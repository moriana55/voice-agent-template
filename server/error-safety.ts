export function publicStreamErrorMessage(
  error: unknown,
  production = process.env.NODE_ENV === "production",
) {
  if (production) return "Görüşme akışı güvenli biçimde sonlandırıldı. Lütfen tekrar deneyin.";
  return error instanceof Error ? error.message : "Beklenmeyen streaming hatası.";
}
