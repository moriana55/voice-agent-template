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

let activeTurns = 0;

function maximumConcurrentTurns() {
  const configured = Number(process.env.TURN_MAX_CONCURRENCY || 4);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 4;
}

export function turnConcurrencyLimiter(_req: Request, res: Response, next: NextFunction) {
  if (activeTurns >= maximumConcurrentTurns()) {
    res.setHeader("Retry-After", "2");
    return res.status(429).json({ message: "Sistem görüşme kapasitesi dolu. Lütfen kısa süre sonra tekrar deneyin." });
  }
  activeTurns += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeTurns = Math.max(0, activeTurns - 1);
  };
  res.once("finish", release);
  res.once("close", release);
  try {
    return next();
  } catch (error) {
    release();
    throw error;
  }
}

function configuredOrigins() {
  const origins = new Set<string>();
  for (const value of (process.env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Invalid configured origins never grant access.
    }
  }
  return origins;
}

export function sameOriginOnly(req: Request, res: Response, next: NextFunction) {
  const origin = req.get("origin");
  if (!origin) return next();

  const trustProxy = process.env.TRUST_PROXY === "true";
  const forwardedHost = trustProxy ? req.get("x-forwarded-host")?.split(",")[0]?.trim() : undefined;
  const forwardedProto = trustProxy ? req.get("x-forwarded-proto")?.split(",")[0]?.trim() : undefined;
  const host = forwardedHost || req.get("host");
  const allowed = configuredOrigins();
  try {
    const parsedOrigin = new URL(origin).origin;
    const requestOrigin = host ? new URL(`${forwardedProto || req.protocol}://${host}`).origin : null;
    if ((requestOrigin && parsedOrigin === requestOrigin) || allowed.has(parsedOrigin)) return next();
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
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
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
