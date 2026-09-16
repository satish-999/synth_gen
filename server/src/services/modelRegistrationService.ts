import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { UPLOADS_PATH } from "../config.js";
import { validateDraftWorkbook } from "./draftRefresh.js";
import { computeDiff, readWorkbook } from "./workbookBuilder.js";
import {
  getFamily,
  registerVersion,
  resolveModelRef,
  workbookPath,
  type ModelRef,
} from "./registryService.js";
import type { AgentDiff } from "./diffService.js";

export interface RegisterWorkbookInput {
  workbookSource: string;
  family: string;
  displayName: string;
  mode: "CREATE" | "UPDATE" | "REWRITE";
  baseVersion?: number;
  registeredBy?: string;
}

export interface RegisterWorkbookResult {
  ref: ModelRef;
  diff: AgentDiff | null;
  tableCount: number;
  viewCount: number;
}

/** Validate workbook via Python engine, then register as an immutable version. */
export async function registerWorkbookFromFile(
  input: RegisterWorkbookInput,
): Promise<RegisterWorkbookResult> {
  await validateDraftWorkbook(input.workbookSource);

  const newSpec = readWorkbook(input.workbookSource);
  const tableCount = Object.keys(newSpec.tables).length;
  const viewCount = Object.keys(newSpec.views ?? {}).length;

  let diff: AgentDiff | null = null;
  let diffPath: string | undefined;

  if (input.mode !== "CREATE" && input.baseVersion != null) {
    const baseWb = workbookPath(input.family, input.baseVersion);
    const baseSpec = readWorkbook(baseWb);
    diff = computeDiff(baseSpec, newSpec, input.mode);
    const tmpDir = path.join(UPLOADS_PATH, "model-revise", `${input.family}-v${input.baseVersion}`);
    mkdirSync(tmpDir, { recursive: true });
    diffPath = path.join(tmpDir, "diff.json");
    writeFileSync(diffPath, JSON.stringify(diff, null, 2));
  } else if (input.mode === "CREATE") {
    diff = computeDiff(null, newSpec, "CREATE");
  }

  const nextVersion =
    input.mode === "CREATE"
      ? 1
      : input.baseVersion != null
        ? input.baseVersion + 1
        : undefined;

  const ref = await registerVersion({
    family: input.family,
    displayName: input.displayName,
    workbookSource: input.workbookSource,
    mode: input.mode === "CREATE" ? "IMPORT" : input.mode,
    registeredBy: input.registeredBy ?? "workbook-upload",
    version: nextVersion,
    diffSourcePath: diffPath,
    baseVersion: input.baseVersion,
  });

  return { ref, diff, tableCount, viewCount };
}

export function assertCanCreateFamily(familyId: string): void {
  if (getFamily(familyId)) {
    throw Object.assign(new Error(`Family '${familyId}' already exists. Upload a new version instead.`), {
      status: 409,
    });
  }
}

export function assertCanReviseFamily(familyId: string, baseVersion: number): void {
  const family = getFamily(familyId);
  if (!family) {
    throw Object.assign(new Error(`Family '${familyId}' not found.`), { status: 404 });
  }
  if (!family.versions.includes(baseVersion)) {
    throw Object.assign(new Error(`Version v${baseVersion} not found for '${familyId}'.`), { status: 404 });
  }
  if (!resolveModelRef(familyId, baseVersion)) {
    throw Object.assign(new Error(`Workbook missing for ${familyId} v${baseVersion}.`), { status: 404 });
  }
}
