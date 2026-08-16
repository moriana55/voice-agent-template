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
  provider: ProviderName;
  configured: true;
  healthy: boolean;
  status: number | null;
};

function preflightTimeoutMs() {
  const configured = Number(process.env.PROVIDER_PREFLIGHT_TIMEOUT_MS || 5_000);
  return Number.isFinite(configured) ? Math.min(30_000, Math.max(1_000, configured)) : 5_000;
}

async function probe(
  provider: ProviderName,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<ProviderPreflightResult> {
  const startedAt = Date.now();
  try {
    const url = provider === "anthropic"
      ? "https://api.anthropic.com/v1/models?limit=1"
      : provider === "openai"
        ? "https://api.openai.com/v1/models"
        : "https://api.fish.audio/wallet/self/api-credit?check_free_credit=true";
    const response = await fetchImpl(
      url,
      {
        headers: provider === "anthropic"
          ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
          : { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(preflightTimeoutMs()),
      },
    );
    let healthy = response.ok;
    if (provider === "fishAudio" && response.ok) {
      const wallet = await response.json() as { credit?: string; has_free_credit?: boolean };
      const credit = Number(wallet.credit);
      healthy = (Number.isFinite(credit) && credit > 0) || wallet.has_free_credit === true;
    }
    setProviderHealth(provider, healthy);
    console.log(JSON.stringify({
      level: healthy ? "info" : "error",
      event: "provider_preflight",
      provider,
      healthy,
      status: response.status,
      durationMs: Date.now() - startedAt,
    }));
    return { provider, configured: true, healthy, status: response.status };
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

export async function preflightConfiguredProviders(fetchImpl: typeof fetch = fetch) {
  const probes: Array<Promise<ProviderPreflightResult>> = [];
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const fishAudioKey = process.env.FISH_AUDIO_API_KEY?.trim();
  if (anthropicKey) probes.push(probe("anthropic", anthropicKey, fetchImpl));
  if (openaiKey) probes.push(probe("openai", openaiKey, fetchImpl));
  if (fishAudioKey) probes.push(probe("fishAudio", fishAudioKey, fetchImpl));
  return Promise.all(probes);
}
