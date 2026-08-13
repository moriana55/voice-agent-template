import { createHash, createHmac, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Locale } from "@shared/i18n";
import { publicProductConfig } from "./product";

export type UsageSource = "web" | "twilio";

export type UsageEvent = {
  id: string;
  turnId: string;
  callHash: string;
  source: UsageSource;
  locale: Locale;
  createdAt: string;
  inputSeconds: number;
  outputSeconds: number;
  billableSeconds: number;
};

const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const usagePath = path.join(dataDirectory, "usage-events.jsonl");
const recordedTurnIds = new Set<string>();
let writeQueue = Promise.resolve();

function configuredHardLimitMinutes() {
  const value = Number(process.env.USAGE_HARD_LIMIT_MINUTES || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function periodFor(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function callHash(callId: string) {
  const key = process.env.USAGE_HASH_KEY || process.env.DATA_ENCRYPTION_KEY;
  return key
    ? createHmac("sha256", key).update(callId).digest("hex").slice(0, 24)
    : createHash("sha256").update(callId).digest("hex").slice(0, 24);
}

export function wavDurationSeconds(buffer?: Buffer | null) {
  if (!buffer || buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") return 0;
  const byteRate = buffer.readUInt32LE(28);
  const dataBytes = buffer.readUInt32LE(40);
  if (!byteRate || !dataBytes) return 0;
  return Math.min(300, dataBytes / byteRate);
}

export function estimateSpeechSeconds(text: string) {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  if (!words) return 0;
  return Math.min(120, Math.max(1, words / 2.5));
}

async function events() {
  await writeQueue;
  try {
    const content = await readFile(usagePath, "utf8");
    return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as UsageEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function usageSummary(period = periodFor()) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw Object.assign(new Error("Geçersiz kullanım dönemi."), { status: 400 });
  const selected = (await events()).filter((event) => event.createdAt.startsWith(period));
  const totalSeconds = selected.reduce((total, event) => total + event.billableSeconds, 0);
  const activeMinutes = Math.ceil(totalSeconds / 60);
  const config = publicProductConfig();
  const includedMinutes = config.plan.includedMinutes;
  const overageMinutes = Math.max(0, activeMinutes - includedMinutes);
  const byDay = new Map<string, { seconds: number; turns: number }>();
  for (const event of selected) {
    const day = event.createdAt.slice(0, 10);
    const current = byDay.get(day) || { seconds: 0, turns: 0 };
    current.seconds += event.billableSeconds;
    current.turns += 1;
    byDay.set(day, current);
  }
  return {
    period,
    billingBasis: config.plan.billingBasis,
    totalSeconds,
    activeMinutes,
    turns: selected.length,
    calls: new Set(selected.map((event) => event.callHash)).size,
    includedMinutes,
    remainingIncludedMinutes: Math.max(0, includedMinutes - activeMinutes),
    overageMinutes,
    overageTryPerMinute: config.plan.overageTryPerMinute,
    estimatedOverageTry: overageMinutes * config.plan.overageTryPerMinute,
    hardLimitMinutes: configuredHardLimitMinutes() || null,
    daily: [...byDay.entries()].map(([date, value]) => ({
      date,
      minutes: Math.ceil(value.seconds / 60),
      turns: value.turns,
    })),
  };
}

export async function assertUsageAvailable() {
  const hardLimitMinutes = configuredHardLimitMinutes();
  if (!hardLimitMinutes) return;
  const summary = await usageSummary();
  if (summary.activeMinutes >= hardLimitMinutes) {
    throw Object.assign(new Error("Aylık görüşme kotası doldu. Lütfen işletmeyle iletişime geçin."), { status: 429 });
  }
}

export async function recordUsage(input: {
  turnId?: string;
  callId: string;
  source: UsageSource;
  locale: Locale;
  inputSeconds?: number;
  inputText?: string;
  reply: string;
}) {
  const turnId = input.turnId || randomUUID();
  if (recordedTurnIds.has(turnId)) return null;
  const inputSeconds = Math.max(0, input.inputSeconds || estimateSpeechSeconds(input.inputText || ""));
  const outputSeconds = estimateSpeechSeconds(input.reply);
  const event: UsageEvent = {
    id: randomUUID(),
    turnId,
    callHash: callHash(input.callId),
    source: input.source,
    locale: input.locale,
    createdAt: new Date().toISOString(),
    inputSeconds: Number(inputSeconds.toFixed(2)),
    outputSeconds: Number(outputSeconds.toFixed(2)),
    billableSeconds: Math.max(1, Math.ceil(inputSeconds + outputSeconds)),
  };
  recordedTurnIds.add(turnId);
  try {
    writeQueue = writeQueue.then(async () => {
      await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
      await appendFile(usagePath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    });
    await writeQueue;
    return event;
  } catch (error) {
    recordedTurnIds.delete(turnId);
    throw error;
  }
}
