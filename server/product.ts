function text(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

function nonNegativeNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export type PublicProductConfig = ReturnType<typeof publicProductConfig>;

export function publicProductConfig() {
  return {
    productName: text("PUBLIC_PRODUCT_NAME", "VoiceOps Studio"),
    agentName: text("PUBLIC_AGENT_NAME", "Nova"),
    businessName: text("PUBLIC_BUSINESS_NAME", "VoiceOps Studio"),
    tagline: text("PUBLIC_TAGLINE", "Global voice operations"),
    supportEmail: process.env.PUBLIC_SUPPORT_EMAIL?.trim() || null,
    privacyUrl: process.env.PUBLIC_PRIVACY_URL?.trim() || "/#/privacy",
    portfolioAttribution: process.env.SHOW_PORTFOLIO_ATTRIBUTION !== "false",
    plan: {
      name: text("PLAN_NAME", "Managed Voice"),
      includedMinutes: nonNegativeNumber("PLAN_INCLUDED_MINUTES", 300),
      overageTryPerMinute: nonNegativeNumber("PLAN_OVERAGE_TRY_PER_MINUTE", 12),
      billingBasis: "active-voice-seconds" as const,
    },
  };
}

export function agentName() {
  return publicProductConfig().agentName;
}

export function commercialReadiness() {
  if (process.env.CUSTOMER_MODE !== "true") {
    return { enabled: false, ready: true, issues: [] as string[] };
  }

  const config = publicProductConfig();
  const issues: string[] = [];
  if (!process.env.PUBLIC_BUSINESS_NAME?.trim()) issues.push("PUBLIC_BUSINESS_NAME");
  if (!process.env.BUSINESS_CONTEXT?.trim()) issues.push("BUSINESS_CONTEXT");
  if (!config.supportEmail) issues.push("PUBLIC_SUPPORT_EMAIL");
  if (!process.env.PUBLIC_PRIVACY_URL?.trim()) issues.push("PUBLIC_PRIVACY_URL");
  if (!process.env.ADMIN_API_KEY?.trim()) issues.push("ADMIN_API_KEY");
  if (process.env.RECORD_STORAGE !== "disabled" && !process.env.DATA_ENCRYPTION_KEY?.trim()) {
    issues.push("DATA_ENCRYPTION_KEY");
  }
  if (nonNegativeNumber("USAGE_HARD_LIMIT_MINUTES", 0) <= 0) issues.push("USAGE_HARD_LIMIT_MINUTES");
  if (!process.env.FISH_AUDIO_API_KEY?.trim()) issues.push("FISH_AUDIO_API_KEY");
  if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.OPENAI_API_KEY?.trim()) {
    issues.push("ANTHROPIC_API_KEY|OPENAI_API_KEY");
  }
  if (!process.env.ALLOWED_ORIGINS?.trim()) issues.push("ALLOWED_ORIGINS");
  if (process.env.CRM_WEBHOOK_URL?.trim() && !process.env.CRM_WEBHOOK_TOKEN?.trim()) {
    issues.push("CRM_WEBHOOK_TOKEN");
  }
  if (process.env.CALENDAR_WEBHOOK_URL?.trim() && !process.env.CALENDAR_WEBHOOK_TOKEN?.trim()) {
    issues.push("CALENDAR_WEBHOOK_TOKEN");
  }
  if (process.env.TELEPHONY_RECORD_STORAGE === "enabled" && !process.env.TWILIO_AUTH_TOKEN?.trim()) {
    issues.push("TWILIO_AUTH_TOKEN");
  }

  return { enabled: true, ready: issues.length === 0, issues };
}
