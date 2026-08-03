import express, { type Request, Response, NextFunction } from "express";
import "dotenv/config";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { randomUUID } from "node:crypto";
import { apiLimiter, sameOriginOnly, securityHeaders } from "./security";

const app = express();
const httpServer = createServer(app);

if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "100kb", parameterLimit: 50 }));
app.use("/api", apiLimiter);
app.use("/api", sameOriginOnly);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  const requestId = req.get("x-request-id") || randomUUID();
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      console.log(JSON.stringify({
        level: "info",
        event: "http_request",
        requestId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: duration,
      }));
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = ["MulterError", "ZodError", "SyntaxError"].includes(err.name)
      ? 400
      : err.status || err.statusCode || 500;
    const message = status >= 500 && process.env.NODE_ENV === "production"
      ? "İstek işlenirken beklenmeyen bir hata oluştu."
      : err.message || "Internal Server Error";

    console.error(JSON.stringify({
      level: "error",
      event: "request_failed",
      status,
      name: err.name || "Error",
      message: err.message || "Internal Server Error",
    }));

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5177", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
