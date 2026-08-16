import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locale } from "@shared/i18n";
import {
  callStateSchema,
  localeSchema,
  messageSchema,
  type CallState,
  type ConversationMessage,
} from "@shared/schema";

type TelephonySession = {
  locale: Locale;
  state: CallState;
  history: ConversationMessage[];
  updatedAt: number;
  revision: number;
  activeToken: string | null;
};

type PersistedTelephonySession = Omit<TelephonySession, "activeToken">;

type EncryptedSessionFile = {
  version: 1;
  encrypted: true;
  iv: string;
  tag: string;
  payload: string;
};

export type PhoneTurnLease = {
  callSid: string;
  token: string;
  revision: number;
  locale: Locale;
  state: CallState;
  history: ConversationMessage[];
};

const sessions = new Map<string, TelephonySession>();
let loadedStoragePath: string | null = null;
let sessionQueue = Promise.resolve();

function storageEnabled() {
  return process.env.TELEPHONY_SESSION_STORAGE === "encrypted-file";
}

function storagePath() {
  const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
  return path.join(dataDirectory, "telephony-sessions.enc.json");
}

function encryptionKey() {
  const configured = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error("TELEPHONY_SESSION_STORAGE=encrypted-file için DATA_ENCRYPTION_KEY gerekli.");
  }
  return createHash("sha256").update("voiceops:telephony-sessions:v1\0").update(configured).digest();
}

function maximumSessions() {
  const configured = Number(process.env.TELEPHONY_SESSION_LIMIT || 2_000);
  return Number.isInteger(configured) && configured >= 1 && configured <= 100_000 ? configured : 2_000;
}

export function configuredTelephonySessionTtlMinutes() {
  const configured = Number(process.env.TELEPHONY_SESSION_TTL_MINUTES || 120);
  return Number.isInteger(configured) && configured >= 5 && configured <= 1_440 ? configured : 120;
}

function validCallSid(callSid: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(callSid)) {
    throw Object.assign(new Error("Geçersiz telefon görüşmesi kimliği."), { status: 400 });
  }
  return callSid;
}

function validatedSession(value: PersistedTelephonySession): PersistedTelephonySession {
  if (!value || !Number.isFinite(value.updatedAt) || !Number.isInteger(value.revision)
    || value.revision < 0 || !Array.isArray(value.history)) {
    throw new Error("Kalıcı telefon oturumu biçimi geçersiz.");
  }
  return {
    locale: localeSchema.parse(value.locale),
    state: callStateSchema.parse(value.state),
    history: value.history.slice(-20).map((message) => messageSchema.parse(message)),
    updatedAt: value.updatedAt,
    revision: value.revision,
  };
}

function decodeSessionFile(content: string) {
  const envelope = JSON.parse(content) as EncryptedSessionFile;
  if (envelope.version !== 1 || envelope.encrypted !== true) {
    throw new Error("Kalıcı telefon oturumu sürümü desteklenmiyor.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.payload, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as Record<string, PersistedTelephonySession>;
}

function encodeSessionFile() {
  const payload = Object.fromEntries([...sessions.entries()].map(([callSid, session]) => [callSid, {
    locale: session.locale,
    state: session.state,
    history: session.history,
    updatedAt: session.updatedAt,
    revision: session.revision,
  } satisfies PersistedTelephonySession]));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: 1,
    encrypted: true,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: encrypted.toString("base64"),
  } satisfies EncryptedSessionFile);
}

async function ensureLoaded() {
  if (!storageEnabled()) return;
  const filePath = storagePath();
  if (loadedStoragePath === filePath) return;
  sessions.clear();
  try {
    const decoded = decodeSessionFile(await readFile(filePath, "utf8"));
    for (const [callSid, stored] of Object.entries(decoded)) {
      const session = validatedSession(stored);
      sessions.set(validCallSid(callSid), { ...session, activeToken: null });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  loadedStoragePath = filePath;
}

async function persistSessions() {
  if (!storageEnabled()) return;
  const filePath = storagePath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${encodeSessionFile()}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function runExclusive<T>(task: () => Promise<T>) {
  const queued = sessionQueue.then(task, task);
  sessionQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

function cleanSessions(now = Date.now()) {
  let deleted = 0;
  const cutoff = now - configuredTelephonySessionTtlMinutes() * 60 * 1000;
  for (const [callSid, session] of sessions) {
    if (!session.activeToken && session.updatedAt < cutoff) {
      sessions.delete(callSid);
      deleted += 1;
    }
  }
  if (sessions.size < maximumSessions()) return deleted;
  const evictable = [...sessions.entries()]
    .filter(([, session]) => !session.activeToken)
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt);
  while (sessions.size >= maximumSessions() && evictable.length) {
    sessions.delete(evictable.shift()![0]);
    deleted += 1;
  }
  return deleted;
}

function newSession(locale: Locale, welcome: string): TelephonySession {
  return {
    locale,
    state: callStateSchema.parse({}),
    history: [{ role: "assistant", content: welcome }],
    updatedAt: Date.now(),
    revision: 0,
    activeToken: null,
  };
}

export async function ensurePhoneSession(callSid: string, locale: Locale, welcome: string) {
  return runExclusive(async () => {
    await ensureLoaded();
    const cleaned = cleanSessions();
    const id = validCallSid(callSid);
    let session = sessions.get(id);
    let created = false;
    if (!session) {
      if (sessions.size >= maximumSessions()) {
        throw Object.assign(new Error("Telefon görüşmesi kapasitesi dolu."), { status: 503 });
      }
      session = newSession(locale, welcome);
      sessions.set(id, session);
      created = true;
    }
    if (session.locale !== locale) throw conflict("Aktif telefon görüşmesinin dili değiştirilemez.");
    if (created || cleaned > 0) await persistSessions();
    return { locale: session.locale, state: callStateSchema.parse(session.state), history: [...session.history] };
  });
}

export async function beginPhoneTurn(
  callSid: string,
  locale: Locale,
  welcome: string,
  options: { enforceLocale?: boolean } = {},
): Promise<PhoneTurnLease> {
  return runExclusive(async () => {
    await ensureLoaded();
    const cleaned = cleanSessions();
    const id = validCallSid(callSid);
    let session = sessions.get(id);
    let created = false;
    if (!session) {
      if (sessions.size >= maximumSessions()) {
        throw Object.assign(new Error("Telefon görüşmesi kapasitesi dolu."), { status: 503 });
      }
      session = newSession(locale, welcome);
      sessions.set(id, session);
      created = true;
    }
    if (options.enforceLocale !== false && session.locale !== locale) {
      throw conflict("Aktif telefon görüşmesinin dili değiştirilemez.");
    }
    if (session.activeToken) throw conflict("Bu telefon görüşmesinde başka bir tur halen işleniyor.");
    const token = randomUUID();
    session.activeToken = token;
    if (created || cleaned > 0) await persistSessions();
    return {
      callSid: id,
      token,
      revision: session.revision,
      locale: session.locale,
      state: callStateSchema.parse(session.state),
      history: session.history.map((message) => ({ ...message })),
    };
  });
}

function leasedSession(lease: PhoneTurnLease) {
  const session = sessions.get(lease.callSid);
  if (!session || session.activeToken !== lease.token || session.revision !== lease.revision) {
    throw conflict("Telefon görüşmesi oturumu artık geçerli değil.");
  }
  return session;
}

export async function commitPhoneTurn(
  lease: PhoneTurnLease,
  state: CallState,
  history: ConversationMessage[],
) {
  return runExclusive(async () => {
    await ensureLoaded();
    const session = leasedSession(lease);
    session.state = callStateSchema.parse(state);
    session.history = history.slice(-20).map((message) => messageSchema.parse(message));
    session.updatedAt = Date.now();
    session.revision += 1;
    session.activeToken = null;
    await persistSessions();
  });
}

export async function completePhoneTurn(lease: PhoneTurnLease) {
  return runExclusive(async () => {
    await ensureLoaded();
    leasedSession(lease);
    sessions.delete(lease.callSid);
    await persistSessions();
  });
}

export async function abortPhoneTurn(lease: PhoneTurnLease | null) {
  if (!lease) return;
  return runExclusive(async () => {
    await ensureLoaded();
    const session = sessions.get(lease.callSid);
    if (session?.activeToken === lease.token) session.activeToken = null;
  });
}

export async function pruneExpiredPhoneSessions(now = Date.now()) {
  return runExclusive(async () => {
    await ensureLoaded();
    const deleted = cleanSessions(now);
    if (deleted > 0) await persistSessions();
    return deleted;
  });
}

export async function initializeTelephonySessions() {
  await runExclusive(async () => {
    await ensureLoaded();
    if (cleanSessions() > 0) await persistSessions();
  });
}

export function telephonySessionStatus() {
  return {
    backend: storageEnabled() ? "encrypted-file" as const : "memory" as const,
    durable: storageEnabled(),
    encrypted: storageEnabled() && Boolean(process.env.DATA_ENCRYPTION_KEY?.trim()),
    ttlMinutes: configuredTelephonySessionTtlMinutes(),
  };
}

export async function resetTelephonySessionsForTests(options: { preserveStorage?: boolean } = {}) {
  await sessionQueue;
  sessions.clear();
  loadedStoragePath = null;
  sessionQueue = Promise.resolve();
  if (!options.preserveStorage) process.env.TELEPHONY_SESSION_STORAGE = "memory";
}
