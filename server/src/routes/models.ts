import { Router } from "express";
import multer from "multer";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, UPLOADS_PATH } from "../config.js";
import {
  listFamilies,
  getFamily,
  getFamilyMeta,
  getVersionManifest,
  getRegistration,
  resolveModelRef,
  workbookPath,
} from "../services/registryService.js";
import {
  assertCanCreateFamily,
  assertCanReviseFamily,
  registerWorkbookFromFile,
} from "../services/modelRegistrationService.js";
import { getModelObjects } from "../services/modelService.js";
import { parseModelCsv, parseModelJson } from "../services/modelImport.js";
import { writeWorkbook } from "../services/workbookBuilder.js";

mkdirSync(UPLOADS_PATH, { recursive: true });
const upload = multer({ dest: UPLOADS_PATH, limits: { fileSize: 20 * 1024 * 1024 } });

const router = Router();

const TEMPLATE_CANDIDATES = [
  path.join(REPO_ROOT, "templates", "data_model_TEMPLATE.xlsx"),
  path.join(REPO_ROOT, "Design docs", "data_model.xlsx"),
  path.join(REPO_ROOT, "engine", "data_model_demo.xlsx"),
];

function slugFamilyId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

class ModelImportError extends Error {
  status = 400;
  fieldErrors: string[];
  constructor(fieldErrors: string[]) {
    super(fieldErrors.length === 1 ? fieldErrors[0] : `${fieldErrors.length} problems found in the uploaded file.`);
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Accepts a .xlsx/.xls workbook (used as-is) or a .csv/.json data-model file
 * (parsed, then written through the real writeWorkbook() to produce an
 * actual workbook) and returns a staged .xlsx path ready for
 * registerWorkbookFromFile — the exact same function either way, so a CSV or
 * JSON import is validated and registered identically to an uploaded
 * workbook. Throws ModelImportError with per-field messages on a parse
 * failure; never lets a parser exception surface as a raw 500.
 */
function stageModelFile(file: Express.Multer.File, stagedXlsxPath: string): void {
  const ext = path.extname(file.originalname).toLowerCase();
  mkdirSync(path.dirname(stagedXlsxPath), { recursive: true });

  if (ext === ".csv" || ext === ".json") {
    const content = readFileSync(file.path, "utf8");
    const { spec, errors } = ext === ".csv" ? parseModelCsv(content) : parseModelJson(content);
    if (errors.length > 0 || !spec) {
      throw new ModelImportError(errors.length ? errors : ["Could not parse this file into a data model."]);
    }
    writeWorkbook(spec, stagedXlsxPath);
    return;
  }

  // .xlsx / .xls (or anything else — validate_model.py / XLSX.read will
  // reject it downstream with a clear error rather than silently accepting it)
  copyFileSync(file.path, stagedXlsxPath);
}

/** List all model families and their versions. */
router.get("/models", (_req, res) => {
  const families = listFamilies().map((f) => ({
    id: f.id,
    displayName: f.display_name,
    latestVersion: f.latest_version,
    versions: f.versions,
    createdAt: f.created_at,
  }));
  res.json({ families });
});

/** Download reference data_model.xlsx template (Design docs copy). */
router.get("/models/template", (_req, res) => {
  const template = TEMPLATE_CANDIDATES.find((p) => existsSync(p));
  if (!template) {
    return res.status(404).json({ error: "No reference data_model.xlsx found in Design docs/ or engine/." });
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="data_model_template.xlsx"');
  createReadStream(template).pipe(res);
});

/** Register a new family from an uploaded data model: .xlsx/.xls workbook,
 * or a .csv/.json representation of the same structure (no agent). */
router.post("/models/register", upload.single("workbook"), async (req, res) => {
  const familyId = slugFamilyId(String(req.body.familyId ?? ""));
  const displayName = String(req.body.displayName ?? familyId).trim();
  const file = req.file;

  if (!familyId) return res.status(400).json({ error: "familyId is required." });
  if (!file) return res.status(400).json({ error: "Upload a data model as 'workbook' (.xlsx, .xls, .csv or .json)." });

  try {
    assertCanCreateFamily(familyId);
    const staged = path.join(UPLOADS_PATH, "register", `${familyId}-${Date.now()}.xlsx`);
    const registeredBy = { ".csv": "csv-import", ".json": "json-import" }[path.extname(file.originalname).toLowerCase()];
    stageModelFile(file, staged);

    const result = await registerWorkbookFromFile({
      workbookSource: staged,
      family: familyId,
      displayName,
      mode: "CREATE",
      registeredBy,
    });

    res.status(201).json({
      family: result.ref.family,
      version: result.ref.version,
      modelKey: result.ref.modelKey,
      tableCount: result.tableCount,
      viewCount: result.viewCount,
      diff: result.diff,
    });
  } catch (e) {
    if (e instanceof ModelImportError) {
      return res.status(e.status).json({ error: e.message, fieldErrors: e.fieldErrors });
    }
    const err = e as Error & { status?: number };
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

/** Upload a new data model version (update or rewrite) — .xlsx/.xls, or a
 * .csv/.json representation of the same structure — validates then
 * registers v(N+1). */
router.post("/models/:family/:version/revise", upload.single("workbook"), async (req, res) => {
  const familyId = String(req.params.family);
  const baseVersion = Number(req.params.version);
  const mode = String(req.body.mode ?? "REWRITE").toUpperCase();
  const file = req.file;

  if (!Number.isFinite(baseVersion)) {
    return res.status(400).json({ error: "Invalid version number." });
  }
  if (!["UPDATE", "REWRITE"].includes(mode)) {
    return res.status(400).json({ error: "mode must be UPDATE or REWRITE." });
  }
  if (!file) return res.status(400).json({ error: "Upload a data model as 'workbook' (.xlsx, .xls, .csv or .json)." });

  try {
    assertCanReviseFamily(familyId, baseVersion);
    const staged = path.join(UPLOADS_PATH, "revise", `${familyId}-v${baseVersion}-${Date.now()}.xlsx`);
    const registeredBy = { ".csv": "csv-import", ".json": "json-import" }[path.extname(file.originalname).toLowerCase()];
    stageModelFile(file, staged);

    const family = getFamily(familyId)!;
    const result = await registerWorkbookFromFile({
      workbookSource: staged,
      family: familyId,
      displayName: family.display_name,
      mode: mode as "UPDATE" | "REWRITE",
      baseVersion,
      registeredBy,
    });

    res.status(201).json({
      family: result.ref.family,
      version: result.ref.version,
      modelKey: result.ref.modelKey,
      baseVersion,
      tableCount: result.tableCount,
      viewCount: result.viewCount,
      diff: result.diff,
    });
  } catch (e) {
    if (e instanceof ModelImportError) {
      return res.status(e.status).json({ error: e.message, fieldErrors: e.fieldErrors });
    }
    const err = e as Error & { status?: number };
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

/** Model metadata for a specific family + version. */
router.get("/models/:family/:version", async (req, res) => {
  const version = Number(req.params.version);
  if (!Number.isFinite(version)) {
    return res.status(400).json({ error: "Invalid version number." });
  }

  const family = getFamily(req.params.family);
  if (!family) return res.status(404).json({ error: "Unknown model family." });
  if (!family.versions.includes(version)) {
    return res.status(404).json({ error: `Version v${version} not registered.` });
  }

  const ref = resolveModelRef(req.params.family, version);
  if (!ref) return res.status(404).json({ error: "Model workbook missing." });

  const manifest = await getVersionManifest(req.params.family, version);
  const registration = getRegistration(req.params.family, version);
  const meta = getFamilyMeta(req.params.family);

  res.json({
    family: req.params.family,
    version,
    displayName: family.display_name,
    meta,
    manifest,
    registration,
    modelPath: ref.modelPath,
    downloadUrl: `/api/models/${req.params.family}/${version}/download`,
  });
});

/** Tables and views for generation UI — scoped to this model version only. */
router.get("/models/:family/:version/objects", async (req, res) => {
  const version = Number(req.params.version);
  if (!Number.isFinite(version)) {
    return res.status(400).json({ error: "Invalid version number." });
  }

  const ref = resolveModelRef(req.params.family, version);
  if (!ref) return res.status(404).json({ error: "Unknown model or version." });

  try {
    const objects = await getModelObjects(ref.modelPath);
    res.json({
      family: req.params.family,
      version,
      ...objects,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** Download the registered workbook (.xlsx) — open in Excel, edit, re-upload as new version. */
router.get("/models/:family/:version/download", (req, res) => {
  const version = Number(req.params.version);
  if (!Number.isFinite(version)) {
    return res.status(400).json({ error: "Invalid version number." });
  }

  const wb = workbookPath(req.params.family, version);
  if (!existsSync(wb)) {
    return res.status(404).json({ error: "Model workbook not found." });
  }

  const filename = `${req.params.family}_v${version}_data_model.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  createReadStream(wb).pipe(res);
});

export default router;
