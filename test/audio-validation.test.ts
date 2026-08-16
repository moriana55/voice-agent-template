import test from "node:test";
import assert from "node:assert/strict";
import { assertValidUploadedAudio, hasSupportedAudioSignature } from "../server/audio-validation";

test("ses MIME etiketi ve dosya imzası birlikte doğrulanır", () => {
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0, "ascii");
  wav.write("WAVE", 8, "ascii");
  assert.equal(hasSupportedAudioSignature(wav, "audio/wav"), true);
  assert.doesNotThrow(() => assertValidUploadedAudio({ buffer: wav, mimetype: "audio/wav" }));

  const disguised = Buffer.from("<html>not audio</html>");
  assert.equal(hasSupportedAudioSignature(disguised, "audio/wav"), false);
  assert.throws(
    () => assertValidUploadedAudio({ buffer: disguised, mimetype: "audio/wav" }),
    /desteklenmiyor/i,
  );
  assert.equal(hasSupportedAudioSignature(wav, "audio/arbitrary"), false);
});
