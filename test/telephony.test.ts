import test from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { createGatherResponse, validateTwilioWebhook } from "../server/telephony";

test("TwiML Türkçe konuşma toplar ve dönüş endpointine yönlendirir", () => {
  const xml = createGatherResponse("Merhaba", null, "tr");
  assert.match(xml, /<Gather/);
  assert.match(xml, /input="speech"/);
  assert.match(xml, /language="tr-TR"/);
  assert.match(xml, /action="\/api\/telephony\/turn"/);
  assert.match(xml, /<Say language="tr-TR">Merhaba<\/Say>/);
});

test("TwiML seçilen dil kodunu konuşma tanıma ve seslendirmeye taşır", () => {
  const xml = createGatherResponse("Bonjour", null, "fr");
  assert.match(xml, /language="fr-FR"/);
  assert.match(xml, /<Say language="fr-FR">Bonjour<\/Say>/);
});

test("geçerli Twilio imzasını kabul eder", () => {
  const token = "test-auth-token";
  const url = "https://voice.example.com/api/telephony/incoming";
  const body = { CallSid: "CA123" };
  process.env.TWILIO_AUTH_TOKEN = token;
  process.env.PUBLIC_BASE_URL = "https://voice.example.com";
  delete process.env.TWILIO_SKIP_SIGNATURE;
  const signature = twilio.getExpectedTwilioSignature(token, url, body);
  let nextCalled = false;
  const req = {
    originalUrl: "/api/telephony/incoming",
    protocol: "https",
    body,
    get(name: string) {
      if (name.toLowerCase() === "x-twilio-signature") return signature;
      if (name.toLowerCase() === "host") return "voice.example.com";
      return undefined;
    },
  };
  const res = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    send() { return this; },
  };
  validateTwilioWebhook(req as never, res as never, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
