import type { AgentModelSpec } from './modelTypes.js';

/** UPDATE adds tables; existing definitions are immutable. Use REWRITE for edits. */
export function assertAdditiveUpdate(base: AgentModelSpec, next: AgentModelSpec): void {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    return JSON.stringify(value);
  };
  for (const [name, columns] of Object.entries(base.tables)) {
    if (canonical(columns) !== canonical(next.tables[name])) throw new Error(`UPDATE changed existing table ${name}. Existing tables must be preserved; use REWRITE for intentional changes.`);
  }
  for (const rule of base.rules) {
    if (!next.rules.some(r => canonical(r) === canonical(rule))) throw new Error(`UPDATE changed or removed existing rule ${rule.rule_id}.`);
  }
  if (!Object.keys(next.tables).some(name => !(name in base.tables))) throw new Error('UPDATE must add at least one new table.');
}