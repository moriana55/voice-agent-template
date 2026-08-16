import twilio from "twilio";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:5193";
const adminKey = process.env.SMOKE_ADMIN_KEY || "smoke-admin";
const twilioToken = process.env.SMOKE_TWILIO_TOKEN || "smoke-twilio";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const live = await fetch(`${baseUrl}/api/health/live`);
assert(live.status === 200, `live health ${live.status}`);

const ready = await fetch(`${baseUrl}/api/health/ready`);
assert([200, 503].includes(ready.status), `ready health ${ready.status}`);

const product = await fetch(`${baseUrl}/api/product`).then((response) => response.json());
assert(product.productName && product.agentName, "public product configuration missing");
assert(product.plan?.billingBasis === "active-voice-seconds", "billing basis missing");

const callId = crypto.randomUUID();
const body = new FormData();
body.set("callId", callId);
body.set("turnId", crypto.randomUUID());
body.set("noticeAcknowledged", "true");
body.set("storageConsent", "true");
body.set("locale", "tr");
body.set("text", "Yarın saat 15:00 için randevu istiyorum, adım Ayşe Yılmaz, telefonum 0532 123 45 67");
body.set("history", "[]");
body.set("state", "{}");
const turn = await fetch(`${baseUrl}/api/turn`, { method: "POST", body });
const turnPayload = await turn.json();
assert(turn.status === 200, `turn ${turn.status}`);
assert(turnPayload.state?.completed === true, "turn did not complete the appointment");
assert(turnPayload.recorded === true, "turn was not recorded");

const noConsentBody = new FormData();
noConsentBody.set("callId", crypto.randomUUID());
noConsentBody.set("locale", "tr");
noConsentBody.set("text", "Merhaba");
noConsentBody.set("history", "[]");
noConsentBody.set("state", "{}");
const noConsent = await fetch(`${baseUrl}/api/turn`, { method: "POST", body: noConsentBody });
assert(noConsent.status === 400, `missing consent ${noConsent.status}`);

const unauthorized = await fetch(`${baseUrl}/api/admin/records`);
assert(unauthorized.status === 401, `admin unauthorized ${unauthorized.status}`);
const records = await fetch(`${baseUrl}/api/admin/records`, {
  headers: { authorization: `Bearer ${adminKey}` },
});
const recordsPayload = await records.json();
assert(records.status === 200, `admin records ${records.status}`);
assert(recordsPayload.records?.some((record) => record.callId === callId), "saved call record missing");

const usage = await fetch(`${baseUrl}/api/admin/usage`, {
  headers: { authorization: `Bearer ${adminKey}` },
});
const usagePayload = await usage.json();
assert(usage.status === 200, `admin usage ${usage.status}`);
assert(usagePayload.turns >= 1, "usage meter did not record the web turn");

const operationalReadiness = await fetch(`${baseUrl}/api/admin/readiness`, {
  headers: { authorization: `Bearer ${adminKey}` },
});
const operationalPayload = await operationalReadiness.json();
assert([200, 503].includes(operationalReadiness.status), `admin readiness ${operationalReadiness.status}`);
assert(typeof operationalPayload.ready === "boolean", "admin readiness boolean missing");
assert(typeof operationalPayload.commercial?.enabled === "boolean", "commercial gate detail missing");
assert(Array.isArray(operationalPayload.deploymentIssues), "deployment safety details missing");

const phoneCallSid = `CA-${crypto.randomUUID()}`;
const incomingUrl = `${baseUrl}/api/telephony/incoming?locale=tr`;
const twilioBody = new URLSearchParams({ CallSid: phoneCallSid });
const signature = twilio.getExpectedTwilioSignature(
  twilioToken,
  incomingUrl,
  Object.fromEntries(twilioBody),
);
const incoming = await fetch(incomingUrl, {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    "x-twilio-signature": signature,
  },
  body: twilioBody,
});
const twiml = await incoming.text();
assert(incoming.status === 200, `twilio incoming ${incoming.status}`);
assert(twiml.includes("<Gather"), "twilio response does not gather speech");
assert(twiml.includes('language="tr-TR"'), "twilio response is not Turkish");

async function twilioPost(path, parameters) {
  const url = `${baseUrl}${path}`;
  const form = new URLSearchParams(parameters);
  const requestSignature = twilio.getExpectedTwilioSignature(
    twilioToken,
    url,
    Object.fromEntries(form),
  );
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": requestSignature,
    },
    body: form,
  });
}

const phoneTurns = [
  "Fiyat teklifi almak istiyorum",
  "Ben Ayşe Yılmaz",
  "Telefonum 0532 123 45 67",
];
let finalPhoneXml = "";
for (const speech of phoneTurns) {
  const phoneTurn = await twilioPost("/api/telephony/turn", {
    CallSid: phoneCallSid,
    SpeechResult: speech,
  });
  assert(phoneTurn.status === 200, `twilio turn ${phoneTurn.status}`);
  finalPhoneXml = await phoneTurn.text();
}
assert(finalPhoneXml.includes("<Hangup"), "completed phone call does not hang up cleanly");

const finalRecords = await fetch(`${baseUrl}/api/admin/records`, {
  headers: { authorization: `Bearer ${adminKey}` },
}).then((response) => response.json());
assert(
  finalRecords.records?.some((record) => record.callId === phoneCallSid && record.source === "twilio"),
  "completed phone call record missing",
);
assert(
  finalRecords.records?.some((record) => record.callId === phoneCallSid && record.locale === "tr"),
  "completed phone call locale missing",
);

console.log(JSON.stringify({
  ok: true,
  checks: ["live", "ready", "admin-readiness", "product-config", "locale", "notice", "storage-consent", "turn", "record", "usage", "admin-auth", "twilio-signature", "twiml", "phone-turns"],
}));
