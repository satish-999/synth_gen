import { Router } from "express";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { getModelObjects } from "../services/modelService.js";
import {
  generate,
  zipRun,
  type OutputFormat,
} from "../services/generationService.js";
import { getRun } from "../db/sqlite.js";
import {
  parseModelRef,
  resolveModelRef,
  modelKey,
} from "../services/registryService.js";

const router = Router();
const VALID_FORMATS: OutputFormat[] = ["csv", "xlsx"];

function resolveFromBody(body: Record<string, unknown>): ReturnType<typeof resolveModelRef> {
  if (body.family && body.version != null) {
    return resolveModelRef(String(body.family), Number(body.version));
  }
  if (body.model) {
    const parsed = parseModelRef(String(body.model));
    if (parsed) return resolveModelRef(parsed.family, parsed.version);
  }
  return null;
}

/** Start a generation run — bound to one registry model version. */
router.post("/generate", async (req, res) => {
  const body = req.body ?? {};
  const {
    tables,
    rows = {},
    seed = 42,
    locale = "en_US",
    format = ["csv", "xlsx"],
  } = body;

  const ref = resolveFromBody(body);
  if (!ref) {
    return res.status(400).json({
      error: "Unknown model. Provide { family, version } or { model: 'retail@v1' }.",
    });
  }
  if (!Array.isArray(tables) || tables.length === 0) {
    return res.status(400).json({ error: "'tables' must be a non-empty array." });
  }
  const formats = (Array.isArray(format) ? format : [format]).filter((f) =>
    VALID_FORMATS.includes(f),
  ) as OutputFormat[];
  if (formats.length === 0) {
    return res
      .status(400)
      .json({ error: "'format' must include at least one of: csv, xlsx." });
  }

  try {
    const result = await generate({
      modelKey: ref.modelKey,
      modelPath: ref.modelPath,
      family: ref.family,
      version: ref.version,
      selectedTables: tables,
      requestedRows: rows,
      seed: Number(seed),
      locale: String(locale),
      formats,
    });
    res.status(result.status === "ERROR" ? 500 : 200).json({
      ...result,
      family: ref.family,
      version: ref.version,
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    res.status(status).json({ error: (e as Error).message });
  }
});

/** Poll a run's status/report. */
router.get("/generate/:runId", (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json({
    runId: run.run_id,
    model: run.model_key,
    status: run.status,
    seed: run.seed,
    targets: JSON.parse(run.targets),
    formats: JSON.parse(run.formats),
    files: run.files ? JSON.parse(run.files) : [],
    report: run.report ? JSON.parse(run.report) : null,
    error: run.error,
    createdAt: run.created_at,
  });
});

/** Download all produced files as a zip — only if the run PASSED. */
router.get("/generate/:runId/download", (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (run.status !== "PASS") {
    return res
      .status(409)
      .json({ error: `Run status is ${run.status}; downloads are blocked.` });
  }
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${run.run_id}.zip"`,
  );
  zipRun(run.output_path!, res);
});

/** Download a single produced file — only if the run PASSED. */
router.get("/generate/:runId/files/:name", (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (run.status !== "PASS") {
    return res
      .status(409)
      .json({ error: `Run status is ${run.status}; downloads are blocked.` });
  }
  const allowed: string[] = run.files ? JSON.parse(run.files) : [];
  const name = path.basename(req.params.name);
  if (!allowed.includes(name)) {
    return res.status(404).json({ error: "File not available for this run." });
  }
  const filePath = path.join(run.output_path!, name);
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: "File missing on disk." });
  }
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  createReadStream(filePath).pipe(res);
});

export default router;
