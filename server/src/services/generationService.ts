import archiver from "archiver";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from 'node:crypto';
import { SYNTHGEN, VALIDATE, RUNS_PATH } from "../config.js";
import { runPython } from "../utils/python.js";
import { buildConfig, type OutputFormat } from "./configBuilder.js";

export type { OutputFormat } from "./configBuilder.js";
import { getModelObjects, resolveDependencies } from "./modelService.js";
import { insertRun, updateRun } from "../db/sqlite.js";
import { planPartialGeneration } from "./generationPlan.js";
import { validateGenerationLimits, withGenerationSlot } from './generationLimits.js';

export interface GenerateRequest {
  modelKey: string;
  modelPath: string;
  family?: string;
  version?: number;
  selectedTables: string[];
  requestedRows: Record<string, number>;
  seed: number;
  locale: string;
  formats: OutputFormat[];
}

export interface ComplianceCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface GenerateResult {
  runId: string;
  status: "PASS" | "FAIL" | "ERROR";
  autoIncluded: string[];
  referencedTables: string[];
  referencedFromRun: string | null;
  targets: Record<string, { rows: number | "derived" }>;
  qa: unknown;
  compliance: { passed: boolean; checks: ComplianceCheck[] };
  files: string[];
  outputPath: string;
  configYaml: string;
  error?: string;
}

function runId(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z") + '_' + randomUUID().slice(0, 8);
}

/** Parse validate_compliance.py stdout into structured checks. */
function parseCompliance(stdout: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const re = /^\s*\[(PASS|FAIL)\]\s+(.+?)\s{2,}(.*)$/;
  for (const line of stdout.split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) {
      checks.push({ name: m[2].trim(), pass: m[1] === "PASS", detail: m[3].trim() });
    }
  }
  return checks;
}

function latestSnapshot(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const snaps = readdirSync(dir)
    .filter((f) => f.startsWith("model_snapshot_") && f.endsWith(".json"))
    .sort();
  return snaps.length ? path.join(dir, snaps[snaps.length - 1]) : null;
}

function producedFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(
    (f) => f.endsWith(".csv") || f === "synthetic_data.xlsx",
  );
}

export async function generate(req: GenerateRequest): Promise<GenerateResult> {
  validateGenerationLimits(req.selectedTables, req.requestedRows, req.seed);
  return withGenerationSlot(() => generateDataset(req));
}

async function generateDataset(req: GenerateRequest): Promise<GenerateResult> {
  const id = runId();
  const outputDir = path.join(RUNS_PATH, `run_${id}`);
  mkdirSync(outputDir, { recursive: true });

  const model = await getModelObjects(req.modelPath);

  // validate selected tables belong to this model
  const unknown = req.selectedTables.filter((t) => !model.tables[t]);
  if (unknown.length) {
    throw Object.assign(new Error(`Tables not in model: ${unknown.join(", ")}`), {
      status: 400,
    });
  }

  const { resolved, added } = resolveDependencies(req.selectedTables, model.tables);
  const plan = planPartialGeneration(req.selectedTables, resolved, req.modelKey, req.seed);

  const { configPath, yamlText, targets } = buildConfig(
    {
      modelPath: req.modelPath,
      requestedRows: req.requestedRows,
      userSelectedTables: req.selectedTables,
      targetTables: plan.targetTables,
      references: plan.references,
      seed: req.seed,
      locale: req.locale,
      formats: req.formats,
      outputDir,
    },
    model,
  );

  insertRun({
    run_id: id,
    model_key: req.modelKey,
    model_path: req.modelPath,
    seed: req.seed,
    locale: req.locale,
    targets: JSON.stringify(targets),
    formats: JSON.stringify(req.formats),
    status: "RUNNING",
    report: null,
    output_path: outputDir,
    files: null,
    error: null,
    created_at: new Date().toISOString(),
  });

  // 1. generation
  const gen = await runPython(SYNTHGEN, ["--model", req.modelPath, "--config", configPath]);

  let qa: unknown = null;
  const qaPath = path.join(outputDir, "qa_report.json");
  if (existsSync(qaPath)) qa = JSON.parse(readFileSync(qaPath, "utf8"));

  if (gen.code !== 0) {
    // synthgen exits non-zero on inline validation failure (no files written)
    const result: GenerateResult = {
      runId: id,
      status: "FAIL",
      autoIncluded: added,
      referencedTables: plan.referencedTables,
      referencedFromRun: plan.referencedFromRun,
      targets,
      qa,
      compliance: { passed: false, checks: [] },
      files: [],
      outputPath: outputDir,
      configYaml: yamlText,
      error: gen.stderr.trim() || "Generation failed inline validation.",
    };
    updateRun(id, {
      status: "FAIL",
      report: JSON.stringify({ qa, compliance: result.compliance }),
      error: result.error,
      files: JSON.stringify([]),
    });
    return result;
  }

  // 2. independent compliance gate
  const snapshot = latestSnapshot(outputDir);
  if (!snapshot) {
    throw new Error("No model snapshot produced by generation.");
  }
  const val = await runPython(VALIDATE, ["--snapshot", snapshot, "--data", outputDir, "--config", configPath]);
  const checks = parseCompliance(val.stdout);
  const passed = val.code === 0;

  const files = passed ? producedFiles(outputDir) : [];
  const status: "PASS" | "FAIL" = passed ? "PASS" : "FAIL";

  updateRun(id, {
    status,
    report: JSON.stringify({ qa, compliance: { passed, checks } }),
    files: JSON.stringify(files),
  });

  return {
    runId: id,
    status,
    autoIncluded: added,
    referencedTables: plan.referencedTables,
    referencedFromRun: plan.referencedFromRun,
    targets,
    qa,
    compliance: { passed, checks },
    files,
    outputPath: outputDir,
    configYaml: yamlText,
  };
}

/** Stream a zip of all produced files for a passed run. */
export function zipRun(outputDir: string, res: NodeJS.WritableStream): void {
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res as NodeJS.WritableStream);
  for (const f of producedFiles(outputDir)) {
    archive.file(path.join(outputDir, f), { name: f });
  }
  void archive.finalize();
}

export function runOutputDir(id: string): string {
  return path.join(RUNS_PATH, `run_${id}`);
}