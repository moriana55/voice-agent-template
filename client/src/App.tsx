import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowRight, AudioLines, BadgeDollarSign, Bot, CalendarClock, Check,
  CircleStop, Download, Headphones, Mic, MonitorPlay, Moon,
  PhoneCall, RefreshCw, RotateCcw, Send, ShieldCheck, Sun, UserRound,
  Waves, Wrench,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import type { CallState } from "@shared/schema";

type Message = { role: "user" | "assistant"; content: string };
type Status = {
  mode: "demo" | "fish-live" | "live";
  credit: number | null;
  services: Record<"microphone" | "anthropic" | "openai" | "fishAudio" | "voice", boolean>;
  models: { llm: string; transcription: string; speech: string };
  records: { enabled: boolean; encrypted: boolean; crmWebhook: boolean };
};
type StreamEvent =
  | { type: "meta"; transcript: string; state: CallState; mode: string }
  | { type: "text_delta"; text: string }
  | { type: "audio"; audioBase64: string; audioMime: string }
  | { type: "done"; reply: string; latencyMs: number; firstAudioMs: number | null; audioWarning: string | null; recorded: boolean }
  | { type: "error"; message: string };
type PresentationScenario = {
  id: "appointment" | "pricing" | "support";
  label: string;
  detail: string;
  prompt: string;
  reply: string;
  state: CallState;
};
type RunTurnContext = {
  history?: Message[];
  state?: CallState;
  scenario?: PresentationScenario;
};

const initialMessages: Message[] = [{
  role: "assistant",
  content: "Merhaba, ben Arama. Size nasıl yardımcı olabilirim?",
}];
const initialCallState: CallState = {
  intent: "genel",
  name: null,
  phone: null,
  requestedDate: null,
  requestedTime: null,
  summary: "Yeni görüşme",
  missingFields: [],
  completed: false,
};
const intentLabels: Record<CallState["intent"], string> = {
  genel: "Genel talep",
  randevu: "Randevu",
  fiyat: "Fiyat talebi",
  destek: "Destek kaydı",
};
const presentationScenarios: PresentationScenario[] = [
  {
    id: "appointment",
    label: "Randevu oluştur",
    detail: "Yarın / 15:00",
    prompt: "Yarın öğleden sonra saat üç için randevu almak istiyorum.",
    reply: "Elbette, randevunuzu birlikte hemen oluşturalım. Adınızı ve soyadınızı alabilir miyim?",
    state: {
      intent: "randevu",
      name: null,
      phone: null,
      requestedDate: "yarın",
      requestedTime: "15:00",
      summary: "Randevu talebi — yarın 15:00",
      missingFields: ["name", "phone"],
      completed: false,
    },
  },
  {
    id: "pricing",
    label: "Fiyat bilgisi",
    detail: "Web sitesi paketi",
    prompt: "Yeni bir web sitesi için fiyat bilgisi almak istiyorum.",
    reply: "Tabii, fiyat bilgisi için hemen yardımcı olayım. Size hitap edebilmem için adınızı alabilir miyim?",
    state: {
      intent: "fiyat",
      name: null,
      phone: null,
      requestedDate: null,
      requestedTime: null,
      summary: "Web sitesi için fiyat talebi",
      missingFields: ["name", "phone"],
      completed: false,
    },
  },
  {
    id: "support",
    label: "Teknik destek",
    detail: "Sistem çalışmıyor",
    prompt: "Teknik destek almak istiyorum, sistem çalışmıyor.",
    reply: "Anladım, sorunu birlikte hızlıca kontrol edelim. Destek kaydı için adınızı alabilir miyim?",
    state: {
      intent: "destek",
      name: null,
      phone: null,
      requestedDate: null,
      requestedTime: null,
      summary: "Sistem çalışmıyor — destek kaydı",
      missingFields: ["name", "phone"],
      completed: false,
    },
  },
];

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function speakFallback(text: string) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "tr-TR";
  utterance.rate = 1.03;
  window.speechSynthesis.speak(utterance);
}

function decodeBase64(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function createStreamingAudioPlayer() {
  const audio = new Audio();
  audio.autoplay = true;
  const supportsMediaSource = typeof MediaSource !== "undefined"
    && MediaSource.isTypeSupported("audio/mpeg");
  const chunks: Uint8Array[] = [];
  let sourceBuffer: SourceBuffer | null = null;
  let mediaSource: MediaSource | null = null;
  let objectUrl: string | null = null;
  let ending = false;
  let receivedAudio = false;
  let playbackStarted = false;

  const maybeStartPlayback = () => {
    if (playbackStarted || audio.buffered.length === 0) return;
    const lastRange = audio.buffered.length - 1;
    const bufferedAhead = audio.buffered.end(lastRange) - audio.currentTime;
    // İlk pakette oynatmaya başlamak ağdaki en küçük dalgalanmada buffer'ın
    // boşalmasına yol açıyordu. Kısa bir güvenlik payı takılmayı önlüyor.
    if (bufferedAhead < 0.35 && !ending) return;
    playbackStarted = true;
    void audio.play().catch(() => {
      playbackStarted = false;
    });
  };

  const pump = () => {
    if (!sourceBuffer || sourceBuffer.updating) return;
    const chunk = chunks.shift();
    if (chunk) {
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      sourceBuffer.appendBuffer(copy.buffer);
      return;
    }
    if (ending && mediaSource?.readyState === "open") {
      maybeStartPlayback();
      mediaSource.endOfStream();
    }
  };

  if (supportsMediaSource) {
    mediaSource = new MediaSource();
    objectUrl = URL.createObjectURL(mediaSource);
    audio.src = objectUrl;
    mediaSource.addEventListener("sourceopen", () => {
      if (!mediaSource || mediaSource.readyState !== "open") return;
      sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
      sourceBuffer.mode = "sequence";
      sourceBuffer.addEventListener("updateend", () => {
        maybeStartPlayback();
        pump();
      });
      pump();
    }, { once: true });
  }

  audio.addEventListener("waiting", () => {
    playbackStarted = false;
  });

  audio.addEventListener("playing", () => {
    playbackStarted = true;
  });

  audio.addEventListener("ended", () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, { once: true });

  return {
    audio,
    get hasAudio() {
      return receivedAudio;
    },
    append(base64: string) {
      receivedAudio = true;
      chunks.push(decodeBase64(base64));
      pump();
    },
    finish() {
      ending = true;
      if (!supportsMediaSource && chunks.length > 0) {
        const blobParts = chunks.map((chunk) => {
          const copy = new Uint8Array(chunk.byteLength);
          copy.set(chunk);
          return copy.buffer;
        });
        objectUrl = URL.createObjectURL(new Blob(blobParts, { type: "audio/mpeg" }));
        audio.src = objectUrl;
        void audio.play().catch(() => undefined);
        chunks.length = 0;
      } else {
        maybeStartPlayback();
        pump();
      }
    },
    cancel() {
      audio.pause();
      chunks.length = 0;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    },
  };
}

function encodePcmWav(chunks: Float32Array[], inputRate: number, outputRate = 16_000) {
  const inputLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const input = new Float32Array(inputLength);
  let inputOffset = 0;
  for (const chunk of chunks) {
    input.set(chunk, inputOffset);
    inputOffset += chunk.length;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const samples = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      sum += input[sourceIndex];
    }
    samples[index] = sum / (end - start);
  }

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputRate, true);
  view.setUint32(28, outputRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return new Blob([buffer], { type: "audio/wav" });
}

export default function App() {
  const [location, navigate] = useLocation();
  const presentationMode = location === "/present";
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [callState, setCallState] = useState<CallState>(initialCallState);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [activeScenario, setActiveScenario] = useState<PresentationScenario["id"] | null>(null);
  const [privacyAccepted, setPrivacyAccepted] = useState(
    () => window.localStorage.getItem("arama-privacy-consent") === "accepted",
  );
  const [recordSaved, setRecordSaved] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const muteRef = useRef<GainNode | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);
  const lastInputRef = useRef<{ text?: string; audio?: Blob } | null>(null);
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const callIdRef = useRef(crypto.randomUUID());
  const recordingRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const speechDetectedRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const maxRecordingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    refreshStatus();
  }, []);

  function refreshStatus() {
    fetch("/api/status").then((response) => response.json()).then(setStatus)
      .catch(() => {
        if (presentationMode) setUsingFallback(true);
        else setError("Sunucu bağlantısı kurulamadı.");
      });
  }

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    requestAbortRef.current?.abort();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (maxRecordingTimerRef.current !== null) window.clearTimeout(maxRecordingTimerRef.current);
  }, []);

  function setConsent(accepted: boolean) {
    setPrivacyAccepted(accepted);
    if (accepted) window.localStorage.setItem("arama-privacy-consent", "accepted");
    else window.localStorage.removeItem("arama-privacy-consent");
  }

  function cancelActiveTurn() {
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    playbackRef.current?.pause();
    window.speechSynthesis.cancel();
    setStreamingReply("");
    setBusy(false);
  }

  async function runTurn(
    input: { text?: string; audio?: Blob },
    remember = true,
    context: RunTurnContext = {},
  ) {
    if (busy) return;
    if (!privacyAccepted) {
      setError("Devam etmek için veri işleme bilgilendirmesini kabul edin.");
      return;
    }
    if (remember) lastInputRef.current = input;
    setBusy(true);
    setStreamingReply("");
    setError("");
    setUsingFallback(false);
    const historyAtStart = context.history ?? messages;
    const stateAtStart = context.state ?? callState;
    const requestAbort = new AbortController();
    requestAbortRef.current?.abort();
    requestAbortRef.current = requestAbort;
    playbackRef.current?.pause();
    const player = status?.services.fishAudio || presentationMode ? createStreamingAudioPlayer() : null;
    if (player) playbackRef.current = player.audio;
    try {
      const body = new FormData();
      if (input.text) body.append("text", input.text);
      if (input.audio) body.append("audio", input.audio, "recording.wav");
      body.append("callId", callIdRef.current);
      body.append("consent", "true");
      body.append("history", JSON.stringify(historyAtStart));
      body.append("state", JSON.stringify(stateAtStart));
      const response = await fetch("/api/turn/stream", { method: "POST", body, signal: requestAbort.signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: "Görüşme işlenemedi." }));
        throw new Error(payload.message || "Görüşme işlenemedi.");
      }
      if (!response.body) throw new Error("Sunucu streaming yanıtı döndürmedi.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let transcript = "";
      let reply = "";

      const handleEvent = (event: StreamEvent) => {
        if (event.type === "meta") {
          transcript = event.transcript;
          setCallState(context.scenario?.state ?? event.state);
          setMessages([...historyAtStart, { role: "user", content: transcript }]);
        } else if (event.type === "text_delta") {
          reply += event.text;
          setStreamingReply(reply);
        } else if (event.type === "audio") {
          player?.append(event.audioBase64);
        } else if (event.type === "done") {
          reply = event.reply;
          setLatency(event.firstAudioMs ?? event.latencyMs);
          if (event.audioWarning) {
            if (presentationMode) setUsingFallback(true);
            else setError(`Ses uyarısı: ${event.audioWarning}`);
          }
          if (event.recorded) setRecordSaved(true);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) handleEvent(JSON.parse(line) as StreamEvent);
        }
        if (done) break;
      }
      if (buffer.trim()) handleEvent(JSON.parse(buffer) as StreamEvent);
      if (!transcript || !reply.trim()) throw new Error("Streaming görüşme tamamlanamadı.");

      player?.finish();
      if (!player?.hasAudio) {
        speakFallback(reply);
        if (presentationMode) setUsingFallback(true);
      }
      setMessages([
        ...historyAtStart,
        { role: "user", content: transcript },
        { role: "assistant", content: reply.trim() },
      ]);
      refreshStatus();
    } catch (reason) {
      player?.cancel();
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (presentationMode && input.text) {
        const scenario = context.scenario
          ?? presentationScenarios.find((candidate) => candidate.prompt === input.text)
          ?? presentationScenarios[0];
        setUsingFallback(true);
        setLatency(120);
        setCallState(scenario.state);
        setMessages([
          ...historyAtStart,
          { role: "user", content: input.text },
          { role: "assistant", content: scenario.reply },
        ]);
        speakFallback(scenario.reply);
        setError("");
      } else {
        setError(reason instanceof Error ? reason.message : "Beklenmeyen bir hata oluştu.");
      }
    } finally {
      if (requestAbortRef.current === requestAbort) requestAbortRef.current = null;
      setStreamingReply("");
      setBusy(false);
    }
  }

  function submitText(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    void runTurn({ text: value });
  }

  async function startRecording() {
    if (recordingRef.current) return;
    if (!privacyAccepted) {
      setError("Mikrofonu açmadan önce veri işleme bilgilendirmesini kabul edin.");
      return;
    }
    if (busy) cancelActiveTurn();
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Bu tarayıcı mikrofon kaydını desteklemiyor.");
      return;
    }
    try {
      playbackRef.current?.pause();
      window.speechSynthesis.cancel();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      samplesRef.current = [];
      recordingRef.current = true;
      recordingStartedAtRef.current = performance.now();
      speechDetectedRef.current = false;
      lastVoiceAtRef.current = 0;
      processor.onaudioprocess = (event) => {
        const samples = new Float32Array(event.inputBuffer.getChannelData(0));
        samplesRef.current.push(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const rms = Math.sqrt(energy / Math.max(1, samples.length));
        const now = performance.now();
        if (rms >= 0.025) {
          speechDetectedRef.current = true;
          lastVoiceAtRef.current = now;
        } else if (
          speechDetectedRef.current
          && lastVoiceAtRef.current > 0
          && now - lastVoiceAtRef.current >= 1_150
          && now - recordingStartedAtRef.current >= 800
        ) {
          window.setTimeout(() => stopRecording(), 0);
        }
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      audioContextRef.current = context;
      sourceRef.current = source;
      processorRef.current = processor;
      muteRef.current = mute;
      setRecording(true);
      maxRecordingTimerRef.current = window.setTimeout(() => stopRecording(), 30_000);
    } catch {
      setError("Mikrofon izni verilmedi. Metin alanıyla demoyu deneyebilirsiniz.");
    }
  }

  function resetCall() {
    cancelActiveTurn();
    setMessages(initialMessages);
    setCallState(initialCallState);
    setElapsedSeconds(0);
    setLatency(null);
    setError("");
    setUsingFallback(false);
    setActiveScenario(null);
    setRecordSaved(false);
    callIdRef.current = crypto.randomUUID();
    lastInputRef.current = null;
  }

  function runPresentationScenario(scenario: PresentationScenario) {
    if (busy || recording) return;
    resetCall();
    setActiveScenario(scenario.id);
    void runTurn(
      { text: scenario.prompt },
      true,
      { history: initialMessages, state: initialCallState, scenario },
    );
  }

  function retryLastTurn() {
    if (lastInputRef.current && !busy) void runTurn(lastInputRef.current, false);
  }

  function exportSummary() {
    const lines = [
      "ARAMA — Görüşme Özeti",
      `Süre: ${formatDuration(elapsedSeconds)}`,
      `Niyet: ${intentLabels[callState.intent]}`,
      `İsim: ${callState.name || "Alınmadı"}`,
      `Telefon: ${callState.phone || "Alınmadı"}`,
      `Tarih: ${callState.requestedDate || "Alınmadı"}`,
      `Saat: ${callState.requestedTime || "Alınmadı"}`,
      `Özet: ${callState.summary}`,
      "",
      ...messages.map((message) => `${message.role === "assistant" ? "Arama" : "Müşteri"}: ${message.content}`),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `arama-gorusme-${Date.now()}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function stopRecording() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    if (maxRecordingTimerRef.current !== null) {
      window.clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }
    const context = audioContextRef.current;
    const audio = context
      ? encodePcmWav(samplesRef.current, context.sampleRate)
      : null;
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    muteRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void context?.close();
    processorRef.current = null;
    sourceRef.current = null;
    muteRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    samplesRef.current = [];
    setRecording(false);
    if (audio && audio.size > 500) {
      void runTurn({ audio });
    } else {
      setError("Kayıt çok kısa kaldı. Biraz daha uzun konuşup tekrar deneyin.");
    }
  }

  const serviceRows = [
    ["Mikrofon", status?.services.microphone, "Tarayıcı"],
    ["Dinleme", Boolean(status?.services.openai || status?.services.fishAudio), status?.models.transcription || "—"],
    ["Zekâ", Boolean(status?.services.anthropic || status?.services.openai), status?.models.llm || "—"],
    ["Konuşma", status?.services.fishAudio, status?.models.speech || "—"],
  ] as const;
  const callFields = [
    ["İsim", callState.name],
    ["Telefon", callState.phone],
    ["Tarih", callState.requestedDate],
    ["Saat", callState.requestedTime],
  ] as const;
  const presentationStatus = usingFallback
    ? "SUNUM YEDEĞİ"
    : status?.mode === "live"
      ? "SUNUM CANLI"
      : "SUNUM HAZIR";

  return (
    <>
      <button className="skip-link" type="button" data-testid="button-skip-content"
        onClick={() => document.getElementById("main")?.scrollIntoView({ behavior: "smooth" })}>İçeriğe geç</button>
      <div className={`app-shell ${presentationMode ? "presentation-mode" : ""}`}>
        <header className="topbar">
          <Link className="brand" href="/" aria-label="Arama ana sayfa" data-testid="link-home">
            <svg viewBox="0 0 40 40" role="img" aria-label="Arama logosu">
              <path d="M9 20c0-8 4-12 11-12s11 4 11 12-4 12-11 12" />
              <path d="M14 16v8M20 13v14M26 16v8" />
            </svg>
            <span>ARAMA{presentationMode ? " / LIVE DEMO" : ""}</span>
          </Link>
          <div className="topbar-actions">
            <span className="call-timer" data-testid="text-call-duration">{formatDuration(elapsedSeconds)}</span>
            <button className={`presentation-toggle ${presentationMode ? "active" : ""}`} type="button"
              data-testid="button-presentation-mode"
              onClick={() => navigate(presentationMode ? "/" : "/present")}
              aria-pressed={presentationMode}>
              <MonitorPlay size={18} /><span>{presentationMode ? "Sunumdan çık" : "Sunum modu"}</span>
            </button>
            <button className="icon-button" type="button" data-testid="button-reset-call"
              aria-label="Yeni görüşme başlat" title="Yeni görüşme" onClick={resetCall} disabled={recording}>
              <RotateCcw size={18} />
            </button>
            <span className={`mode-pill ${status?.mode !== "demo" && !usingFallback ? "live" : ""}`} data-testid="status-mode">
              <span />{presentationMode
                ? presentationStatus
                : status?.mode === "live" ? "TAM CANLI" : status?.mode === "fish-live" ? "FISH CANLI" : "DEMO MODU"}
            </span>
            <button className="icon-button" type="button"
              data-testid="button-theme"
              aria-label={dark ? "Açık temaya geç" : "Koyu temaya geç"}
              onClick={() => setDark((value) => !value)}>
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        <main id="main" className="workspace">
          <section className={`call-stage ${presentationMode ? "presentation-stage" : ""}`} aria-labelledby="call-title">
            <div className="stage-header">
              <div><p className="eyebrow">{presentationMode ? "CANLI DEMO / SESLİ AI" : "ÇAĞRI PROTOTİPİ / 01"}</p>
                <h1 id="call-title">{presentationMode ? "Konuşan müşteri temsilcisi" : "Türkçe çağrı elemanı"}</h1></div>
              <div className={`call-meta ${presentationMode ? "latency-meta" : ""}`}>
                <span>{presentationMode ? "İLK SES" : "FISH BAKİYE"}</span>
                <strong data-testid={presentationMode ? "text-first-audio" : "text-credit"}>
                  {presentationMode
                    ? latency ? `${(latency / 1000).toFixed(2)} sn` : "Ölçülüyor"
                    : status?.credit != null ? `$${status.credit.toFixed(4)}` : "—"}
                </strong>
                <small>{presentationMode ? usingFallback ? "güvenli yedek" : "canlı ölçüm" : latency ? `ilk ses ${(latency / 1000).toFixed(1)} sn` : "hazır"}</small>
              </div>
            </div>
            {presentationMode && <section className="presentation-console" aria-labelledby="presentation-scenarios-title">
              <div className="presentation-copy">
                <p className="eyebrow">TEK TIK SENARYOLAR</p>
                <h2 id="presentation-scenarios-title">Bir müşteri cümlesi seç; sistem konuşsun ve kaydı doldursun.</h2>
              </div>
              <div className="scenario-list">
                {presentationScenarios.map((scenario) => {
                  const Icon = scenario.id === "appointment" ? CalendarClock : scenario.id === "pricing" ? BadgeDollarSign : Wrench;
                  return <button key={scenario.id} type="button"
                    className={`scenario-button ${scenario.id === "appointment" ? "featured" : ""} ${activeScenario === scenario.id ? "active" : ""}`}
                    data-testid={`button-scenario-${scenario.id}`}
                    onClick={() => runPresentationScenario(scenario)} disabled={busy || recording || !privacyAccepted}>
                    <Icon size={19} />
                    <span><strong>{scenario.label}</strong><small>{scenario.detail}</small></span>
                    <ArrowRight size={17} />
                  </button>;
                })}
              </div>
              <div className="presentation-flow" aria-label="Canlı ses zinciri">
                <span><Mic size={16} />Dinle</span><ArrowRight size={14} />
                <span><Bot size={16} />Anla</span><ArrowRight size={14} />
                <span><AudioLines size={16} />Konuş</span>
              </div>
              <p className="presentation-safety"><ShieldCheck size={16} />Canlı servis kesilirse görüşme yerel sunum yedeğiyle devam eder.</p>
            </section>}
            <div className={`voice-orbit ${recording ? "recording" : ""} ${busy ? "thinking" : ""}`}>
              <div className="orbit-line orbit-one" /><div className="orbit-line orbit-two" />
              <div className="voice-core">
                {recording ? <Waves size={44} /> : busy ? <AudioLines size={44} /> : <Headphones size={44} />}
              </div>
              <span className="orbit-label label-top">MÜŞTERİ</span>
              <span className="orbit-label label-right">FISH S2 PRO</span>
              <span className="orbit-label label-bottom">{status?.services.anthropic ? "CLAUDE" : status?.services.openai ? "OPENAI" : "KURAL MOTORU"}</span>
            </div>
            <div className="primary-control">
              <button className={`talk-button ${recording ? "recording" : ""}`} type="button"
                data-testid="button-record"
                onClick={recording ? stopRecording : startRecording} disabled={!privacyAccepted}>
                {recording ? <CircleStop size={21} /> : <Mic size={21} />}
                {recording ? "Kaydı bitir" : busy ? "Sözü kes ve konuş" : "Konuşmaya başla"}
              </button>
              <p>{recording
                ? "Konuşmanızı dinliyorum; sustuğunuzda otomatik göndereceğim."
                : presentationMode
                  ? "Hazır senaryoyu seçin veya mikrofondan canlı konuşun."
                  : busy
                    ? "Mikrofona basarak yanıtı kesebilirsiniz."
                    : "Basın ve konuşun; sessizlikte kayıt otomatik tamamlanır."}</p>
              <label className="consent-control">
                <input type="checkbox" checked={privacyAccepted}
                  onChange={(event) => setConsent(event.target.checked)} />
                <span><strong>Bilgilendirildim ve kabul ediyorum.</strong> Ses/metin, yanıt üretmek için yapılandırılmış AI servislerine gönderilir; tamamlanan talep güvenli çağrı kaydına alınır.</span>
              </label>
            </div>
          </section>

          <aside className="side-panel" aria-label="Bağlantılar ve görüşme">
            <section className="connections" aria-labelledby="connections-title">
              <div className="panel-title"><div><p className="eyebrow">SİSTEM DURUMU</p>
                <h2 id="connections-title">{presentationMode ? "Canlı zincir" : "Bağlantılar"}</h2></div><PhoneCall size={19} /></div>
              <div className="service-list">
                {(presentationMode ? [
                  ["Dinleme", Boolean(status?.services.openai || status?.services.fishAudio), "Müşteriyi yazıya çevirir"],
                  ["Karar", Boolean(status?.services.anthropic || status?.services.openai), "Talebi ve eksik bilgiyi anlar"],
                  ["Ses", Boolean(status?.services.fishAudio), "Yanıtı seçilen sesle akıtır"],
                ] as const : serviceRows).map(([label, connected, model], index) => (
                  <div className="service-row" key={label}>
                    <span className="service-index">0{index + 1}</span>
                    <div><strong>{label}</strong><small>{model}</small></div>
                    <span className={`service-state ${connected ? "connected" : ""}`}>
                      {connected ? <Check size={14} /> : "—"}
                    </span>
                  </div>
                ))}
              </div>
              {presentationMode && <p className={`notice ${usingFallback ? "fallback-notice" : ""}`} data-testid="status-notice">
                {usingFallback
                  ? "Güvenli sunum yedeği devrede; akış kesilmeden devam ediyor."
                  : busy
                    ? "Müşteri talebi işleniyor; yanıt canlı olarak akıyor."
                    : activeScenario
                      ? "Canlı görüşme tamamlandı; çağrı kaydı güncellendi."
                      : "Canlı servisler hazır. Bir senaryo seçerek demoyu başlatın."}
              </p>}
              {!presentationMode && status?.mode === "fish-live" && <p className="notice" data-testid="status-notice">
                Dinleme ve Türkçe ses Fish üzerinden canlı. Claude veya OpenAI anahtarı eklenince serbest konuşma açılır.
              </p>}
              {!presentationMode && status?.mode === "demo" && <p className="notice" data-testid="status-notice">
                Fish ve Claude anahtarları eklenince servisler canlıya geçer.
              </p>}
            </section>

            <section className="transcript" aria-labelledby="transcript-title">
              <div className="panel-title compact"><div><p className="eyebrow">CANLI DÖKÜM</p>
                <h2 id="transcript-title">Görüşme</h2></div><span>{Math.floor((messages.length - 1) / 2)} TUR</span></div>
              <div className="message-list" aria-live="polite">
                {messages.map((message, index) => (
                  <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                    <div className="avatar" aria-hidden="true">
                      {message.role === "assistant" ? <Bot size={16} /> : <UserRound size={16} />}
                    </div>
                    <div><strong>{message.role === "assistant" ? "Arama" : "Siz"}</strong>
                      <p>{message.content}</p></div>
                  </article>
                ))}
                {busy && <article className="message assistant"><div className="avatar"><Bot size={16} /></div>
                  {streamingReply
                    ? <div><strong>Arama</strong><p>{streamingReply}</p></div>
                    : <div className="typing"><i /><i /><i /></div>}</article>}
                <div ref={endRef} />
              </div>
              <form className="text-input" onSubmit={submitText}>
                <label htmlFor="message">Metinle dene</label>
                <div><input id="message" data-testid="input-message" value={text} onChange={(event) => setText(event.target.value)}
                  placeholder="Örn. Yarın için randevu istiyorum" disabled={busy || !privacyAccepted} />
                  <button type="submit" data-testid="button-send" aria-label="Mesajı gönder" disabled={busy || !privacyAccepted || !text.trim()}>
                    <Send size={17} /></button></div>
              </form>
              {error && !presentationMode && <p className="error-message" role="alert">{error}</p>}
            </section>

            <section className="call-record" aria-labelledby="call-record-title">
              <div className="panel-title compact">
                <div><p className="eyebrow">CANLI ÇAĞRI KAYDI</p>
                  <h2 id="call-record-title">{intentLabels[callState.intent]}</h2></div>
                <span className={callState.completed ? "record-complete" : ""}>
                  {recordSaved ? "KAYDEDİLDİ" : callState.completed ? "TAMAM" : "AKTİF"}
                </span>
              </div>
              <p className="record-summary" data-testid="text-call-summary">{callState.summary}</p>
              <dl className="record-grid">
                {callFields.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value || "Bekleniyor"}</dd></div>
                ))}
              </dl>
              <div className="record-actions">
                <button type="button" data-testid="button-retry-turn" onClick={retryLastTurn}
                  disabled={busy || !privacyAccepted || !lastInputRef.current}><RefreshCw size={16} />Tekrar dene</button>
                <button type="button" data-testid="button-export-summary" onClick={exportSummary}>
                  <Download size={16} />Özeti indir</button>
              </div>
            </section>
          </aside>
        </main>
      </div>
    </>
  );
}
