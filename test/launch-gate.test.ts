import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRuntime,
  validateBackupVerification,
  validateLaunchEvidence,
} from "../script/launch-gate.mjs";

const revision = "a".repeat(40);

function evidenceItem(status: "approved" | "passed") {
  return {
    status,
    owner: "test-owner",
    at: "2026-08-16T00:00:00.000Z",
    evidenceRef: "test-evidence-reference",
  };
}

function validEvidence() {
  return validateLaunchEvidence({
    format: "voiceops-launch-evidence",
    version: 1,
    environment: {
      kind: "customer",
      name: "customer-production",
      origin: "https://customer.example.com",
      deployedRevision: revision,
    },
    approvals: {
      businessIdentity: evidenceItem("approved"),
      operatingContext: evidenceItem("approved"),
      privacyLegal: evidenceItem("approved"),
      retention: evidenceItem("approved"),
      usageCost: evidenceItem("approved"),
      providerDataTerms: evidenceItem("approved"),
      recovery: evidenceItem("approved"),
      incidentOwnership: evidenceItem("approved"),
    },
    technicalChecks: {
      browserFlow: evidenceItem("passed"),
      restartResume: evidenceItem("passed"),
      recordDeletion: evidenceItem("passed"),
      quotaBoundary: evidenceItem("passed"),
      liveProviderTurn: evidenceItem("passed"),
      soldLocaleVoices: evidenceItem("passed"),
      monitoringFailure: evidenceItem("passed"),
      backupRestore: evidenceItem("passed"),
      rollback: evidenceItem("passed"),
    },
    requiredIntegrations: ["twilio"],
  });
}

function passingRuntime() {
  return {
    live: { status: 200, payload: { ok: true } },
    ready: { status: 200, payload: { ready: true } },
    status: {
      status: 200,
      payload: {
        mode: "live",
        services: { anthropic: true, openai: false, fishAudio: true },
        sessions: { backend: "encrypted-file", durable: true, encrypted: true },
        telephonySessions: { backend: "encrypted-file", durable: true, encrypted: true },
        records: { enabled: true, encrypted: true },
      },
    },
    product: { status: 200, payload: { supportEmail: "support@example.com", privacyUrl: "https://example.com/privacy" } },
    operational: {
      status: 200,
      payload: {
        ready: true,
        revision,
        mode: "live",
        commercial: { enabled: true, ready: true, issues: [] },
        deploymentIssues: [],
      },
    },
    integrations: {
      status: 200,
      payload: { integrations: [{ id: "twilio", configured: true, missing: [] }] },
    },
  };
}

const railwayBackup = {
  entries: 4,
  createdAt: "2026-08-16T00:00:00.000Z",
  sha256: "b".repeat(64),
  sourceKind: "railway-volume-stream",
};

test("launch gate yalnız tüm ticari, runtime ve teknik kanıtlar mevcutken geçer", () => {
  const result = evaluateRuntime(passingRuntime(), validEvidence(), railwayBackup);
  assert.equal(result.passed, true);
  assert.equal(result.checks.every((item: { passed: boolean }) => item.passed), true);
});

test("launch gate public demo ortamını müşteri ortamı saymaz", () => {
  const runtime = passingRuntime();
  runtime.status.payload.mode = "fish-live";
  runtime.operational.payload.mode = "fish-live";
  runtime.operational.payload.commercial.enabled = false;
  const result = evaluateRuntime(runtime, validEvidence(), railwayBackup);
  assert.equal(result.passed, false);
  assert.ok(result.checks.some((item: { id: string; passed: boolean }) => item.id === "customer-mode" && !item.passed));
  assert.ok(result.checks.some((item: { id: string; passed: boolean }) => item.id === "live-provider-mode" && !item.passed));
});

test("launch evidence pending veya eksik onayı reddeder", () => {
  const evidence = {
    format: "voiceops-launch-evidence",
    version: 1,
    environment: {
      kind: "customer",
      name: "customer-production",
      origin: "https://customer.example.com",
      deployedRevision: revision,
    },
    approvals: { businessIdentity: { ...evidenceItem("approved"), status: "pending" } },
    technicalChecks: {},
    requiredIntegrations: [],
  };
  assert.throws(() => validateLaunchEvidence(evidence), /businessIdentity\.status must be approved/i);
});

test("launch gate yerel fixture backup'ını production recovery kanıtı saymaz", () => {
  assert.throws(() => validateBackupVerification({
    ok: true,
    entries: 3,
    manifest: {
      sourceKind: "local-directory",
      createdAt: "2026-08-16T00:00:00.000Z",
      sha256: "b".repeat(64),
    },
  }), /Railway volume stream/i);
});

test("launch gate eski Railway backup'ını güncel recovery kanıtı saymaz", () => {
  assert.throws(() => validateBackupVerification({
    ok: true,
    entries: 3,
    manifest: {
      sourceKind: "railway-volume-stream",
      createdAt: "2026-08-01T00:00:00.000Z",
      sha256: "b".repeat(64),
    },
  }, 24, Date.parse("2026-08-16T00:00:00.000Z")), /older than/i);
});
