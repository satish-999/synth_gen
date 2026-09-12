import { Router } from "express";
import { getRun, listRuns } from "../db/sqlite.js";
import { generate } from "../services/generationService.js";
import { parseModelRef, resolveModelRef } from "../services/registryService.js";

const router = Router();

router.get("/runs", (_req, res) => {
  const runs = listRuns().map((r) => ({
    runId: r.run_id,
    model: r.model_key,
    status: r.status,
    seed: r.seed,
    formats: JSON.parse(r.formats),
    targets: JSON.parse(r.targets),
    files: r.files ? JSON.parse(r.files) : [],
    createdAt: r.created_at,
  }));
  res.json({ runs });
});

/** Re-run a previous generation with the same model, tables, rows, seed, and formats. */
router.post("/runs/:runId/rerun", async (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found" });

  const parsed = parseModelRef(run.model_key);
  if (!parsed) return res.status(400).json({ error: "Invalid model key on stored run." });

  const ref = resolveModelRef(parsed.family, parsed.version);
  if (!ref) return res.status(404).json({ error: "Model version no longer in registry." });

  const targets = JSON.parse(run.targets) as Record<string, { rows: number | "derived" }>;
  const formats = JSON.parse(run.formats) as ("csv" | "xlsx")[];
  const tables = Object.keys(targets);
  const requestedRows: Record<string, number> = {};
  for (const [t, v] of Object.entries(targets)) {
    if (v.rows !== "derived") requestedRows[t] = v.rows;
  }

  try {
    const result = await generate({
      modelKey: ref.modelKey,
      modelPath: ref.modelPath,
      family: ref.family,
      version: ref.version,
      selectedTables: tables,
      requestedRows,
      seed: run.seed ?? 42,
      locale: run.locale ?? "en_US",
      formats,
    });
    res.status(result.status === "ERROR" ? 500 : 200).json({
      ...result,
      family: ref.family,
      version: ref.version,
      rerunOf: run.run_id,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
