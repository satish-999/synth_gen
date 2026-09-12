import { Router } from "express";
import multer from "multer";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { DRAFTS_PATH, UPLOADS_PATH, ANTHROPIC_API_KEY } from "../config.js";
import { parseSchemaFile } from "../services/schemaParser.js";
import {
  generateCreateModel,
  generateUpdateModel,
  generateRewriteModel,
  buildDraftWorkbook,
} from "../services/agentService.js";
import { readWorkbook } from "../services/workbookBuilder.js";
import {
  getAgentJob,
  insertAgentJob,
  listAgentJobs,
  updateAgentJob,
} from "../db/agentJobs.js";
import { registerVersion, getFamily, workbookPath, resolveModelRef } from "../services/registryService.js";
import { enrichDiff, type AgentDiff } from "../services/diffService.js";
import { refreshDraftArtifacts, loadDiff } from "../services/draftRefresh.js";
import { runPython } from "../utils/python.js";
import { MODEL_OBJECTS } from "../config.js";

mkdirSync(UPLOADS_PATH, { recursive: true });
mkdirSync(DRAFTS_PATH, { recursive: true });

const upload = multer({ dest: UPLOADS_PATH, limits: { fileSize: 10 * 1024 * 1024 } });
const draftUpload = multer({ dest: UPLOADS_PATH, limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

type AgentMode = "CREATE" | "UPDATE" | "REWRITE";

function jobIdFromReq(req: { params: { id?: string | string[] } }): string {
  const id = req.params.id;
  return Array.isArray(id) ? (id[0] ?? "") : (id ?? "");
}

function jobResponse(job: NonNullable<ReturnType<typeof getAgentJob>>, objects?: Record<string, unknown>) {
  const manifest = job.manifest ? JSON.parse(job.manifest) : null;
  const diff = job.diff ? (JSON.parse(job.diff) as AgentDiff) : null;
  const enrichedDiff = diff ? enrichDiff(diff, manifest, objects ? { tables: objects as never } : null) : null;

  return {
    jobId: job.job_id,
    mode: job.mode,
    familyId: job.family_id,
    displayName: job.display_name,
    baseVersion: job.base_version,
    status: job.status,
    agentSource: job.agent_source,
    manifest,
    diff,
    enrichedDiff,
    schemaFiles: JSON.parse(job.schema_files),
    error: job.error,
    createdAt: job.created_at,
    completedAt: job.completed_at,
  };
}

function copySchemaFiles(files: Express.Multer.File[], draftDir: string): void {
  for (const f of files) {
    const dest = path.join(draftDir, "source_schemas", f.originalname);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(f.path, dest);
  }
}

function parseUploadedSchemas(files: Express.Multer.File[]) {
  const schemas = files.flatMap((f) => {
    const buf = readFileSync(f.path);
    return parseSchemaFile(f.originalname, buf);
  });
  if (schemas.length === 0) throw new Error("No tables found in uploaded schemas");
  return schemas;
}

async function processCreateJob(
  jobId: string,
  files: Express.Multer.File[],
  domainHint?: string,
): Promise<void> {
  updateAgentJob(jobId, { status: "RUNNING" });
  try {
    const schemas = parseUploadedSchemas(files);
    const spec = await generateCreateModel(schemas, domainHint);
    const draftDir = path.join(DRAFTS_PATH, jobId);
    mkdirSync(draftDir, { recursive: true });
    copySchemaFiles(files, draftDir);

    const { manifestPath, diffPath } = await buildDraftWorkbook(spec, draftDir, { mode: "CREATE" });
    updateAgentJob(jobId, {
      status: "DRAFT_READY",
      draft_path: draftDir,
      manifest: readFileSync(manifestPath, "utf8"),
      diff: readFileSync(diffPath, "utf8"),
      agent_source: ANTHROPIC_API_KEY ? "claude" : "rule-based",
      completed_at: new Date().toISOString(),
    });
  } catch (e) {
    updateAgentJob(jobId, {
      status: "FAILED",
      error: (e as Error).message,
      completed_at: new Date().toISOString(),
    });
  }
}

async function processUpdateJob(
  jobId: string,
  familyId: string,
  baseVersion: number,
  files: Express.Multer.File[],
): Promise<void> {
  updateAgentJob(jobId, { status: "RUNNING" });
  try {
    const baseWb = workbookPath(familyId, baseVersion);
    if (!existsSync(baseWb)) throw new Error(`Base model ${familyId} v${baseVersion} not found`);

    const baseSpec = readWorkbook(baseWb);
    const newSchemas = parseUploadedSchemas(files);
    const spec = await generateUpdateModel(baseSpec, newSchemas, familyId, baseVersion);

    const draftDir = path.join(DRAFTS_PATH, jobId);
    mkdirSync(draftDir, { recursive: true });
    copySchemaFiles(files, draftDir);

    const { manifestPath, diffPath } = await buildDraftWorkbook(spec, draftDir, {
      mode: "UPDATE",
      baseSpec,
    });

    updateAgentJob(jobId, {
      status: "DRAFT_READY",
      draft_path: draftDir,
      manifest: readFileSync(manifestPath, "utf8"),
      diff: readFileSync(diffPath, "utf8"),
      agent_source: ANTHROPIC_API_KEY ? "claude" : "rule-based",
      completed_at: new Date().toISOString(),
    });
  } catch (e) {
    updateAgentJob(jobId, {
      status: "FAILED",
      error: (e as Error).message,
      completed_at: new Date().toISOString(),
    });
  }
}

async function processRewriteJob(
  jobId: string,
  familyId: string,
  baseVersion: number,
  files: Express.Multer.File[],
  domainHint?: string,
): Promise<void> {
  updateAgentJob(jobId, { status: "RUNNING" });
  try {
    const baseWb = workbookPath(familyId, baseVersion);
    if (!existsSync(baseWb)) throw new Error(`Base model ${familyId} v${baseVersion} not found`);

    const baseSpec = readWorkbook(baseWb);
    const schemas = parseUploadedSchemas(files);
    const spec = await generateRewriteModel(schemas, baseSpec, familyId, baseVersion, domainHint);

    const draftDir = path.join(DRAFTS_PATH, jobId);
    mkdirSync(draftDir, { recursive: true });
    copySchemaFiles(files, draftDir);

    const { manifestPath, diffPath } = await buildDraftWorkbook(spec, draftDir, {
      mode: "REWRITE",
      baseSpec,
    });

    updateAgentJob(jobId, {
      status: "DRAFT_READY",
      draft_path: draftDir,
      manifest: readFileSync(manifestPath, "utf8"),
      diff: readFileSync(diffPath, "utf8"),
      agent_source: ANTHROPIC_API_KEY ? "claude" : "rule-based",
      completed_at: new Date().toISOString(),
    });
  } catch (e) {
    updateAgentJob(jobId, {
      status: "FAILED",
      error: (e as Error).message,
      completed_at: new Date().toISOString(),
    });
  }
}

router.post("/agent/jobs", upload.array("schemas", 20), async (req, res) => {
  const mode = String(req.body.mode ?? "CREATE").toUpperCase() as AgentMode;
  if (!["CREATE", "UPDATE", "REWRITE"].includes(mode)) {
    return res.status(400).json({ error: "mode must be CREATE, UPDATE, or REWRITE." });
  }

  const familyId = String(req.body.familyId ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const displayName = String(req.body.displayName ?? familyId).trim();
  const domainHint = req.body.domainHint ? String(req.body.domainHint) : undefined;
  const baseVersion = req.body.baseVersion != null ? Number(req.body.baseVersion) : null;

  if (!familyId) return res.status(400).json({ error: "familyId is required." });

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files?.length) return res.status(400).json({ error: "Upload at least one schema file." });

  if (mode === "CREATE") {
    if (getFamily(familyId)) {
      return res.status(409).json({ error: `Family '${familyId}' already exists. Use UPDATE or REWRITE.` });
    }
  } else {
    const family = getFamily(familyId);
    if (!family) {
      return res.status(404).json({ error: `Family '${familyId}' not found. Use CREATE for new families.` });
    }
    if (baseVersion == null || !Number.isFinite(baseVersion)) {
      return res.status(400).json({ error: "baseVersion is required for UPDATE and REWRITE." });
    }
    if (!family.versions.includes(baseVersion)) {
      return res.status(404).json({ error: `Version v${baseVersion} not found for '${familyId}'.` });
    }
    if (!resolveModelRef(familyId, baseVersion)) {
      return res.status(404).json({ error: `Workbook missing for ${familyId} v${baseVersion}.` });
    }
  }

  const jobId = uuidv4().replace(/-/g, "").slice(0, 16);
  insertAgentJob({
    job_id: jobId,
    mode,
    family_id: familyId,
    display_name: displayName || getFamily(familyId)?.display_name || familyId,
    base_version: baseVersion,
    status: "PENDING",
    draft_path: null,
    manifest: null,
    diff: null,
    schema_files: JSON.stringify(files.map((f) => f.originalname)),
    error: null,
    agent_source: null,
    created_at: new Date().toISOString(),
    completed_at: null,
  });

  if (mode === "CREATE") void processCreateJob(jobId, files, domainHint);
  else if (mode === "UPDATE") void processUpdateJob(jobId, familyId, baseVersion!, files);
  else void processRewriteJob(jobId, familyId, baseVersion!, files, domainHint);

  res.status(202).json({ jobId, status: "PENDING", mode, familyId, baseVersion, displayName });
});

router.get("/agent/jobs", (_req, res) => {
  const jobs = listAgentJobs().map((j) => ({
    jobId: j.job_id,
    mode: j.mode,
    familyId: j.family_id,
    displayName: j.display_name,
    baseVersion: j.base_version,
    status: j.status,
    agentSource: j.agent_source,
    createdAt: j.created_at,
    completedAt: j.completed_at,
    error: j.error,
  }));
  res.json({ jobs });
});

router.get("/agent/jobs/:id", async (req, res) => {
  const job = getAgentJob(jobIdFromReq(req));
  if (!job) return res.status(404).json({ error: "Job not found" });

  let objects: Record<string, unknown> | undefined;
  const wb = job.draft_path ? path.join(job.draft_path, "data_model.xlsx") : null;
  if (wb && existsSync(wb)) {
    try {
      const { stdout } = await runPython(MODEL_OBJECTS, ["--model", wb]);
      objects = JSON.parse(stdout).tables;
    } catch {
      /* manifest-only diff */
    }
  }

  res.json(jobResponse(job, objects));
});

router.get("/agent/jobs/:id/diff", (req, res) => {
  const job = getAgentJob(jobIdFromReq(req));
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!job.diff) return res.status(404).json({ error: "No diff available" });
  const manifest = job.manifest ? JSON.parse(job.manifest) : null;
  const diff = JSON.parse(job.diff) as AgentDiff;
  res.json({ enrichedDiff: enrichDiff(diff, manifest) });
});

router.get("/agent/jobs/:id/draft", (req, res) => {
  const job = getAgentJob(jobIdFromReq(req));
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "DRAFT_READY" && job.status !== "APPROVED") {
    return res.status(409).json({ error: `Job status is ${job.status}` });
  }
  const wb = path.join(job.draft_path!, "data_model.xlsx");
  if (!existsSync(wb)) return res.status(404).json({ error: "Draft workbook missing" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="draft_${job.family_id}.xlsx"`);
  createReadStream(wb).pipe(res);
});

router.put("/agent/jobs/:id/draft", draftUpload.single("workbook"), async (req, res) => {
  const job = getAgentJob(jobIdFromReq(req));
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "DRAFT_READY") {
    return res.status(409).json({ error: `Cannot edit draft in status ${job.status}` });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Upload workbook file as 'workbook'." });

  const dest = path.join(job.draft_path!, "data_model.xlsx");
  copyFileSync(file.path, dest);

  try {
    const { manifest, objects } = await refreshDraftArtifacts(job.draft_path!);
    updateAgentJob(job.job_id, { manifest, status: "DRAFT_READY" });
    const updated = getAgentJob(job.job_id)!;
    res.json(jobResponse(updated, objects));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post("/agent/jobs/:id/approve", async (req, res) => {
  const job = getAgentJob(jobIdFromReq(req));
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "DRAFT_READY") {
    return res.status(409).json({ error: `Cannot approve job in status ${job.status}` });
  }

  const { reviewAcknowledged, confirmedFks = [] } = req.body ?? {};
  if (!reviewAcknowledged) {
    return res.status(400).json({ error: "reviewAcknowledged must be true before registering." });
  }

  const diff = job.diff ? (JSON.parse(job.diff) as AgentDiff) : loadDiff(job.draft_path!);
  const inferred = diff.inferred_fks ?? [];
  if (inferred.length > 0) {
    const confirmed = new Set(confirmedFks as string[]);
    const missing = inferred.map((fk) => fk.column).filter((c) => !confirmed.has(c));
    if (missing.length > 0) {
      return res.status(400).json({
        error: "Confirm every inferred FK before registering.",
        unconfirmedFks: missing,
      });
    }
  }

  const wb = path.join(job.draft_path!, "data_model.xlsx");
  if (!existsSync(wb)) return res.status(404).json({ error: "Draft workbook missing" });

  try {
    await refreshDraftArtifacts(job.draft_path!);

    const mode = (job.mode ?? "CREATE") as "CREATE" | "UPDATE" | "REWRITE";
    const baseVersion = job.base_version ?? undefined;
    const nextVersion =
      mode === "CREATE" ? 1 : baseVersion != null ? baseVersion + 1 : undefined;

    const ref = await registerVersion({
      family: job.family_id!,
      displayName: job.display_name ?? job.family_id!,
      workbookSource: wb,
      mode,
      registeredBy: "human-review",
      version: nextVersion,
      agentJobId: job.job_id,
      sourceSchemasDir: path.join(job.draft_path!, "source_schemas"),
      diffSourcePath: path.join(job.draft_path!, "diff.json"),
      baseVersion: baseVersion ?? undefined,
      confirmedFks: confirmedFks as string[],
    });

    writeFileSync(
      path.join(job.draft_path!, "registration.json"),
      JSON.stringify({
        registered_at: new Date().toISOString(),
        registered_by: "human-review",
        mode,
        confirmed_fks: confirmedFks,
        agent_job_id: job.job_id,
        base_version: baseVersion,
        registered_version: ref.version,
      }, null, 2),
    );

    updateAgentJob(job.job_id, { status: "APPROVED", completed_at: new Date().toISOString() });
    res.json({
      status: "APPROVED",
      family: ref.family,
      version: ref.version,
      modelKey: ref.modelKey,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post("/agent/jobs/:id/reject", (req, res) => {
  const job = getAgentJob(jobIdFromReq(req));
  if (!job) return res.status(404).json({ error: "Job not found" });
  updateAgentJob(job.job_id, { status: "REJECTED", completed_at: new Date().toISOString() });
  res.json({ status: "REJECTED" });
});

export default router;
