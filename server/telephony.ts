import { normalizeLocale, type Locale } from "@shared/i18n";
import { DEFAULT_LOCALE, phoneDisclosure, telephonyLanguage, unheardMessage, welcomeMessage } from "./dil.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Express, NextFunction, Request, Response } from "express";
import twilio from "twilio";
import { callStateSchema, type CallState, type ConversationMessage } from "@shared/schema";
import { updateCallState } from "@shared/call-logic";
import { generateAssistantReply } from "./assistant";
import { synthesizeFishBuffer } from "./fish";
import { recordCompletedCall } from "./records";
import {
  assertUsageAvailable,
  assertUsageTurnAvailable,
  estimateSpeechSeconds,
  recordAbandonedUsage,
  recordUsage,
  releaseUsageReservation,
  reserveUsage,
} from "./usage";
import { turnConcurrencyLimiter } from "./security";
import { ReplayWindow } from "./replay-window";

type PhoneSession = {
  locale: Locale;
  state: CallState;
  history: ConversationMessage[];
  updatedAt: number;
};

const sessions = new Map<string, PhoneSession>();
const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const audioDirectory = path.join(dataDirectory, "telephony-audio");
const phoneTurnReplay = new ReplayWindow<string>(2 * 60 * 60 * 1000, 10_000);

function phoneRequestId(req: Request) {
  const provided = String(req.query.turnId || "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(provided)) {
    return provided;
  }
  return createHash("sha256")
    .update(req.originalUrl)
    .update("\0")
    .update(req.get("x-twilio-signature") || "")
    .digest("hex");
}

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
}

function signedRequestUrl(req: Request) {
  const configured = publicBaseUrl();
  if (configured) return `${configured}${req.originalUrl}`;
  const trustProxy = process.env.TRUST_PROXY === "true";
  const forwardedProto = trustProxy ? req.get("x-forwarded-proto")?.split(",")[0]?.trim() : undefined;
  const forwardedHost = trustProxy ? req.get("x-forwarded-host")?.split(",")[0]?.trim() : undefined;
  return `${forwardedProto || req.protocol}://${forwardedHost || req.get("host")}${req.originalUrl}`;
}

export function validateTwilioWebhook(req: Request, res: Response, next: NextFunction) {
  if (process.env.TWILIO_SKIP_SIGNATURE === "true" && process.env.NODE_ENV !== "production") {
    return next();
  }
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.get("x-twilio-signature");
  if (!token || !signature) return res.status(401).send("Twilio imzası gerekli.");
  const valid = twilio.validateRequest(token, signature, signedRequestUrl(req), req.body || {});
  if (!valid) return res.status(403).send("Geçersiz Twilio imzası.");
  return next();
}

export function createGatherResponse(
  prompt: string,
  audioUrl?: string | null,
  locale: Locale = DEFAULT_LOCALE,
  turnId = randomUUID(),
) {
  const language = telephonyLanguage(locale);
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: ["speech"],
    action: `/api/telephony/turn?turnId=${encodeURIComponent(turnId)}`,
    method: "POST",
    language: language as "en-US",
    speechTimeout: "auto",
    actionOnEmptyResult: true,
  });
  if (audioUrl) gather.play(audioUrl);
  else gather.say({ language: language as "en-US" }, prompt);
  response.redirect({ method: "POST" }, "/api/telephony/incoming");
  return response.toString();
}

async function createPhoneAudio(text: string, locale: Locale) {
  if (!process.env.FISH_AUDIO_API_KEY || !publicBaseUrl()) return null;
  await mkdir(audioDirectory, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const filePath = path.join(audioDirectory, `${id}.mp3`);
  await writeFile(filePath, await synthesizeFishBuffer(text, { phoneOptimized: true, locale }), { mode: 0o600 });
  const timer = setTimeout(() => void unlink(filePath).catch(() => undefined), 60 * 60 * 1000);
  timer.unref();
  return `${publicBaseUrl()}/api/telephony/audio/${id}`;
}

function getSession(callSid: string, selectedLocale: Locale = DEFAULT_LOCALE) {
  const existing = sessions.get(callSid);
  if (existing) return existing;
  const session: PhoneSession = {
    locale: selectedLocale,
    state: callStateSchema.parse({}),
    history: [{ role: "assistant", content: welcomeMessage(selectedLocale) }],
    updatedAt: Date.now(),
  };
  sessions.set(callSid, session);
  return session;
}

function cleanOldSessions() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [callSid, session] of sessions) {
    if (session.updatedAt < cutoff) sessions.delete(callSid);
  }
}

export function registerTelephonyRoutes(app: Express) {
  app.get("/api/telephony/audio/:id", async (req, res, next) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.sendStatus(404);
    try {
      const audio = await readFile(path.join(audioDirectory, `${req.params.id}.mp3`));
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "private, max-age=600");
      return res.send(audio);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return res.sendStatus(404);
      return next(error);
    }
  });

  app.post("/api/telephony/incoming", validateTwilioWebhook, async (req, res, next) => {
    try {
      cleanOldSessions();
      const callSid = String(req.body.CallSid || randomUUID());
      const locale = normalizeLocale(req.query.locale || req.body.locale, DEFAULT_LOCALE);
      getSession(callSid, locale);
      const prompt = phoneDisclosure(locale);
      const audioUrl = await createPhoneAudio(prompt, locale);
      return res.type("text/xml").send(createGatherResponse(prompt, audioUrl, locale));
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/telephony/turn", validateTwilioWebhook, turnConcurrencyLimiter, async (req, res, next) => {
    let usageReservation: string | null = null;
    let abandonedUsage: { turnId: string; callId: string; locale: Locale } | null = null;
    const replayId = phoneRequestId(req);
    let replayAcquired = false;
    const sendVoiceResponse = (xml: string) => {
      phoneTurnReplay.commit(replayId, xml);
      replayAcquired = false;
      return res.type("text/xml").send(xml);
    };
    try {
      const replay = phoneTurnReplay.begin(replayId);
      if (replay.cached) return res.type("text/xml").send(replay.value);
      replayAcquired = true;
      await assertUsageTurnAvailable(replayId);
      const callSid = String(req.body.CallSid || randomUUID());
      const transcript = String(req.body.SpeechResult || "").trim().slice(0, 4000);
      const session = getSession(callSid);
      session.updatedAt = Date.now();

      await assertUsageAvailable();

      if (!transcript) {
        const prompt = unheardMessage(session.locale);
        const audioUrl = await createPhoneAudio(prompt, session.locale);
        return sendVoiceResponse(createGatherResponse(prompt, audioUrl, session.locale));
      }

      usageReservation = await reserveUsage(estimateSpeechSeconds(transcript));
      abandonedUsage = { turnId: replayId, callId: callSid, locale: session.locale };

      const previousState = session.state;
      const state = updateCallState(transcript, previousState, session.locale);
      const reply = await generateAssistantReply(transcript, session.history, state, session.locale);
      session.state = state;
      session.history = ([
        ...session.history,
        { role: "user" as const, content: transcript },
        { role: "assistant" as const, content: reply },
      ]).slice(-20);

      if (process.env.TELEPHONY_RECORD_STORAGE === "enabled" && state.completed && !previousState.completed) {
        await recordCompletedCall({
          callId: callSid,
          source: "twilio",
          locale: session.locale,
          state,
          transcript,
          history: session.history,
        });
      }

      await recordUsage({
        turnId: abandonedUsage.turnId,
        callId: callSid,
        source: "twilio",
        locale: session.locale,
        inputText: transcript,
        reply,
        reservationId: usageReservation,
      });
      usageReservation = null;
      abandonedUsage = null;

      const audioUrl = await createPhoneAudio(reply, session.locale);
      if (state.completed) {
        const response = new twilio.twiml.VoiceResponse();
        if (audioUrl) response.play(audioUrl);
        else response.say({ language: telephonyLanguage(session.locale) as "en-US" }, reply);
        response.hangup();
        sessions.delete(callSid);
        return sendVoiceResponse(response.toString());
      }
      return sendVoiceResponse(createGatherResponse(reply, audioUrl, session.locale));
    } catch (error) {
      return next(error);
    } finally {
      if (replayAcquired) phoneTurnReplay.abort(replayId);
      if (usageReservation && abandonedUsage) {
        await recordAbandonedUsage({
          ...abandonedUsage,
          source: "twilio",
          reservationId: usageReservation,
        }).catch((error) => console.error(JSON.stringify({
          level: "error",
          event: "abandoned_usage_record_failed",
          message: error instanceof Error ? error.message : "Abandoned usage record failed",
        })));
      }
      releaseUsageReservation(usageReservation);
    }
  });

  app.post("/api/telephony/status", validateTwilioWebhook, (req, res) => {
    const allowedStatuses = new Set(["queued", "initiated", "ringing", "in-progress", "completed", "busy", "no-answer", "failed", "canceled"]);
    const status = String(req.body.CallStatus || "unknown");
    console.log(JSON.stringify({
      level: "info",
      event: "telephony_status",
      callSid: String(req.body.CallSid || "").slice(0, 40),
      status: allowedStatuses.has(status) ? status : "unknown",
      durationSeconds: Math.max(0, Number(req.body.CallDuration || 0)),
    }));
    return res.sendStatus(204);
  });
}
