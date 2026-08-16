import type { Locale } from "@shared/i18n";
import { systemInstructions } from "./dil.js";
import OpenAI from "openai";
import { demoReply } from "@shared/call-logic";
import type { CallState, ConversationMessage } from "@shared/schema";
import { setProviderHealth } from "./provider-health";

function conversationPrompt(
  transcript: string,
  history: ConversationMessage[],
  state: CallState,
  locale: Locale,
) {
  const labels = locale === "tr"
    ? { customer: "Müşteri", agent: "Temsilci", context: "Doğrulanmış işletme bilgisi", state: "Görüşme durumu", rule: "Eksik alanlardan yalnızca birini doğal biçimde sor. Tamamlanan bilgiyi tekrar isteme." }
    : { customer: "Customer", agent: "Agent", context: "Verified business information", state: "Call state", rule: "Ask naturally for only one missing field. Never request information that is already complete." };
  const conversation = history
    .slice(-10)
    .map((item) => `${item.role === "user" ? labels.customer : labels.agent}: ${item.content}`)
    .join("\n");
  const businessContext = process.env.BUSINESS_CONTEXT?.trim();
  return `${businessContext ? `${labels.context}:\n${businessContext}\n` : ""}
${labels.state}: ${JSON.stringify(state)}
${labels.rule}
${conversation ? `${conversation}\n` : ""}${labels.customer}: ${transcript}\n${labels.agent}:`;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function generateAssistantReply(
  transcript: string,
  history: ConversationMessage[],
  state: CallState,
  locale: Locale,
  signal?: AbortSignal,
) {
  const demo = process.env.DEMO_MODE !== "false"
    || (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY);
  if (demo) return demoReply(transcript, history, state, locale);

  if (process.env.ANTHROPIC_API_KEY) {
    try {
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
          system: systemInstructions(locale),
          messages: [{ role: "user", content: conversationPrompt(transcript, history, state, locale) }],
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
      setProviderHealth("anthropic", true);
      return reply;
    } catch (error) {
      setProviderHealth("anthropic", false);
      throw error;
    }
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      instructions: systemInstructions(locale),
      input: conversationPrompt(transcript, history, state, locale),
      store: false,
    }, { signal: withTimeout(signal, 20_000) });
    setProviderHealth("openai", true);
    return response.output_text.trim();
  } catch (error) {
    setProviderHealth("openai", false);
    throw error;
  }
}
