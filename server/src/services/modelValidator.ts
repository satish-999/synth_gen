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
        col.fk_ref = null;
        col.fk_mode = null;
        col.nullable_pct = 0;
        col.unique = true;
        if (!col.generator) col.generator = "pattern";
      }
    }

    const sizing = cols.filter((c) => c.fk_mode === "SIZING");
    if (sizing.length > 1) {
      for (let i = 1; i < sizing.length; i++) {
        sizing[i].fk_mode = "REFERENCE";
        sizing[i].cardinality = null;
      }
    }
    for (const col of cols) {
      if (col.fk_mode === "SIZING" && !col.cardinality) {
        col.cardinality = isLineTable(tableName) ? "1,15,poisson(3)" : "0,60,poisson(8)";
        col.orphan_pct = isLineTable(tableName) ? 0 : 0.05;
      }
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
    if (pks.length > 1) errors.push(`${tableName}: multiple PK columns marked.`);

    for (const pk of pks) {
      if (pk.generator !== "pattern") errors.push(`${tableName}.${pk.name}: PK must use pattern generator.`);
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
      if (col.fk_ref) {
        if (col.generator != null && col.generator !== "") {
          errors.push(`${tableName}.${col.name}: FK column must have generator=null (got ${col.generator}).`);
        }
        const [pt, pc] = col.fk_ref.split(".");
        const parentPk = pkMap.get(pt);
        if (!parentPk) {
          const hasUnresolved = warnings.some((w) => w.startsWith("UNRESOLVED FK:") && w.includes(`${tableName}.${col.name}`));
          if (!hasUnresolved) errors.push(`${tableName}.${col.name}: fk_ref parent ${pt} not found.`);
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

  return { ok: errors.length === 0, errors, warnings };
}

export function validateAndNormalize(spec: AgentModelSpec): { spec: AgentModelSpec; validation: ValidationResult } {
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
