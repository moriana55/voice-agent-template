import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowRight, AudioLines, BadgeDollarSign, Bot, CalendarClock, Check,
  CircleStop, Download, Headphones, Mic, MonitorPlay, Moon,
  PhoneCall, Radio, RefreshCw, RotateCcw, Send, ShieldCheck, Sun, UserRound,
  Waves, Wrench, BarChart3, LockKeyhole, Trash2,
  PlugZap, PhoneOutgoing, CreditCard,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { apiRequest, queryClient } from "./lib/queryClient";

type Status = {
  mode: "demo" | "fish-live" | "live";
  credit: number | null;
  services: Record<"microphone" | "anthropic" | "openai" | "fishAudio" | "voice", boolean>;
  models: { llm: string; transcription: string; speech: string };
  records: { enabled: boolean; encrypted: boolean; crmWebhook: boolean };
  localization?: { defaultLocale: Locale; supportedLocales: Locale[] };
};
type ProductConfig = {
  productName: string;
  agentName: string;
  businessName: string;
  tagline: string;
  supportEmail: string | null;
  privacyUrl: string;
  portfolioAttribution: boolean;
  plan: { name: string; includedMinutes: number; overageTryPerMinute: number; billingBasis: string };
};
type StreamEvent =
  | { type: "meta"; transcript: string; state: CallState; mode: string }
  | { type: "text_delta"; text: string }
  | { type: "audio"; audioBase64: string; audioMime: string }
  | { type: "done"; reply: string; latencyMs: number; firstAudioMs: number | null; audioWarning: string | null; recorded: boolean; usageSeconds: number }
  | { type: "error"; message: string };
type RunTurnContext = {
  history?: Message[];
  state?: CallState;
  scenario?: PresentationScenario;
};
type UsageSummary = {
  period: string;
  activeMinutes: number;
  turns: number;
  calls: number;
  includedMinutes: number;
  remainingIncludedMinutes: number;
  overageMinutes: number;
  overageTryPerMinute: number;
  estimatedOverageTry: number;
  hardLimitMinutes: number | null;
  daily: Array<{ date: string; minutes: number; turns: number }>;
};
type AdminRecord = {
  id: string;
  createdAt: string;
  intent: string;
  name: string | null;
  phone: string | null;
  summary: string;
  source: string;
  locale: string;
};
type IntegrationStatus = {
  id: string;
  label: string;
  category: "voice" | "calendar" | "crm" | "billing";
  configured: boolean;
  missing: string[];
  detail: string;
};

function AdminDashboard({ product }: { product: ProductConfig }) {
  const [key, setKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [error, setError] = useState("");
  const [outboundNumber, setOutboundNumber] = useState("");
  const [outboundLocale, setOutboundLocale] = useState<Locale>("en");
  const [billingEmail, setBillingEmail] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const adminHeaders = () => ({ authorization: `Bearer ${key.trim()}` });
  const usageQuery = useQuery<UsageSummary>({
    queryKey: ["admin", "usage", period],
    enabled: false,
    gcTime: 0,
    queryFn: async () => (await apiRequest("GET", `/api/admin/usage?period=${encodeURIComponent(period)}`, undefined, adminHeaders())).json(),
  });
  const recordsQuery = useQuery<{ records: AdminRecord[] }>({
    queryKey: ["admin", "records"],
    enabled: false,
    gcTime: 0,
    queryFn: async () => (await apiRequest("GET", "/api/admin/records?limit=50", undefined, adminHeaders())).json(),
  });
  const integrationsQuery = useQuery<{ integrations: IntegrationStatus[] }>({
    queryKey: ["admin", "integrations"],
    enabled: false,
    gcTime: 0,
    queryFn: async () => (await apiRequest("GET", "/api/admin/integrations", undefined, adminHeaders())).json(),
  });

  useEffect(() => () => {
    queryClient.removeQueries({ queryKey: ["admin"] });
  }, []);

  function clearAdminSession() {
    setAuthenticated(false);
    queryClient.removeQueries({ queryKey: ["admin"] });
  }

  function changeAdminKey(value: string) {
    if (value !== key) clearAdminSession();
    setKey(value);
  }

  function logoutAdmin() {
    setKey("");
    setError("");
    setActionMessage("");
    clearAdminSession();
  }

  const removeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/records/${id}`, undefined, adminHeaders()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "records"] });
      await recordsQuery.refetch();
    },
    onError: () => setError("Kayıt silinemedi."),
  });
  const outboundMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/telephony/outbound", {
      to: outboundNumber, locale: outboundLocale,
    }, adminHeaders())).json() as Promise<{ sid: string; status: string; to: string }>,
    onSuccess: (result) => {
      setActionMessage(`Arama sıraya alındı: ${result.to} · ${result.status}`);
      setOutboundNumber("");
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Arama başlatılamadı."),
  });
  const checkoutMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/billing/checkout", {
      email: billingEmail,
    }, adminHeaders())).json() as Promise<{ id: string; url: string }>,
    onSuccess: (result) => {
      setActionMessage("Stripe ödeme sayfası oluşturuldu.");
      window.location.assign(result.url);
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Ödeme bağlantısı oluşturulamadı."),
  });

  async function loadDashboard(event?: FormEvent) {
    event?.preventDefault();
    if (!key.trim()) return;
    setError("");
    setActionMessage("");
    try {
      const results = await Promise.all([usageQuery.refetch(), recordsQuery.refetch(), integrationsQuery.refetch()]);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      setAuthenticated(true);
    } catch (reason) {
      clearAdminSession();
      setError(reason instanceof Error ? reason.message : "Yönetim verisi alınamadı.");
    }
  }

  const usage = authenticated ? usageQuery.data || null : null;
  const records = authenticated ? recordsQuery.data?.records || [] : [];
  const integrations = authenticated ? integrationsQuery.data?.integrations || [] : [];
  const loading = usageQuery.isFetching || recordsQuery.isFetching || integrationsQuery.isFetching;

  return <main className="admin-shell">
    <header className="admin-header">
      <div><p className="eyebrow">MANAGED VOICE / OPERATIONS</p><h1>{product.businessName}</h1>
        <p>{product.plan.name} · {product.plan.includedMinutes} dakika dahil · aşım {product.plan.overageTryPerMinute} TL/dk</p></div>
      <Link href="/" className="admin-back">Canlı konsola dön</Link>
    </header>
    <form className="admin-login" onSubmit={loadDashboard}>
      <LockKeyhole size={19} /><input type="password" value={key} onChange={(event) => changeAdminKey(event.target.value)}
        placeholder="ADMIN_API_KEY" autoComplete="current-password" data-testid="input-admin-key" />
      <input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} data-testid="input-report-period" />
      <button type="submit" disabled={loading || !key.trim()} data-testid="button-load-admin">{loading ? "Yükleniyor…" : "Raporu aç"}</button>
      {authenticated && <button type="button" onClick={logoutAdmin} data-testid="button-admin-logout">Çıkış</button>}
    </form>
    {error && <p className="error-message" role="alert">{error}</p>}
    {actionMessage && <p className="admin-success" role="status" data-testid="status-admin-action">{actionMessage}</p>}
    {usage && <>
      <section className="admin-metrics" aria-label="Kullanım özeti">
        <article><BarChart3 /><span>Aktif kullanım</span><strong>{usage.activeMinutes} dk</strong><small>{usage.remainingIncludedMinutes} dk paket kaldı</small></article>
        <article><PhoneCall /><span>Görüşmeler</span><strong>{usage.calls}</strong><small>{usage.turns} konuşma turu</small></article>
        <article><BadgeDollarSign /><span>Tahmini aşım</span><strong>{usage.estimatedOverageTry.toLocaleString("tr-TR")} TL</strong><small>{usage.overageMinutes} dk × {usage.overageTryPerMinute} TL</small></article>
      </section>
      <section className="admin-table-card">
        <div className="panel-title"><div><p className="eyebrow">LEAD KAYITLARI</p><h2>Son tamamlanan talepler</h2></div><span>{records.length} kayıt</span></div>
        <div className="admin-records">
          {records.length === 0 ? <p>Bu dönemde izinli kayıt bulunmuyor.</p> : records.map((record) => <article key={record.id}>
            <div><strong>{record.name || "İsimsiz müşteri"}</strong><small>{record.phone || "Telefon yok"} · {record.intent} · {record.locale.toUpperCase()}</small></div>
            <p>{record.summary}</p><time>{new Date(record.createdAt).toLocaleString("tr-TR")}</time>
            <button type="button" aria-label="Kaydı sil" data-testid={`button-delete-record-${record.id}`}
              onClick={() => removeMutation.mutate(record.id)}><Trash2 size={16} /></button>
          </article>)}
        </div>
      </section>
      <section className="admin-integrations" aria-labelledby="integrations-title">
        <div className="panel-title"><div><p className="eyebrow">PROVIDER CONNECTIONS</p>
          <h2 id="integrations-title">Satış altyapısı</h2></div><PlugZap size={19} /></div>
        <div className="integration-grid">
          {integrations.map((item) => <article key={item.id} data-testid={`card-integration-${item.id}`}>
            <div><strong>{item.label}</strong><span className={item.configured ? "ready" : "waiting"}>
              {item.configured ? "Hazır" : "Kurulum gerekli"}</span></div>
            <p>{item.detail}</p>
            {!item.configured && <small>{item.missing.join(" · ")}</small>}
          </article>)}
        </div>
        <div className="integration-actions">
          <form onSubmit={(event) => { event.preventDefault(); setError(""); outboundMutation.mutate(); }}>
            <div className="action-heading"><PhoneOutgoing size={18} /><div><strong>Test araması başlat</strong><small>E.164 numarası kullanın</small></div></div>
            <label><span>Telefon</span><input type="tel" value={outboundNumber} onChange={(event) => setOutboundNumber(event.target.value)}
              placeholder="+905551112233" data-testid="input-outbound-phone" required /></label>
            <label><span>Dil</span><select value={outboundLocale} onChange={(event) => setOutboundLocale(event.target.value as Locale)}
              data-testid="select-outbound-language">{supportedLocales.map((option) => <option key={option} value={option}>{localeMetadata[option].label}</option>)}</select></label>
            <button type="submit" disabled={outboundMutation.isPending || !outboundNumber.trim()} data-testid="button-outbound-call">
              {outboundMutation.isPending ? "Bağlanıyor…" : "Aramayı başlat"}</button>
          </form>
          <form onSubmit={(event) => { event.preventDefault(); setError(""); checkoutMutation.mutate(); }}>
            <div className="action-heading"><CreditCard size={18} /><div><strong>Abonelik bağlantısı</strong><small>Stripe Checkout</small></div></div>
            <label><span>Müşteri e-postası</span><input type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)}
              placeholder="customer@company.com" data-testid="input-billing-email" required /></label>
            <button type="submit" disabled={checkoutMutation.isPending || !billingEmail.trim()} data-testid="button-create-checkout">
              {checkoutMutation.isPending ? "Oluşturuluyor…" : "Ödeme sayfası oluştur"}</button>
          </form>
        </div>
      </section>
    </>}
  </main>;
}

function PrivacyPage({ product }: { product: ProductConfig }) {
  return <main className="admin-shell privacy-page">
    <header className="admin-header"><div><p className="eyebrow">PRIVACY / DATA FLOW</p>
      <h1>Veri işleme bilgilendirmesi</h1><p>{product.businessName} · {product.productName}</p></div>
      <Link href="/" className="admin-back">Uygulamaya dön</Link></header>
    <section className="admin-table-card privacy-copy">
      <h2>Hangi veriler işlenir?</h2><p>Gönderdiğiniz ses veya metin, yanıt üretmek amacıyla yapılandırılmış yapay zekâ servislerine iletilir. Ham ses kalıcı olarak saklanmaz.</p>
      <h2>Talep kaydı isteğe bağlıdır</h2><p>Ayrı kayıt iznini seçerseniz tamamlanan talebin özeti, görüşme metni ve paylaştığınız iletişim bilgileri şifreli çağrı kaydında saklanabilir ve yapılandırılmış işletme sistemlerine aktarılabilir. Bu izin olmadan görüşebilirsiniz; talep kaydı oluşturulmaz.</p>
      <h2>Saklama ve erişim</h2><p>Kayıtlar varsayılan olarak 30 gün sonra temizlenir. Yönetim erişimi korumalıdır ve ham konuşma içeriği uygulama loglarına yazılmaz.</p>
      <h2>Üçüncü taraflar</h2><p>Yapılandırmaya göre Fish Audio, Anthropic, OpenAI veya telefon sağlayıcısı veriyi yalnızca hizmeti sunmak için işleyebilir. Müşteri kurulumunda sağlayıcılar ve hukuki dayanak ayrıca belirtilmelidir.</p>
      <h2>İletişim</h2><p>{product.supportEmail ? <a href={`mailto:${product.supportEmail}`}>{product.supportEmail}</a> : "Bu portföy demosunda veri sorumlusu iletişim adresi yapılandırılmamıştır; gerçek müşteri kurulumu bu alan olmadan hazır sayılmaz."}</p>
      <small>Bu metin ürün içi teknik bilgilendirmedir; işletmeye özel hukuki incelemenin yerine geçmez.</small>
    </section>
  </main>;
}

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
    window.localStorage.getItem("voiceops-studio-locale") || navigator.language,
    "en",
  ));
  const t = getCopy(locale);
  const scenarios = getPresentationScenarios(locale);
  const [product, setProduct] = useState<ProductConfig>({
    productName: "VoiceOps Studio", agentName: "Nova", businessName: "VoiceOps Studio",
    tagline: "Global voice operations", supportEmail: null, privacyUrl: "/#/privacy",
    portfolioAttribution: true,
    plan: { name: "Managed Voice", includedMinutes: 300, overageTryPerMinute: 12, billingBasis: "active-voice-seconds" },
  });
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
    () => window.localStorage.getItem("voiceops-studio-privacy-consent") === "accepted",
  );
  const [storageConsent, setStorageConsent] = useState(
    () => window.localStorage.getItem("voiceops-studio-storage-consent") === "accepted",
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

  const refreshStatus = useCallback(() => {
    fetch("/api/status").then((response) => response.json()).then(setStatus)
      .catch(() => {
        if (presentationMode) setUsingFallback(true);
        else setError(t.serverUnavailable);
      });
  }, [presentationMode, t.serverUnavailable]);

  useEffect(() => {
    void refreshStatus();
    fetch("/api/product").then((response) => response.json()).then((config: ProductConfig) => {
      setProduct(config);
      setMessages((current) => current.length === 1 ? initialMessages(locale, config.agentName) : current);
      document.title = `${config.productName} — Multilingual Voice AI`;
    }).catch(() => undefined);
  }, [locale, refreshStatus]);

  useEffect(() => {
    document.documentElement.lang = localeMetadata[locale].html;
    window.localStorage.setItem("voiceops-studio-locale", locale);
  }, [locale]);

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
    if (accepted) window.localStorage.setItem("voiceops-studio-privacy-consent", "accepted");
    else window.localStorage.removeItem("voiceops-studio-privacy-consent");
  }

  function setRecordConsent(accepted: boolean) {
    setStorageConsent(accepted);
    if (accepted) window.localStorage.setItem("voiceops-studio-storage-consent", "accepted");
    else window.localStorage.removeItem("voiceops-studio-storage-consent");
  }

  function changeLocale(nextLocale: Locale) {
    if (nextLocale === locale) return;
    cancelActiveTurn();
    setLocale(nextLocale);
    setMessages(initialMessages(nextLocale, product.agentName));
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
      body.append("turnId", crypto.randomUUID());
      body.append("noticeAcknowledged", "true");
      body.append("storageConsent", String(storageConsent));
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
    setMessages(initialMessages(locale, product.agentName));
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
      { history: initialMessages(locale, product.agentName), state: initialCallState(locale), scenario },
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
      ...messages.map((message) => `${message.role === "assistant" ? product.agentName : t.customer}: ${message.content}`),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `voiceops-call-${locale}-${Date.now()}.txt`;
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

  if (location === "/admin") return <AdminDashboard product={product} />;
  if (location === "/privacy") return <PrivacyPage product={product} />;

  return (
    <>
      <button className="skip-link" type="button" data-testid="button-skip-content"
        onClick={() => document.getElementById("main")?.scrollIntoView({ behavior: "smooth" })}>{t.skip}</button>
      <div className={`app-shell ${presentationMode ? "presentation-mode" : ""}`}>
        <header className="topbar">
          <Link className="brand" href="/" aria-label={t.home} data-testid="link-home">
            <svg viewBox="0 0 40 40" role="img" aria-label={product.productName}>
              <path d="M9 20c0-8 4-12 11-12s11 4 11 12-4 12-11 12" />
              <path d="M14 16v8M20 13v14M26 16v8" />
            </svg>
            <span className="brand-copy">
              <strong>{product.productName.toLocaleUpperCase()}</strong>
              <small>{product.tagline.toLocaleUpperCase()}{presentationMode ? " / LIVE" : ""}</small>
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
              <span><ShieldCheck size={14} />METERED USAGE + QUOTAS</span>
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
              <label className="consent-control optional-consent">
                <input type="checkbox" checked={storageConsent}
                  onChange={(event) => setRecordConsent(event.target.checked)} />
                <span><strong>{t.storageConsentStrong}</strong> {t.storageConsentText} <a href={product.privacyUrl} target="_blank" rel="noreferrer">Privacy</a></span>
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
                    <div><strong>{message.role === "assistant" ? product.agentName : t.you}</strong>
                      <p>{message.content}</p></div>
                  </article>
                ))}
                {busy && <article className="message assistant"><div className="avatar"><Bot size={16} /></div>
                  {streamingReply
                    ? <div><strong>{product.agentName}</strong><p>{streamingReply}</p></div>
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
