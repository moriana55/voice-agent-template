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

const multilingualAppointments = [
  ["en", "I need an appointment tomorrow at 3 pm", "tomorrow", "15:00"],
  ["es", "Quiero una cita mañana a las 15:00", "mañana", "15:00"],
  ["de", "Ich brauche morgen um 15:00 einen Termin", "morgen", "15:00"],
  ["fr", "Je souhaite un rendez-vous demain à 15:00", "demain", "15:00"],
  ["it", "Vorrei un appuntamento domani alle 15:00", "domani", "15:00"],
  ["pt", "Quero um agendamento amanhã às 15:00", "amanhã", "15:00"],
  ["nl", "Ik wil morgen om 15:00 een afspraak", "morgen", "15:00"],
  ["pl", "Chcę umówić wizytę jutro o 15:00", "jutro", "15:00"],
  ["ru", "Я хочу записаться завтра в 15:00", "завтра", "15:00"],
] as const;

for (const [locale, phrase, date, time] of multilingualAppointments) {
  test(`${locale} randevu niyetini, tarihi ve saati çıkarır`, () => {
    const state = updateCallState(phrase, undefined, locale);
    assert.equal(state.intent, "randevu");
    assert.equal(state.requestedDate, date);
    assert.equal(state.requestedTime, time);
    assert.deepEqual(state.missingFields, ["name", "phone"]);
  });
}

test("İngilizce görüşmede isim ve uluslararası telefon numarasını tamamlar", () => {
  const first = updateCallState("I need pricing", undefined, "en");
  const named = updateCallState("My name is Jane Miller", first, "en");
  const completed = updateCallState("My number is +1 612 555 0199", named, "en");
  assert.equal(completed.name, "Jane Miller");
  assert.equal(completed.phone, "+16125550199");
  assert.equal(completed.completed, true);
  assert.match(demoReply("My number is +1 612 555 0199", [], completed, "en"), /everything/i);
});
