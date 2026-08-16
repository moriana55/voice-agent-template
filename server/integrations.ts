import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import twilio from "twilio";
import type { Locale } from "@shared/i18n";
import type { CallState, IntegrationId } from "@shared/schema";
import { safePublicBaseUrl, safeStripeCheckoutUrl, safeWebhookUrl } from "./url-security";

export type IntegrationStatus = {
  id: IntegrationId;
  label: string;
  category: "voice" | "calendar" | "crm" | "billing";
  configured: boolean;
  missing: string[];
  detail: string;
};

export type CallIntegrationRecord = {
  id: string;
  callId: string;
  locale: Locale;
  createdAt: string;
  intent: CallState["intent"];
  name: string | null;
  phone: string | null;
  requestedDate: string | null;
  requestedTime: string | null;
  summary: string;
  transcript: string;
};

const processedStripeEvents = new Set<string>();
let billingWriteQueue = Promise.resolve();

function dataDirectory() {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
}

function missing(...names: string[]) {
  return names.filter((name) => !process.env[name]?.trim());
}

function integration(
  id: IntegrationId,
  label: string,
  category: IntegrationStatus["category"],
  required: string[],
  detail: string,
): IntegrationStatus {
  const absent = missing(...required);
  return { id, label, category, configured: absent.length === 0, missing: absent, detail };
}

export function integrationStatuses(): IntegrationStatus[] {
  return [
    integration("twilio", "Twilio Voice", "voice", [
      "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "PUBLIC_BASE_URL",
    ], "Incoming and outbound phone calls"),
    integration("googleCalendar", "Google Calendar", "calendar", [
      "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CALENDAR_ID",
    ], "Creates appointment events from completed calls"),
    integration("hubspot", "HubSpot CRM", "crm", ["HUBSPOT_ACCESS_TOKEN"],
      "Creates or updates contacts by phone number"),
    integration("stripe", "Stripe Billing", "billing", [
      "STRIPE_SECRET_KEY", "STRIPE_PRICE_ID", "STRIPE_WEBHOOK_SECRET", "PUBLIC_BASE_URL",
    ], "Subscription Checkout and verified billing webhooks"),
    integration("genericCrmWebhook", "CRM webhook", "crm", ["CRM_WEBHOOK_URL", "CRM_WEBHOOK_TOKEN"],
      "Signed bearer-token delivery to another CRM"),
    integration("genericCalendarWebhook", "Calendar webhook", "calendar", [
      "CALENDAR_WEBHOOK_URL", "CALENDAR_WEBHOOK_TOKEN",
    ], "Signed bearer-token appointment delivery"),
  ];
}

function requireConfiguration(names: string[]) {
  const absent = missing(...names);
  if (absent.length) {
    throw Object.assign(new Error(`Eksik entegrasyon ayarı: ${absent.join(", ")}`), { status: 503 });
  }
}

function publicBaseUrl() {
  const value = process.env.PUBLIC_BASE_URL || "";
  return process.env.NODE_ENV === "production" ? safePublicBaseUrl(value) : value.replace(/\/$/, "");
}

async function postWebhook(url: string, token: string | undefined, payload: unknown, eventId: string) {
  if (!token?.trim()) throw new Error("Entegrasyon webhook token'ı yapılandırılmamış.");
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(safeWebhookUrl(url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "idempotency-key": eventId,
          "x-voiceops-event": "call.completed",
        },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) return;
      lastError = new Error(`Entegrasyon webhook'u ${response.status} döndürdü.`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Entegrasyon webhook hatası.");
    }
  }
  throw lastError || new Error("Entegrasyon webhook'u teslim edilemedi.");
}

function localDateParts(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function resolveDate(value: string, timeZone: string) {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  const today = localDateParts(timeZone);
  if (/^(today|bugün|bugun)$/.test(normalized)) return today;
  if (/^(tomorrow|yarın|yarin)$/.test(normalized)) return addDays(today, 1);
  const iso = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = normalized.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
  if (local) return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  return null;
}

function resolveTime(value: string) {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  const clock = normalized.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (clock) return { hour: Number(clock[1]), minute: Number(clock[2]) };
  const meridiem = normalized.match(/\b(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/);
  if (meridiem) {
    let hour = Number(meridiem[1]) % 12;
    if (meridiem[3].startsWith("p")) hour += 12;
    return { hour, minute: Number(meridiem[2] || 0) };
  }
  const hourOnly = normalized.match(/\b(?:at|saat)\s+([01]?\d|2[0-3])\b/);
  return hourOnly ? { hour: Number(hourOnly[1]), minute: 0 } : null;
}

export function appointmentWindow(record: Pick<CallIntegrationRecord, "requestedDate" | "requestedTime">) {
  if (!record.requestedDate || !record.requestedTime) return null;
  const timeZone = process.env.BUSINESS_TIME_ZONE || "Europe/Istanbul";
  const date = resolveDate(record.requestedDate, timeZone);
  const time = resolveTime(record.requestedTime);
  if (!date || !time) return null;
  const duration = Math.max(5, Math.min(240, Number(process.env.APPOINTMENT_DURATION_MINUTES || 30)));
  const endMinutes = time.hour * 60 + time.minute + duration;
  const endDate = addDays(date, Math.floor(endMinutes / 1440));
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    timeZone,
    start: `${date}T${pad(time.hour)}:${pad(time.minute)}:00`,
    end: `${endDate}T${pad(Math.floor((endMinutes % 1440) / 60))}:${pad(endMinutes % 60)}:00`,
  };
}

async function googleAccessToken() {
  requireConfiguration(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]);
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  const result = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error_description || "Google yetkilendirmesi başarısız.");
  return result.access_token;
}

async function createGoogleCalendarEvent(record: CallIntegrationRecord) {
  requireConfiguration(["GOOGLE_CALENDAR_ID"]);
  const window = appointmentWindow(record);
  if (!window) throw new Error("Randevu tarihi veya saati takvime aktarılamadı.");
  const accessToken = await googleAccessToken();
  const calendarId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID!);
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      id: record.id.replaceAll("-", ""),
      summary: `${record.name || "Customer"} — appointment request`,
      description: `${record.summary}\nPhone: ${record.phone || "not provided"}\nVoiceOps record: ${record.id}`,
      start: { dateTime: window.start, timeZone: window.timeZone },
      end: { dateTime: window.end, timeZone: window.timeZone },
      extendedProperties: { private: { voiceopsRecordId: record.id, voiceopsCallId: record.callId } },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`Google Calendar ${response.status} döndürdü.`);
  }
}

async function hubspotRequest(pathname: string, init: RequestInit) {
  requireConfiguration(["HUBSPOT_ACCESS_TOKEN"]);
  const response = await fetch(`https://api.hubapi.com${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`HubSpot ${response.status} döndürdü.`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function upsertHubSpotContact(record: CallIntegrationRecord) {
  if (!record.phone) throw new Error("HubSpot aktarımı için telefon numarası gerekli.");
  const search = await hubspotRequest("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: record.phone }] }],
      properties: ["firstname", "lastname", "phone"],
      limit: 1,
    }),
  }) as { results?: Array<{ id: string }> };
  const nameParts = (record.name || "VoiceOps lead").trim().split(/\s+/u);
  const properties = {
    firstname: nameParts.shift() || "VoiceOps",
    lastname: nameParts.join(" ") || "Lead",
    phone: record.phone,
  };
  if (search.results?.[0]?.id) {
    await hubspotRequest(`/crm/v3/objects/contacts/${encodeURIComponent(search.results[0].id)}`, {
      method: "PATCH", body: JSON.stringify({ properties }),
    });
  } else {
    await hubspotRequest("/crm/v3/objects/contacts", {
      method: "POST", body: JSON.stringify({ properties }),
    });
  }
}

export async function forwardCallIntegrations(record: CallIntegrationRecord) {
  const tasks: Array<{ provider: string; run: () => Promise<void> }> = [];
  if (process.env.CRM_WEBHOOK_URL) {
    tasks.push({ provider: "crm-webhook", run: () => postWebhook(
      process.env.CRM_WEBHOOK_URL!, process.env.CRM_WEBHOOK_TOKEN, record, record.id,
    ) });
  }
  if (record.intent === "randevu" && process.env.CALENDAR_WEBHOOK_URL) {
    tasks.push({ provider: "calendar-webhook", run: () => postWebhook(
      process.env.CALENDAR_WEBHOOK_URL!, process.env.CALENDAR_WEBHOOK_TOKEN, {
        ...record,
        title: `${record.name || "Customer"} — appointment request`,
      }, record.id,
    ) });
  }
  if (record.intent === "randevu" && !missing(
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CALENDAR_ID",
  ).length) {
    tasks.push({ provider: "google-calendar", run: () => createGoogleCalendarEvent(record) });
  }
  if (process.env.HUBSPOT_ACCESS_TOKEN) {
    tasks.push({ provider: "hubspot", run: () => upsertHubSpotContact(record) });
  }
  if (!tasks.length) return false;
  const results = await Promise.allSettled(tasks.map((task) => task.run()));
  results.forEach((result, index) => {
    if (result.status === "rejected") console.error(JSON.stringify({
      level: "error",
      event: "integration_delivery_failed",
      provider: tasks[index].provider,
      recordId: record.id,
      message: result.reason instanceof Error ? result.reason.message : "Integration failed",
    }));
  });
  return results.some((result) => result.status === "fulfilled");
}

export async function createOutboundCall(input: { to: string; locale: Locale }) {
  requireConfiguration(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "PUBLIC_BASE_URL"]);
  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  const base = publicBaseUrl();
  const call = await client.calls.create({
    to: input.to,
    from: process.env.TWILIO_PHONE_NUMBER!,
    url: `${base}/api/telephony/incoming?locale=${encodeURIComponent(input.locale)}`,
    method: "POST",
    statusCallback: `${base}/api/telephony/status`,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });
  return { sid: call.sid, status: call.status || "queued", to: input.to.replace(/.(?=.{4})/g, "•") };
}

export async function createStripeCheckout(email: string) {
  requireConfiguration(["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID", "PUBLIC_BASE_URL"]);
  const base = publicBaseUrl();
  const body = new URLSearchParams({
    mode: "subscription",
    customer_email: email,
    success_url: `${base}/#/admin?checkout=success`,
    cancel_url: `${base}/#/admin?checkout=cancelled`,
    "line_items[0][price]": process.env.STRIPE_PRICE_ID!,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
  });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": randomUUID(),
    },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  const result = await response.json() as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !result.id || !result.url) {
    throw new Error(result.error?.message || `Stripe ${response.status} döndürdü.`);
  }
  return { id: result.id, url: safeStripeCheckoutUrl(result.url) };
}

function verifyStripeSignature(rawBody: Buffer, signatureHeader: string) {
  requireConfiguration(["STRIPE_WEBHOOK_SECRET"]);
  const fields = signatureHeader.split(",").map((part) => part.split("=", 2));
  const timestamp = fields.find(([key]) => key === "t")?.[1];
  const signatures = fields.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !/^\d{10}$/.test(timestamp) || !signatures.length) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)
    || Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > 300) return false;
  const expected = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET!)
    .update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  return signatures.some((candidate) => {
    const actual = Buffer.from(candidate);
    const wanted = Buffer.from(expected);
    return actual.length === wanted.length && timingSafeEqual(actual, wanted);
  });
}

export async function processStripeWebhook(rawBody: Buffer, signatureHeader: string) {
  if (!verifyStripeSignature(rawBody, signatureHeader)) {
    throw Object.assign(new Error("Geçersiz Stripe webhook imzası."), { status: 400 });
  }
  const event = JSON.parse(rawBody.toString("utf8")) as {
    id: string;
    type: string;
    created?: number;
    data?: { object?: { id?: string; customer?: string; subscription?: string; status?: string } };
  };
  if (!event.id || processedStripeEvents.has(event.id)) return { received: true, duplicate: true };
  processedStripeEvents.add(event.id);
  const object = event.data?.object;
  const directory = dataDirectory();
  const billingPath = path.join(directory, "billing-events.jsonl");
  const saveTask = billingWriteQueue.then(async () => {
    let existing = "";
    try {
      existing = await readFile(billingPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const duplicate = existing.split("\n").filter(Boolean).some((line) => {
      try {
        return (JSON.parse(line) as { id?: string }).id === event.id;
      } catch {
        return false;
      }
    });
    if (duplicate) return true;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await appendFile(billingPath, `${JSON.stringify({
      id: event.id,
      type: event.type,
      createdAt: new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      objectId: object?.id || null,
      customerId: object?.customer || null,
      subscriptionId: object?.subscription || null,
      status: object?.status || null,
    })}\n`, { encoding: "utf8", mode: 0o600 });
    return false;
  });
  billingWriteQueue = saveTask.then(() => undefined, () => undefined);
  try {
    const duplicate = await saveTask;
    return { received: true, duplicate };
  } catch (error) {
    processedStripeEvents.delete(event.id);
    throw error;
  }
}

export function resetStripeIdempotencyForTests() {
  processedStripeEvents.clear();
}
