import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { updateCallState } from "../shared/call-logic";
import {
  abortWebTurn,
  beginWebTurn,
  commitWebTurn,
  initializeWebSessions,
  resetWebSessionsForTests,
  webSessionStatus,
} from "../server/web-sessions";

test("istemci yerine sunucuya ait görüşme durumu ilerletilir", async () => {
  await resetWebSessionsForTests();
  const callId = "11111111-1111-4111-8111-111111111111";
  const first = await beginWebTurn(callId, "en");

  assert.equal(first.state.name, null);
  assert.deepEqual(first.history, []);

  const firstState = updateCallState("I need an appointment", first.state, first.locale);
  assert.equal(firstState.completed, false);
  assert.equal(firstState.name, null);
  await commitWebTurn(first, firstState, "I need an appointment", "What is your name?");

  const second = await beginWebTurn(callId, "en");
  assert.equal(second.state.intent, "randevu");
  assert.equal(second.state.name, null);
  assert.equal(second.history.length, 2);
  await abortWebTurn(second);
});

test("bozuk veya anahtarı uyuşmayan kalıcı oturumla startup kapalı reddedilir", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "voiceops-web-session-corrupt-"));
  const previousStorage = process.env.WEB_SESSION_STORAGE;
  const previousDataDirectory = process.env.DATA_DIR;
  const previousKey = process.env.DATA_ENCRYPTION_KEY;
  try {
    process.env.WEB_SESSION_STORAGE = "encrypted-file";
    process.env.DATA_DIR = dataDirectory;
    process.env.DATA_ENCRYPTION_KEY = "web-session-test-key-with-at-least-32-characters";
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(path.join(dataDirectory, "web-sessions.enc.json"), "{\"encrypted\":true,\"version\":1}\n");
    await resetWebSessionsForTests({ preserveStorage: true });
    await assert.rejects(initializeWebSessions());
  } finally {
    await resetWebSessionsForTests();
    if (previousStorage === undefined) delete process.env.WEB_SESSION_STORAGE;
    else process.env.WEB_SESSION_STORAGE = previousStorage;
    if (previousDataDirectory === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDirectory;
    if (previousKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previousKey;
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("aynı görüşmedeki paralel tur kapalı reddedilir", async () => {
  await resetWebSessionsForTests();
  const callId = "22222222-2222-4222-8222-222222222222";
  const lease = await beginWebTurn(callId, "tr");
  await assert.rejects(beginWebTurn(callId, "tr"), /halen işleniyor/i);
  await abortWebTurn(lease);
  await assert.doesNotReject(async () => abortWebTurn(await beginWebTurn(callId, "tr")));
});

test("istemci turnId tekrarı reddedilir ve kullanım kimliği sunucu tarafından üretilir", async () => {
  await resetWebSessionsForTests();
  const callId = "33333333-3333-4333-8333-333333333333";
  const clientTurnId = "44444444-4444-4444-8444-444444444444";
  const first = await beginWebTurn(callId, "en", clientTurnId);
  assert.notEqual(first.usageTurnId, clientTurnId);
  await commitWebTurn(first, first.state, "hello", "hello");
  await assert.rejects(beginWebTurn(callId, "en", clientTurnId), /daha önce işlendi/i);

  const retryable = await beginWebTurn(callId, "en", "55555555-5555-4555-8555-555555555555");
  await abortWebTurn(retryable);
  await assert.doesNotReject(async () => abortWebTurn(await beginWebTurn(
    callId,
    "en",
    "55555555-5555-4555-8555-555555555555",
  )));
});

test("şifreli dosya oturumu restart sonrasında son tamamlanan turdan sürdürür", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "voiceops-web-session-"));
  const previousStorage = process.env.WEB_SESSION_STORAGE;
  const previousDataDirectory = process.env.DATA_DIR;
  const previousKey = process.env.DATA_ENCRYPTION_KEY;
  try {
    process.env.WEB_SESSION_STORAGE = "encrypted-file";
    process.env.DATA_DIR = dataDirectory;
    process.env.DATA_ENCRYPTION_KEY = "web-session-test-key-with-at-least-32-characters";
    await resetWebSessionsForTests({ preserveStorage: true });

    const callId = "66666666-6666-4666-8666-666666666666";
    const turnId = "77777777-7777-4777-8777-777777777777";
    const first = await beginWebTurn(callId, "en", turnId);
    const firstState = updateCallState("I need an appointment", first.state, first.locale);
    await commitWebTurn(first, firstState, "I need an appointment", "What is your name?");

    const encrypted = await readFile(path.join(dataDirectory, "web-sessions.enc.json"), "utf8");
    assert.doesNotMatch(encrypted, /appointment|What is your name/i);
    assert.deepEqual(webSessionStatus(), {
      backend: "encrypted-file",
      durable: true,
      encrypted: true,
    });

    await resetWebSessionsForTests({ preserveStorage: true });
    const resumed = await beginWebTurn(callId, "en");
    assert.equal(resumed.state.intent, "randevu");
    assert.equal(resumed.history.length, 2);
    await abortWebTurn(resumed);
    await assert.rejects(beginWebTurn(callId, "en", turnId), /daha önce işlendi/i);
  } finally {
    await resetWebSessionsForTests();
    if (previousStorage === undefined) delete process.env.WEB_SESSION_STORAGE;
    else process.env.WEB_SESSION_STORAGE = previousStorage;
    if (previousDataDirectory === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDirectory;
    if (previousKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previousKey;
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
