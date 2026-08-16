export type ProviderName = "anthropic" | "openai" | "fishAudio";

const providerHealth: Record<ProviderName, boolean | null> = {
  anthropic: null,
  openai: null,
  fishAudio: null,
};

export function providerAvailable(provider: ProviderName, configured: boolean) {
  return configured && providerHealth[provider] !== false;
}

export function setProviderHealth(provider: ProviderName, healthy: boolean) {
  providerHealth[provider] = healthy;
}

export function resetProviderHealth() {
  providerHealth.anthropic = null;
  providerHealth.openai = null;
  providerHealth.fishAudio = null;
}

export function providerHealthSnapshot() {
  return { ...providerHealth };
}

export type ProviderPreflightResult = {
  provider: "anthropic" | "openai";
  configured: true;
  healthy: boolean;
  status: number | null;
};

function preflightTimeoutMs() {
  const configured = Number(process.env.PROVIDER_PREFLIGHT_TIMEOUT_MS || 5_000);
  return Number.isFinite(configured) ? Math.min(30_000, Math.max(1_000, configured)) : 5_000;
}

async function probe(
  provider: "anthropic" | "openai",
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<ProviderPreflightResult> {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(
      provider === "anthropic"
        ? "https://api.anthropic.com/v1/models?limit=1"
        : "https://api.openai.com/v1/models",
      {
        headers: provider === "anthropic"
          ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
          : { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(preflightTimeoutMs()),
      },
    );
    setProviderHealth(provider, response.ok);
    console.log(JSON.stringify({
      level: response.ok ? "info" : "error",
      event: "provider_preflight",
      provider,
      healthy: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
    }));
    return { provider, configured: true, healthy: response.ok, status: response.status };
  } catch (error) {
    setProviderHealth(provider, false);
    console.error(JSON.stringify({
      level: "error",
      event: "provider_preflight",
      provider,
      healthy: false,
      status: null,
      errorType: error instanceof Error ? error.name : "UnknownError",
      durationMs: Date.now() - startedAt,
    }));
    return { provider, configured: true, healthy: false, status: null };
  }
}

export async function preflightConfiguredBrainProviders(fetchImpl: typeof fetch = fetch) {
  const probes: Array<Promise<ProviderPreflightResult>> = [];
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (anthropicKey) probes.push(probe("anthropic", anthropicKey, fetchImpl));
  if (openaiKey) probes.push(probe("openai", openaiKey, fetchImpl));
  return Promise.all(probes);
}
