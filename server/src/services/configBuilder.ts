import yaml from "js-yaml";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_PARENT_ROWS } from "../config.js";
import type { ModelObjects } from "./modelService.js";

export type OutputFormat = "csv" | "xlsx";

export const DEFAULT_SIZING_ROWS = 50;

export interface BuildConfigInput {
  modelPath: string;
  /** table -> requested row count */
  requestedRows: Record<string, number>;
  /** tables the user explicitly checked */
  userSelectedTables: string[];
  /** tables to generate this run (user-selected only) */
  targetTables: string[];
  /** FK parent tables loaded from a prior run */
  references?: Record<string, string>;
  seed: number;
  locale: string;
  formats: OutputFormat[];
  outputDir: string;
}

export interface BuiltConfig {
  configPath: string;
  yamlText: string;
  targets: Record<string, { rows: number | "derived" }>;
  references: Record<string, string>;
}

/**
 * Build run_config.yaml. SIZING tables use `rows: derived` unless the user
 * explicitly selected that table and provided a row count.
 */
export function buildConfig(input: BuildConfigInput, model: ModelObjects): BuiltConfig {
  const targets: Record<string, { rows: number | "derived" }> = {};
  const references = { ...(input.references ?? {}) };
  const userPicked = new Set(input.userSelectedTables);

  for (const t of input.targetTables) {
    const info = model.tables[t];
    if (!info) continue;
    if (info.sizing && userPicked.has(t)) {
      const rows = input.requestedRows[t] ?? DEFAULT_SIZING_ROWS;
      targets[t] = { rows: Math.max(1, Math.floor(rows)) };
    } else if (info.sizing) {
      targets[t] = { rows: "derived" };
    } else {
      const rows = input.requestedRows[t] ?? DEFAULT_PARENT_ROWS;
      targets[t] = { rows: Math.max(1, Math.floor(rows)) };
    }
  }

  const config: Record<string, unknown> = {
    model: input.modelPath,
    seed: input.seed,
    locale: input.locale,
    targets,
    output: {
      format: input.formats,
      path: input.outputDir,
    },
  };

  if (Object.keys(references).length > 0) {
    config.references = Object.fromEntries(
      Object.entries(references).map(([name, csvPath]) => [name, { path: csvPath }]),
    );
  }

  const yamlText = yaml.dump(config, { lineWidth: 120 });
  const configPath = path.join(input.outputDir, "run_config.yaml");
  writeFileSync(configPath, yamlText, "utf8");

  return { configPath, yamlText, targets, references };
}
