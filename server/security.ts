import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

// ── GELİŞTİRME MODU İSTİSNASI (2026-08-03) ──────────────────────────────────
// Vite dev sunucusu sayfaya bir SATIR İÇİ önyükleme betiği (react-refresh
// preamble) enjekte eder. `script-src 'self'` bunu engelleyince React hiç
// çalışmıyor ve ekran BOMBOŞ kalıyordu — "@vitejs/plugin-react can't detect
// preamble" hatası. Sadece geliştirmede 'unsafe-inline' + websocket bağlantısı
// açılıyor; production paketinde satır içi betik yok, kural sıkı kalıyor.
const gelistirme = process.env.NODE_ENV !== "production";

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: gelistirme ? ["'self'", "'unsafe-inline'"] : ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://api.fontshare.com"],
      fontSrc: ["'self'", "https://cdn.fontshare.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: gelistirme ? ["'self'", "ws:", "wss:"] : ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
});

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Çok fazla istek gönderildi. Bir dakika sonra tekrar deneyin." },
});

export const turnLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.TURN_RATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Görüşme isteği sınırı aşıldı. Kısa bir süre sonra tekrar deneyin." },
});

function configuredOrigins() {
  return new Set(
    (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function sameOriginOnly(req: Request, res: Response, next: NextFunction) {
  const origin = req.get("origin");
  if (!origin) return next();

  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  const allowed = configuredOrigins();
  try {
    if ((host && new URL(origin).host === host) || allowed.has(origin)) return next();
  } catch {
    // Invalid origins are rejected below.
  }
  return res.status(403).json({ message: "Bu kaynaktan API isteğine izin verilmiyor." });
}

function safeSecretMatch(candidate: string, expected: string) {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length
    && timingSafeEqual(candidateBuffer, expectedBuffer);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return res.status(503).json({ message: "Yönetim API'si yapılandırılmamış." });
  }
  const authorization = req.get("authorization") || "";
  const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!candidate || !safeSecretMatch(candidate, expected)) {
    return res.status(401).json({ message: "Yetkisiz istek." });
  }
  return next();
}
