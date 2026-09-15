import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { HOST, PORT, PUBLIC_URL, REPO_ROOT } from "./config.js";
import modelsRoutes from "./routes/models.js";
import generateRoutes from "./routes/generate.js";
import agentRoutes from "./routes/agent.js";
import runRoutes from "./routes/runs.js";
import { basicAuth, assertAuthConfigured } from "./middleware/basicAuth.js";
import { bootstrapRegistryIfEmpty } from "./services/registryService.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);          // correct client IPs behind a reverse proxy

// ---------------------------------------------------------------------------
// CORS
// Previously `cors()` allowed every origin, so any website could call this API
// with the browser's stored credentials. Allowed origins are now explicit.
// Set CORS_ORIGINS to a comma-separated list; PUBLIC_URL is included
// automatically. Same-origin requests (the bundled UI) send no Origin header
// and are always permitted.
// ---------------------------------------------------------------------------
const allowedOrigins = new Set(
  [
    ...String(process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    PUBLIC_URL,
  ].filter(Boolean) as string[],
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);        // same-origin or curl
      if (allowedOrigins.has(origin)) return callback(null, true);
      if (process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);                   // local dev front end
      }
      return callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "10mb" }));

// ---------------------------------------------------------------------------
// Health endpoint is registered BEFORE basicAuth and is also listed as a public
// path inside the middleware, so container and load-balancer probes never need
// credentials. It deliberately reports no configuration detail.
// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(basicAuth);

// authenticated diagnostics, for operators rather than probes
app.get("/api/status", (_req, res) => {
  res.json({
    status: "ok",
    host: HOST,
    port: PORT,
    publicUrl: PUBLIC_URL,
    ui: existsSync(path.join(REPO_ROOT, "client", "dist")),
    nodeEnv: process.env.NODE_ENV ?? "development",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", modelsRoutes);
app.use("/api", generateRoutes);
app.use("/api", agentRoutes);
app.use("/api", runRoutes);

const clientDist = path.join(REPO_ROOT, "client", "dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// ---------------------------------------------------------------------------
// Error handler: returns a useful message without leaking stack traces to
// clients in production.
// ---------------------------------------------------------------------------
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const isCors = err.message?.startsWith("Origin not allowed");
  const status = isCors ? 403 : 500;
  console.error("[error]", err.message);
  res.status(status).json({
    error: isCors ? err.message : "Internal server error.",
    ...(process.env.NODE_ENV !== "production" ? { detail: err.message } : {}),
  });
});

async function main() {
  // refuses to boot a production deployment with no way to authenticate
  assertAuthConfigured();

  await bootstrapRegistryIfEmpty();

  const server = app.listen(PORT, HOST, () => {
    console.log(`SynthGen server listening on http://${HOST}:${PORT}`);
    if (HOST === "0.0.0.0") {
      console.log(
        `LAN / remote access: set PUBLIC_URL or open http://<this-machine-ip>:${PORT}`,
      );
    }
    console.log(
      existsSync(clientDist)
        ? `UI served from ${clientDist}`
        : "UI not built — run: cd client && npm install && npm run build",
    );
  });

  // let in-flight generations finish instead of cutting them off mid-write
  const shutdown = (signal: string) => {
    console.log(`[${signal}] shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 30_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
