import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { railwayArchiveArgs } from "../script/encrypted-backup.mjs";

const execFileAsync = promisify(execFile);
const backupScript = path.resolve("script/encrypted-backup.mjs");

test("Railway backup komutu SSH seçeneklerini remote tar komutundan ayırır", () => {
  assert.deepEqual(railwayArchiveArgs("/app/data", "/secure/railway.key"), [
    "ssh",
    "--identity-file",
    path.resolve("/secure/railway.key"),
    "--",
    "tar",
    "-czf",
    "-",
    "-C",
    "/app/data",
    ".",
  ]);
});

async function runBackup(...args: string[]) {
  const result = await execFileAsync(process.execPath, [backupScript, ...args], {
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

test("şifreli volume backup doğrulanır, bozulma reddedilir ve izole dizine geri yüklenir", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "voiceops-backup-"));
  const source = path.join(root, "source");
  const restored = path.join(root, "restored");
  const backup = path.join(root, "voiceops.vopsbackup");
  const keyFile = path.join(root, "backup.key");
  const wrongKeyFile = path.join(root, "wrong.key");
  try {
    await mkdir(path.join(source, "nested"), { recursive: true });
    await writeFile(path.join(source, "call-records.jsonl"), "customer-private-record\n", { mode: 0o600 });
    await writeFile(path.join(source, "nested", "usage-events.jsonl"), "{\"turns\":3}\n", { mode: 0o600 });
    await writeFile(keyFile, "correct-backup-passphrase-with-more-than-thirty-two-characters\n", { mode: 0o600 });
    await writeFile(wrongKeyFile, "incorrect-backup-passphrase-with-more-than-thirty-two-characters\n", { mode: 0o600 });
    await chmod(keyFile, 0o600);
    await chmod(wrongKeyFile, 0o600);

    const created = await runBackup("create", "--source", source, "--output", backup, "--key-file", keyFile);
    assert.equal(created.ok, true);
    assert.equal(created.manifestAuthenticated, true);
    assert.equal((created.manifest as { version: number; sourceKind: string }).version, 2);
    assert.equal((created.manifest as { version: number; sourceKind: string }).sourceKind, "local-directory");
    assert.doesNotMatch((await readFile(backup)).toString("utf8"), /customer-private-record/u);

    const verified = await runBackup("verify", "--backup", backup, "--key-file", keyFile);
    assert.equal(verified.ok, true);
    assert.equal(verified.manifestAuthenticated, true);
    assert.ok(Number(verified.entries) >= 3);

    const metadataTampered = path.join(root, "metadata-tampered.vopsbackup");
    await copyFile(backup, metadataTampered);
    const metadataManifest = JSON.parse(await readFile(`${backup}.manifest.json`, "utf8"));
    metadataManifest.sourceKind = "railway-volume-stream";
    await writeFile(`${metadataTampered}.manifest.json`, `${JSON.stringify(metadataManifest, null, 2)}\n`, { mode: 0o600 });
    await assert.rejects(
      runBackup("verify", "--backup", metadataTampered, "--key-file", keyFile),
      /manifest authentication failed/i,
    );

    const legacyBackup = path.join(root, "legacy-v1.vopsbackup");
    await copyFile(backup, legacyBackup);
    const legacyManifest = JSON.parse(await readFile(`${backup}.manifest.json`, "utf8"));
    legacyManifest.version = 1;
    delete legacyManifest.authentication;
    await writeFile(`${legacyBackup}.manifest.json`, `${JSON.stringify(legacyManifest, null, 2)}\n`, { mode: 0o600 });
    const legacyVerified = await runBackup("verify", "--backup", legacyBackup, "--key-file", keyFile);
    assert.equal(legacyVerified.ok, true);
    assert.equal(legacyVerified.manifestAuthenticated, false);

    await assert.rejects(
      runBackup("verify", "--backup", backup, "--key-file", wrongKeyFile),
      /authenticate|verification|failed|incorrect|invalid/i,
    );

    const restoredResult = await runBackup(
      "restore", "--backup", backup, "--destination", restored, "--key-file", keyFile,
    );
    assert.equal(restoredResult.ok, true);
    assert.equal(await readFile(path.join(restored, "call-records.jsonl"), "utf8"), "customer-private-record\n");
    assert.equal(await readFile(path.join(restored, "nested", "usage-events.jsonl"), "utf8"), "{\"turns\":3}\n");
    await assert.rejects(
      runBackup("restore", "--backup", backup, "--destination", restored, "--key-file", keyFile),
      /already exists/i,
    );

    const tampered = path.join(root, "tampered.vopsbackup");
    await copyFile(backup, tampered);
    await copyFile(`${backup}.manifest.json`, `${tampered}.manifest.json`);
    const tamperedBytes = await readFile(tampered);
    tamperedBytes[Math.floor(tamperedBytes.length / 2)] ^= 0xff;
    await writeFile(tampered, tamperedBytes, { mode: 0o600 });
    await assert.rejects(
      runBackup("verify", "--backup", tampered, "--key-file", keyFile),
      /checksum does not match/i,
    );

    const unsafeSource = path.join(root, "unsafe-source");
    await mkdir(unsafeSource);
    await symlink(path.join(source, "call-records.jsonl"), path.join(unsafeSource, "record-link"));
    await assert.rejects(
      runBackup(
        "create", "--source", unsafeSource, "--output", path.join(root, "unsafe.vopsbackup"),
        "--key-file", keyFile,
      ),
      /symbolic link/i,
    );

    const identityLink = path.join(root, "railway-identity-link");
    await symlink(keyFile, identityLink);
    await assert.rejects(
      runBackup(
        "create-railway", "--output", path.join(root, "railway.vopsbackup"),
        "--key-file", keyFile, "--identity-file", identityLink,
      ),
      /identity path must be a regular file/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
