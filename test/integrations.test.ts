import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("randevu tarihini Google Calendar zaman aralığına dönüştürür", async () => {
  process.env.BUSINESS_TIME_ZONE = "Europe/Istanbul";
  process.env.APPOINTMENT_DURATION_MINUTES = "30";
  const { appointmentWindow } = await import("../server/integrations");
  const window = appointmentWindow({ requestedDate: "tomorrow", requestedTime: "3 pm" });
  assert.ok(window);
  assert.match(window.start, /T15:00:00$/);
  assert.match(window.end, /T15:30:00$/);
  assert.equal(window.timeZone, "Europe/Istanbul");
});

test("entegrasyon durumu sırları göstermeden eksik ayarları bildirir", async () => {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_PHONE_NUMBER;
  const { integrationStatuses } = await import("../server/integrations");
  const twilio = integrationStatuses().find((item) => item.id === "twilio");
  assert.equal(twilio?.configured, false);
  assert.ok(twilio?.missing.includes("TWILIO_ACCOUNT_SID"));
  assert.equal(JSON.stringify(twilio).includes("AUTH_TOKEN="), false);
});

test("CRM webhook aktarımını kimlik doğrulama ve idempotency ile yapar", async () => {
  process.env.CRM_WEBHOOK_URL = "https://crm.example.com/voiceops";
  process.env.CRM_WEBHOOK_TOKEN = "test-webhook-token";
  delete process.env.HUBSPOT_ACCESS_TOKEN;
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return new Response(null, { status: 204 });
  };
  try {
    const { forwardCallIntegrations } = await import("../server/integrations");
    const forwarded = await forwardCallIntegrations({
      id: "b683e224-80ab-44db-995f-3ca90ef920d1",
      callId: "call-1",
      locale: "en",
      createdAt: new Date().toISOString(),
      intent: "fiyat",
      name: "Jane Miller",
      phone: "+15550000104",
      requestedDate: null,
      requestedTime: null,
      summary: "Pricing request",
      transcript: "I need pricing information.",
    });
    assert.equal(forwarded, true);
    assert.equal((request?.headers as Record<string, string>)["idempotency-key"], "b683e224-80ab-44db-995f-3ca90ef920d1");
    assert.equal((request?.headers as Record<string, string>).authorization, "Bearer test-webhook-token");
    assert.equal(request?.redirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CRM_WEBHOOK_URL;
    delete process.env.CRM_WEBHOOK_TOKEN;
  }
});

test("Stripe webhook imzasını doğrular ve tekrarını tekilleştirir", async () => {
  process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "voiceops-billing-"));
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_only";
  const { processStripeWebhook, resetStripeIdempotencyForTests } = await import("../server/integrations");
  const body = Buffer.from(JSON.stringify({
    id: "evt_voiceops_1",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: "cs_test_1", customer: "cus_test_1", subscription: "sub_test_1", status: "complete" } },
  }));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${body.toString("utf8")}`).digest("hex");
  const first = await processStripeWebhook(body, `t=${timestamp},v1=${signature}`);
  const duplicate = await processStripeWebhook(body, `t=${timestamp},v1=${signature}`);
  resetStripeIdempotencyForTests();
  const duplicateAfterRestart = await processStripeWebhook(body, `t=${timestamp},v1=${signature}`);
  assert.deepEqual(first, { received: true, duplicate: false });
  assert.deepEqual(duplicate, { received: true, duplicate: true });
  assert.deepEqual(duplicateAfterRestart, { received: true, duplicate: true });
  await assert.rejects(() => processStripeWebhook(body, `t=${timestamp},v1=bad`), /imza/i);
  await assert.rejects(() => processStripeWebhook(body, `t=not-a-time,v1=${signature}`), /imza/i);
  const staleTimestamp = timestamp - 301;
  const staleSignature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${staleTimestamp}.${body.toString("utf8")}`).digest("hex");
  await assert.rejects(
    () => processStripeWebhook(body, `t=${staleTimestamp},v1=${staleSignature}`),
    /imza/i,
  );
});
