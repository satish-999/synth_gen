import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { listPassRuns } from '../db/sqlite.js';
import { parseModelRef, resolveModelInput } from './registryService.js';
import { readWorkbook } from './workbookBuilder.js';

export interface GenerationPlan {
  targetTables: string[];
  references: Record<string, string>;
  referencedFromRun: string | null;
  referencedTables: string[];
}

/** Reuse one coherent successful dataset, including its inherited references.
 * Earlier versions are eligible only when every required parent definition matches.
 * A different seed affects new rows, not the identity of already saved parents.
 */
export function planPartialGeneration(selectedTables: string[], resolvedTables: string[], modelKey: string, _seed: number): GenerationPlan {
  const parents = resolvedTables.filter(t => !selectedTables.includes(t));
  const empty = {targetTables: selectedTables, references: {}, referencedTables: [], referencedFromRun: null};
  if (!parents.length) return empty;
  const currentRef = resolveModelInput(modelKey);
  if (!currentRef) throw new Error('Model version unavailable.');
  const current = readWorkbook(currentRef.modelPath);
  for (const run of listPassRuns()) {
    const previousRef = parseModelRef(run.model_key);
    if (!previousRef || previousRef.family !== currentRef.family || previousRef.version > currentRef.version || !run.output_path || !existsSync(run.model_path)) continue;
    try {
      const previous = readWorkbook(run.model_path);
      if (!parents.every(t => JSON.stringify(current.tables[t]) === JSON.stringify(previous.tables[t]) &&
        JSON.stringify(current.rules.filter(r => r.object === t)) === JSON.stringify(previous.rules.filter(r => r.object === t)))) continue;
      const configPath = path.join(run.output_path, 'run_config.yaml');
      const config = existsSync(configPath) ? yaml.load(readFileSync(configPath, 'utf8')) as {references?: Record<string, {path: string}>} : {};
      const references: Record<string, string> = {};
      for (const table of parents) {
        const candidates = [path.join(run.output_path, table + '.csv'), path.join(run.output_path, '_reference_data', table + '.csv'), config.references?.[table]?.path];
        const file = candidates.find(p => p && existsSync(p));
        if (file) references[table] = file;
      }
      if (parents.every(t => references[t])) return {targetTables:selectedTables, references, referencedTables:parents, referencedFromRun:run.run_id};
    } catch { /* Missing or unreadable historical data is not safe to reuse. */ }
  }
  throw Object.assign(new Error(`No compatible saved dataset contains the required parents: ${parents.join(', ')}. Generate these parent tables first (including their dependencies). Existing parent definitions must match the selected model version; you do not need to regenerate every table.`), {status:400});
}