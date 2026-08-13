export const supportedLocales = ["en", "tr", "es", "de", "fr", "it", "pt", "nl", "pl", "ru"] as const;

export type Locale = (typeof supportedLocales)[number];

export const localeMetadata: Record<Locale, {
  html: string;
  speech: string;
  transcription: string;
  label: string;
}> = {
  tr: { html: "tr", speech: "tr-TR", transcription: "tr", label: "Türkçe" },
  en: { html: "en", speech: "en-US", transcription: "en", label: "English" },
  es: { html: "es", speech: "es-ES", transcription: "es", label: "Español" },
  de: { html: "de", speech: "de-DE", transcription: "de", label: "Deutsch" },
  fr: { html: "fr", speech: "fr-FR", transcription: "fr", label: "Français" },
  it: { html: "it", speech: "it-IT", transcription: "it", label: "Italiano" },
  pt: { html: "pt", speech: "pt-BR", transcription: "pt", label: "Português" },
  nl: { html: "nl", speech: "nl-NL", transcription: "nl", label: "Nederlands" },
  pl: { html: "pl", speech: "pl-PL", transcription: "pl", label: "Polski" },
  ru: { html: "ru", speech: "ru-RU", transcription: "ru", label: "Русский" },
};

export function normalizeLocale(value: unknown, fallback: Locale = "en"): Locale {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  const exact = supportedLocales.find((locale) => normalized === locale || normalized.startsWith(`${locale}-`));
  if (exact) return exact;
  return fallback;
}
