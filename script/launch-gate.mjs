import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const backupScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "encrypted-backup.mjs");
const approvalIds = [
  "businessIdentity",
  "operatingContext",
  "privacyLegal",
  "retention",
  "usageCost",
  "providerDataTerms",
  "recovery",
  "incidentOwnership",
];
const technicalCheckIds = [
  "browserFlow",
  "restartResume",
  "recordDeletion",
  "quotaBoundary",
  "liveProviderTurn",
  "soldLocaleVoices",
  "monitoringFailure",
  "backupRestore",
  "rollback",
];
const integrationIds = new Set([
  "twilio",
  "googleCalendar",
  "hubspot",
  "stripe",
  "genericCrmWebhook",
  "genericCalendarWebhook",
]);
const allowedOptions = new Set([
  "base-url",
  "admin-key-file",
  "evidence",
  "backup",
  "backup-key-file",
  "backup-max-age-hours",
  "output",
]);

function fail(message) {
  throw new Error(message);
}

function requiredText(value, label, maximum = 240) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    fail(`${label} must be a non-empty string of at most ${maximum} characters.`);
  }
  return value.trim();
}

function evidenceItem(value, label, expectedStatus) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is missing.`);
  if (value.status !== expectedStatus) fail(`${label}.status must be ${expectedStatus}.`);
  const owner = requiredText(value.owner, `${label}.owner`, 120);
  const evidenceRef = requiredText(value.evidenceRef, `${label}.evidenceRef`, 240);
  const at = requiredText(value.at, `${label}.at`, 40);
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 60_000) fail(`${label}.at must be a past ISO timestamp.`);
  return { status: expectedStatus, owner, evidenceRef, at: new Date(timestamp).toISOString() };
}

export function validateLaunchEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Launch evidence must be an object.");
  if (value.format !== "voiceops-launch-evidence" || value.version !== 2) fail("Launch evidence format is invalid.");
  if (!value.environment || typeof value.environment !== "object" || Array.isArray(value.environment)) {
    fail("Launch evidence environment is missing.");
  }
  if (value.environment.kind !== "customer") fail("Launch environment kind must be customer.");
  const name = requiredText(value.environment.name, "environment.name", 120);
  const origin = safeBaseUrl(requiredText(value.environment.origin, "environment.origin", 2_048));
  const deployedRevision = requiredText(value.environment.deployedRevision, "environment.deployedRevision", 40).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(deployedRevision)) fail("environment.deployedRevision must be a 40-character git SHA.");
  const railwayDeploymentId = requiredText(
    value.environment.railwayDeploymentId,
    "environment.railwayDeploymentId",
    36,
  ).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(railwayDeploymentId)) {
    fail("environment.railwayDeploymentId must be a UUID.");
  }

  const approvals = {};
  for (const id of approvalIds) approvals[id] = evidenceItem(value.approvals?.[id], `approvals.${id}`, "approved");
  const technicalChecks = {};
  for (const id of technicalCheckIds) {
    technicalChecks[id] = evidenceItem(value.technicalChecks?.[id], `technicalChecks.${id}`, "passed");
  }

  if (!Array.isArray(value.requiredIntegrations)) fail("requiredIntegrations must be an array.");
  const requiredIntegrations = [...new Set(value.requiredIntegrations.map((item) => requiredText(item, "requiredIntegrations item", 60)))];
  for (const id of requiredIntegrations) if (!integrationIds.has(id)) fail(`Unsupported required integration: ${id}.`);

  return {
    format: value.format,
    version: value.version,
    environment: { kind: "customer", name, origin, deployedRevision, railwayDeploymentId },
    approvals,
    technicalChecks,
    requiredIntegrations,
  };
}

function addCheck(checks, id, passed, detail) {
  checks.push({ id, passed: Boolean(passed), detail });
}

export function validateBackupVerification(value, maximumAgeHours = 24, now = Date.now()) {
  if (value?.ok !== true || !Number.isInteger(value.entries) || value.entries < 1) {
    fail("Encrypted backup verification did not succeed.");
  }
  if (value.manifestAuthenticated !== true) fail("Launch backup manifest must be cryptographically authenticated.");
  const manifest = value.manifest;
  if (!manifest || manifest.version !== 2 || manifest.sourceKind !== "railway-volume-stream") {
    fail("Launch backup must be a verified Railway volume stream, not a local fixture.");
  }
  if (!/^[0-9a-f]{64}$/i.test(manifest.sha256 || "")) fail("Launch backup manifest SHA-256 is invalid.");
  const createdAt = requiredText(manifest.createdAt, "backup manifest createdAt", 40);
  const createdTimestamp = Date.parse(createdAt);
  if (!Number.isFinite(createdTimestamp) || createdTimestamp > now + 60_000) fail("Launch backup timestamp is invalid.");
  if (!Number.isFinite(maximumAgeHours) || maximumAgeHours < 1 || maximumAgeHours > 168) {
    fail("Backup maximum age must be between 1 and 168 hours.");
  }
  if (now - createdTimestamp > maximumAgeHours * 60 * 60 * 1_000) fail("Launch backup is older than the allowed maximum age.");
  return {
    entries: value.entries,
    createdAt: new Date(createdTimestamp).toISOString(),
    sha256: manifest.sha256.toLowerCase(),
    sourceKind: manifest.sourceKind,
  };
}

export function evaluateRuntime(runtime, evidence, backup) {
  const checks = [];
  const { live, ready, status, product, operational, integrations } = runtime;
  addCheck(checks, "liveness", live.status === 200 && live.payload?.ok === true, "Public liveness is healthy");
  addCheck(checks, "public-readiness", ready.status === 200 && ready.payload?.ready === true, "Public readiness is closed unless all runtime gates pass");
  addCheck(checks, "admin-readiness", operational.status === 200 && operational.payload?.ready === true, "Authenticated readiness is healthy");
  addCheck(checks, "status-contract", status.status === 200, "Runtime status endpoint is healthy");
  addCheck(checks, "product-contract", product.status === 200, "Public product contract is healthy");
  addCheck(checks, "integration-contract", integrations.status === 200, "Authenticated integration contract is healthy");
  addCheck(checks, "customer-mode", operational.payload?.commercial?.enabled === true, "CUSTOMER_MODE is enabled");
  addCheck(checks, "commercial-config", operational.payload?.commercial?.ready === true
    && operational.payload?.commercial?.issues?.length === 0, "Commercial configuration has no missing fields");
  addCheck(checks, "deployment-safety", operational.payload?.deploymentIssues?.length === 0, "Deployment safety has no open issues");
  addCheck(checks, "revision", operational.payload?.revision === evidence.environment.deployedRevision,
    "Runtime revision matches approved evidence");
  addCheck(checks, "railway-deployment", operational.payload?.railwayDeploymentId === evidence.environment.railwayDeploymentId,
    "Runtime Railway deployment matches approved evidence");
  addCheck(checks, "live-provider-mode", status.payload?.mode === "live" && operational.payload?.mode === "live",
    "LLM and voice providers are live without fallback");
  addCheck(checks, "brain-provider", status.payload?.services?.anthropic === true || status.payload?.services?.openai === true,
    "At least one live intelligence provider is healthy");
  addCheck(checks, "voice-provider", status.payload?.services?.fishAudio === true, "Fish Audio is healthy and funded");
  addCheck(checks, "web-session-durability", status.payload?.sessions?.backend === "encrypted-file"
    && status.payload?.sessions?.durable === true && status.payload?.sessions?.encrypted === true,
  "Web sessions are encrypted and restart-persistent");
  addCheck(checks, "record-privacy", status.payload?.records?.enabled === false || status.payload?.records?.encrypted === true,
    "Completed record storage is disabled or encrypted");
  addCheck(checks, "privacy-contact", Boolean(product.payload?.supportEmail && product.payload?.privacyUrl),
    "Public support and privacy routes are configured");

  const availableIntegrations = new Map((integrations.payload?.integrations || []).map((item) => [item.id, item]));
  for (const id of evidence.requiredIntegrations) {
    const integration = availableIntegrations.get(id);
    addCheck(checks, `integration:${id}`, integration?.configured === true && integration?.missing?.length === 0,
      `${id} is configured`);
  }
  if (evidence.requiredIntegrations.includes("twilio")) {
    addCheck(checks, "telephony-session-durability", status.payload?.telephonySessions?.backend === "encrypted-file"
      && status.payload?.telephonySessions?.durable === true && status.payload?.telephonySessions?.encrypted === true,
    "Twilio sessions are encrypted and restart-persistent");
  }
  addCheck(checks, "railway-backup", backup.sourceKind === "railway-volume-stream" && backup.entries > 0,
    "A current encrypted Railway volume backup decrypts and validates");
  for (const id of approvalIds) addCheck(checks, `approval:${id}`, evidence.approvals[id]?.status === "approved", `${id} is approved`);
  for (const id of technicalCheckIds) {
    addCheck(checks, `evidence:${id}`, evidence.technicalChecks[id]?.status === "passed", `${id} has dated evidence`);
  }
  return { passed: checks.every((item) => item.passed), checks };
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) fail(`Invalid option near ${name || "end"}.`);
    const key = name.slice(2);
    if (!allowedOptions.has(key)) fail(`Unknown option ${name}.`);
    if (options[key]) fail(`Duplicate option ${name}.`);
    options[key] = value;
  }
  return options;
}

function requiredOption(options, name) {
  return requiredText(options[name], `--${name}`, 2_048);
}

function safeBaseUrl(value) {
  const parsed = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))
    || parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
    fail("--base-url must be an HTTPS origin (HTTP is allowed only for loopback tests).");
  }
  return parsed.origin;
}

async function readAdminKey(keyPath) {
  const details = await lstat(keyPath);
  if (!details.isFile() || details.isSymbolicLink()) fail("Admin key path must be a regular file.");
  if ((details.mode & 0o077) !== 0) fail("Admin key file permissions must be 0600.");
  const key = (await readFile(keyPath, "utf8")).trim();
  if (key.length < 32) fail("Admin key must contain at least 32 characters.");
  return key;
}

async function requestJson(baseUrl, pathname, adminKey) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: adminKey ? { authorization: `Bearer ${adminKey}` } : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (text.length > 256 * 1024) fail(`${pathname} returned an oversized response.`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail(`${pathname} did not return JSON.`);
  }
  return { status: response.status, payload };
}

async function verifyEncryptedBackup(backupPath, keyFile, maximumAgeHours) {
  const result = await execFileAsync(process.execPath, [
    backupScript,
    "verify",
    "--backup", backupPath,
    "--key-file", keyFile,
  ], { maxBuffer: 2 * 1024 * 1024 });
  return validateBackupVerification(JSON.parse(result.stdout), maximumAgeHours);
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const baseUrl = safeBaseUrl(requiredOption(options, "base-url"));
  const evidencePath = path.resolve(requiredOption(options, "evidence"));
  const evidenceBytes = await readFile(evidencePath);
  const evidence = validateLaunchEvidence(JSON.parse(evidenceBytes.toString("utf8")));
  if (evidence.environment.origin !== baseUrl) fail("--base-url does not match the customer origin approved in launch evidence.");
  const adminKey = await readAdminKey(path.resolve(requiredOption(options, "admin-key-file")));
  const maximumBackupAge = options["backup-max-age-hours"] === undefined
    ? 24
    : Number(options["backup-max-age-hours"]);
  const backup = await verifyEncryptedBackup(
    path.resolve(requiredOption(options, "backup")),
    path.resolve(requiredOption(options, "backup-key-file")),
    maximumBackupAge,
  );
  const [live, ready, status, product, operational, integrations] = await Promise.all([
    requestJson(baseUrl, "/api/health/live"),
    requestJson(baseUrl, "/api/health/ready"),
    requestJson(baseUrl, "/api/status"),
    requestJson(baseUrl, "/api/product"),
    requestJson(baseUrl, "/api/admin/readiness", adminKey),
    requestJson(baseUrl, "/api/admin/integrations", adminKey),
  ]);
  const evaluation = evaluateRuntime({ live, ready, status, product, operational, integrations }, evidence, backup);
  const report = {
    format: "voiceops-launch-gate-report",
    version: 2,
    generatedAt: new Date().toISOString(),
    targetOrigin: baseUrl,
    environment: evidence.environment.name,
    revision: evidence.environment.deployedRevision,
    railwayDeploymentId: evidence.environment.railwayDeploymentId,
    evidenceSha256: createHash("sha256").update(evidenceBytes).digest("hex"),
    backup,
    ...evaluation,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) await writeFile(path.resolve(options.output), serialized, { flag: "wx", mode: 0o600 });
  else process.stdout.write(serialized);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Launch gate failed."}\n`);
    process.exitCode = 1;
  });
}
