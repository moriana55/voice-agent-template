import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const MAGIC = Buffer.from("VOPSBK01");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const deriveKey = promisify(scrypt);

function fail(message) {
  throw new Error(message);
}

async function readPassphrase(keyFile) {
  const file = await stat(keyFile);
  if (!file.isFile()) fail("Backup key path must be a regular file.");
  if (process.platform !== "win32" && (file.mode & 0o077) !== 0) {
    fail("Backup key file must not be readable or writable by group/others (chmod 600).");
  }
  const passphrase = (await readFile(keyFile, "utf8")).replace(/\r?\n$/u, "");
  if (passphrase.length < 32) fail("Backup passphrase must contain at least 32 characters.");
  return passphrase;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function scanSafeTree(directory) {
  let files = 0;
  let directories = 0;
  let bytes = 0;
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    directories += 1;
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const details = await lstat(entryPath);
      if (details.isSymbolicLink()) fail(`Backup source contains a symbolic link: ${entry.name}`);
      if (details.isDirectory()) await visit(entryPath);
      else if (details.isFile()) {
        files += 1;
        bytes += details.size;
      } else {
        fail(`Backup source contains an unsupported special file: ${entry.name}`);
      }
    }
  }
  await visit(directory);
  return { files, directories, bytes };
}

function processResult(child, label) {
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    if (stderr.length < 8_000) stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      if (child.exitCode === 0) resolve();
      else reject(new Error(`${label} failed (${child.exitCode}): ${stderr.trim().slice(0, 2_000)}`));
      return;
    }
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${signal || code}): ${stderr.trim().slice(0, 2_000)}`));
    });
  });
}

async function encryptStream(input, outputPath, passphrase) {
  const bufferedInput = new PassThrough();
  input.once("error", (error) => bufferedInput.destroy(error));
  input.pipe(bufferedInput);
  if (await pathExists(outputPath)) fail(`Backup output already exists: ${outputPath}`);
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true, mode: 0o700 });
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt, 32, SCRYPT_OPTIONS);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const header = Buffer.concat([MAGIC, salt, iv]);

  async function* encryptedChunks() {
    yield header;
    for await (const chunk of bufferedInput) yield cipher.update(chunk);
    yield cipher.final();
    yield cipher.getAuthTag();
  }

  try {
    await pipeline(Readable.from(encryptedChunks()), createWriteStream(temporaryPath, {
      flags: "wx",
      mode: 0o600,
    }));
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function encryptedFileMetadata(backupPath) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(backupPath)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { encryptedBytes: bytes, sha256: hash.digest("hex") };
}

async function decryptionStream(backupPath, passphrase) {
  const details = await stat(backupPath);
  if (!details.isFile() || details.size <= HEADER_BYTES + TAG_BYTES) fail("Backup file is truncated or invalid.");
  const handle = await open(backupPath, "r");
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read({ buffer: header, position: 0 });
    await handle.read({ buffer: tag, position: details.size - TAG_BYTES });
    const magic = header.subarray(0, MAGIC.length);
    if (magic.length !== MAGIC.length || !timingSafeEqual(magic, MAGIC)) fail("Unsupported backup format.");
    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
    const iv = header.subarray(MAGIC.length + SALT_BYTES);
    const key = await deriveKey(passphrase, salt, 32, SCRYPT_OPTIONS);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    async function* decryptedChunks() {
      const encrypted = createReadStream(backupPath, {
        start: HEADER_BYTES,
        end: details.size - TAG_BYTES - 1,
      });
      for await (const chunk of encrypted) yield decipher.update(chunk);
      yield decipher.final();
    }
    return Readable.from(decryptedChunks());
  } finally {
    await handle.close();
  }
}

async function collectOutput(stream, maximumBytes = 16 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maximumBytes) fail("Archive listing exceeds the safety limit.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function writeChildInput(input, writable) {
  try {
    for await (const chunk of input) {
      if (!writable.write(chunk)) await once(writable, "drain");
    }
    const finished = once(writable, "finish");
    writable.end();
    await finished;
  } catch (error) {
    writable.destroy(error);
    throw error;
  }
}

async function runTarRead(backupPath, passphrase, args, label) {
  const child = spawn("tar", args, { stdio: ["pipe", "pipe", "pipe"] });
  const childResult = processResult(child, label);
  const decrypted = await decryptionStream(backupPath, passphrase);
  const outputPromise = collectOutput(child.stdout);
  try {
    await Promise.all([
      writeChildInput(decrypted, child.stdin),
      childResult,
    ]);
  } catch (error) {
    child.kill();
    throw error;
  }
  return outputPromise;
}

function validateArchiveNames(listing) {
  const names = listing.split("\n").filter(Boolean);
  if (!names.length) fail("Backup archive is empty.");
  if (names.length > 100_000) fail("Backup archive has too many entries.");
  for (const rawName of names) {
    const name = rawName.replace(/^\.\//u, "");
    if (!name || name === ".") continue;
    if (name.startsWith("/") || name.includes("\\") || name.includes("\0")) {
      fail("Backup archive contains an unsafe path.");
    }
    if (name.split("/").includes("..")) fail("Backup archive contains path traversal.");
  }
  return names.length;
}

function validateArchiveTypes(listing) {
  const lines = listing.split("\n").filter(Boolean);
  for (const line of lines) {
    if (!["-", "d"].includes(line[0])) {
      fail(`Backup archive contains an unsupported entry type: ${line[0] || "unknown"}`);
    }
  }
}

async function verifyManifest(backupPath) {
  const manifestPath = `${backupPath}.manifest.json`;
  if (!(await pathExists(manifestPath))) return null;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.format !== "voiceops-encrypted-backup" || manifest.version !== 1) {
    fail("Backup manifest format is invalid.");
  }
  const actual = await encryptedFileMetadata(backupPath);
  if (manifest.encryptedBytes !== actual.encryptedBytes || manifest.sha256 !== actual.sha256) {
    fail("Backup manifest checksum does not match the encrypted archive.");
  }
  return manifest;
}

export async function verifyBackup({ backupPath, keyFile }) {
  const passphrase = await readPassphrase(keyFile);
  const manifest = await verifyManifest(backupPath);
  const names = await runTarRead(backupPath, passphrase, ["-tzf", "-"], "Archive name verification");
  const entries = validateArchiveNames(await names);
  const verbose = await runTarRead(backupPath, passphrase, ["-tvzf", "-"], "Archive type verification");
  validateArchiveTypes(await verbose);
  return { ok: true, entries, manifest };
}

async function writeManifest(backupPath, sourceKind, sourceSummary) {
  const metadata = await encryptedFileMetadata(backupPath);
  const manifest = {
    format: "voiceops-encrypted-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    sourceKind,
    cipher: "AES-256-GCM",
    kdf: { name: "scrypt", N: SCRYPT_OPTIONS.N, r: SCRYPT_OPTIONS.r, p: SCRYPT_OPTIONS.p },
    ...metadata,
    sourceSummary,
  };
  await writeFile(`${backupPath}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return manifest;
}

async function finalizeCreatedBackup({ backupPath, keyFile, sourceKind, sourceSummary }) {
  try {
    const manifest = await writeManifest(backupPath, sourceKind, sourceSummary);
    const verification = await verifyBackup({ backupPath, keyFile });
    return { ...verification, manifest };
  } catch (error) {
    await Promise.all([
      rm(backupPath, { force: true }),
      rm(`${backupPath}.manifest.json`, { force: true }),
    ]);
    throw error;
  }
}

export async function createLocalBackup({ source, outputPath, keyFile }) {
  const sourcePath = path.resolve(source);
  const details = await stat(sourcePath);
  if (!details.isDirectory()) fail("Backup source must be a directory.");
  if (await pathExists(`${outputPath}.manifest.json`)) fail("Backup manifest already exists.");
  const sourceSummary = await scanSafeTree(sourcePath);
  const passphrase = await readPassphrase(keyFile);
  const child = spawn("tar", ["-czf", "-", "-C", sourcePath, "."], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const childResult = processResult(child, "Archive creation");
  try {
    await Promise.all([
      encryptStream(child.stdout, outputPath, passphrase),
      childResult,
    ]);
    return finalizeCreatedBackup({ backupPath: outputPath, keyFile, sourceKind: "local-directory", sourceSummary });
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function createRailwayBackup({ outputPath, keyFile, mountPath = "/app/data" }) {
  if (!mountPath.startsWith("/") || mountPath.includes("..")) fail("Railway mount path is invalid.");
  if (await pathExists(`${outputPath}.manifest.json`)) fail("Backup manifest already exists.");
  const passphrase = await readPassphrase(keyFile);
  const child = spawn("railway", ["ssh", "tar", "-czf", "-", "-C", mountPath, "."], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const childResult = processResult(child, "Railway volume archive");
  try {
    await Promise.all([
      encryptStream(child.stdout, outputPath, passphrase),
      childResult,
    ]);
    return finalizeCreatedBackup({
      backupPath: outputPath,
      keyFile,
      sourceKind: "railway-volume-stream",
      sourceSummary: { mountPath },
    });
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function restoreBackup({ backupPath, destination, keyFile }) {
  const destinationPath = path.resolve(destination);
  if (await pathExists(destinationPath)) fail("Restore destination already exists.");
  await verifyBackup({ backupPath, keyFile });
  await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  const stagingPath = path.join(path.dirname(destinationPath), `.${path.basename(destinationPath)}.${randomUUID()}.restore`);
  await mkdir(stagingPath, { mode: 0o700 });
  const passphrase = await readPassphrase(keyFile);
  const child = spawn("tar", ["-xzf", "-", "-C", stagingPath], { stdio: ["pipe", "ignore", "pipe"] });
  const childResult = processResult(child, "Archive extraction");
  try {
    const decrypted = await decryptionStream(backupPath, passphrase);
    await Promise.all([
      writeChildInput(decrypted, child.stdin),
      childResult,
    ]);
    await scanSafeTree(stagingPath);
    await chmod(stagingPath, 0o700);
    await rename(stagingPath, destinationPath);
  } catch (error) {
    child.kill();
    await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return { ok: true, destination: destinationPath };
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) fail(`Invalid option near ${name || "end"}.`);
    options[name.slice(2)] = value;
  }
  return options;
}

function required(options, name) {
  if (!options[name]) fail(`Missing --${name}.`);
  return options[name];
}

async function main() {
  const command = process.argv[2];
  const options = parseOptions(process.argv.slice(3));
  let result;
  if (command === "create") {
    result = await createLocalBackup({
      source: required(options, "source"),
      outputPath: required(options, "output"),
      keyFile: required(options, "key-file"),
    });
  } else if (command === "create-railway") {
    result = await createRailwayBackup({
      outputPath: required(options, "output"),
      keyFile: required(options, "key-file"),
      mountPath: options["mount-path"] || "/app/data",
    });
  } else if (command === "verify") {
    result = await verifyBackup({
      backupPath: required(options, "backup"),
      keyFile: required(options, "key-file"),
    });
  } else if (command === "restore") {
    result = await restoreBackup({
      backupPath: required(options, "backup"),
      destination: required(options, "destination"),
      keyFile: required(options, "key-file"),
    });
  } else {
    fail("Usage: encrypted-backup.mjs <create|create-railway|verify|restore> [options]");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Backup command failed."}\n`);
    process.exitCode = 1;
  });
}
