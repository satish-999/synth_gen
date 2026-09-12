import { MODEL_OBJECTS } from "../config.js";
import { runPython } from "../utils/python.js";

export interface TableInfo {
  pk: string[];
  sizing: boolean;
  parents: string[];
}

export interface ModelObjects {
  tables: Record<string, TableInfo>;
  views: string[];
}

const cache = new Map<string, ModelObjects>();

/** Parse a workbook's objects via the engine helper (cached by model path). */
export async function getModelObjects(modelPath: string): Promise<ModelObjects> {
  const cached = cache.get(modelPath);
  if (cached) return cached;

  const { code, stdout, stderr } = await runPython(MODEL_OBJECTS, ["--model", modelPath]);
  if (code !== 0) {
    throw new Error(`Failed to read model objects: ${stderr || stdout}`);
  }
  const parsed = JSON.parse(stdout) as ModelObjects;
  cache.set(modelPath, parsed);
  return parsed;
}

/**
 * Transitive FK-parent closure. Given selected tables, add every parent table
 * required so no child is generated without its FK parent.
 */
export function resolveDependencies(
  selected: string[],
  tables: Record<string, TableInfo>,
): { resolved: string[]; added: string[] } {
  const resolved = new Set(selected);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of [...resolved]) {
      for (const parent of tables[t]?.parents ?? []) {
        if (!resolved.has(parent)) {
          resolved.add(parent);
          changed = true;
        }
      }
    }
  }
  const added = [...resolved].filter((t) => !selected.includes(t));
  return { resolved: [...resolved], added };
}
