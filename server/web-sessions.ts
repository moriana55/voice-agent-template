import { randomUUID } from "node:crypto";
import type { Locale } from "@shared/i18n";
import { callStateSchema, type CallState, type ConversationMessage } from "@shared/schema";

type WebSession = {
  locale: Locale;
  state: CallState;
  history: ConversationMessage[];
  updatedAt: number;
  activeToken: string | null;
  completedTurnIds: string[];
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

function maximumSessions() {
  const configured = Number(process.env.WEB_SESSION_LIMIT || 5_000);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 5_000;
}

function cleanSessions(now = Date.now()) {
  const cutoff = now - sessionTtlMs;
  for (const [callId, session] of sessions) {
    if (!session.activeToken && session.updatedAt < cutoff) sessions.delete(callId);
  }

  if (sessions.size < maximumSessions()) return;
  const evictable = [...sessions.entries()]
    .filter(([, session]) => !session.activeToken)
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt);
  while (sessions.size >= maximumSessions() && evictable.length) {
    sessions.delete(evictable.shift()![0]);
  }
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

export function beginWebTurn(
  callId: string | undefined,
  locale: Locale,
  clientTurnId?: string,
): WebTurnLease {
  cleanSessions();
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
  return {
    callId: resolvedCallId,
    token,
    locale: session.locale,
    state: callStateSchema.parse(session.state),
    history: session.history.map((message) => ({ ...message })),
    usageTurnId: randomUUID(),
    clientTurnId: clientTurnId || null,
  };
}

function leasedSession(lease: WebTurnLease) {
  const session = sessions.get(lease.callId);
  if (!session || session.activeToken !== lease.token) {
    throw conflict("Görüşme oturumu artık geçerli değil.");
  }
  return session;
}

export function commitWebTurn(
  lease: WebTurnLease,
  state: CallState,
  transcript: string,
  reply: string,
) {
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
  return session.history.map((message) => ({ ...message }));
}

export function abortWebTurn(lease: WebTurnLease | null) {
  if (!lease) return;
  const session = sessions.get(lease.callId);
  if (session?.activeToken === lease.token) {
    session.activeToken = null;
    session.updatedAt = Date.now();
  }
}

export function resetWebSessionsForTests() {
  sessions.clear();
}
