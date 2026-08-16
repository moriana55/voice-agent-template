import test from "node:test";
import assert from "node:assert/strict";
import { updateCallState } from "../shared/call-logic";
import {
  abortWebTurn,
  beginWebTurn,
  commitWebTurn,
  resetWebSessionsForTests,
} from "../server/web-sessions";

test("istemci yerine sunucuya ait görüşme durumu ilerletilir", () => {
  resetWebSessionsForTests();
  const callId = "11111111-1111-4111-8111-111111111111";
  const first = beginWebTurn(callId, "en");

  assert.equal(first.state.name, null);
  assert.deepEqual(first.history, []);

  const firstState = updateCallState("I need an appointment", first.state, first.locale);
  assert.equal(firstState.completed, false);
  assert.equal(firstState.name, null);
  commitWebTurn(first, firstState, "I need an appointment", "What is your name?");

  const second = beginWebTurn(callId, "en");
  assert.equal(second.state.intent, "randevu");
  assert.equal(second.state.name, null);
  assert.equal(second.history.length, 2);
  abortWebTurn(second);
});

test("aynı görüşmedeki paralel tur kapalı reddedilir", () => {
  resetWebSessionsForTests();
  const callId = "22222222-2222-4222-8222-222222222222";
  const lease = beginWebTurn(callId, "tr");
  assert.throws(() => beginWebTurn(callId, "tr"), /halen işleniyor/i);
  abortWebTurn(lease);
  assert.doesNotThrow(() => abortWebTurn(beginWebTurn(callId, "tr")));
});

test("istemci turnId tekrarı reddedilir ve kullanım kimliği sunucu tarafından üretilir", () => {
  resetWebSessionsForTests();
  const callId = "33333333-3333-4333-8333-333333333333";
  const clientTurnId = "44444444-4444-4444-8444-444444444444";
  const first = beginWebTurn(callId, "en", clientTurnId);
  assert.notEqual(first.usageTurnId, clientTurnId);
  commitWebTurn(first, first.state, "hello", "hello");
  assert.throws(() => beginWebTurn(callId, "en", clientTurnId), /daha önce işlendi/i);

  const retryable = beginWebTurn(callId, "en", "55555555-5555-4555-8555-555555555555");
  abortWebTurn(retryable);
  assert.doesNotThrow(() => abortWebTurn(beginWebTurn(
    callId,
    "en",
    "55555555-5555-4555-8555-555555555555",
  )));
});
