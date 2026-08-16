import { z } from "zod";

export const localeSchema = z.enum(["en", "tr", "es", "de", "fr", "it", "pt", "nl", "pl", "ru"]);

export const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

export const callStateSchema = z.object({
  intent: z.enum(["randevu", "fiyat", "destek", "genel"]).default("genel"),
  name: z.string().max(120).nullable().default(null),
  phone: z.string().max(30).nullable().default(null),
  requestedDate: z.string().max(80).nullable().default(null),
  requestedTime: z.string().max(30).nullable().default(null),
  summary: z.string().max(500).default("Yeni görüşme"),
  missingFields: z.array(z.enum(["name", "phone", "requestedDate", "requestedTime"])).default([]),
  completed: z.boolean().default(false),
});

export const turnRequestSchema = z.object({
  callId: z.string().uuid().optional(),
  turnId: z.string().uuid().optional(),
  noticeAcknowledged: z.literal(true),
  storageConsent: z.boolean().default(false),
  locale: localeSchema.default("en"),
  text: z.string().max(4000).optional(),
  history: z.array(messageSchema).max(20).default([]),
  state: callStateSchema.optional(),
});

export const outboundCallRequestSchema = z.object({
  to: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Telefon numarası E.164 biçiminde olmalı."),
  locale: localeSchema.default("en"),
});

export const checkoutSessionRequestSchema = z.object({
  email: z.email("Geçerli bir e-posta adresi girin."),
});

export const integrationIdSchema = z.enum([
  "twilio",
  "googleCalendar",
  "hubspot",
  "stripe",
  "genericCrmWebhook",
  "genericCalendarWebhook",
]);

export type ConversationMessage = z.infer<typeof messageSchema>;
export type CallState = z.infer<typeof callStateSchema>;
export type TurnRequest = z.infer<typeof turnRequestSchema>;
export type OutboundCallRequest = z.infer<typeof outboundCallRequestSchema>;
export type CheckoutSessionRequest = z.infer<typeof checkoutSessionRequestSchema>;
export type IntegrationId = z.infer<typeof integrationIdSchema>;
