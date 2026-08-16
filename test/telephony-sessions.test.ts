import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { updateCallState } from "../shared/call-logic";
import {
  abortPhoneTurn,
  beginPhoneTurn,
  commitPhoneTurn,
  completePhoneTurn,
  ensurePhoneSession,
  pruneExpiredPhoneSessions,
  resetTelephonySessionsForTests,
  telephonySessionStatus,
} from "../server/telephony-sessions";

test("aynı Twilio çağrısındaki paralel tur reddedilir ve sunucu durumu ilerler", async () => {
  await resetTelephonySessionsForTests();
  const callSid = "CA11111111111111111111111111111111";
  await ensurePhoneSession(callSid, "en", "Welcome");
  const first = await beginPhoneTurn(callSid, "en", "Welcome");
  await assert.rejects(beginPhoneTurn(callSid, "en", "Welcome"), /halen işleniyor/i);
  const state = updateCallState("I need an appointment", first.state, first.locale);
  const history = [...first.history, { role: "user" as const, content: "I need an appointment" }];
  await commitPhoneTurn(first, state, history);

  const second = await beginPhoneTurn(callSid, "en", "Welcome");
  assert.equal(second.state.intent, "randevu");
  assert.equal(second.history.length, 2);
  await abortPhoneTurn(second);
});

test("şifreli telefon oturumu restarttan sonra sürer, TTL sonunda silinir", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "voiceops-phone-session-"));
  const previousStorage = process.env.TELEPHONY_SESSION_STORAGE;
  const previousDataDirectory = process.env.DATA_DIR;
  const previousKey = process.env.DATA_ENCRYPTION_KEY;
  const previousTtl = process.env.TELEPHONY_SESSION_TTL_MINUTES;
  try {
    process.env.TELEPHONY_SESSION_STORAGE = "encrypted-file";
    process.env.TELEPHONY_SESSION_TTL_MINUTES = "120";
    process.env.DATA_DIR = dataDirectory;
    process.env.DATA_ENCRYPTION_KEY = "telephony-session-test-key-with-at-least-32-characters";
    await resetTelephonySessionsForTests({ preserveStorage: true });

    const callSid = "CA22222222222222222222222222222222";
    await ensurePhoneSession(callSid, "tr", "Merhaba");
    const first = await beginPhoneTurn(callSid, "tr", "Merhaba");
    const state = updateCallState("Randevu istiyorum", first.state, first.locale);
    await commitPhoneTurn(first, state, [
      ...first.history,
      { role: "user", content: "Randevu istiyorum" },
      { role: "assistant", content: "Adınız nedir?" },
    ]);

    const encrypted = await readFile(path.join(dataDirectory, "telephony-sessions.enc.json"), "utf8");
    assert.doesNotMatch(encrypted, /Randevu|Adınız|Merhaba/u);
    assert.deepEqual(telephonySessionStatus(), {
      backend: "encrypted-file",
      durable: true,
      encrypted: true,
      ttlMinutes: 120,
    });

    await resetTelephonySessionsForTests({ preserveStorage: true });
    const resumed = await beginPhoneTurn(callSid, "tr", "Merhaba");
    assert.equal(resumed.state.intent, "randevu");
    assert.equal(resumed.history.length, 3);
    await abortPhoneTurn(resumed);

    assert.equal(await pruneExpiredPhoneSessions(Date.now() + 121 * 60 * 1000), 1);
    await resetTelephonySessionsForTests({ preserveStorage: true });
    const afterExpiry = await beginPhoneTurn(callSid, "tr", "Merhaba");
    assert.equal(afterExpiry.state.intent, "genel");
    assert.equal(afterExpiry.history.length, 1);
    await completePhoneTurn(afterExpiry);
  } finally {
    await resetTelephonySessionsForTests();
    if (previousStorage === undefined) delete process.env.TELEPHONY_SESSION_STORAGE;
    else process.env.TELEPHONY_SESSION_STORAGE = previousStorage;
    if (previousDataDirectory === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDirectory;
    if (previousKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previousKey;
    if (previousTtl === undefined) delete process.env.TELEPHONY_SESSION_TTL_MINUTES;
    else process.env.TELEPHONY_SESSION_TTL_MINUTES = previousTtl;
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
