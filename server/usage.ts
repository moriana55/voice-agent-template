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
  quotaSeconds?: number;
  abandoned?: boolean;
};

const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const usagePath = path.join(dataDirectory, "usage-events.jsonl");
const recordedTurnIds = new Set<string>();
const usageReservations = new Map<string, { period: string; seconds: number }>();
let writeQueue = Promise.resolve();
let reservationQueue = Promise.resolve();

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

async function readUsageEvents() {
  try {
    const content = await readFile(usagePath, "utf8");
    return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as UsageEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function events() {
  await writeQueue;
  return readUsageEvents();
}

export async function assertUsageTurnAvailable(turnId: string) {
  if (recordedTurnIds.has(turnId) || (await events()).some((event) => event.turnId === turnId)) {
    throw Object.assign(new Error("Bu sağlayıcı turu daha önce işlendi."), { status: 409 });
  }
}

export async function usageSummary(period = periodFor()) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw Object.assign(new Error("Geçersiz kullanım dönemi."), { status: 400 });
  const selected = (await events()).filter((event) => event.createdAt.startsWith(period));
  const totalSeconds = selected.reduce((total, event) => total + event.billableSeconds, 0);
  const quotaSeconds = selected.reduce(
    (total, event) => total + (event.quotaSeconds ?? event.billableSeconds),
    0,
  );
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
    quotaSeconds,
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
  const reservedSeconds = [...usageReservations.values()]
    .filter((reservation) => reservation.period === summary.period)
    .reduce((total, reservation) => total + reservation.seconds, 0);
  if (summary.quotaSeconds + reservedSeconds >= hardLimitMinutes * 60) {
    throw Object.assign(new Error("Aylık görüşme kotası doldu. Lütfen işletmeyle iletişime geçin."), { status: 429 });
  }
}

export async function reserveUsage(inputSeconds = 0) {
  const hardLimitMinutes = configuredHardLimitMinutes();
  if (!hardLimitMinutes) return null;
  const seconds = Math.max(1, Math.min(420, Math.ceil(inputSeconds) + 120));
  const task = reservationQueue.then(async () => {
    const summary = await usageSummary();
    const reservedSeconds = [...usageReservations.values()]
      .filter((reservation) => reservation.period === summary.period)
      .reduce((total, reservation) => total + reservation.seconds, 0);
    if (summary.quotaSeconds + reservedSeconds + seconds > hardLimitMinutes * 60) {
      throw Object.assign(new Error("Aylık görüşme kotası bu görüşme için yeterli değil."), { status: 429 });
    }
    const id = randomUUID();
    usageReservations.set(id, { period: summary.period, seconds });
    return id;
  });
  reservationQueue = task.then(() => undefined, () => undefined);
  return task;
}

export function releaseUsageReservation(id?: string | null) {
  if (id) usageReservations.delete(id);
}

export async function recordAbandonedUsage(input: {
  turnId: string;
  callId: string;
  source: UsageSource;
  locale: Locale;
  reservationId: string | null;
}) {
  const reservation = input.reservationId ? usageReservations.get(input.reservationId) : undefined;
  if (!reservation) return null;
  return recordUsage({
    turnId: input.turnId,
    callId: input.callId,
    source: input.source,
    locale: input.locale,
    inputSeconds: 0,
    reply: "",
    reservationId: input.reservationId,
    billableSecondsOverride: 0,
    quotaSecondsOverride: reservation.seconds,
    abandoned: true,
  });
}

export async function recordUsage(input: {
  turnId?: string;
  callId: string;
  source: UsageSource;
  locale: Locale;
  inputSeconds?: number;
  inputText?: string;
  reply: string;
  reservationId?: string | null;
  billableSecondsOverride?: number;
  quotaSecondsOverride?: number;
  abandoned?: boolean;
}) {
  const turnId = input.turnId || randomUUID();
  if (recordedTurnIds.has(turnId)) {
    releaseUsageReservation(input.reservationId);
    return null;
  }
  const inputSeconds = Math.max(0, input.inputSeconds || estimateSpeechSeconds(input.inputText || ""));
  const outputSeconds = estimateSpeechSeconds(input.reply);
  const measuredBillableSeconds = Math.max(1, Math.ceil(inputSeconds + outputSeconds));
  const billableSeconds = input.billableSecondsOverride ?? measuredBillableSeconds;
  const event: UsageEvent = {
    id: randomUUID(),
    turnId,
    callHash: callHash(input.callId),
    source: input.source,
    locale: input.locale,
    createdAt: new Date().toISOString(),
    inputSeconds: Number(inputSeconds.toFixed(2)),
    outputSeconds: Number(outputSeconds.toFixed(2)),
    billableSeconds: Math.max(0, billableSeconds),
    quotaSeconds: Math.max(0, input.quotaSecondsOverride ?? billableSeconds),
    abandoned: input.abandoned || undefined,
  };
  recordedTurnIds.add(turnId);
  try {
    const saveTask = writeQueue.then(async () => {
      const existing = await readUsageEvents();
      if (existing.some((item) => item.turnId === turnId)) return false;
      await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
      await appendFile(usagePath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
      return true;
    });
    writeQueue = saveTask.then(() => undefined, () => undefined);
    return await saveTask ? event : null;
  } catch (error) {
    recordedTurnIds.delete(turnId);
    throw error;
  } finally {
    releaseUsageReservation(input.reservationId);
  }
}

export function resetUsageIdempotencyForTests() {
  recordedTurnIds.clear();
}
