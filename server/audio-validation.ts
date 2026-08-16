export const supportedAudioMimeTypes = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
]);

function normalizedMime(value: string) {
  return value.split(";", 1)[0].trim().toLowerCase();
}

export function hasSupportedAudioSignature(buffer: Buffer, mimeType: string) {
  const mime = normalizedMime(mimeType);
  if (!supportedAudioMimeTypes.has(mime)) return false;
  if (["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(mime)) {
    return buffer.length >= 12
      && buffer.toString("ascii", 0, 4) === "RIFF"
      && buffer.toString("ascii", 8, 12) === "WAVE";
  }
  if (mime === "audio/webm") {
    return buffer.length >= 4
      && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }
  if (mime === "audio/ogg") return buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "OggS";
  if (mime === "audio/mpeg" || mime === "audio/mp3") {
    return buffer.length >= 3 && (
      buffer.toString("ascii", 0, 3) === "ID3"
      || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    );
  }
  return buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp";
}

export function assertValidUploadedAudio(file?: { buffer: Buffer; mimetype: string } | null) {
  if (!file) return;
  if (!hasSupportedAudioSignature(file.buffer, file.mimetype)) {
    throw Object.assign(new Error("Ses dosyası türü veya içeriği desteklenmiyor."), { status: 400 });
  }
}
