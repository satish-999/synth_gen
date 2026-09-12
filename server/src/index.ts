import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { HOST, PORT, PUBLIC_URL, REPO_ROOT } from "./config.js";
import modelsRoutes from "./routes/models.js";
import generateRoutes from "./routes/generate.js";
import agentRoutes from "./routes/agent.js";
import runRoutes from "./routes/runs.js";
import { basicAuth } from "./middleware/basicAuth.js";
import { bootstrapRegistryIfEmpty } from "./services/registryService.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(basicAuth);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    host: HOST,
    port: PORT,
    publicUrl: PUBLIC_URL,
    ui: existsSync(path.join(REPO_ROOT, "client", "dist")),
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

async function main() {
  await bootstrapRegistryIfEmpty();
  app.listen(PORT, HOST, () => {
    console.log(`SynthGen server listening on http://${HOST}:${PORT}`);
    if (HOST === "0.0.0.0") {
      console.log(`LAN / remote access: set PUBLIC_URL or open http://<this-machine-ip>:${PORT}`);
    }
    if (existsSync(clientDist)) {
      console.log(`UI served from ${clientDist}`);
    } else {
      console.log("UI not built — run: cd client && npm install && npm run build");
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
