import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { VALIDATE_MODEL, MODEL_OBJECTS } from "../config.js";
import { runPython } from "../utils/python.js";
import type { AgentDiff } from "./diffService.js";

export async function validateDraftWorkbook(workbookPath: string): Promise<void> {
  const val = await runPython(VALIDATE_MODEL, [workbookPath]);
  if (val.code !== 0) {
    throw new Error(`Workbook validation failed:\n${val.stderr || val.stdout}`);
  }
}

export async function refreshDraftArtifacts(draftDir: string): Promise<{
  manifest: string;
  objects: Record<string, { pk: string[]; sizing: boolean; parents: string[] }>;
}> {
  const workbookPath = path.join(draftDir, "data_model.xlsx");
  await validateDraftWorkbook(workbookPath);

  const { stdout } = await runPython(MODEL_OBJECTS, ["--model", workbookPath]);
  const objects = JSON.parse(stdout) as {
    tables: Record<string, { pk: string[]; sizing: boolean; parents: string[] }>;
    views: string[];
  };

  const existingManifest = readFileSync(path.join(draftDir, "manifest.json"), "utf8");
  const prev = JSON.parse(existingManifest) as Record<string, unknown>;

  const wb = XLSX.read(readFileSync(workbookPath), { type: "buffer" });
  const colCounts: Record<string, number> = {};
  for (const sheet of wb.SheetNames) {
    if (sheet.startsWith("_")) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1 });
    colCounts[sheet] = Math.max(0, (rows[0] as unknown[])?.length ?? 0);
  }

  const manifestFixed = {
    ...prev,
    tables: Object.fromEntries(
      Object.keys(objects.tables).map((name) => [
        name,
        {
          columns: colCounts[name] ?? 0,
          pk: objects.tables[name].pk[0] ?? null,
          parents: objects.tables[name].parents,
          sizing: objects.tables[name].sizing,
        },
      ]),
    ),
    refreshed_at: new Date().toISOString(),
  };

  writeFileSync(path.join(draftDir, "manifest.json"), JSON.stringify(manifestFixed, null, 2));
  return { manifest: JSON.stringify(manifestFixed), objects: objects.tables };
}

export function loadDiff(draftDir: string): AgentDiff {
  return JSON.parse(readFileSync(path.join(draftDir, "diff.json"), "utf8")) as AgentDiff;
}
