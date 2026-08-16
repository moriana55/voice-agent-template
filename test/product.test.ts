import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProductionConfiguration,
  commercialReadiness,
  deploymentSafetyIssues,
  publicProductConfig,
  publicReadinessPayload,
} from "../server/product";

test("müşteri modunda eksik ticari sırları ve sınırları hazır saymaz", () => {
  process.env.CUSTOMER_MODE = "true";
  process.env.PUBLIC_BUSINESS_NAME = "Test İşletmesi";
  process.env.BUSINESS_CONTEXT = "Doğrulanmış test işletmesi bilgisi";
  process.env.PUBLIC_SUPPORT_EMAIL = "destek@example.com";
  process.env.PUBLIC_PRIVACY_URL = "https://example.com/privacy";
  process.env.ADMIN_API_KEY = "admin-test-key";
  process.env.RECORD_STORAGE = "enabled";
  process.env.DATA_ENCRYPTION_KEY = "records-test-key";
  process.env.WEB_SESSION_STORAGE = "encrypted-file";
  process.env.WEB_SESSION_TTL_MINUTES = "120";
  process.env.USAGE_HARD_LIMIT_MINUTES = "500";
  process.env.FISH_AUDIO_API_KEY = "fish-test-key";
  process.env.ANTHROPIC_API_KEY = "brain-test-key";
  process.env.ALLOWED_ORIGINS = "https://voice.example.com";
  process.env.CRM_WEBHOOK_URL = "https://crm.example.com/hook";
  delete process.env.CRM_WEBHOOK_TOKEN;

  const missingToken = commercialReadiness();
  assert.equal(missingToken.ready, false);
  assert.ok(missingToken.issues.includes("CRM_WEBHOOK_TOKEN"));

  process.env.CRM_WEBHOOK_TOKEN = "crm-test-token";
  const ready = commercialReadiness();
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.issues, []);
  assert.equal(publicProductConfig().businessName, "Test İşletmesi");
});

test("production readiness ayrıntıları public yanıtta gizlenir", () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.deepEqual(publicReadinessPayload({
      ready: false,
      deploymentIssues: ["ADMIN_API_KEY"],
      services: { fishAudio: false },
    }), { ready: false });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("production canlı sağlayıcıları şifreleme, origin ve pozitif kota olmadan başlamaz", () => {
  const names = [
    "NODE_ENV", "CUSTOMER_MODE", "FISH_AUDIO_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
    "RECORD_STORAGE", "DATA_ENCRYPTION_KEY", "USAGE_HARD_LIMIT_MINUTES", "ALLOWED_ORIGINS",
    "WEB_REPLICA_COUNT", "ADMIN_API_KEY", "CRM_WEBHOOK_URL", "CRM_WEBHOOK_TOKEN",
    "CALENDAR_WEBHOOK_URL", "CALENDAR_WEBHOOK_TOKEN",
    "INTEGRATION_WEBHOOK_ALLOWED_HOSTS", "PUBLIC_BASE_URL", "PUBLIC_PRIVACY_URL",
    "RECORD_RETENTION_DAYS", "RECORD_PRUNE_INTERVAL_MS", "TURN_RATE_LIMIT",
    "TURN_MAX_CONCURRENCY", "WEB_SESSION_LIMIT", "WEB_SESSION_STORAGE", "WEB_SESSION_TTL_MINUTES",
    "WEB_SESSION_PRUNE_INTERVAL_MS", "APPOINTMENT_DURATION_MINUTES",
    "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
    "TELEPHONY_SESSION_STORAGE", "TELEPHONY_SESSION_TTL_MINUTES",
    "TELEPHONY_SESSION_PRUNE_INTERVAL_MS", "TELEPHONY_SESSION_LIMIT",
    "BUSINESS_TIME_ZONE", "GRACEFUL_SHUTDOWN_MS", "PORT",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NODE_ENV = "production";
    process.env.CUSTOMER_MODE = "false";
    process.env.FISH_AUDIO_API_KEY = "test-provider-key";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.RECORD_STORAGE = "enabled";
    delete process.env.DATA_ENCRYPTION_KEY;
    process.env.USAGE_HARD_LIMIT_MINUTES = "0";
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.WEB_REPLICA_COUNT;
    delete process.env.ADMIN_API_KEY;
    delete process.env.CRM_WEBHOOK_URL;
    delete process.env.CRM_WEBHOOK_TOKEN;
    delete process.env.CALENDAR_WEBHOOK_URL;
    delete process.env.CALENDAR_WEBHOOK_TOKEN;
    delete process.env.INTEGRATION_WEBHOOK_ALLOWED_HOSTS;
    delete process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_PRIVACY_URL = "https://voice.example.com/privacy";
    delete process.env.RECORD_RETENTION_DAYS;
    delete process.env.RECORD_PRUNE_INTERVAL_MS;
    delete process.env.TURN_RATE_LIMIT;
    delete process.env.TURN_MAX_CONCURRENCY;
    delete process.env.WEB_SESSION_LIMIT;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    delete process.env.TELEPHONY_SESSION_STORAGE;
    delete process.env.TELEPHONY_SESSION_TTL_MINUTES;
    delete process.env.TELEPHONY_SESSION_PRUNE_INTERVAL_MS;
    delete process.env.TELEPHONY_SESSION_LIMIT;
    delete process.env.APPOINTMENT_DURATION_MINUTES;
    delete process.env.BUSINESS_TIME_ZONE;
    delete process.env.GRACEFUL_SHUTDOWN_MS;
    process.env.PORT = "5177";

    const issues = deploymentSafetyIssues();
    assert.ok(issues.includes("DATA_ENCRYPTION_KEY|RECORD_STORAGE=disabled"));
    assert.ok(issues.includes("USAGE_HARD_LIMIT_MINUTES"));
    assert.ok(issues.includes("ALLOWED_ORIGINS"));
    assert.ok(issues.some((issue) => issue.startsWith("WEB_REPLICA_COUNT=1")));
    assert.throws(assertProductionConfiguration, /Güvensiz production/i);

    process.env.DATA_ENCRYPTION_KEY = "test-encryption-key-32-characters-minimum";
    process.env.USAGE_HARD_LIMIT_MINUTES = "500";
    process.env.ALLOWED_ORIGINS = "https://voice.example.com";
    process.env.WEB_REPLICA_COUNT = "1";
    assert.deepEqual(deploymentSafetyIssues(), []);
    assert.doesNotThrow(assertProductionConfiguration);

    process.env.TWILIO_ACCOUNT_SID = "AC-test";
    process.env.TWILIO_AUTH_TOKEN = "twilio-test-token";
    process.env.TWILIO_PHONE_NUMBER = "+15551234567";
    process.env.PUBLIC_BASE_URL = "https://voice.example.com";
    const ephemeralPhoneIssues = deploymentSafetyIssues();
    assert.ok(ephemeralPhoneIssues.includes("TELEPHONY_SESSION_STORAGE=encrypted-file"));
    assert.ok(ephemeralPhoneIssues.includes("TELEPHONY_SESSION_TTL_MINUTES"));
    process.env.TELEPHONY_SESSION_STORAGE = "encrypted-file";
    process.env.TELEPHONY_SESSION_TTL_MINUTES = "120";
    assert.deepEqual(deploymentSafetyIssues(), []);

    process.env.CRM_WEBHOOK_URL = "https://crm.example.com/hook";
    process.env.INTEGRATION_WEBHOOK_ALLOWED_HOSTS = "crm.example.com";
    delete process.env.CRM_WEBHOOK_TOKEN;
    assert.ok(deploymentSafetyIssues().includes("CRM_WEBHOOK_TOKEN"));

    process.env.CRM_WEBHOOK_URL = "https://evil.example/hook";
    process.env.CRM_WEBHOOK_TOKEN = "x".repeat(32);
    process.env.INTEGRATION_WEBHOOK_ALLOWED_HOSTS = "crm.example.com";
    process.env.PUBLIC_BASE_URL = "http://voice.example.com";
    process.env.PUBLIC_PRIVACY_URL = "javascript:alert(1)";
    process.env.ALLOWED_ORIGINS = "not-an-origin";
    process.env.RECORD_RETENTION_DAYS = "NaN";
    process.env.RECORD_PRUNE_INTERVAL_MS = "1000";
    process.env.TURN_MAX_CONCURRENCY = "0";
    process.env.WEB_SESSION_TTL_MINUTES = "1";
    process.env.WEB_SESSION_PRUNE_INTERVAL_MS = "10";
    process.env.TELEPHONY_SESSION_TTL_MINUTES = "2";
    process.env.TELEPHONY_SESSION_PRUNE_INTERVAL_MS = "10";
    process.env.TELEPHONY_SESSION_LIMIT = "0";
    process.env.APPOINTMENT_DURATION_MINUTES = "241";
    process.env.BUSINESS_TIME_ZONE = "Mars/Olympus_Mons";
    process.env.GRACEFUL_SHUTDOWN_MS = "999";
    process.env.PORT = "70000";
    const malformedIssues = deploymentSafetyIssues();
    assert.ok(malformedIssues.includes("CRM_WEBHOOK_URL(invalid or not allowlisted)"));
    assert.ok(malformedIssues.includes("PUBLIC_BASE_URL(HTTPS origin required)"));
    assert.ok(malformedIssues.includes("PUBLIC_PRIVACY_URL(invalid scheme)"));
    assert.ok(malformedIssues.includes("ALLOWED_ORIGINS(valid origins required)"));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("RECORD_RETENTION_DAYS(")));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("RECORD_PRUNE_INTERVAL_MS(")));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("TURN_MAX_CONCURRENCY(")));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("WEB_SESSION_TTL_MINUTES(")));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("WEB_SESSION_PRUNE_INTERVAL_MS(")));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("TELEPHONY_SESSION_TTL_MINUTES(")));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("TELEPHONY_SESSION_PRUNE_INTERVAL_MS(")));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("TELEPHONY_SESSION_LIMIT(")));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("APPOINTMENT_DURATION_MINUTES(")));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("BUSINESS_TIME_ZONE(")));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("GRACEFUL_SHUTDOWN_MS(")));
    assert.ok(malformedIssues.some((issue) => issue.startsWith("PORT(")));
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
