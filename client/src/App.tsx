import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowRight, AudioLines, BadgeDollarSign, Bot, CalendarClock, Check,
  CircleStop, Download, Headphones, Mic, MonitorPlay, Moon,
  PhoneCall, Radio, RefreshCw, RotateCcw, Send, ShieldCheck, Sun, UserRound,
  Waves, Wrench,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import type { CallState } from "@shared/schema";
import { localeMetadata, normalizeLocale, supportedLocales, type Locale } from "@shared/i18n";
import {
  getCopy,
  getPresentationScenarios,
  initialCallState,
  initialMessages,
  intentLabels,
  type Message,
  type PresentationScenario,
} from "./i18n";

type Status = {
  mode: "demo" | "fish-live" | "live";
  credit: number | null;
  services: Record<"microphone" | "anthropic" | "openai" | "fishAudio" | "voice", boolean>;
  models: { llm: string; transcription: string; speech: string };
  records: { enabled: boolean; encrypted: boolean; crmWebhook: boolean };
  localization?: { defaultLocale: Locale; supportedLocales: Locale[] };
};
type StreamEvent =
  | { type: "meta"; transcript: string; state: CallState; mode: string }
  | { type: "text_delta"; text: string }
  | { type: "audio"; audioBase64: string; audioMime: string }
  | { type: "done"; reply: string; latencyMs: number; firstAudioMs: number | null; audioWarning: string | null; recorded: boolean }
  | { type: "error"; message: string };
type RunTurnContext = {
  history?: Message[];
  state?: CallState;
  scenario?: PresentationScenario;
};

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function speakFallback(text: string, locale: Locale) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = localeMetadata[locale].speech;
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
  const [locale, setLocale] = useState<Locale>(() => normalizeLocale(
    window.localStorage.getItem("arama-locale") || navigator.language,
    "en",
  ));
  const t = getCopy(locale);
  const scenarios = getPresentationScenarios(locale);
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[]>(() => initialMessages(locale));
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [callState, setCallState] = useState<CallState>(() => initialCallState(locale));
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [dark, setDark] = useState(true);
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

  useEffect(() => {
    document.documentElement.lang = localeMetadata[locale].html;
    window.localStorage.setItem("arama-locale", locale);
  }, [locale]);

  function refreshStatus() {
    fetch("/api/status").then((response) => response.json()).then(setStatus)
      .catch(() => {
        if (presentationMode) setUsingFallback(true);
        else setError(t.serverUnavailable);
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

  function changeLocale(nextLocale: Locale) {
    if (nextLocale === locale) return;
    cancelActiveTurn();
    setLocale(nextLocale);
    setMessages(initialMessages(nextLocale));
    setCallState(initialCallState(nextLocale));
    setElapsedSeconds(0);
    setLatency(null);
    setError("");
    setActiveScenario(null);
    setRecordSaved(false);
    callIdRef.current = crypto.randomUUID();
    lastInputRef.current = null;
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
      setError(t.consentRequired);
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
      body.append("locale", locale);
      body.append("history", JSON.stringify(historyAtStart));
      body.append("state", JSON.stringify(stateAtStart));
      const response = await fetch("/api/turn/stream", { method: "POST", body, signal: requestAbort.signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: t.requestFailed }));
        throw new Error(payload.message || t.requestFailed);
      }
      if (!response.body) throw new Error(t.streamMissing);

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
            else setError(`${t.audioWarning}: ${event.audioWarning}`);
          }
          if (event.recorded) setRecordSaved(true);
          refreshStatus();
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
      if (!transcript || !reply.trim()) throw new Error(t.streamIncomplete);

      player?.finish();
      if (!player?.hasAudio) {
        speakFallback(reply, locale);
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
          ?? scenarios.find((candidate) => candidate.prompt === input.text)
          ?? scenarios[0];
        setUsingFallback(true);
        setLatency(120);
        setCallState(scenario.state);
        setMessages([
          ...historyAtStart,
          { role: "user", content: input.text },
          { role: "assistant", content: scenario.reply },
        ]);
        speakFallback(scenario.reply, locale);
        setError("");
      } else {
        setError(reason instanceof Error ? reason.message : t.unexpected);
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
      setError(t.micConsent);
      return;
    }
    if (busy) cancelActiveTurn();
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t.micUnsupported);
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
      setError(t.micDenied);
    }
  }

  function resetCall() {
    cancelActiveTurn();
    setMessages(initialMessages(locale));
    setCallState(initialCallState(locale));
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
      { history: initialMessages(locale), state: initialCallState(locale), scenario },
    );
  }

  function retryLastTurn() {
    if (lastInputRef.current && !busy) void runTurn(lastInputRef.current, false);
  }

  function exportSummary() {
    const lines = [
      t.summaryTitle,
      `${t.duration}: ${formatDuration(elapsedSeconds)}`,
      `${t.intent}: ${intentLabels[locale][callState.intent]}`,
      `${t.name}: ${callState.name || t.notProvided}`,
      `${t.phone}: ${callState.phone || t.notProvided}`,
      `${t.date}: ${callState.requestedDate || t.notProvided}`,
      `${t.time}: ${callState.requestedTime || t.notProvided}`,
      `${t.summary}: ${callState.summary}`,
      "",
      ...messages.map((message) => `${message.role === "assistant" ? "Arama" : t.customer}: ${message.content}`),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `arama-call-${locale}-${Date.now()}.txt`;
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
      setError(t.recordingShort);
    }
  }

  const serviceRows = [
    [t.microphone, status?.services.microphone, t.browser],
    [t.listening, Boolean(status?.services.openai || status?.services.fishAudio), status?.models.transcription || "—"],
    [t.intelligence, Boolean(status?.services.anthropic || status?.services.openai), status?.models.llm || "—"],
    [t.speech, status?.services.fishAudio, status?.models.speech || "—"],
  ] as const;
  const callFields = [
    [t.name, callState.name],
    [t.phone, callState.phone],
    [t.date, callState.requestedDate],
    [t.time, callState.requestedTime],
  ] as const;
  const presentationStatus = usingFallback
    ? status?.mode === "fish-live" ? t.liveFish : t.presentationFallback
    : status?.mode === "live"
      ? t.presentationLive
      : t.presentationReady;

  return (
    <>
      <button className="skip-link" type="button" data-testid="button-skip-content"
        onClick={() => document.getElementById("main")?.scrollIntoView({ behavior: "smooth" })}>{t.skip}</button>
      <div className={`app-shell ${presentationMode ? "presentation-mode" : ""}`}>
        <header className="topbar">
          <Link className="brand" href="/" aria-label={t.home} data-testid="link-home">
            <svg viewBox="0 0 40 40" role="img" aria-label="Arama">
              <path d="M9 20c0-8 4-12 11-12s11 4 11 12-4 12-11 12" />
              <path d="M14 16v8M20 13v14M26 16v8" />
            </svg>
            <span className="brand-copy">
              <strong>ARAMA</strong>
              <small>{presentationMode ? "GLOBAL VOICE OPERATIONS / LIVE" : "GLOBAL VOICE OPERATIONS"}</small>
            </span>
          </Link>
          <div className="topbar-actions">
            <span className="call-timer" data-testid="text-call-duration">{formatDuration(elapsedSeconds)}</span>
            <label className="language-picker">
              <span className="sr-only">Language</span>
              <select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)}
                data-testid="select-language" disabled={recording || busy}>
                {supportedLocales.map((option) => (
                  <option key={option} value={option}>{localeMetadata[option].label}</option>
                ))}
              </select>
            </label>
            <button className={`presentation-toggle ${presentationMode ? "active" : ""}`} type="button"
              data-testid="button-presentation-mode"
              onClick={() => navigate(presentationMode ? "/" : "/present")}
              aria-pressed={presentationMode}>
              <MonitorPlay size={18} /><span>{presentationMode ? t.exitPresentation : t.presentationMode}</span>
            </button>
            <button className="icon-button" type="button" data-testid="button-reset-call"
              aria-label={t.newCall} title={t.newCall} onClick={resetCall} disabled={recording}>
              <RotateCcw size={18} />
            </button>
            <span className={`mode-pill ${status?.mode !== "demo" && !usingFallback ? "live" : ""}`} data-testid="status-mode">
              <span />{presentationMode
                ? presentationStatus
                : status?.mode === "live" ? t.liveFull : status?.mode === "fish-live" ? t.liveFish : t.demoMode}
            </span>
            <button className="icon-button" type="button"
              data-testid="button-theme"
              aria-label={dark ? t.lightTheme : t.darkTheme}
              onClick={() => setDark((value) => !value)}>
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        <main id="main" className="workspace">
          <section className={`call-stage ${presentationMode ? "presentation-stage" : ""}`} aria-labelledby="call-title">
            <div className="stage-header">
              <div><p className="eyebrow">{presentationMode ? t.presentationEyebrow : t.prototypeEyebrow}</p>
                <h1 id="call-title">{presentationMode ? t.presentationTitle : t.title}</h1></div>
              <div className={`call-meta ${presentationMode ? "latency-meta" : ""}`}>
                <span>{presentationMode ? t.firstAudio : t.fishCredit}</span>
                <strong data-testid={presentationMode ? "text-first-audio" : "text-credit"}>
                  {presentationMode
                    ? latency ? `${(latency / 1000).toFixed(2)} s` : t.measuring
                    : status?.credit != null ? `$${status.credit.toFixed(4)}` : "—"}
                </strong>
                <small>{presentationMode
                  ? usingFallback && status?.mode !== "fish-live" ? t.safeFallback : t.liveMeasurement
                  : latency ? `${t.firstAudio.toLocaleLowerCase()} ${(latency / 1000).toFixed(1)} s` : t.ready}</small>
              </div>
            </div>
            <div className="capability-rail" aria-label="Platform capabilities">
              <span><i className="signal-dot" />10 LANGUAGES</span>
              <span><Activity size={14} />STREAMING INTELLIGENCE</span>
              <span><Radio size={14} />FISH S2 PRO VOICE</span>
              <span><ShieldCheck size={14} />CONSENT-AWARE RECORDS</span>
            </div>
            {presentationMode && <section className="presentation-console" aria-labelledby="presentation-scenarios-title">
              <div className="presentation-copy">
                <p className="eyebrow">{t.scenariosEyebrow}</p>
                <h2 id="presentation-scenarios-title">{t.scenariosTitle}</h2>
              </div>
              <div className="scenario-list">
                {scenarios.map((scenario) => {
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
              <div className="presentation-flow" aria-label={t.voiceFlow}>
                <span><Mic size={16} />{t.listen}</span><ArrowRight size={14} />
                <span><Bot size={16} />{t.understand}</span><ArrowRight size={14} />
                <span><AudioLines size={16} />{t.speak}</span>
              </div>
              <p className="presentation-safety"><ShieldCheck size={16} />{t.presentationSafety}</p>
            </section>}
            <div className={`voice-orbit ${recording ? "recording" : ""} ${busy ? "thinking" : ""}`}>
              <div className="orbit-line orbit-one" /><div className="orbit-line orbit-two" />
              <div className="signal-scan" aria-hidden="true" />
              <div className="voice-spectrum" aria-hidden="true">
                {Array.from({ length: 24 }, (_, index) => <i key={index} />)}
              </div>
              <div className="voice-core">
                {recording ? <Waves size={44} /> : busy ? <AudioLines size={44} /> : <Headphones size={44} />}
              </div>
              <span className="orbit-coordinate coordinate-left">40.7128° N</span>
              <span className="orbit-coordinate coordinate-right">VOICE / 01</span>
              <span className="orbit-label label-top">{t.customerOrbit}</span>
              <span className="orbit-label label-right">FISH S2 PRO</span>
              <span className="orbit-label label-bottom">{status?.services.anthropic ? "CLAUDE" : status?.services.openai ? "OPENAI" : t.rulesEngine}</span>
            </div>
            <div className="primary-control">
              <span className="control-kicker"><i />VOICE CHANNEL READY</span>
              <button className={`talk-button ${recording ? "recording" : ""}`} type="button"
                data-testid="button-record"
                onClick={recording ? stopRecording : startRecording} disabled={!privacyAccepted}>
                {recording ? <CircleStop size={21} /> : <Mic size={21} />}
                {recording ? t.stopRecording : busy ? t.interruptAndSpeak : t.startSpeaking}
              </button>
              <p>{recording
                ? t.recordingHelp
                : presentationMode
                  ? t.presentationHelp
                  : busy
                    ? t.interruptHelp
                    : t.idleHelp}</p>
              <label className="consent-control">
                <input type="checkbox" checked={privacyAccepted}
                  onChange={(event) => setConsent(event.target.checked)} />
                <span><strong>{t.consentStrong}</strong> {t.consentText}</span>
              </label>
            </div>
          </section>

          <aside className="side-panel" aria-label={`${t.connections} / ${t.conversation}`}>
            <section className="connections" aria-labelledby="connections-title">
              <div className="panel-title"><div><p className="eyebrow">{t.systemStatus}</p>
                <h2 id="connections-title">{presentationMode ? t.livePipeline : t.connections}</h2></div><PhoneCall size={19} /></div>
              <div className="service-list">
                {(presentationMode ? [
                  [t.listening, Boolean(status?.services.openai || status?.services.fishAudio), t.transcribesCustomer],
                  [t.decision, Boolean(status?.services.anthropic || status?.services.openai), t.understandsRequest],
                  [t.voice, Boolean(status?.services.fishAudio), t.streamsVoice],
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
                  ? status?.mode === "fish-live" ? t.fishNotice : t.fallbackActive
                  : busy
                    ? t.processing
                    : activeScenario
                      ? t.completedNotice
                      : t.chooseScenario}
              </p>}
              {!presentationMode && status?.mode === "fish-live" && <p className="notice" data-testid="status-notice">
                {t.fishNotice}
              </p>}
              {!presentationMode && status?.mode === "demo" && <p className="notice" data-testid="status-notice">
                {t.demoNotice}
              </p>}
            </section>

            <section className="transcript" aria-labelledby="transcript-title">
              <div className="panel-title compact"><div><p className="eyebrow">{t.transcriptEyebrow}</p>
                <h2 id="transcript-title">{t.conversation}</h2></div><span>{Math.floor((messages.length - 1) / 2)} {t.turns}</span></div>
              <div className="message-list" aria-live="polite">
                {messages.map((message, index) => (
                  <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                    <div className="avatar" aria-hidden="true">
                      {message.role === "assistant" ? <Bot size={16} /> : <UserRound size={16} />}
                    </div>
                    <div><strong>{message.role === "assistant" ? "Arama" : t.you}</strong>
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
                <label htmlFor="message">{t.tryText}</label>
                <div><input id="message" data-testid="input-message" value={text} onChange={(event) => setText(event.target.value)}
                  placeholder={t.inputPlaceholder} disabled={busy || !privacyAccepted} />
                  <button type="submit" data-testid="button-send" aria-label={t.sendMessage} disabled={busy || !privacyAccepted || !text.trim()}>
                    <Send size={17} /></button></div>
              </form>
              {error && !presentationMode && <p className="error-message" role="alert">{error}</p>}
            </section>

            <section className="call-record" aria-labelledby="call-record-title">
              <div className="panel-title compact">
                <div><p className="eyebrow">{t.recordEyebrow}</p>
                  <h2 id="call-record-title">{intentLabels[locale][callState.intent]}</h2></div>
                <span className={callState.completed ? "record-complete" : ""}>
                  {recordSaved ? t.saved : callState.completed ? t.complete : t.active}
                </span>
              </div>
              <p className="record-summary" data-testid="text-call-summary">{callState.summary}</p>
              <dl className="record-grid">
                {callFields.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value || t.waiting}</dd></div>
                ))}
              </dl>
              <div className="record-actions">
                <button type="button" data-testid="button-retry-turn" onClick={retryLastTurn}
                  disabled={busy || !privacyAccepted || !lastInputRef.current}><RefreshCw size={16} />{t.retry}</button>
                <button type="button" data-testid="button-export-summary" onClick={exportSummary}>
                  <Download size={16} />{t.export}</button>
              </div>
            </section>
          </aside>
        </main>
      </div>
    </>
  );
}
