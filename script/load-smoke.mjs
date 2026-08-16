const baseUrl = process.env.LOAD_BASE_URL || "http://127.0.0.1:5193";
const totalRequests = positiveInteger("LOAD_TOTAL", 80, 1, 10_000);
const concurrency = positiveInteger("LOAD_CONCURRENCY", 4, 1, 100);
const timeoutMs = positiveInteger("LOAD_REQUEST_TIMEOUT_MS", 5_000, 100, 120_000);
const maximumP95Ms = positiveInteger("LOAD_MAX_P95_MS", 750, 1, 120_000);
const maximumErrorRate = fraction("LOAD_MAX_ERROR_RATE", 0);

function positiveInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function fraction(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
  return value;
}

function percentile(sorted, quantile) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

const health = await fetch(`${baseUrl}/api/health/live`, { signal: AbortSignal.timeout(timeoutMs) });
if (!health.ok) throw new Error(`Load target is not live (${health.status})`);

const status = await fetchJson("/api/status");
if (!status.response.ok) throw new Error(`Load target status failed (${status.response.status})`);
if (status.payload.mode !== "demo" && process.env.LOAD_ALLOW_LIVE !== "true") {
  throw new Error(`Refusing provider-backed load test in ${status.payload.mode || "unknown"} mode; set LOAD_ALLOW_LIVE=true explicitly`);
}

const results = [];
let nextRequest = 0;

async function worker() {
  while (true) {
    const index = nextRequest++;
    if (index >= totalRequests) return;
    const body = new FormData();
    body.set("callId", crypto.randomUUID());
    body.set("turnId", crypto.randomUUID());
    body.set("noticeAcknowledged", "true");
    body.set("storageConsent", "false");
    body.set("locale", index % 2 === 0 ? "en" : "tr");
    body.set("text", index % 2 === 0 ? "I need pricing information" : "Fiyat bilgisi almak istiyorum");

    const startedAt = performance.now();
    try {
      const { response, payload } = await fetchJson("/api/turn", { method: "POST", body });
      results.push({
        ok: response.status === 200 && typeof payload.reply === "string",
        status: response.status,
        durationMs: performance.now() - startedAt,
      });
    } catch (error) {
      results.push({
        ok: false,
        status: 0,
        durationMs: performance.now() - startedAt,
        error: error instanceof Error ? error.name : "request-error",
      });
    }
  }
}

const suiteStartedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const suiteDurationMs = performance.now() - suiteStartedAt;
const durations = results.map((result) => result.durationMs).sort((left, right) => left - right);
const failed = results.filter((result) => !result.ok);
const errorRate = failed.length / results.length;
const report = {
  ok: errorRate <= maximumErrorRate && percentile(durations, 0.95) <= maximumP95Ms,
  targetMode: status.payload.mode,
  sessionBackend: status.payload.sessions?.backend || "unknown",
  totalRequests: results.length,
  concurrency,
  succeeded: results.length - failed.length,
  failed: failed.length,
  errorRate: Number(errorRate.toFixed(4)),
  latencyMs: {
    p50: Math.round(percentile(durations, 0.5)),
    p95: Math.round(percentile(durations, 0.95)),
    p99: Math.round(percentile(durations, 0.99)),
    maximum: Math.round(percentile(durations, 1)),
  },
  throughputPerSecond: Number((results.length / (suiteDurationMs / 1000)).toFixed(2)),
  thresholds: { maximumErrorRate, maximumP95Ms },
  failureStatuses: Object.fromEntries([...new Set(failed.map((result) => result.status))].map((code) => [
    code,
    failed.filter((result) => result.status === code).length,
  ])),
};

console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
