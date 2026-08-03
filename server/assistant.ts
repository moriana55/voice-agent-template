import OpenAI from "openai";
import { demoReply } from "@shared/call-logic";
import type { CallState, ConversationMessage } from "@shared/schema";

const SYSTEM_PROMPT = `Sen Türkçe konuşan profesyonel bir çağrı merkezi elemanısın.
Kısa, doğal ve sıcak konuş. Bir seferde en fazla iki kısa cümle kur.
Bilmediğin müşteri veya şirket bilgisini uydurma; gerektiğinde temsilciye aktaracağını söyle.
Kullanıcının talebini önce anladığını göster, sonra net bir sonraki adım öner.`;

function conversationPrompt(
  transcript: string,
  history: ConversationMessage[],
  state: CallState,
) {
  const conversation = history
    .slice(-10)
    .map((item) => `${item.role === "user" ? "Müşteri" : "Temsilci"}: ${item.content}`)
    .join("\n");
  const businessContext = process.env.BUSINESS_CONTEXT?.trim();
  return `${businessContext ? `Doğrulanmış işletme bilgisi:\n${businessContext}\n` : ""}
Görüşme durumu: ${JSON.stringify(state)}
Eksik alanlardan yalnızca birini doğal biçimde sor. Tamamlanan bilgiyi tekrar isteme.
${conversation ? `${conversation}\n` : ""}Müşteri: ${transcript}\nTemsilci:`;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function generateAssistantReply(
  transcript: string,
  history: ConversationMessage[],
  state: CallState,
  signal?: AbortSignal,
) {
  const demo = process.env.DEMO_MODE !== "false"
    || (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY);
  if (demo) return demoReply(transcript, history, state);

  if (process.env.ANTHROPIC_API_KEY) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 180,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: conversationPrompt(transcript, history, state) }],
      }),
      signal: withTimeout(signal, 20_000),
    });
    if (!response.ok) throw new Error(`Claude API ${response.status} döndürdü.`);
    const result = await response.json() as { content?: Array<{ type: string; text?: string }> };
    const reply = result.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text || "")
      .join("\n")
      .trim();
    if (!reply) throw new Error("Claude API boş yanıt döndürdü.");
    return reply;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    instructions: SYSTEM_PROMPT,
    input: conversationPrompt(transcript, history, state),
    store: false,
  }, { signal: withTimeout(signal, 20_000) });
  return response.output_text.trim();
}
