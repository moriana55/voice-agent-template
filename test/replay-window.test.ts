import test from "node:test";
import assert from "node:assert/strict";
import { ReplayWindow } from "../server/replay-window";

test("sağlayıcı replay penceresi paralel kopyayı reddeder ve tamamlanan cevabı tekrar kullanır", () => {
  const replay = new ReplayWindow<string>(1_000, 10);
  assert.deepEqual(replay.begin("request-1", 1_000), { cached: false });
  assert.throws(() => replay.begin("request-1", 1_001), /halen işleniyor/i);
  replay.commit("request-1", "<Response/>", 1_002);
  assert.deepEqual(replay.begin("request-1", 1_003), { cached: true, value: "<Response/>" });

  assert.deepEqual(replay.begin("request-2", 1_004), { cached: false });
  replay.abort("request-2");
  assert.deepEqual(replay.begin("request-2", 1_005), { cached: false });
});

test("replay cevabı TTL sonrasında yeniden işlenebilir", () => {
  const replay = new ReplayWindow<string>(100, 10);
  replay.begin("request-1", 1_000);
  replay.commit("request-1", "done", 1_001);
  assert.deepEqual(replay.begin("request-1", 1_102), { cached: false });
});
