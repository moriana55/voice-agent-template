import type { Locale } from "@shared/i18n";
import { supportedLocales } from "@shared/i18n";
import {
  DEFAULT_LOCALE,
  openingLeadIn,
  systemInstructions,
  transcriptionLanguage,
  voiceId,
} from "./dil.js";
import type { Express, Response } from "express";
import type { Server } from "http";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { FishAudioClient, FlushEvent, RealtimeEvents, type Backends } from "fish-audio";
import {
  checkoutSessionRequestSchema,
  outboundCallRequestSchema,
  turnRequestSchema,
  type CallState,
  type ConversationMessage,
} from "@shared/schema";
import { demoReply, updateCallState } from "@shared/call-logic";
import {
  deleteCallRecord,
  listCallRecords,
  pruneExpiredRecords,
  recordCompletedCall,
  recordsStatus,
} from "./records";
import { requireAdmin, turnConcurrencyLimiter, turnLimiter } from "./security";
import { synthesizeFishBuffer } from "./fish";
import { registerTelephonyRoutes } from "./telephony";
import {
  commercialReadiness,
  deploymentSafetyIssues,
  publicProductConfig,
  publicReadinessPayload,
} from "./product";
import {
  assertUsageAvailable,
  estimateSpeechSeconds,
  recordAbandonedUsage,
  recordUsage,
  releaseUsageReservation,
  reserveUsage,
  usageSummary,
  wavDurationSeconds,
} from "./usage";
import {
  createOutboundCall,
  createStripeCheckout,
  integrationStatuses,
  processStripeWebhook,
} from "./integrations";
import {
  abortWebTurn,
  beginWebTurn,
  commitWebTurn,
  initializeWebSessions,
  pruneExpiredWebSessions,
  webSessionStatus,
  type WebTurnLease,
} from "./web-sessions";
import { assertValidUploadedAudio, supportedAudioMimeTypes } from "./audio-validation";
import { publicStreamErrorMessage } from "./error-safety";
import { isServerDraining } from "./lifecycle";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 10, fieldSize: 100 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (supportedAudioMimeTypes.has(file.mimetype.split(";", 1)[0].trim().toLowerCase())) callback(null, true);
    else callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
  },
});

type StreamEvent =
  | { type: "meta"; transcript: string; state: CallState; mode: string }
  | { type: "text_delta"; text: string }
  | { type: "audio"; audioBase64: string; audioMime: string }
  | { type: "done"; reply: string; latencyMs: number; firstAudioMs: number | null; audioWarning: string | null; recorded: boolean; usageSeconds: number }
  | { type: "error"; message: string };

class AsyncTextQueue implements AsyncIterable<string>, AsyncIterator<string> {
  private values: string[] = [];
  private waiters: Array<(result: IteratorResult<string>) => void> = [];
  private ended = false;

  push(value: string) {
    if (this.ended || !value) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.waiters.splice(0).forEach((waiter) => waiter({ value: undefined, done: true }));
  }

  async waitUntilDrained(timeoutMs = 750) {
    const deadline = Date.now() + timeoutMs;
    while (this.values.length > 0) {
      if (Date.now() >= deadline) return false;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    // Iterator metni kuyruktan aldıktan sonra SDK'nın WebSocket'e TextEvent
    // yazmasına bir event-loop turu bırak. Böylece FlushEvent metnin önüne geçmez.
    await new Promise<void>((resolve) => setImmediate(resolve));
    return true;
  }

  next(): Promise<IteratorResult<string>> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isDemoBrain() {
  return process.env.DEMO_MODE !== "false"
    || (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY);
}

type ProviderName = "anthropic" | "openai" | "fishAudio";
const providerHealth: Record<ProviderName, boolean | null> = {
  anthropic: null,
  openai: null,
  fishAudio: null,
};

function providerAvailable(provider: ProviderName, configured: boolean) {
  return configured && providerHealth[provider] !== false;
}

function currentMode(demo: boolean, fishConfigured: boolean) {
  const brainAvailable = !demo && (
    providerAvailable("anthropic", Boolean(process.env.ANTHROPIC_API_KEY))
    || providerAvailable("openai", Boolean(process.env.OPENAI_API_KEY))
  );
  const fishAvailable = providerAvailable("fishAudio", fishConfigured);
  return brainAvailable ? "live" : fishAvailable ? "fish-live" : "demo";
}

const fallbackWarnings: Record<Locale, { brain: string; voice: string }> = {
  en: { brain: "Live intelligence is unavailable; the secure local fallback is active.", voice: "Live voice is unavailable; browser audio is active." },
  tr: { brain: "Canlı zekâ servisine ulaşılamadı; güvenli yerel yedek devrede.", voice: "Canlı ses servisine ulaşılamadı; tarayıcı sesi devrede." },
  es: { brain: "La inteligencia en vivo no está disponible; el respaldo local seguro está activo.", voice: "La voz en vivo no está disponible; el audio del navegador está activo." },
  de: { brain: "Die Live-Intelligenz ist nicht verfügbar; das sichere lokale Backup ist aktiv.", voice: "Die Live-Stimme ist nicht verfügbar; Browser-Audio ist aktiv." },
  fr: { brain: "L’intelligence en direct est indisponible ; le secours local sécurisé est actif.", voice: "La voix en direct est indisponible ; l’audio du navigateur est actif." },
  it: { brain: "L’intelligenza live non è disponibile; il fallback locale sicuro è attivo.", voice: "La voce live non è disponibile; l’audio del browser è attivo." },
  pt: { brain: "A inteligência ao vivo está indisponível; o fallback local seguro está ativo.", voice: "A voz ao vivo está indisponível; o áudio do navegador está ativo." },
  nl: { brain: "Live-intelligentie is niet beschikbaar; de veilige lokale fallback is actief.", voice: "Live-stem is niet beschikbaar; browseraudio is actief." },
  pl: { brain: "Inteligencja na żywo jest niedostępna; działa bezpieczny tryb lokalny.", voice: "Głos na żywo jest niedostępny; działa dźwięk przeglądarki." },
  ru: { brain: "Онлайн-интеллект недоступен; включён безопасный локальный режим.", voice: "Онлайн-голос недоступен; включён звук браузера." },
};

function providerFailure(service: string, error: unknown, provider?: ProviderName) {
  if (provider) providerHealth[provider] = false;
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[provider fallback] ${service}: ${detail}`);
}

async function transcribeAudio(openai: OpenAI, file: Express.Multer.File, locale: Locale, signal?: AbortSignal) {
  const uploaded = await toFile(file.buffer, file.originalname || "recording.webm", {
    type: file.mimetype || "audio/webm",
  });
  const result = await openai.audio.transcriptions.create({
    file: uploaded,
    model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
    language: transcriptionLanguage(locale),
  }, { signal: withTimeout(signal, 20_000) });
  providerHealth.openai = true;
  return result.text.trim();
}

async function transcribeFish(file: Express.Multer.File, locale: Locale, signal?: AbortSignal) {
  const form = new FormData();
  const audioBuffer = new ArrayBuffer(file.buffer.byteLength);
  new Uint8Array(audioBuffer).set(file.buffer);
  form.append("audio", new Blob([audioBuffer], { type: file.mimetype || "audio/webm" }),
    file.originalname || "recording.webm");
  form.append("language", transcriptionLanguage(locale));
  form.append("ignore_timestamps", "true");
  const response = await fetch("https://api.fish.audio/v1/asr", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}` },
    body: form,
    signal: withTimeout(signal, 20_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    providerHealth.fishAudio = false;
    throw new Error(`Fish ASR ${response.status}: ${detail.slice(0, 240)}`);
  }
  providerHealth.fishAudio = true;
  const result = await response.json() as { text: string };
  return result.text.trim();
}

let fishCreditCache: { value: number; expiresAt: number } | null = null;
let fishCreditRefresh: Promise<void> | null = null;

function getFishCredit() {
  if (!process.env.FISH_AUDIO_API_KEY) return null;
  if ((!fishCreditCache || fishCreditCache.expiresAt <= Date.now()) && !fishCreditRefresh) {
    fishCreditRefresh = (async () => {
      const response = await fetch("https://api.fish.audio/wallet/self/api-credit", {
        headers: { Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}` },
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) providerHealth.fishAudio = false;
        return;
      }
      providerHealth.fishAudio = true;
      const result = await response.json() as { credit: string };
      const value = Number(result.credit);
      if (Number.isFinite(value)) fishCreditCache = { value, expiresAt: Date.now() + 60_000 };
    })().catch(() => undefined).finally(() => {
      fishCreditRefresh = null;
    });
  }
  return fishCreditCache?.value ?? null;
}

function buildConversationPrompt(
  transcript: string,
  history: ConversationMessage[],
  state: CallState,
  locale: Locale,
) {
  const labels = locale === "tr"
    ? { customer: "Müşteri", agent: "Temsilci", context: "Doğrulanmış işletme bilgisi", state: "Görüşme durumu", rule: "Eksik alanlardan yalnızca birini doğal biçimde sor. Tamamlanan bilgiyi tekrar isteme." }
    : { customer: "Customer", agent: "Agent", context: "Verified business information", state: "Call state", rule: "Ask naturally for only one missing field. Never request information that is already complete." };
  const conversation = history
    .slice(-10)
    .map((item) => `${item.role === "user" ? labels.customer : labels.agent}: ${item.content}`)
    .join("\n");

  const businessContext = process.env.BUSINESS_CONTEXT?.trim();
  return `${businessContext ? `${labels.context}:\n${businessContext}\n` : ""}${labels.state}: ${JSON.stringify(state)}
${labels.rule}
${conversation ? `${conversation}\n` : ""}${labels.customer}: ${transcript}\n${labels.agent}:`;
}

function streamingLeadIn(state: CallState, locale: Locale) {
  if (locale === "en") {
    if (state.intent === "randevu") return "Of course, let's set up your appointment. ";
    if (state.intent === "fiyat") return "Certainly, I can help with pricing. ";
    if (state.intent === "destek") return "I understand. Let's get that issue sorted out. ";
  } else if (locale === "tr") {
    if (state.intent === "randevu") return "Elbette, randevunuzu birlikte hemen oluşturalım. ";
    if (state.intent === "fiyat") return "Tabii, fiyat bilgisi için hemen yardımcı olayım. ";
    if (state.intent === "destek") return "Anladım, sorunu birlikte hızlıca kontrol edelim. ";
  }
  return openingLeadIn(locale);
}

function sanitizeStreamingContinuation(value: string) {
  return value
    .trimStart()
    .replace(/^(?:(?:tabii|elbette|anladım|merhaba|memnuniyetle|sure|certainly|of course|understood|hello)[,!:.]?\s*)+/i, "");
}

function cleanStreamingContinuation(value: string, locale: Locale) {
  const cleaned = sanitizeStreamingContinuation(value).trim();
  if (!cleaned) return locale === "tr" ? "Size nasıl yardımcı olabilirim?" : "How can I help you?";
  return `${cleaned.charAt(0).toLocaleUpperCase(locale === "tr" ? "tr-TR" : "en-US")}${cleaned.slice(1)}`;
}

async function generateOpenAIReply(
  openai: OpenAI,
  transcript: string,
  history: ConversationMessage[],
  state: CallState,
  locale: Locale,
  signal?: AbortSignal,
) {
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    instructions: systemInstructions(locale),
    input: buildConversationPrompt(transcript, history, state, locale),
    store: false,
  }, { signal: withTimeout(signal, 20_000) });
  providerHealth.openai = true;
  return response.output_text.trim();
}

async function generateClaudeReply(
  transcript: string,
  history: ConversationMessage[],
  state: CallState,
  locale: Locale,
  signal?: AbortSignal,
) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 180,
      system: systemInstructions(locale),
      messages: [
        {
          role: "user",
          content: buildConversationPrompt(transcript, history, state, locale),
        },
      ],
    }),
    signal: withTimeout(signal, 20_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    providerHealth.anthropic = false;
    throw new Error(`Claude API ${response.status}: ${detail.slice(0, 240)}`);
  }
  providerHealth.anthropic = true;

  const result = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
  };
  const reply = result.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text || "")
    .join("\n")
    .trim();

  if (!reply) throw new Error("Claude API boş yanıt döndürdü.");
  return reply;
}

async function* streamClaudeReply(
  transcript: string,
  history: ConversationMessage[],
  state: CallState,
  leadIn: string,
  locale: Locale,
  signal?: AbortSignal,
) {
  const continuationInstruction = locale === "tr"
    ? "Temsilci şu giriş cümlesini zaten seslendirdi"
    : "The agent has already spoken this opening sentence";
  const responseInstruction = locale === "tr"
    ? "Bu girişi, selamlamayı veya onayı tekrar etme. Yalnızca tek kısa cümleyle gerekli soruyu ya da net cevabı ver."
    : "Do not repeat the opening, greeting, or acknowledgment. In one short sentence, provide only the needed question or clear answer.";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 180,
      system: systemInstructions(locale),
      stream: true,
      messages: [
        {
          role: "user",
          content: `${buildConversationPrompt(transcript, history, state, locale)}
${continuationInstruction}: ${JSON.stringify(leadIn.trim())}
${responseInstruction}`,
        },
      ],
    }),
    signal: withTimeout(signal, 20_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    providerHealth.anthropic = false;
    throw new Error(`Claude API ${response.status}: ${detail.slice(0, 240)}`);
  }
  providerHealth.anthropic = true;
  if (!response.body) throw new Error("Claude API akış gövdesi döndürmedi.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let producedText = false;

  const parseLine = (line: string) => {
    if (!line.startsWith("data:")) return null;
    const raw = line.slice(5).trim();
    if (!raw) return null;
    const event = JSON.parse(raw) as {
      type?: string;
      delta?: { type?: string; text?: string };
      error?: { message?: string };
    };
    if (event.type === "error") {
      throw new Error(event.error?.message || "Claude streaming hatası.");
    }
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      return event.delta.text || null;
    }
    return null;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const text = parseLine(line);
      if (text) {
        producedText = true;
        yield text;
      }
    }
    if (done) break;
  }

  if (buffer) {
    const text = parseLine(buffer);
    if (text) {
      producedText = true;
      yield text;
    }
  }
  if (!producedText) throw new Error("Claude API boş akış döndürdü.");
}

function writeStreamEvent(res: Response, event: StreamEvent) {
  if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
}

async function synthesizeFish(text: string, locale: Locale, signal?: AbortSignal) {
  try {
    const audio = await synthesizeFishBuffer(text, { signal, locale });
    providerHealth.fishAudio = true;
    return audio.toString("base64");
  } catch (error) {
    providerHealth.fishAudio = false;
    throw error;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  await initializeWebSessions();
  registerTelephonyRoutes(app);
  await pruneExpiredRecords();
  const configuredPruneInterval = Number(process.env.RECORD_PRUNE_INTERVAL_MS || 6 * 60 * 60 * 1000);
  const pruneIntervalMs = Number.isFinite(configuredPruneInterval)
    ? Math.max(60_000, configuredPruneInterval)
    : 6 * 60 * 60 * 1000;
  const pruneTimer = setInterval(() => {
    void pruneExpiredRecords().catch((error) => console.error(JSON.stringify({
      level: "error",
      event: "record_retention_failed",
      message: error instanceof Error ? error.message : "Record retention failed",
    })));
  }, pruneIntervalMs);
  pruneTimer.unref();
  const configuredSessionPruneInterval = Number(process.env.WEB_SESSION_PRUNE_INTERVAL_MS || 15 * 60 * 1000);
  const sessionPruneIntervalMs = Number.isFinite(configuredSessionPruneInterval)
    ? Math.max(60_000, configuredSessionPruneInterval)
    : 15 * 60 * 1000;
  const sessionPruneTimer = setInterval(() => {
    void pruneExpiredWebSessions().catch((error) => console.error(JSON.stringify({
      level: "error",
      event: "web_session_prune_failed",
      message: error instanceof Error ? error.message : "Web session pruning failed",
    })));
  }, sessionPruneIntervalMs);
  sessionPruneTimer.unref();
  httpServer.once("close", () => {
    clearInterval(pruneTimer);
    clearInterval(sessionPruneTimer);
  });
  app.get("/api/health/live", (_req, res) => {
    res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
  });

  app.get("/api/health/ready", (_req, res) => {
    const fishAudio = providerAvailable("fishAudio", Boolean(process.env.FISH_AUDIO_API_KEY));
    const brain = providerAvailable("anthropic", Boolean(process.env.ANTHROPIC_API_KEY))
      || providerAvailable("openai", Boolean(process.env.OPENAI_API_KEY))
      || process.env.DEMO_MODE !== "false";
    const recordConfiguration = recordsStatus();
    const privacyReady = !recordConfiguration.enabled || recordConfiguration.encrypted
      || process.env.NODE_ENV !== "production";
    const commercial = commercialReadiness();
    const deploymentIssues = deploymentSafetyIssues();
    const sessionConfiguration = webSessionStatus();
    const ready = !isServerDraining()
      && fishAudio && brain && privacyReady && commercial.ready && deploymentIssues.length === 0;
    res.status(ready ? 200 : 503).json(publicReadinessPayload({
      ready,
      services: { fishAudio, brain },
      privacyReady,
      commercial,
      deploymentIssues,
      records: recordConfiguration,
      sessions: sessionConfiguration,
    }));
  });

  app.get("/api/product", (_req, res) => {
    res.json(publicProductConfig());
  });

  app.post("/api/integrations/stripe/webhook", async (req, res, next) => {
    try {
      const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
      const signature = req.get("stripe-signature") || "";
      return res.json(await processStripeWebhook(rawBody, signature));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/integrations", requireAdmin, (_req, res) => {
    res.json({ integrations: integrationStatuses() });
  });

  app.post("/api/admin/telephony/outbound", requireAdmin, async (req, res, next) => {
    try {
      const input = outboundCallRequestSchema.parse(req.body);
      return res.status(201).json(await createOutboundCall(input));
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/admin/billing/checkout", requireAdmin, async (req, res, next) => {
    try {
      const input = checkoutSessionRequestSchema.parse(req.body);
      return res.status(201).json(await createStripeCheckout(input.email));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/records", requireAdmin, async (req, res, next) => {
    try {
      return res.json({ records: await listCallRecords(req.query.limit) });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/admin/records/:id", requireAdmin, async (req, res, next) => {
    try {
      const deleted = await deleteCallRecord(String(req.params.id));
      return deleted ? res.sendStatus(204) : res.sendStatus(404);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/usage", requireAdmin, async (req, res, next) => {
    try {
      return res.json(await usageSummary(String(req.query.period || new Date().toISOString().slice(0, 7))));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/status", async (_req, res) => {
    const demo = isDemoBrain();
    const fishEnabled = Boolean(process.env.FISH_AUDIO_API_KEY);
    const anthropicAvailable = providerAvailable("anthropic", Boolean(process.env.ANTHROPIC_API_KEY));
    const openaiAvailable = providerAvailable("openai", Boolean(process.env.OPENAI_API_KEY));
    const fishAvailable = providerAvailable("fishAudio", fishEnabled);
    const exposeProviderDetails = process.env.EXPOSE_PROVIDER_STATUS === "true";
    const credit = exposeProviderDetails ? getFishCredit() : null;
    res.json({
      mode: currentMode(demo, fishEnabled),
      credit,
      services: {
        microphone: true,
        anthropic: anthropicAvailable,
        openai: openaiAvailable,
        fishAudio: fishAvailable,
        voice: Boolean(voiceId(DEFAULT_LOCALE)),
      },
      models: {
        llm: exposeProviderDetails
          ? anthropicAvailable
            ? process.env.ANTHROPIC_MODEL || "configured anthropic model"
            : openaiAvailable
              ? process.env.OPENAI_MODEL || "configured openai model"
              : "local scenario engine"
          : anthropicAvailable || openaiAvailable ? "configured provider" : "local scenario engine",
        transcription: exposeProviderDetails
          ? openaiAvailable
            ? process.env.OPENAI_TRANSCRIBE_MODEL || "configured transcription model"
            : fishAvailable ? "configured fish transcription" : "browser text input"
          : openaiAvailable || fishAvailable ? "configured provider" : "browser text input",
        speech: exposeProviderDetails
          ? process.env.FISH_AUDIO_MODEL || "configured speech model"
          : fishAvailable ? "configured provider" : "browser audio",
      },
      records: recordsStatus(),
      sessions: webSessionStatus(),
      product: publicProductConfig(),
      localization: {
        defaultLocale: DEFAULT_LOCALE,
        supportedLocales,
      },
    });
  });

  app.post("/api/turn/stream", turnLimiter, turnConcurrencyLimiter, upload.single("audio"), async (req, res, next) => {
    const startedAt = Date.now();
    let streamStarted = false;
    let webLease: WebTurnLease | null = null;
    let usageReservation: string | null = null;
    let abandonedUsage: Pick<WebTurnLease, "callId" | "usageTurnId" | "locale"> | null = null;
    const requestAbort = new AbortController();
    req.once("aborted", () => requestAbort.abort());
    res.once("close", () => {
      if (!res.writableEnded) requestAbort.abort();
    });
    try {
      const parsedHistory = req.body.history ? JSON.parse(req.body.history) : [];
      const parsedState = req.body.state ? JSON.parse(req.body.state) : undefined;
      const payload = turnRequestSchema.parse({
        callId: req.body.callId || undefined,
        turnId: req.body.turnId || undefined,
        noticeAcknowledged: req.body.noticeAcknowledged === "true",
        storageConsent: req.body.storageConsent === "true",
        locale: req.body.locale || undefined,
        text: req.body.text || undefined,
        history: parsedHistory,
        state: parsedState,
      });
      assertValidUploadedAudio(req.file);
      webLease = await beginWebTurn(payload.callId, payload.locale, payload.turnId);

      await assertUsageAvailable();

      const demo = isDemoBrain();
      const fishEnabled = Boolean(process.env.FISH_AUDIO_API_KEY);
      const claudeEnabled = Boolean(process.env.ANTHROPIC_API_KEY);
      const openai = process.env.OPENAI_API_KEY
        ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        : null;

      let transcript = payload.text?.trim() || "";
      if (!transcript && req.file && openai) {
        transcript = await transcribeAudio(openai, req.file, payload.locale, requestAbort.signal);
      } else if (!transcript && req.file && fishEnabled) {
        transcript = await transcribeFish(req.file, payload.locale, requestAbort.signal);
      }
      if (!transcript) {
        return res.status(400).json({
          message: payload.locale === "tr" ? "Konuşma veya metin bulunamadı." : "No speech or text was provided.",
        });
      }

      const inputSeconds = req.file ? wavDurationSeconds(req.file.buffer) : estimateSpeechSeconds(transcript);
      usageReservation = await reserveUsage(inputSeconds);
      abandonedUsage = {
        callId: webLease.callId,
        usageTurnId: webLease.usageTurnId,
        locale: webLease.locale,
      };

      const state = updateCallState(transcript, webLease.state, webLease.locale);
      const mode = currentMode(demo, fishEnabled);
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      streamStarted = true;
      writeStreamEvent(res, { type: "meta", transcript, state, mode });

      let reply = "";
      let firstAudioMs: number | null = null;
      let audioWarning: string | null = null;
      let recorded = false;

      if (!demo && claudeEnabled) {
        const textQueue = new AsyncTextQueue();
        const leadIn = streamingLeadIn(state, payload.locale);
        let finishFish: Promise<void> | null = null;
        let closeFish: (() => void) | null = null;
        let flushFish: (() => void) | null = null;

        try {
          if (fishEnabled) {
            const client = new FishAudioClient({ apiKey: process.env.FISH_AUDIO_API_KEY });
            const connection = await client.textToSpeech.convertRealtime({
              text: "",
              reference_id: voiceId(payload.locale),
              format: "mp3",
              sample_rate: 44_100,
              mp3_bitrate: 128,
              chunk_length: 90,
              latency: "balanced",
              normalize: true,
              temperature: 0.35,
              top_p: 0.7,
              prosody: { speed: 1, volume: 0 },
            }, textQueue, (process.env.FISH_AUDIO_MODEL || "s2-pro") as Backends);
            closeFish = () => connection.close();
            requestAbort.signal.addEventListener("abort", closeFish, { once: true });
            flushFish = () => connection.send(new FlushEvent());
            finishFish = new Promise((resolve) => {
              let settled = false;
              const settle = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve();
              };
              const timeout = setTimeout(() => {
                audioWarning = fallbackWarnings[payload.locale].voice;
                connection.close();
                settle();
              }, 8_000);
              connection.on(RealtimeEvents.AUDIO_CHUNK, (value: unknown) => {
                providerHealth.fishAudio = true;
                const bytes = value instanceof Uint8Array ? value : Buffer.from(value as ArrayBuffer);
                if (firstAudioMs === null) firstAudioMs = Date.now() - startedAt;
                writeStreamEvent(res, {
                  type: "audio",
                  audioBase64: Buffer.from(bytes).toString("base64"),
                  audioMime: "audio/mpeg",
                });
              });
              connection.on(RealtimeEvents.ERROR, (value: unknown) => {
                providerFailure("Fish realtime", value, "fishAudio");
                audioWarning = fallbackWarnings[payload.locale].voice;
                settle();
              });
              connection.on(RealtimeEvents.CLOSE, settle);
            });
          }

          reply = leadIn;
          writeStreamEvent(res, { type: "text_delta", text: leadIn });
          textQueue.push(leadIn);
          const leadInDrained = await textQueue.waitUntilDrained();
          if (!leadInDrained) audioWarning = fallbackWarnings[payload.locale].voice;
          flushFish?.();
          let continuation = "";
          let continuationStarted = false;
          let pendingStart = "";

          const streamContinuation = (value: string) => {
            if (!value) return;
            reply += value;
            writeStreamEvent(res, { type: "text_delta", text: value });
            textQueue.push(value);
          };

          for await (const delta of streamClaudeReply(
            transcript,
            webLease.history,
            state,
            leadIn,
            payload.locale,
            requestAbort.signal,
          )) {
            continuation += delta;
            if (continuationStarted) {
              streamContinuation(delta);
              continue;
            }

            pendingStart += delta;
            // İlk birkaç tokenı kısa süre tamponlayarak Claude'un giriş cümlesini
            // tekrar etmesini temizliyor, sonrasını ise gerçek zamanlı Fish'e veriyoruz.
            if (pendingStart.trim().length < 18) continue;
            const cleanedStart = sanitizeStreamingContinuation(pendingStart).trimStart();
            if (cleanedStart.trim()) {
              streamContinuation(`${cleanedStart.charAt(0).toLocaleUpperCase(payload.locale === "tr" ? "tr-TR" : "en-US")}${cleanedStart.slice(1)}`);
            }
            continuationStarted = true;
          }
          if (!continuationStarted) streamContinuation(cleanStreamingContinuation(continuation, payload.locale));
          textQueue.end();
          if (finishFish) await finishFish;
          if (fishEnabled && firstAudioMs === null) {
            const audioBase64 = await synthesizeFish(reply, payload.locale, requestAbort.signal);
            firstAudioMs = Date.now() - startedAt;
            writeStreamEvent(res, { type: "audio", audioBase64, audioMime: "audio/mpeg" });
          }
        } catch (error) {
          textQueue.end();
          closeFish?.();
          providerFailure("live turn", error, claudeEnabled ? "anthropic" : "openai");
          audioWarning = fallbackWarnings[payload.locale].brain;
          const fallback = demoReply(transcript, webLease.history, state, payload.locale);
          if (!reply.trim()) {
            reply = fallback;
            writeStreamEvent(res, { type: "text_delta", text: fallback });
          } else if (reply.trim() === leadIn.trim()) {
            reply += fallback;
            writeStreamEvent(res, { type: "text_delta", text: fallback });
          }
          if (fishEnabled && firstAudioMs === null) {
            try {
              const audioBase64 = await synthesizeFish(reply, payload.locale, requestAbort.signal);
              firstAudioMs = Date.now() - startedAt;
              writeStreamEvent(res, { type: "audio", audioBase64, audioMime: "audio/mpeg" });
            } catch (fishError) {
              providerFailure("Fish synthesis", fishError, "fishAudio");
              audioWarning = `${audioWarning} ${fallbackWarnings[payload.locale].voice}`;
            }
          }
        }
      } else {
        reply = !demo && openai
          ? await generateOpenAIReply(openai, transcript, webLease.history, state, payload.locale, requestAbort.signal)
          : demoReply(transcript, webLease.history, state, payload.locale);
        writeStreamEvent(res, { type: "text_delta", text: reply });
        if (fishEnabled) {
          try {
            const audioBase64 = await synthesizeFish(reply, payload.locale, requestAbort.signal);
            firstAudioMs = Date.now() - startedAt;
            writeStreamEvent(res, { type: "audio", audioBase64, audioMime: "audio/mpeg" });
          } catch (error) {
            providerFailure("Fish synthesis", error, "fishAudio");
            audioWarning = fallbackWarnings[payload.locale].voice;
          }
        }
      }

      if (payload.storageConsent && state.completed && !webLease.state.completed) {
        const result = await recordCompletedCall({
          callId: webLease.callId,
          source: "web",
          locale: payload.locale,
          state,
          transcript,
          history: [
            ...webLease.history,
            { role: "user", content: transcript },
            { role: "assistant", content: reply.trim() },
          ],
        });
        recorded = result.saved;
      }

      const { callId, usageTurnId } = webLease;
      await commitWebTurn(webLease, state, transcript, reply.trim());
      webLease = null;
      const usage = await recordUsage({
        turnId: usageTurnId,
        callId,
        source: "web",
        locale: payload.locale,
        inputSeconds: req.file ? wavDurationSeconds(req.file.buffer) : undefined,
        inputText: req.file ? undefined : transcript,
        reply,
        reservationId: usageReservation,
      });
      usageReservation = null;
      abandonedUsage = null;

      writeStreamEvent(res, {
        type: "done",
        reply: reply.trim(),
        latencyMs: Date.now() - startedAt,
        firstAudioMs,
        audioWarning,
        recorded,
        usageSeconds: usage?.billableSeconds || 0,
      });
      return res.end();
    } catch (error) {
      if (!streamStarted) return next(error);
      writeStreamEvent(res, {
        type: "error",
        message: publicStreamErrorMessage(error),
      });
      return res.end();
    } finally {
      await abortWebTurn(webLease);
      if (usageReservation && abandonedUsage) {
        await recordAbandonedUsage({
          turnId: abandonedUsage.usageTurnId,
          callId: abandonedUsage.callId,
          source: "web",
          locale: abandonedUsage.locale,
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

  app.post("/api/turn", turnLimiter, turnConcurrencyLimiter, upload.single("audio"), async (req, res, next) => {
    const startedAt = Date.now();
    let webLease: WebTurnLease | null = null;
    let usageReservation: string | null = null;
    let abandonedUsage: Pick<WebTurnLease, "callId" | "usageTurnId" | "locale"> | null = null;
    const requestAbort = new AbortController();
    req.once("aborted", () => requestAbort.abort());
    res.once("close", () => {
      if (!res.writableEnded) requestAbort.abort();
    });
    try {
      const parsedHistory = req.body.history ? JSON.parse(req.body.history) : [];
      const parsedState = req.body.state ? JSON.parse(req.body.state) : undefined;
      const payload = turnRequestSchema.parse({
        callId: req.body.callId || undefined,
        turnId: req.body.turnId || undefined,
        noticeAcknowledged: req.body.noticeAcknowledged === "true",
        storageConsent: req.body.storageConsent === "true",
        locale: req.body.locale || undefined,
        text: req.body.text || undefined,
        history: parsedHistory,
        state: parsedState,
      });
      assertValidUploadedAudio(req.file);
      webLease = await beginWebTurn(payload.callId, payload.locale, payload.turnId);

      await assertUsageAvailable();

      const demo = isDemoBrain();
      const fishEnabled = Boolean(process.env.FISH_AUDIO_API_KEY);
      const claudeEnabled = Boolean(process.env.ANTHROPIC_API_KEY);
      const openai = process.env.OPENAI_API_KEY
        ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        : null;

      let transcript = payload.text?.trim() || "";
      if (!transcript && req.file && openai) {
        transcript = await transcribeAudio(openai, req.file, payload.locale, requestAbort.signal);
      } else if (!transcript && req.file && fishEnabled) {
        transcript = await transcribeFish(req.file, payload.locale, requestAbort.signal);
      }
      if (!transcript) {
        return res.status(400).json({
          message: payload.locale === "tr" ? "Konuşma veya metin bulunamadı." : "No speech or text was provided.",
        });
      }
      const inputSeconds = req.file ? wavDurationSeconds(req.file.buffer) : estimateSpeechSeconds(transcript);
      usageReservation = await reserveUsage(inputSeconds);
      abandonedUsage = {
        callId: webLease.callId,
        usageTurnId: webLease.usageTurnId,
        locale: webLease.locale,
      };
      const state = updateCallState(transcript, webLease.state, webLease.locale);

      let reply = "";
      let providerWarning: string | null = null;
      try {
        reply = !demo && claudeEnabled
          ? await generateClaudeReply(transcript, webLease.history, state, payload.locale, requestAbort.signal)
          : !demo && openai
            ? await generateOpenAIReply(openai, transcript, webLease.history, state, payload.locale, requestAbort.signal)
            : demoReply(transcript, webLease.history, state, payload.locale);
      } catch (error) {
        providerFailure("live turn", error, claudeEnabled ? "anthropic" : "openai");
        providerWarning = fallbackWarnings[payload.locale].brain;
        reply = demoReply(transcript, webLease.history, state, payload.locale);
      }

      let audioBase64: string | null = null;
      let audioWarning: string | null = providerWarning;
      if (fishEnabled) {
        try {
          audioBase64 = await synthesizeFish(reply, payload.locale, requestAbort.signal);
        } catch (error) {
          providerFailure("Fish synthesis", error, "fishAudio");
          const message = fallbackWarnings[payload.locale].voice;
          audioWarning = audioWarning ? `${audioWarning} ${message}` : message;
        }
      }

      let recorded = false;
      if (payload.storageConsent && state.completed && !webLease.state.completed) {
        const result = await recordCompletedCall({
          callId: webLease.callId,
          source: "web",
          locale: payload.locale,
          state,
          transcript,
          history: [
            ...webLease.history,
            { role: "user", content: transcript },
            { role: "assistant", content: reply.trim() },
          ],
        });
        recorded = result.saved;
      }

      const { callId, usageTurnId } = webLease;
      await commitWebTurn(webLease, state, transcript, reply.trim());
      webLease = null;
      const usage = await recordUsage({
        turnId: usageTurnId,
        callId,
        source: "web",
        locale: payload.locale,
        inputSeconds: req.file ? wavDurationSeconds(req.file.buffer) : undefined,
        inputText: req.file ? undefined : transcript,
        reply,
        reservationId: usageReservation,
      });
      usageReservation = null;
      abandonedUsage = null;

      return res.json({
        transcript,
        reply,
        audioBase64,
        audioMime: audioBase64 ? "audio/mpeg" : null,
        mode: currentMode(demo, fishEnabled),
        audioWarning,
        latencyMs: Date.now() - startedAt,
        state,
        recorded,
        usageSeconds: usage?.billableSeconds || 0,
      });
    } catch (error) {
      next(error);
    } finally {
      await abortWebTurn(webLease);
      if (usageReservation && abandonedUsage) {
        await recordAbandonedUsage({
          turnId: abandonedUsage.usageTurnId,
          callId: abandonedUsage.callId,
          source: "web",
          locale: abandonedUsage.locale,
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

  return httpServer;
}
