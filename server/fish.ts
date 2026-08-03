function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function synthesizeFishBuffer(
  text: string,
  options: { signal?: AbortSignal; phoneOptimized?: boolean } = {},
) {
  if (!process.env.FISH_AUDIO_API_KEY) throw new Error("Fish Audio yapılandırılmamış.");
  const referenceId = process.env.FISH_AUDIO_REFERENCE_ID;
  const response = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}`,
      "Content-Type": "application/json",
      model: process.env.FISH_AUDIO_MODEL || "s2-pro",
    },
    body: JSON.stringify({
      text,
      format: "mp3",
      sample_rate: options.phoneOptimized ? 24_000 : 44_100,
      mp3_bitrate: options.phoneOptimized ? 64 : 128,
      chunk_length: 120,
      latency: "balanced",
      normalize: true,
      temperature: 0.35,
      top_p: 0.7,
      prosody: {
        speed: 1,
        volume: 0,
        normalize_loudness: true,
      },
      ...(referenceId ? { reference_id: referenceId } : {}),
    }),
    signal: withTimeout(options.signal, 30_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Fish Audio ${response.status}: ${detail.slice(0, 240)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
