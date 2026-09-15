import type { AgentModelSpec, ModelColumn } from "./modelTypes.js";

const CARDINALITY_RE = /^\d+,\d+,poisson\([\d.]+\)$/;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function pkPrefix(col: ModelColumn): string | null {
  if (!col.pk || !col.params) return null;
  const m = /pattern=([A-Z0-9]+)-/.exec(col.params);
  return m?.[1] ?? null;
}

function tablePkMap(spec: AgentModelSpec): Map<string, string> {
  const m = new Map<string, string>();
  for (const [t, cols] of Object.entries(spec.tables)) {
    const pk = cols.find((c) => c.pk);
    if (pk) m.set(t, pk.name);
  }
  return m;
}

/** Auto-fix common agent mistakes before validation. */
export function normalizeAgentModel(spec: AgentModelSpec): AgentModelSpec {
  spec = structuredClone(spec);
  const pkMap = tablePkMap(spec);
  const warnings = [...(spec.warnings ?? [])];

  for (const [tableName, cols] of Object.entries(spec.tables)) {
    for (const col of cols) {
      if (col.fk_ref) {
        if (col.generator) {
          col.generator = null;
          col.params = null;
          col.unique = false;
        }
        if (!col.fk_mode) col.fk_mode = "REFERENCE";
      }
      if (col.pk) {
        col.nullable_pct = 0;
        if (cols.filter(c => c.pk).length === 1) col.unique = true;
        if (!col.generator && !col.fk_ref) col.generator = "pattern";
      }
    }

    const sizing = cols.filter((c) => c.fk_mode === "SIZING");
    // Conflicting structural parents require review; do not silently rewrite them.
    for (const col of cols) {
      if (col.fk_mode === 'SIZING' && !col.cardinality) warnings.push(`${tableName}.${col.name}: specify child cardinality.`);
    }
  }

  for (const [tableName, cols] of Object.entries(spec.tables)) {
    for (const col of cols) {
      if (!col.fk_ref) continue;
      const [pt] = col.fk_ref.split(".");
      if (!pkMap.has(pt) && !warnings.some((w) => w.includes(`${tableName}.${col.name}`))) {
        warnings.push(`UNRESOLVED FK: ${tableName}.${col.name} — parent not in upload`);
      }
    }
  }

  return { ...spec, warnings, rules: spec.rules ?? [], inferred_fks: spec.inferred_fks ?? [] };
}

function isLineTable(name: string): boolean {
  return /_line$|_item$|_detail$|order_line|line_item/.test(name);
}

export function validateAgentModel(spec: AgentModelSpec): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [...(spec.warnings ?? [])];
  const pkMap = tablePkMap(spec);
  const prefixes = new Map<string, string>();

  if (!spec.tables || Object.keys(spec.tables).length === 0) {
    errors.push("Model has no tables.");
    return { ok: false, errors, warnings };
  }

  for (const [tableName, cols] of Object.entries(spec.tables)) {
    const pks = cols.filter((c) => c.pk);
    if (pks.length === 0) errors.push(`${tableName}: no PK column.`);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(tableName)) errors.push(`${tableName}: table names must be letters, numbers and underscores, starting with a letter.`);
    if (tableName.length > 31) errors.push(`${tableName}: Excel sheet names are limited to 31 characters.`);
    if (new Set(cols.map(c => c.name)).size !== cols.length) errors.push(`${tableName}: duplicate column names.`);

    for (const pk of pks) {
      if (!pk.fk_ref && !['pattern', 'sequence'].includes(pk.generator ?? '')) errors.push(`${tableName}.${pk.name}: use a pattern or sequence for generated keys.`);
      const pref = pkPrefix(pk);
      if (pref) {
        const other = prefixes.get(pref);
        if (other && other !== tableName) {
          errors.push(`PK prefix ${pref} shared by ${other} and ${tableName}.`);
        }
        prefixes.set(pref, tableName);
      }
    }

    const sizing = cols.filter((c) => c.fk_mode === "SIZING");
    if (sizing.length > 1) errors.push(`${tableName}: more than one SIZING FK.`);

    for (const col of cols) {
      const label = `${tableName}.${col.name}`;
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(col.name)) errors.push(`${label}: invalid column name.`);
      for (const value of [col.nullable_pct, col.orphan_pct]) if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) errors.push(`${label}: null/orphan fractions must be between 0 and 1.`);
      if (col.params != null && typeof col.params !== 'string') { errors.push(`${label}: params must be a semicolon-separated string.`); continue; }
      if (!col.fk_ref && !['pattern','sequence','faker','choice','numeric','date','date_offset','fk_lookup','fk_lookup_jitter','derived','case'].includes(col.generator ?? '')) errors.push(`${label}: unsupported or missing generator ${col.generator}.`);
      if (col.fk_ref && !['SIZING','REFERENCE'].includes(col.fk_mode ?? '')) errors.push(`${label}: invalid FK mode.`);
      if (col.fk_ref) {
        if (col.generator != null && col.generator !== "") {
          errors.push(`${tableName}.${col.name}: FK column must have generator=null (got ${col.generator}).`);
        }
        const [pt, pc] = col.fk_ref.split(".");
        const parentPk = pkMap.get(pt);
        if (!parentPk) {
          errors.push(`${tableName}.${col.name}: fk_ref parent ${pt} not found. Include its schema or extend an existing model containing it.`);
        } else if (parentPk !== pc) {
          errors.push(`${tableName}.${col.name}: fk_ref points to ${pc} but ${pt} PK is ${parentPk}.`);
        }
        if (col.fk_mode === "SIZING") {
          if (!col.cardinality || !CARDINALITY_RE.test(col.cardinality)) {
            errors.push(`${tableName}.${col.name}: SIZING FK needs cardinality min,max,poisson(avg).`);
          }
        }
      }

      if (col.generator === "derived" && col.params) {
        const exprM = /expr=([^;]+)/.exec(col.params);
        if (exprM) {
          const names = cols.map((c) => c.name);
          for (const token of exprM[1].split(/[^a-zA-Z0-9_]+/).filter(Boolean)) {
            if (!names.includes(token) && !/^\d/.test(token)) {
              errors.push(`${tableName}.${col.name}: derived expr references unknown column ${token}.`);
            }
          }
        }
      }

      if (/amount|total|_corrected$/i.test(col.name) && !col.fk_ref && !col.pk) {
        if (col.generator !== "derived" && col.generator !== "case") {
          warnings.push(`SME CONFIRM LOGIC: ${tableName}.${col.name} — expected derived/case generator`);
        }
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (table: string) => {
    if (visiting.has(table)) { errors.push(`Circular foreign-key dependency at ${table}.`); return; }
    if (visited.has(table)) return;
    visiting.add(table);
    for (const col of spec.tables[table] ?? []) if (col.fk_ref) visit(col.fk_ref.split('.')[0]);
    visiting.delete(table); visited.add(table);
  };
  Object.keys(spec.tables).forEach(visit);

  return { ok: errors.length === 0, errors, warnings };
}

export function validateAndNormalize(spec: AgentModelSpec): { spec: AgentModelSpec; validation: ValidationResult } {
  if (!spec || !spec.tables || Array.isArray(spec.tables) || typeof spec.tables !== 'object' || Object.values(spec.tables).some(cols => !Array.isArray(cols) || cols.some(c => !c || typeof c.name !== 'string'))) {
    throw new Error('Invalid model structure: tables must map names to column arrays.');
  }
  let normalized = normalizeAgentModel(spec);
  let validation = validateAgentModel(normalized);
  if (!validation.ok) {
    normalized = normalizeAgentModel(normalized);
    validation = validateAgentModel(normalized);
  }
  const mergedWarnings = [...new Set([...(normalized.warnings ?? []), ...validation.warnings])];
  return {
    spec: { ...normalized, warnings: mergedWarnings },
    validation,
  };
}