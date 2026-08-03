import test from "node:test";
import assert from "node:assert/strict";
import { demoReply, updateCallState } from "../shared/call-logic";

test("randevu niyetini, tarihi ve konuşulan saati çıkarır", () => {
  const state = updateCallState("Yarın öğleden sonra saat üç için randevu istiyorum");
  assert.equal(state.intent, "randevu");
  assert.equal(state.requestedDate, "yarın");
  assert.equal(state.requestedTime, "15:00");
  assert.deepEqual(state.missingFields, ["name", "phone"]);
});

test("önceki durumu koruyup fiyat talebini tamamlar", () => {
  const first = updateCallState("Fiyat teklifi almak istiyorum");
  const named = updateCallState("Ben Ayşe Yılmaz", first);
  const completed = updateCallState("Telefonum 0532 123 45 67", named);
  assert.equal(completed.name, "Ayşe Yılmaz");
  assert.equal(completed.phone, "05321234567");
  assert.equal(completed.completed, true);
});

test("demo yanıtı eksik tek alanı ister", () => {
  const state = updateCallState("Teknik destek istiyorum");
  const reply = demoReply("Teknik destek istiyorum", [], state);
  assert.match(reply, /adınızı/i);
});

test("genel görüşmeyi yanlışlıkla tamamlanmış saymaz", () => {
  const state = updateCallState("Merhaba nasılsınız");
  assert.equal(state.intent, "genel");
  assert.equal(state.completed, false);
});
