import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("kullanımı tekil ölçer, özetler ve sert kotada kapanır", async () => {
  process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "voiceops-usage-"));
  process.env.DATA_ENCRYPTION_KEY = "test-only-meter-key";
  process.env.PLAN_INCLUDED_MINUTES = "1";
  process.env.PLAN_OVERAGE_TRY_PER_MINUTE = "12";
  process.env.USAGE_HARD_LIMIT_MINUTES = "2";

  const {
    assertUsageAvailable,
    assertUsageTurnAvailable,
    recordAbandonedUsage,
    recordUsage,
    releaseUsageReservation,
    resetUsageIdempotencyForTests,
    reserveUsage,
    usageSummary,
  } = await import("../server/usage");
  const reservation = await reserveUsage(0);
  assert.ok(reservation);
  await assert.rejects(() => reserveUsage(0), /yeterli değil/i);
  releaseUsageReservation(reservation);
  process.env.USAGE_HARD_LIMIT_MINUTES = "10";
  const abandonedReservation = await reserveUsage(0);
  assert.ok(abandonedReservation);
  const abandoned = await recordAbandonedUsage({
    turnId: "8f571e11-5948-4bf1-b7ab-4f5859c130eb",
    callId: "call-abandoned",
    source: "web",
    locale: "tr",
    reservationId: abandonedReservation,
  });
  assert.equal(abandoned?.billableSeconds, 0);
  assert.equal(abandoned?.quotaSeconds, 120);
  assert.equal(abandoned?.abandoned, true);
  const turnId = "3e611e11-5948-4bf1-b7ab-4f5859c130eb";
  const first = await recordUsage({
    turnId,
    callId: "call-one",
    source: "web",
    locale: "tr",
    inputSeconds: 8,
    reply: "Elbette, size hemen yardımcı olayım.",
  });
  const duplicate = await recordUsage({
    turnId,
    callId: "call-one",
    source: "web",
    locale: "tr",
    reply: "Bu kayıt iki kez yazılmamalı.",
  });
  assert.ok(first && first.billableSeconds >= 9);
  assert.equal(duplicate, null);
  resetUsageIdempotencyForTests();
  const duplicateAfterRestart = await recordUsage({
    turnId,
    callId: "call-one",
    source: "web",
    locale: "tr",
    reply: "Bu kalıcı tekilleştirme nedeniyle yazılmamalı.",
  });
  assert.equal(duplicateAfterRestart, null);
  await assert.rejects(() => assertUsageTurnAvailable(turnId), /daha önce işlendi/i);

  await recordUsage({
    callId: "call-two",
    source: "web",
    locale: "tr",
    inputSeconds: 65,
    reply: Array.from({ length: 140 }, () => "yanıt").join(" "),
  });
  const summary = await usageSummary();
  assert.equal(summary.calls, 3);
  assert.equal(summary.turns, 3);
  assert.ok(summary.activeMinutes >= 2);
  assert.ok(summary.estimatedOverageTry >= 12);
  process.env.USAGE_HARD_LIMIT_MINUTES = "2";
  await assert.rejects(assertUsageAvailable, /kota/i);
});

test("WAV süresini sunucu tarafında başlıktan ölçer", async () => {
  const { wavDurationSeconds } = await import("../server/usage");
  const wav = Buffer.alloc(44 + 32_000);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt32LE(32_000, 40);
  assert.equal(wavDurationSeconds(wav), 1);
});
