import test from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { createGatherResponse, validateTwilioWebhook } from "../server/telephony";

test("TwiML Türkçe konuşma toplar ve dönüş endpointine yönlendirir", () => {
  const turnId = "11111111-1111-4111-8111-111111111111";
  const xml = createGatherResponse("Merhaba", null, "tr", turnId);
  assert.match(xml, /<Gather/);
  assert.match(xml, /input="speech"/);
  assert.match(xml, /language="tr-TR"/);
  assert.ok(xml.includes(`action="/api/telephony/turn?turnId=${turnId}"`));
  assert.match(xml, /<Say language="tr-TR">Merhaba<\/Say>/);
});

test("TwiML seçilen dil kodunu konuşma tanıma ve seslendirmeye taşır", () => {
  const xml = createGatherResponse(
    "Bonjour",
    null,
    "fr",
    "22222222-2222-4222-8222-222222222222",
  );
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

test("Twilio sırrı yoksa webhook'u kapalı reddeder", () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  let nextCalled = false;
  const req = { originalUrl: "/api/telephony/incoming", protocol: "https", body: {}, get() { return undefined; } };
  const res = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    send() { return this; },
  };
  validateTwilioWebhook(req as never, res as never, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("hatalı Twilio imzasını reddeder", () => {
  process.env.TWILIO_AUTH_TOKEN = "configured-token";
  process.env.PUBLIC_BASE_URL = "https://voice.example.com";
  let nextCalled = false;
  const req = {
    originalUrl: "/api/telephony/incoming", protocol: "https", body: { CallSid: "CA123" },
    get(name: string) { return name.toLowerCase() === "x-twilio-signature" ? "invalid" : "voice.example.com"; },
  };
  const res = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    send() { return this; },
  };
  validateTwilioWebhook(req as never, res as never, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("trusted proxy kapalıyken Twilio imzası forwarded host ile şaşırtılamaz", () => {
  const token = "test-auth-token";
  const body = { CallSid: "CA123" };
  delete process.env.PUBLIC_BASE_URL;
  process.env.TRUST_PROXY = "false";
  process.env.TWILIO_AUTH_TOKEN = token;
  const signature = twilio.getExpectedTwilioSignature(
    token,
    "https://attacker.example/api/telephony/incoming",
    body,
  );
  let nextCalled = false;
  const req = {
    originalUrl: "/api/telephony/incoming",
    protocol: "https",
    body,
    get(name: string) {
      if (name.toLowerCase() === "x-twilio-signature") return signature;
      if (name.toLowerCase() === "x-forwarded-proto") return "https";
      if (name.toLowerCase() === "x-forwarded-host") return "attacker.example";
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
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
