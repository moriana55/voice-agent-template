import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CallState, ConversationMessage } from "@shared/schema";
import type { Locale } from "@shared/i18n";

export type CallSource = "web" | "twilio";

export type CallRecord = {
  id: string;
  callId: string;
  source: CallSource;
  locale: Locale;
  createdAt: string;
  intent: CallState["intent"];
  name: string | null;
  phone: string | null;
  requestedDate: string | null;
  requestedTime: string | null;
  summary: string;
  transcript: string;
  history: ConversationMessage[];
};

type EncryptedRecord = {
  encrypted: true;
  iv: string;
  tag: string;
  payload: string;
};

const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const recordsPath = path.join(dataDirectory, "call-records.jsonl");
const recordedCallIds = new Set<string>();
let writeQueue = Promise.resolve();

function encryptionKey() {
  const configured = process.env.DATA_ENCRYPTION_KEY;
  return configured ? createHash("sha256").update(configured).digest() : null;
}

function encodeRecord(record: CallRecord): string {
  const key = encryptionKey();
  if (!key) return JSON.stringify(record);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([
    cipher.update(JSON.stringify(record), "utf8"),
    cipher.final(),
  ]);
  const envelope: EncryptedRecord = {
    encrypted: true,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: payload.toString("base64"),
  };
  return JSON.stringify(envelope);
}

function decodeRecord(line: string): CallRecord {
  const parsed = JSON.parse(line) as CallRecord | EncryptedRecord;
  if (!("encrypted" in parsed)) return { ...parsed, locale: parsed.locale || "tr" };
  const key = encryptionKey();
  if (!key) throw new Error("Şifreli kayıtlar için DATA_ENCRYPTION_KEY gerekli.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const payload = Buffer.concat([
    decipher.update(Buffer.from(parsed.payload, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const record = JSON.parse(payload) as CallRecord;
  return { ...record, locale: record.locale || "tr" };
}

async function ensureDataDirectory() {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
}

async function postWebhook(url: string, token: string | undefined, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token
        ? { authorization: `Bearer ${token}` }
        : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Entegrasyon webhook'u ${response.status} döndürdü.`);
}

async function forwardIntegrations(record: CallRecord) {
  const tasks: Promise<void>[] = [];
  if (process.env.CRM_WEBHOOK_URL) {
    tasks.push(postWebhook(process.env.CRM_WEBHOOK_URL, process.env.CRM_WEBHOOK_TOKEN, record));
  }
  if (record.intent === "randevu" && process.env.CALENDAR_WEBHOOK_URL) {
    tasks.push(postWebhook(
      process.env.CALENDAR_WEBHOOK_URL,
      process.env.CALENDAR_WEBHOOK_TOKEN,
      {
        id: record.id,
        callId: record.callId,
        createdAt: record.createdAt,
        locale: record.locale,
        title: `${record.name || "Müşteri"} - Randevu talebi`,
        name: record.name,
        phone: record.phone,
        requestedDate: record.requestedDate,
        requestedTime: record.requestedTime,
        summary: record.summary,
      },
    ));
  }
  if (tasks.length === 0) return false;
  await Promise.all(tasks);
  return true;
}

export function recordsStatus() {
  return {
    enabled: process.env.RECORD_STORAGE !== "disabled",
    encrypted: Boolean(encryptionKey()),
    crmWebhook: Boolean(process.env.CRM_WEBHOOK_URL),
    calendarWebhook: Boolean(process.env.CALENDAR_WEBHOOK_URL),
    retentionDays: Number(process.env.RECORD_RETENTION_DAYS || 30),
  };
}

export async function recordCompletedCall(input: {
  callId: string;
  source: CallSource;
  locale?: Locale;
  state: CallState;
  transcript: string;
  history: ConversationMessage[];
}) {
  if (process.env.RECORD_STORAGE === "disabled" || recordedCallIds.has(input.callId)) {
    return { saved: false, forwarded: false };
  }
  const record: CallRecord = {
    id: randomUUID(),
    callId: input.callId,
    source: input.source,
    locale: input.locale || "tr",
    createdAt: new Date().toISOString(),
    intent: input.state.intent,
    name: input.state.name,
    phone: input.state.phone,
    requestedDate: input.state.requestedDate,
    requestedTime: input.state.requestedTime,
    summary: input.state.summary,
    transcript: input.transcript,
    history: input.history.slice(-20),
  };

  recordedCallIds.add(input.callId);
  writeQueue = writeQueue.then(async () => {
    await ensureDataDirectory();
    await appendFile(recordsPath, `${encodeRecord(record)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  await writeQueue;

  let forwarded = false;
  try {
    forwarded = await forwardIntegrations(record);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "integration_webhook_failed",
      recordId: record.id,
      message: error instanceof Error ? error.message : "Entegrasyon webhook hatası",
    }));
  }
  return { saved: true, forwarded, recordId: record.id };
}

export async function listCallRecords(limit = 100) {
  await writeQueue;
  let content = "";
  try {
    content = await readFile(recordsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return content
    .split("\n")
    .filter(Boolean)
    .slice(-Math.max(1, Math.min(limit, 500)))
    .map(decodeRecord)
    .reverse();
}

async function replaceRecords(records: CallRecord[]) {
  await ensureDataDirectory();
  const temporaryPath = `${recordsPath}.${process.pid}.tmp`;
  const content = records.map(encodeRecord).join("\n");
  await writeFile(temporaryPath, content ? `${content}\n` : "", { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, recordsPath);
}

async function allRecords() {
  try {
    const content = await readFile(recordsPath, "utf8");
    return content.split("\n").filter(Boolean).map(decodeRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function pruneExpiredRecords() {
  const retentionDays = Math.max(1, Number(process.env.RECORD_RETENTION_DAYS || 30));
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const task = writeQueue.then(async () => {
    const records = await allRecords();
    const retained = records.filter((record) => Date.parse(record.createdAt) >= cutoff);
    if (retained.length !== records.length) await replaceRecords(retained);
    return records.length - retained.length;
  });
  writeQueue = task.then(() => undefined);
  return task;
}

export async function deleteCallRecord(id: string) {
  const task = writeQueue.then(async () => {
    const records = await allRecords();
    const retained = records.filter((record) => record.id !== id);
    if (retained.length === records.length) return false;
    await replaceRecords(retained);
    return true;
  });
  writeQueue = task.then(() => undefined);
  return task;
}
