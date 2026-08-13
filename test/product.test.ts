import test from "node:test";
import assert from "node:assert/strict";
import { commercialReadiness, publicProductConfig } from "../server/product";

test("müşteri modunda eksik ticari sırları ve sınırları hazır saymaz", () => {
  process.env.CUSTOMER_MODE = "true";
  process.env.PUBLIC_BUSINESS_NAME = "Test İşletmesi";
  process.env.BUSINESS_CONTEXT = "Doğrulanmış test işletmesi bilgisi";
  process.env.PUBLIC_SUPPORT_EMAIL = "destek@example.com";
  process.env.PUBLIC_PRIVACY_URL = "https://example.com/privacy";
  process.env.ADMIN_API_KEY = "admin-test-key";
  process.env.RECORD_STORAGE = "enabled";
  process.env.DATA_ENCRYPTION_KEY = "records-test-key";
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
