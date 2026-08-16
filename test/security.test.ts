import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { requireAdmin, sameOriginOnly, turnConcurrencyLimiter } from "../server/security";

class TestResponse extends EventEmitter {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, string>();

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(value: unknown) {
    this.body = value;
    return this;
  }
}

test("global görüşme kapasitesi dolduğunda yeni sağlayıcı işi başlatılmaz", () => {
  const previous = process.env.TURN_MAX_CONCURRENCY;
  process.env.TURN_MAX_CONCURRENCY = "1";
  try {
    const first = new TestResponse();
    let firstStarted = false;
    turnConcurrencyLimiter({} as never, first as never, () => { firstStarted = true; });
    assert.equal(firstStarted, true);

    const blocked = new TestResponse();
    let blockedStarted = false;
    turnConcurrencyLimiter({} as never, blocked as never, () => { blockedStarted = true; });
    assert.equal(blockedStarted, false);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.headers.get("retry-after"), "2");

    first.emit("finish");
    const next = new TestResponse();
    let nextStarted = false;
    turnConcurrencyLimiter({} as never, next as never, () => { nextStarted = true; });
    assert.equal(nextStarted, true);
    next.emit("close");
  } finally {
    if (previous === undefined) delete process.env.TURN_MAX_CONCURRENCY;
    else process.env.TURN_MAX_CONCURRENCY = previous;
  }
});

test("trusted proxy kapalıyken sahte forwarded host origin kontrolünü geçemez", () => {
  const previousTrust = process.env.TRUST_PROXY;
  const previousAllowed = process.env.ALLOWED_ORIGINS;
  process.env.TRUST_PROXY = "false";
  delete process.env.ALLOWED_ORIGINS;
  try {
    const req = {
      protocol: "https",
      get(name: string) {
        const headers: Record<string, string> = {
          origin: "https://evil.example",
          host: "voice.example.com",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        };
        return headers[name.toLowerCase()];
      },
    };
    const res = new TestResponse();
    let accepted = false;
    sameOriginOnly(req as never, res as never, () => { accepted = true; });
    assert.equal(accepted, false);
    assert.equal(res.statusCode, 403);
  } finally {
    if (previousTrust === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousTrust;
    if (previousAllowed === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previousAllowed;
  }
});

test("admin sırrı eksikken kapalı reddeder ve hassas yanıtları cache dışı bırakır", () => {
  const previous = process.env.ADMIN_API_KEY;
  delete process.env.ADMIN_API_KEY;
  try {
    const req = { get() { return undefined; } };
    const res = new TestResponse();
    let accepted = false;
    requireAdmin(req as never, res as never, () => { accepted = true; });
    assert.equal(accepted, false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("pragma"), "no-cache");
  } finally {
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});
