import test from "node:test";
import assert from "node:assert/strict";
import {
  preflightConfiguredBrainProviders,
  providerAvailable,
  providerHealthSnapshot,
  resetProviderHealth,
} from "../server/provider-health";

const envNames = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PROVIDER_PREFLIGHT_TIMEOUT_MS"] as const;

function preserveEnv() {
  return Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
}

function restoreEnv(previous: Record<string, string | undefined>) {
  for (const name of envNames) {
    const value = previous[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetProviderHealth();
}

test("provider preflight geçersiz Anthropic anahtarını readiness için kapatır", async () => {
  const previous = preserveEnv();
  try {
    process.env.ANTHROPIC_API_KEY = "invalid-anthropic-key";
    delete process.env.OPENAI_API_KEY;
    let capturedAuthorization = "";
    const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedAuthorization = new Headers(init?.headers).get("x-api-key") || "";
      return new Response('{"type":"error"}', { status: 401 });
    }) as typeof fetch;

    const result = await preflightConfiguredBrainProviders(fakeFetch);

    assert.deepEqual(result, [{
      provider: "anthropic",
      configured: true,
      healthy: false,
      status: 401,
    }]);
    assert.equal(capturedAuthorization, "invalid-anthropic-key");
    assert.equal(providerAvailable("anthropic", true), false);
    assert.equal(providerHealthSnapshot().anthropic, false);
  } finally {
    restoreEnv(previous);
  }
});

test("provider preflight sağlıklı OpenAI anahtarını doğrular", async () => {
  const previous = preserveEnv();
  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "valid-openai-key";
    let capturedAuthorization = "";
    const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedAuthorization = new Headers(init?.headers).get("authorization") || "";
      return new Response('{"object":"list","data":[]}', { status: 200 });
    }) as typeof fetch;

    const result = await preflightConfiguredBrainProviders(fakeFetch);

    assert.equal(result[0]?.healthy, true);
    assert.equal(capturedAuthorization, "Bearer valid-openai-key");
    assert.equal(providerAvailable("openai", true), true);
  } finally {
    restoreEnv(previous);
  }
});

test("provider preflight ağ hatasında fail-closed davranır ve sırları loglamaz", async () => {
  const previous = preserveEnv();
  const originalError = console.error;
  const logs: string[] = [];
  try {
    process.env.ANTHROPIC_API_KEY = "do-not-log-this-secret";
    delete process.env.OPENAI_API_KEY;
    console.error = (...values: unknown[]) => logs.push(values.map(String).join(" "));
    const fakeFetch = (async () => {
      throw new TypeError("network unavailable");
    }) as typeof fetch;

    const result = await preflightConfiguredBrainProviders(fakeFetch);

    assert.equal(result[0]?.healthy, false);
    assert.equal(result[0]?.status, null);
    assert.equal(providerAvailable("anthropic", true), false);
    assert.equal(logs.some((line) => line.includes("do-not-log-this-secret")), false);
  } finally {
    console.error = originalError;
    restoreEnv(previous);
  }
});

test("provider preflight yapılandırılmamış sağlayıcı için dış istek yapmaz", async () => {
  const previous = preserveEnv();
  try {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    assert.deepEqual(await preflightConfiguredBrainProviders(fakeFetch), []);
    assert.equal(calls, 0);
  } finally {
    restoreEnv(previous);
  }
});
