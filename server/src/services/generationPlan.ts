import { existsSync } from "node:fs";
import path from "node:path";
import type { RunRecord } from "../db/sqlite.js";
import { findLastPassRun } from "../db/sqlite.js";

export interface GenerationPlan {
  /** Only user-selected tables are regenerated. */
  targetTables: string[];
  /** FK parents loaded from a prior PASS run (not written to output). */
  references: Record<string, string>;
  referencedFromRun: string | null;
  referencedTables: string[];
}

function csvPathForTable(run: RunRecord, table: string): string | null {
  if (!run.output_path) return null;
  const csv = path.join(run.output_path, `${table}.csv`);
  return existsSync(csv) ? csv : null;
}

/**
 * Generate only selected tables. Required FK parents must exist in the last
 * PASS run for the same model + seed — they are loaded as references, not
 * regenerated.
 */
export function planPartialGeneration(
  selectedTables: string[],
  resolvedTables: string[],
  modelKey: string,
  seed: number,
): GenerationPlan {
  const parentTables = resolvedTables.filter((t) => !selectedTables.includes(t));

  if (parentTables.length === 0) {
    return {
      targetTables: selectedTables,
      references: {},
      referencedTables: [],
      referencedFromRun: null,
    };
  }

  const lastRun = findLastPassRun(modelKey, seed);
  const references: Record<string, string> = {};
  const missing: string[] = [];

  for (const t of parentTables) {
    const csv = lastRun ? csvPathForTable(lastRun, t) : null;
    if (csv) references[t] = csv;
    else missing.push(t);
  }

  if (missing.length > 0) {
    const hint = lastRun
      ? `Missing in run ${lastRun.run_id}: ${missing.join(", ")}`
      : `No successful run found for ${modelKey} with seed ${seed}`;
    throw Object.assign(
      new Error(
        `Cannot generate only selected tables yet. FK parents must be reused from a prior run: ${missing.join(", ")}. ` +
          `Select all tables and Generate once with seed ${seed}, then retry with your subset. ${hint}`,
      ),
      { status: 400 },
    );
  }

  return {
    targetTables: selectedTables,
    references,
    referencedTables: Object.keys(references),
    referencedFromRun: lastRun!.run_id,
  };
}
