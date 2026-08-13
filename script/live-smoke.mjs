const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:5193";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ready = await fetch(`${baseUrl}/api/health/ready`);
const readyPayload = await ready.json();
assert(ready.status === 200 && readyPayload.ready === true, `service not ready: ${ready.status}`);

const body = new FormData();
body.set("callId", crypto.randomUUID());
body.set("consent", "true");
body.set("locale", "tr");
body.set("text", "Merhaba, fiyat bilgisi almak istiyorum.");
body.set("history", "[]");
body.set("state", "{}");

const response = await fetch(`${baseUrl}/api/turn/stream`, { method: "POST", body });
assert(response.status === 200, `stream status ${response.status}`);
assert(response.body, "stream body missing");

const reader = response.body.getReader();
const decoder = new TextDecoder();
const events = [];
let buffer = "";
while (true) {
  const { value, done } = await reader.read();
  buffer += decoder.decode(value, { stream: !done });
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || "";
  for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
  if (done) break;
}
if (buffer.trim()) events.push(JSON.parse(buffer));

const types = new Set(events.map((event) => event.type));
const doneEvent = events.find((event) => event.type === "done");
assert(types.has("meta"), "meta event missing");
assert(types.has("text_delta"), "text stream missing");
assert(types.has("audio"), "Fish audio stream missing");
assert(doneEvent?.reply, "completed reply missing");
assert(Number.isFinite(doneEvent?.firstAudioMs), "first audio latency missing");
assert(!doneEvent?.audioWarning, `audio warning: ${doneEvent?.audioWarning}`);

console.log(JSON.stringify({
  ok: true,
  mode: events.find((event) => event.type === "meta")?.mode,
  eventTypes: [...types],
  firstAudioMs: doneEvent.firstAudioMs,
  latencyMs: doneEvent.latencyMs,
}));
