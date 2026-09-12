import type { TableInfo } from "../types";

/** Transitive FK-parent closure — mirrors demo_tool.py logic. */
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

export function modelLabel(family: string, version: number): string {
  return `${family}@v${version}`;
}
