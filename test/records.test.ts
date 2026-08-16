import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("tamamlanan çağrıyı şifreli ve tekil olarak kaydeder", async () => {
  process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "voiceops-records-"));
  process.env.DATA_ENCRYPTION_KEY = "test-only-encryption-key";
  delete process.env.CRM_WEBHOOK_URL;
  delete process.env.RECORD_STORAGE;

  const {
    deleteCallRecord,
    listCallRecords,
    recordCompletedCall,
    recordsStatus,
    resetRecordIdempotencyForTests,
  } = await import("../server/records");
  const state = {
    intent: "fiyat" as const,
    name: "Ayşe Yılmaz",
    phone: "05321234567",
    requestedDate: null,
    requestedTime: null,
    summary: "Fiyat talebi",
    missingFields: [],
    completed: true,
  };
  const first = await recordCompletedCall({
    callId: "test-call-1",
    source: "web",
    locale: "tr",
    state,
    transcript: "Telefonum 0532 123 45 67",
    history: [],
  });
  const duplicate = await recordCompletedCall({
    callId: "test-call-1",
    source: "web",
    locale: "tr",
    state,
    transcript: "tekrar",
    history: [],
  });
  resetRecordIdempotencyForTests();
  const duplicateAfterRestart = await recordCompletedCall({
    callId: "test-call-1",
    source: "web",
    locale: "tr",
    state,
    transcript: "yeniden başlatma sonrası tekrar",
    history: [],
  });
  const records = await listCallRecords();

  assert.equal(recordsStatus().encrypted, true);
  assert.equal(first.saved, true);
  assert.equal(duplicate.saved, false);
  assert.equal(duplicateAfterRestart.saved, false);
  assert.equal(records.length, 1);
  assert.equal(records[0].phone, "05321234567");
  assert.equal(records[0].locale, "tr");
  assert.equal(await deleteCallRecord(records[0].id), true);
  assert.deepEqual(await listCallRecords(), []);
});

test("bozuk retention ve yönetim limitleri güvenli varsayılana düşer veya reddedilir", async () => {
  const previous = process.env.RECORD_RETENTION_DAYS;
  try {
    process.env.RECORD_RETENTION_DAYS = "not-a-number";
    const { configuredRetentionDays, parseRecordLimit } = await import("../server/records");
    assert.equal(configuredRetentionDays(), 30);
    assert.equal(parseRecordLimit("500"), 500);
    assert.throws(() => parseRecordLimit("NaN"), /1 ile 500/i);
    assert.throws(() => parseRecordLimit("501"), /1 ile 500/i);
    assert.throws(() => parseRecordLimit(["10", "20"]), /1 ile 500/i);
  } finally {
    if (previous === undefined) delete process.env.RECORD_RETENTION_DAYS;
    else process.env.RECORD_RETENTION_DAYS = previous;
  }
});
