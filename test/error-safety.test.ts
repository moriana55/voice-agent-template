import test from "node:test";
import assert from "node:assert/strict";
import { publicStreamErrorMessage } from "../server/error-safety";

test("production stream hatası iç ayrıntıları kullanıcıya sızdırmaz", () => {
  const internal = new Error("provider token invalid at /private/data/file.jsonl");
  assert.doesNotMatch(publicStreamErrorMessage(internal, true), /token|private|jsonl/i);
  assert.equal(publicStreamErrorMessage(internal, false), internal.message);
});
