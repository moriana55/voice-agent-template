import { isIP } from "node:net";

function allowedWebhookHosts() {
  return new Set(
    (process.env.INTEGRATION_WEBHOOK_ALLOWED_HOSTS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isPrivateAddress(address: string) {
  const unwrapped = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  if (isIP(unwrapped) === 4) {
    const [a, b] = unwrapped.split(".").map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  if (isIP(unwrapped) === 6) {
    const normalized = unwrapped.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      const tail = normalized.slice(7);
      if (isIP(tail) === 4) return isPrivateAddress(tail);
      const groups = tail.split(":");
      if (groups.length === 2 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
        const high = Number.parseInt(groups[0], 16);
        const low = Number.parseInt(groups[1], 16);
        return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      }
    }
    return normalized === "::" || normalized === "::1"
      || normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff");
  }
  return false;
}

export function safeWebhookUrl(url: string, production = process.env.NODE_ENV === "production") {
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error("Webhook adresi kullanıcı bilgisi veya fragment içeremez.");
  }
  if (production && parsed.protocol !== "https:") {
    throw new Error("Production webhook adresi HTTPS olmalı.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (production && (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || isPrivateAddress(hostname)
  )) {
    throw new Error("Webhook adresi özel veya yerel ağa yönlenemez.");
  }
  if (production && !allowedWebhookHosts().has(hostname)) {
    throw new Error("Webhook host'u production allowlist içinde değil.");
  }
  return parsed.toString();
}

export function safePublicBaseUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
    throw new Error("PUBLIC_BASE_URL yalnızca HTTPS origin olmalı.");
  }
  return parsed.origin;
}

export function safePrivacyUrl(value: string) {
  if (value.startsWith("/")) {
    if (!value.startsWith("//") && !value.includes("\\")
      && !/[\u0000-\u001f\u007f]/.test(value)) return value;
    throw new Error("PUBLIC_PRIVACY_URL relative path veya HTTPS URL olmalı.");
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
    return parsed.toString();
  } catch {
    throw new Error("PUBLIC_PRIVACY_URL relative path veya HTTPS URL olmalı.");
  }
}

export function safeStripeCheckoutUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.hostname !== "checkout.stripe.com"
    || parsed.username || parsed.password) {
    throw new Error("Stripe Checkout güvenli olmayan bir yönlendirme adresi döndürdü.");
  }
  return parsed.toString();
}
