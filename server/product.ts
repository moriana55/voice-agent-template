import { safePrivacyUrl, safePublicBaseUrl, safeWebhookUrl } from "./url-security";

function text(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

function nonNegativeNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function invalidInteger(name: string, minimum: number, maximum: number) {
  const configured = process.env[name]?.trim();
  if (!configured) return false;
  const value = Number(configured);
  return !Number.isInteger(value) || value < minimum || value > maximum;
}

function validConfiguredOrigins(value: string) {
  const origins = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!origins.length) return false;
  return origins.every((origin) => {
    try {
      const parsed = new URL(origin);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
      return ["http:", "https:"].includes(parsed.protocol)
        && (parsed.protocol === "https:" || loopback)
        && !parsed.username && !parsed.password
        && !parsed.search && !parsed.hash
        && ["", "/"].includes(parsed.pathname);
    } catch {
      return false;
    }
  });
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
  if (process.env.WEB_SESSION_STORAGE !== "encrypted-file") {
    issues.push("WEB_SESSION_STORAGE=encrypted-file");
  }
  if (!process.env.WEB_SESSION_TTL_MINUTES?.trim()) issues.push("WEB_SESSION_TTL_MINUTES");
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

  const integrationGroups = [
    { trigger: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"], required: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "PUBLIC_BASE_URL"] },
    { trigger: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CALENDAR_ID"], required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CALENDAR_ID"] },
    { trigger: ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID", "STRIPE_WEBHOOK_SECRET"], required: ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID", "STRIPE_WEBHOOK_SECRET", "PUBLIC_BASE_URL"] },
  ];
  for (const group of integrationGroups) {
    if (group.trigger.some((name) => process.env[name]?.trim())) {
      for (const name of group.required) if (!process.env[name]?.trim() && !issues.includes(name)) issues.push(name);
    }
  }

  return { enabled: true, ready: issues.length === 0, issues };
}

export function deploymentSafetyIssues() {
  if (process.env.NODE_ENV !== "production") return [] as string[];
  const issues = new Set<string>();
  const liveProvidersConfigured = Boolean(
    process.env.FISH_AUDIO_API_KEY?.trim()
    || process.env.ANTHROPIC_API_KEY?.trim()
    || process.env.OPENAI_API_KEY?.trim(),
  );
  if (process.env.RECORD_STORAGE !== "disabled" && !process.env.DATA_ENCRYPTION_KEY?.trim()) {
    issues.add("DATA_ENCRYPTION_KEY|RECORD_STORAGE=disabled");
  }
  if (!["memory", "encrypted-file"].includes(process.env.WEB_SESSION_STORAGE || "memory")) {
    issues.add("WEB_SESSION_STORAGE(memory|encrypted-file)");
  }
  if (process.env.WEB_SESSION_STORAGE === "encrypted-file" && !process.env.DATA_ENCRYPTION_KEY?.trim()) {
    issues.add("DATA_ENCRYPTION_KEY|WEB_SESSION_STORAGE=memory");
  }
  if (process.env.DATA_ENCRYPTION_KEY?.trim() && process.env.DATA_ENCRYPTION_KEY.trim().length < 32) {
    issues.add("DATA_ENCRYPTION_KEY(min 32 chars)");
  }
  if (process.env.ADMIN_API_KEY?.trim() && process.env.ADMIN_API_KEY.trim().length < 32) {
    issues.add("ADMIN_API_KEY(min 32 chars)");
  }
  for (const [urlName, tokenName] of [
    ["CRM_WEBHOOK_URL", "CRM_WEBHOOK_TOKEN"],
    ["CALENDAR_WEBHOOK_URL", "CALENDAR_WEBHOOK_TOKEN"],
  ] as const) {
    if (process.env[urlName]?.trim() && !process.env[tokenName]?.trim()) {
      issues.add(tokenName);
    }
    if (process.env[urlName]?.trim() && process.env[tokenName]?.trim()
      && process.env[tokenName]!.trim().length < 32) {
      issues.add(`${tokenName}(min 32 chars)`);
    }
    if (process.env[urlName]?.trim()) {
      try {
        safeWebhookUrl(process.env[urlName]!);
      } catch {
        issues.add(`${urlName}(invalid or not allowlisted)`);
      }
    }
  }
  if (process.env.PUBLIC_BASE_URL?.trim()) {
    try {
      safePublicBaseUrl(process.env.PUBLIC_BASE_URL);
    } catch {
      issues.add("PUBLIC_BASE_URL(HTTPS origin required)");
    }
  }
  if (process.env.PUBLIC_PRIVACY_URL?.trim()) {
    try {
      safePrivacyUrl(process.env.PUBLIC_PRIVACY_URL);
    } catch {
      issues.add("PUBLIC_PRIVACY_URL(invalid scheme)");
    }
  }
  if (process.env.ALLOWED_ORIGINS?.trim()
    && !validConfiguredOrigins(process.env.ALLOWED_ORIGINS)) {
    issues.add("ALLOWED_ORIGINS(valid origins required)");
  }
  for (const [name, minimum, maximum] of [
    ["RECORD_RETENTION_DAYS", 1, 3_650],
    ["RECORD_PRUNE_INTERVAL_MS", 60_000, 86_400_000],
    ["TURN_RATE_LIMIT", 1, 10_000],
    ["TURN_MAX_CONCURRENCY", 1, 1_000],
    ["WEB_SESSION_LIMIT", 1, 1_000_000],
    ["WEB_SESSION_TTL_MINUTES", 5, 1_440],
    ["WEB_SESSION_PRUNE_INTERVAL_MS", 60_000, 3_600_000],
    ["APPOINTMENT_DURATION_MINUTES", 5, 240],
    ["GRACEFUL_SHUTDOWN_MS", 1_000, 30_000],
    ["PORT", 1, 65_535],
  ] as const) {
    if (invalidInteger(name, minimum, maximum)) {
      issues.add(`${name}(integer ${minimum}-${maximum})`);
    }
  }
  if (process.env.BUSINESS_TIME_ZONE?.trim()) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: process.env.BUSINESS_TIME_ZONE }).format();
    } catch {
      issues.add("BUSINESS_TIME_ZONE(valid IANA time zone required)");
    }
  }
  if (liveProvidersConfigured && nonNegativeNumber("USAGE_HARD_LIMIT_MINUTES", 0) <= 0) {
    issues.add("USAGE_HARD_LIMIT_MINUTES");
  }
  if (liveProvidersConfigured && !process.env.ALLOWED_ORIGINS?.trim()) {
    issues.add("ALLOWED_ORIGINS");
  }
  if (process.env.WEB_REPLICA_COUNT !== "1") {
    issues.add("WEB_REPLICA_COUNT=1 (shared session store required for scaling)");
  }
  const commercial = commercialReadiness();
  if (commercial.enabled) commercial.issues.forEach((issue) => issues.add(issue));
  return [...issues];
}

export function assertProductionConfiguration() {
  const issues = deploymentSafetyIssues();
  if (issues.length) {
    throw new Error(`Güvensiz production yapılandırması: ${issues.join(", ")}`);
  }
}

export function publicReadinessPayload<T extends { ready: boolean }>(details: T) {
  return process.env.NODE_ENV === "production" ? { ready: details.ready } : details;
}
