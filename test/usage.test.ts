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

  const { assertUsageAvailable, recordUsage, usageSummary } = await import("../server/usage");
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

  await recordUsage({
    callId: "call-two",
    source: "web",
    locale: "tr",
    inputSeconds: 65,
    reply: Array.from({ length: 140 }, () => "yanıt").join(" "),
  });
  const summary = await usageSummary();
  assert.equal(summary.calls, 2);
  assert.equal(summary.turns, 2);
  assert.ok(summary.activeMinutes >= 2);
  assert.ok(summary.estimatedOverageTry >= 12);
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
