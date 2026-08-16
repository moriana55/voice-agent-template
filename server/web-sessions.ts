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

type WebSession = {
  locale: Locale;
  state: CallState;
  history: ConversationMessage[];
  updatedAt: number;
  activeToken: string | null;
  completedTurnIds: string[];
};

type PersistedWebSession = Omit<WebSession, "activeToken">;

type EncryptedSessionFile = {
  version: 1;
  encrypted: true;
  iv: string;
  tag: string;
  payload: string;
};

export type WebTurnLease = {
  callId: string;
  token: string;
  locale: Locale;
  state: CallState;
  history: ConversationMessage[];
  usageTurnId: string;
  clientTurnId: string | null;
};

const sessions = new Map<string, WebSession>();
const sessionTtlMs = 2 * 60 * 60 * 1000;
let loadedStoragePath: string | null = null;
let sessionQueue = Promise.resolve();

function storageEnabled() {
  return process.env.WEB_SESSION_STORAGE === "encrypted-file";
}

function storagePath() {
  const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
  return path.join(dataDirectory, "web-sessions.enc.json");
}

function encryptionKey() {
  const configured = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error("WEB_SESSION_STORAGE=encrypted-file için DATA_ENCRYPTION_KEY gerekli.");
  }
  return createHash("sha256").update("voiceops:web-sessions:v1\0").update(configured).digest();
}

function maximumSessions() {
  const configured = Number(process.env.WEB_SESSION_LIMIT || 5_000);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 5_000;
}

function validatedSession(value: PersistedWebSession): PersistedWebSession {
  if (!Number.isFinite(value.updatedAt) || !Array.isArray(value.history)
    || !Array.isArray(value.completedTurnIds) || typeof value.locale !== "string") {
    throw new Error("Kalıcı görüşme oturumu biçimi geçersiz.");
  }
  return {
    locale: localeSchema.parse(value.locale),
    state: callStateSchema.parse(value.state),
    history: value.history.slice(-20).map((message) => messageSchema.parse(message)),
    updatedAt: value.updatedAt,
    completedTurnIds: value.completedTurnIds.slice(-100).map((turnId) => {
      if (typeof turnId !== "string" || turnId.length > 100) {
        throw new Error("Kalıcı görüşme turu kimliği geçersiz.");
      }
      return turnId;
    }),
  };
}

function decodeSessionFile(content: string) {
  const envelope = JSON.parse(content) as EncryptedSessionFile;
  if (envelope.version !== 1 || envelope.encrypted !== true) {
    throw new Error("Kalıcı görüşme oturumu sürümü desteklenmiyor.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.payload, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as Record<string, PersistedWebSession>;
}

function encodeSessionFile() {
  const payload = Object.fromEntries([...sessions.entries()].map(([callId, session]) => [callId, {
    locale: session.locale,
    state: session.state,
    history: session.history,
    updatedAt: session.updatedAt,
    completedTurnIds: session.completedTurnIds,
  } satisfies PersistedWebSession]));
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
    for (const [callId, stored] of Object.entries(decoded)) {
      const session = validatedSession(stored);
      sessions.set(callId, { ...session, activeToken: null });
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

function cleanSessions(now = Date.now()) {
  let changed = false;
  const cutoff = now - sessionTtlMs;
  for (const [callId, session] of sessions) {
    if (!session.activeToken && session.updatedAt < cutoff) {
      sessions.delete(callId);
      changed = true;
    }
  }

  if (sessions.size < maximumSessions()) return changed;
  const evictable = [...sessions.entries()]
    .filter(([, session]) => !session.activeToken)
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt);
  while (sessions.size >= maximumSessions() && evictable.length) {
    sessions.delete(evictable.shift()![0]);
    changed = true;
  }
  return changed;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

export async function beginWebTurn(
  callId: string | undefined,
  locale: Locale,
  clientTurnId?: string,
): Promise<WebTurnLease> {
  return runExclusive(async () => {
    await ensureLoaded();
    const cleaned = cleanSessions();
    const resolvedCallId = callId || randomUUID();
    let session = sessions.get(resolvedCallId);
    if (!session) {
      if (sessions.size >= maximumSessions()) {
        throw Object.assign(new Error("Görüşme kapasitesi dolu. Lütfen kısa süre sonra tekrar deneyin."), { status: 503 });
      }
      session = {
        locale,
        state: callStateSchema.parse({}),
        history: [],
        updatedAt: Date.now(),
        activeToken: null,
        completedTurnIds: [],
      };
      sessions.set(resolvedCallId, session);
    }
    if (session.locale !== locale) throw conflict("Aktif görüşmenin dili değiştirilemez.");
    if (session.activeToken) throw conflict("Bu görüşme için başka bir istek halen işleniyor.");
    if (clientTurnId && session.completedTurnIds.includes(clientTurnId)) {
      throw conflict("Bu görüşme turu daha önce işlendi.");
    }

    const token = randomUUID();
    session.activeToken = token;
    session.updatedAt = Date.now();
    if (cleaned) await persistSessions();
    return {
      callId: resolvedCallId,
      token,
      locale: session.locale,
      state: callStateSchema.parse(session.state),
      history: session.history.map((message) => ({ ...message })),
      usageTurnId: randomUUID(),
      clientTurnId: clientTurnId || null,
    };
  });
}

function leasedSession(lease: WebTurnLease) {
  const session = sessions.get(lease.callId);
  if (!session || session.activeToken !== lease.token) {
    throw conflict("Görüşme oturumu artık geçerli değil.");
  }
  return session;
}

export async function commitWebTurn(
  lease: WebTurnLease,
  state: CallState,
  transcript: string,
  reply: string,
) {
  return runExclusive(async () => {
    await ensureLoaded();
    const session = leasedSession(lease);
    session.state = callStateSchema.parse(state);
    session.history = [
      ...lease.history,
      { role: "user" as const, content: transcript },
      { role: "assistant" as const, content: reply },
    ].slice(-20);
    if (lease.clientTurnId) {
      session.completedTurnIds = [...session.completedTurnIds, lease.clientTurnId].slice(-100);
    }
    session.activeToken = null;
    session.updatedAt = Date.now();
    await persistSessions();
    return session.history.map((message) => ({ ...message }));
  });
}

export async function abortWebTurn(lease: WebTurnLease | null) {
  if (!lease) return;
  return runExclusive(async () => {
    await ensureLoaded();
    const session = sessions.get(lease.callId);
    if (session?.activeToken === lease.token) {
      session.activeToken = null;
      session.updatedAt = Date.now();
    }
  });
}

export function webSessionStatus() {
  return {
    backend: storageEnabled() ? "encrypted-file" as const : "memory" as const,
    durable: storageEnabled(),
    encrypted: storageEnabled() && Boolean(process.env.DATA_ENCRYPTION_KEY?.trim()),
  };
}

export async function initializeWebSessions() {
  await runExclusive(ensureLoaded);
}

export async function resetWebSessionsForTests(options: { preserveStorage?: boolean } = {}) {
  await sessionQueue;
  sessions.clear();
  loadedStoragePath = null;
  sessionQueue = Promise.resolve();
  if (!options.preserveStorage) process.env.WEB_SESSION_STORAGE = "memory";
}
