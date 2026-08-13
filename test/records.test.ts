import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("tamamlanan çağrıyı şifreli ve tekil olarak kaydeder", async () => {
  process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "arama-records-"));
  process.env.DATA_ENCRYPTION_KEY = "test-only-encryption-key";
  delete process.env.CRM_WEBHOOK_URL;
  delete process.env.RECORD_STORAGE;

  const { deleteCallRecord, listCallRecords, recordCompletedCall, recordsStatus } = await import("../server/records");
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
  const records = await listCallRecords();

  assert.equal(recordsStatus().encrypted, true);
  assert.equal(first.saved, true);
  assert.equal(duplicate.saved, false);
  assert.equal(records.length, 1);
  assert.equal(records[0].phone, "05321234567");
  assert.equal(records[0].locale, "tr");
  assert.equal(await deleteCallRecord(records[0].id), true);
  assert.deepEqual(await listCallRecords(), []);
});
