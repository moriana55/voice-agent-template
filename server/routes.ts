import type { Express, Response } from "express";
import type { Server } from "http";
import { randomUUID } from "node:crypto";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { FishAudioClient, FlushEvent, RealtimeEvents, type Backends } from "fish-audio";
import {
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
import { requireAdmin, turnLimiter } from "./security";
import { synthesizeFishBuffer } from "./fish";
import { registerTelephonyRoutes } from "./telephony";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 6, fieldSize: 100 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith("audio/")) callback(null, true);
    else callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
  },
});

const SYSTEM_PROMPT = `Sen Türkçe konuşan profesyonel bir çağrı merkezi elemanısın.
Kısa, doğal ve sıcak konuş. Bir seferde en fazla iki kısa cümle kur.
Bilmediğin müşteri veya şirket bilgisini uydurma; gerektiğinde temsilciye aktaracağını söyle.
Kullanıcının talebini önce anladığını göster, sonra net bir sonraki adım öner.`;

type StreamEvent =
  | { type: "meta"; transcript: string; state: CallState; mode: string }
  | { type: "text_delta"; text: string }
  | { type: "audio"; audioBase64: string; audioMime: string }
  | { type: "done"; reply: string; latencyMs: number; firstAudioMs: number | null; audioWarning: string | null; recorded: boolean }
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

  async waitUntilDrained() {
    while (this.values.length > 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    // Iterator metni kuyruktan aldıktan sonra SDK'nın WebSocket'e TextEvent
    // yazmasına bir event-loop turu bırak. Böylece FlushEvent metnin önüne geçmez.
    await new Promise<void>((resolve) => setImmediate(resolve));
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

async function transcribeAudio(openai: OpenAI, file: Express.Multer.File, signal?: AbortSignal) {
  const uploaded = await toFile(file.buffer, file.originalname || "recording.webm", {
    type: file.mimetype || "audio/webm",
  });
  const result = await openai.audio.transcriptions.create({
    file: uploaded,
    model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
    language: "tr",
  }, { signal: withTimeout(signal, 20_000) });
  return result.text.trim();
}

async function transcribeFish(file: Express.Multer.File, signal?: AbortSignal) {
  const form = new FormData();
  const audioBuffer = new ArrayBuffer(file.buffer.byteLength);
  new Uint8Array(audioBuffer).set(file.buffer);
  form.append("audio", new Blob([audioBuffer], { type: file.mimetype || "audio/webm" }),
    file.originalname || "recording.webm");
  form.append("language", "tr");
  form.append("ignore_timestamps", "true");
  const response = await fetch("https://api.fish.audio/v1/asr", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}` },
    body: form,
    signal: withTimeout(signal, 20_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Fish ASR ${response.status}: ${detail.slice(0, 240)}`);
  }
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
      if (!response.ok) return;
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
) {
  const conversation = history
    .slice(-10)
    .map((item) => `${item.role === "user" ? "Müşteri" : "Temsilci"}: ${item.content}`)
    .join("\n");

  const businessContext = process.env.BUSINESS_CONTEXT?.trim();
  return `${businessContext ? `Doğrulanmış işletme bilgisi:\n${businessContext}\n` : ""}Görüşme durumu: ${JSON.stringify(state)}
Eksik alanlardan yalnızca birini doğal biçimde sor. Tamamlanan bilgiyi tekrar isteme.
${conversation ? `${conversation}\n` : ""}Müşteri: ${transcript}\nTemsilci:`;
}

function streamingLeadIn(state: CallState) {
  if (state.intent === "randevu") return "Elbette, randevunuzu birlikte hemen oluşturalım. ";
  if (state.intent === "fiyat") return "Tabii, fiyat bilgisi için hemen yardımcı olayım. ";
  if (state.intent === "destek") return "Anladım, sorunu birlikte hızlıca kontrol edelim. ";
  return "Tabii, sizi dinliyorum; hemen yardımcı olayım. ";
}

function sanitizeStreamingContinuation(value: string) {
  return value
    .trimStart()
    .replace(/^(?:(?:tabii|elbette|anladım|merhaba|memnuniyetle)[,!:.]?\s*)+/i, "")
}

function cleanStreamingContinuation(value: string) {
  const cleaned = sanitizeStreamingContinuation(value).trim();
  if (!cleaned) return "Size nasıl yardımcı olabilirim?";
  return `${cleaned.charAt(0).toLocaleUpperCase("tr")}${cleaned.slice(1)}`;
}

async function generateOpenAIReply(
  openai: OpenAI,
  transcript: string,
  history: ConversationMessage[],
  state: CallState,
  signal?: AbortSignal,
) {
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    instructions: SYSTEM_PROMPT,
    input: buildConversationPrompt(transcript, history, state),
    store: false,
  }, { signal: withTimeout(signal, 20_000) });
  return response.output_text.trim();
}

async function generateClaudeReply(
  transcript: string,
  history: ConversationMessage[],
  state: CallState,
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
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildConversationPrompt(transcript, history, state),
        },
      ],
    }),
    signal: withTimeout(signal, 20_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Claude API ${response.status}: ${detail.slice(0, 240)}`);
  }

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
      system: SYSTEM_PROMPT,
      stream: true,
      messages: [
        {
          role: "user",
          content: `${buildConversationPrompt(transcript, history, state)}
Temsilci şu giriş cümlesini zaten seslendirdi: ${JSON.stringify(leadIn.trim())}
Bu girişi, selamlamayı veya onayı tekrar etme. Yalnızca tek kısa cümleyle gerekli soruyu ya da net cevabı ver.`,
        },
      ],
    }),
    signal: withTimeout(signal, 20_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Claude API ${response.status}: ${detail.slice(0, 240)}`);
  }
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

async function synthesizeFish(text: string, signal?: AbortSignal) {
  return (await synthesizeFishBuffer(text, { signal })).toString("base64");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  registerTelephonyRoutes(app);
  await pruneExpiredRecords();
  app.get("/api/health/live", (_req, res) => {
    res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
  });

  app.get("/api/health/ready", (_req, res) => {
    const fishAudio = Boolean(process.env.FISH_AUDIO_API_KEY);
    const brain = Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)
      || process.env.DEMO_MODE !== "false";
    const recordConfiguration = recordsStatus();
    const privacyReady = !recordConfiguration.enabled || recordConfiguration.encrypted
      || process.env.NODE_ENV !== "production";
    const ready = fishAudio && brain && privacyReady;
    res.status(ready ? 200 : 503).json({
      ready,
      services: { fishAudio, brain },
      privacyReady,
      records: recordConfiguration,
    });
  });

  app.get("/api/admin/records", requireAdmin, async (req, res, next) => {
    try {
      const limit = Number(req.query.limit || 100);
      return res.json({ records: await listCallRecords(limit) });
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

  app.get("/api/status", async (_req, res) => {
    const demo = isDemoBrain();
    const fishEnabled = Boolean(process.env.FISH_AUDIO_API_KEY);
    const credit = getFishCredit();
    res.json({
      mode: !demo ? "live" : fishEnabled ? "fish-live" : "demo",
      credit,
      services: {
        microphone: true,
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        openai: Boolean(process.env.OPENAI_API_KEY),
        fishAudio: fishEnabled,
        voice: Boolean(process.env.FISH_AUDIO_REFERENCE_ID),
      },
      models: {
        llm: process.env.ANTHROPIC_API_KEY
          ? process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001"
          : process.env.OPENAI_API_KEY
            ? process.env.OPENAI_MODEL || "gpt-5.4-mini"
            : "yerel senaryo motoru",
        transcription: process.env.OPENAI_API_KEY
          ? process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe"
          : "fish transcribe-1",
        speech: process.env.FISH_AUDIO_MODEL || "s2-pro",
      },
      records: recordsStatus(),
    });
  });

  app.post("/api/turn/stream", turnLimiter, upload.single("audio"), async (req, res, next) => {
    const startedAt = Date.now();
    let streamStarted = false;
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
        consent: req.body.consent === "true",
        text: req.body.text || undefined,
        history: parsedHistory,
        state: parsedState,
      });

      const demo = isDemoBrain();
      const fishEnabled = Boolean(process.env.FISH_AUDIO_API_KEY);
      const claudeEnabled = Boolean(process.env.ANTHROPIC_API_KEY);
      const openai = process.env.OPENAI_API_KEY
        ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        : null;

      let transcript = payload.text?.trim() || "";
      if (!transcript && req.file && openai) {
        transcript = await transcribeAudio(openai, req.file, requestAbort.signal);
      } else if (!transcript && req.file && fishEnabled) {
        transcript = await transcribeFish(req.file, requestAbort.signal);
      }
      if (!transcript) {
        return res.status(400).json({ message: "Konuşma veya metin bulunamadı." });
      }

      const state = updateCallState(transcript, payload.state);
      const mode = !demo ? "live" : fishEnabled ? "fish-live" : "demo";
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
        const leadIn = streamingLeadIn(state);
        let finishFish: Promise<void> | null = null;
        let closeFish: (() => void) | null = null;
        let flushFish: (() => void) | null = null;

        if (fishEnabled) {
          const client = new FishAudioClient({ apiKey: process.env.FISH_AUDIO_API_KEY });
          const connection = await client.textToSpeech.convertRealtime({
            text: "",
            reference_id: process.env.FISH_AUDIO_REFERENCE_ID || undefined,
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
              audioWarning = "Fish Audio streaming zaman aşımına uğradı.";
              connection.close();
              settle();
            }, 45_000);
            connection.on(RealtimeEvents.AUDIO_CHUNK, (value: unknown) => {
              const bytes = value instanceof Uint8Array ? value : Buffer.from(value as ArrayBuffer);
              if (firstAudioMs === null) firstAudioMs = Date.now() - startedAt;
              writeStreamEvent(res, {
                type: "audio",
                audioBase64: Buffer.from(bytes).toString("base64"),
                audioMime: "audio/mpeg",
              });
            });
            connection.on(RealtimeEvents.ERROR, (value: unknown) => {
              audioWarning = value instanceof Error ? value.message : "Fish Audio streaming hatası.";
              settle();
            });
            connection.on(RealtimeEvents.CLOSE, settle);
          });
        }

        try {
          reply = leadIn;
          writeStreamEvent(res, { type: "text_delta", text: leadIn });
          textQueue.push(leadIn);
          await textQueue.waitUntilDrained();
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
            payload.history,
            state,
            leadIn,
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
              streamContinuation(`${cleanedStart.charAt(0).toLocaleUpperCase("tr")}${cleanedStart.slice(1)}`);
            }
            continuationStarted = true;
          }
          if (!continuationStarted) streamContinuation(cleanStreamingContinuation(continuation));
          textQueue.end();
          if (finishFish) await finishFish;
        } catch (error) {
          textQueue.end();
          closeFish?.();
          throw error;
        }
      } else {
        reply = !demo && openai
          ? await generateOpenAIReply(openai, transcript, payload.history, state, requestAbort.signal)
          : demoReply(transcript, payload.history, state);
        writeStreamEvent(res, { type: "text_delta", text: reply });
        if (fishEnabled) {
          try {
            const audioBase64 = await synthesizeFish(reply, requestAbort.signal);
            firstAudioMs = Date.now() - startedAt;
            writeStreamEvent(res, { type: "audio", audioBase64, audioMime: "audio/mpeg" });
          } catch (error) {
            audioWarning = error instanceof Error ? error.message : "Fish Audio yanıt vermedi.";
          }
        }
      }

      if (state.completed && !payload.state?.completed) {
        const result = await recordCompletedCall({
          callId: payload.callId || randomUUID(),
          source: "web",
          state,
          transcript,
          history: [
            ...payload.history,
            { role: "user", content: transcript },
            { role: "assistant", content: reply.trim() },
          ],
        });
        recorded = result.saved;
      }

      writeStreamEvent(res, {
        type: "done",
        reply: reply.trim(),
        latencyMs: Date.now() - startedAt,
        firstAudioMs,
        audioWarning,
        recorded,
      });
      return res.end();
    } catch (error) {
      if (!streamStarted) return next(error);
      writeStreamEvent(res, {
        type: "error",
        message: error instanceof Error ? error.message : "Beklenmeyen streaming hatası.",
      });
      return res.end();
    }
  });

  app.post("/api/turn", turnLimiter, upload.single("audio"), async (req, res, next) => {
    const startedAt = Date.now();
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
        consent: req.body.consent === "true",
        text: req.body.text || undefined,
        history: parsedHistory,
        state: parsedState,
      });

      const demo = isDemoBrain();
      const fishEnabled = Boolean(process.env.FISH_AUDIO_API_KEY);
      const claudeEnabled = Boolean(process.env.ANTHROPIC_API_KEY);
      const openai = process.env.OPENAI_API_KEY
        ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        : null;

      let transcript = payload.text?.trim() || "";
      if (!transcript && req.file && openai) {
        transcript = await transcribeAudio(openai, req.file, requestAbort.signal);
      } else if (!transcript && req.file && fishEnabled) {
        transcript = await transcribeFish(req.file, requestAbort.signal);
      }
      if (!transcript) {
        return res.status(400).json({ message: "Konuşma veya metin bulunamadı." });
      }
      const state = updateCallState(transcript, payload.state);

      const reply = !demo && claudeEnabled
        ? await generateClaudeReply(transcript, payload.history, state, requestAbort.signal)
        : !demo && openai
          ? await generateOpenAIReply(openai, transcript, payload.history, state, requestAbort.signal)
          : demoReply(transcript, payload.history, state);

      let audioBase64: string | null = null;
      let audioWarning: string | null = null;
      if (fishEnabled) {
        try {
          audioBase64 = await synthesizeFish(reply, requestAbort.signal);
        } catch (error) {
          audioWarning = error instanceof Error ? error.message : "Fish Audio yanıt vermedi.";
        }
      }

      let recorded = false;
      if (state.completed && !payload.state?.completed) {
        const result = await recordCompletedCall({
          callId: payload.callId || randomUUID(),
          source: "web",
          state,
          transcript,
          history: [
            ...payload.history,
            { role: "user", content: transcript },
            { role: "assistant", content: reply.trim() },
          ],
        });
        recorded = result.saved;
      }

      return res.json({
        transcript,
        reply,
        audioBase64,
        audioMime: audioBase64 ? "audio/mpeg" : null,
        mode: !demo ? "live" : fishEnabled ? "fish-live" : "demo",
        audioWarning,
        latencyMs: Date.now() - startedAt,
        state,
        recorded,
      });
    } catch (error) {
      next(error);
    }
  });

  return httpServer;
}
