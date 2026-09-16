/**
 * CSV and JSON representations of a full data model -- the same structure a
 * .xlsx workbook encodes (tables, columns, rules, views) -- parsed into the
 * same AgentModelSpec that readWorkbook() produces from a real workbook, so
 * that writeWorkbook(spec) + the existing registration path yields exactly
 * the model an equivalent workbook would. See docs/CSV_JSON_MODEL_FORMAT.md
 * for the format specification this file implements.
 */
import type { AgentModelSpec, ModelColumn, ModelRule, ModelView, ModelViewColumn } from "./modelTypes.js";

export interface ImportResult {
  spec: AgentModelSpec | null;
  errors: string[];
}

const TABLE_HEADERS = [
  "column_name", "dtype", "pk", "fk_ref", "fk_mode", "cardinality",
  "orphan_pct", "generator", "params", "nullable_pct", "unique",
] as const;

const VIEW_KEYS = new Set(["source_objects", "join_logic", "filter_logic", "group_by"]);

// ---------------------------------------------------------------- CSV -----

/** RFC4180-style row tokenizer: handles quoted fields, embedded commas and
 * embedded newlines, and "" as an escaped quote. schemaParser.ts's parseCsv
 * uses a naive split(",") deliberately -- fine for plain sample data, but
 * this format's `params` column routinely contains literal commas
 * (`values=A,B,C; weights=0.5,0.3,0.2`), which a naive split would shred. */
function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const text = content.replace(/\r\n/g, "\n");

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

function isBlankRow(row: string[]): boolean {
  return row.every((c) => c.trim() === "");
}

function toBool(value: string, field: string, where: string, errors: string[]): boolean {
  const v = value.trim().toUpperCase();
  if (v === "" || v === "N") return false;
  if (v === "Y") return true;
  errors.push(`${where}: ${field} must be Y or N (got "${value}").`);
  return false;
}

function toNumber(value: string, field: string, where: string, errors: string[]): number {
  if (value.trim() === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    errors.push(`${where}: ${field} must be a number (got "${value}").`);
    return 0;
  }
  return n;
}

function csvRowToColumn(row: string[], where: string, errors: string[]): ModelColumn | null {
  const get = (i: number) => (row[i] ?? "").trim();
  const name = get(0);
  if (!name) { errors.push(`${where}: column_name is required.`); return null; }
  const dtype = get(1);
  if (!dtype) { errors.push(`${where} (${name}): dtype is required.`); return null; }
  const label = `${where} (${name})`;
  return {
    name,
    dtype,
    pk: toBool(get(2), "pk", label, errors),
    fk_ref: get(3) || null,
    fk_mode: get(4) || null,
    cardinality: get(5) || null,
    orphan_pct: toNumber(get(6), "orphan_pct", label, errors),
    generator: get(7) || null,
    params: get(8) || null,
    nullable_pct: toNumber(get(9), "nullable_pct", label, errors),
    unique: toBool(get(10), "unique", label, errors),
  };
}

/** Split a CSV model file into `## TABLE:name` / `## VIEW:name` / `## RULES`
 * sections. Marker rows have the marker as the entire first cell; everything
 * up to the next marker (or end of file) belongs to that section. */
function splitSections(rows: string[][]): { kind: "TABLE" | "VIEW" | "RULES"; name: string; rows: string[][] }[] {
  const sections: { kind: "TABLE" | "VIEW" | "RULES"; name: string; rows: string[][] }[] = [];
  let current: { kind: "TABLE" | "VIEW" | "RULES"; name: string; rows: string[][] } | null = null;

  for (const row of rows) {
    const marker = (row[0] ?? "").trim();
    const tableMatch = /^##\s*TABLE:\s*(.+)$/i.exec(marker);
    const viewMatch = /^##\s*VIEW:\s*(.+)$/i.exec(marker);
    const rulesMatch = /^##\s*RULES\s*$/i.exec(marker);
    if (tableMatch) { current = { kind: "TABLE", name: tableMatch[1].trim(), rows: [] }; sections.push(current); continue; }
    if (viewMatch) { current = { kind: "VIEW", name: viewMatch[1].trim(), rows: [] }; sections.push(current); continue; }
    if (rulesMatch) { current = { kind: "RULES", name: "", rows: [] }; sections.push(current); continue; }
    if (current && !isBlankRow(row)) current.rows.push(row);
  }
  return sections;
}

export function parseModelCsv(content: string): ImportResult {
  const errors: string[] = [];
  const allRows = parseCsvRows(content).filter((r) => !isBlankRow(r));
  if (allRows.length === 0) {
    return { spec: null, errors: ["The file is empty."] };
  }

  const sections = splitSections(allRows);
  if (sections.length === 0) {
    return {
      spec: null,
      errors: [
        "No '## TABLE:name', '## VIEW:name' or '## RULES' section markers found. " +
          "Every table needs its own '## TABLE:<name>' section — see docs/CSV_JSON_MODEL_FORMAT.md.",
      ],
    };
  }

  const tables: Record<string, ModelColumn[]> = {};
  const views: Record<string, ModelView> = {};
  const rules: ModelRule[] = [];

  for (const section of sections) {
    if (section.rows.length === 0) continue;
    if (section.kind === "TABLE") {
      if (!section.name) { errors.push("'## TABLE:' section is missing a table name."); continue; }
      if (tables[section.name]) { errors.push(`Table '${section.name}' is defined more than once.`); continue; }
      const header = section.rows[0].map((h) => h.trim().toLowerCase());
      const headerOk = TABLE_HEADERS.every((h, i) => header[i] === h);
      const dataRows = headerOk ? section.rows.slice(1) : section.rows;
      if (!headerOk) {
        errors.push(
          `Table '${section.name}': first row should be the column header ` +
            `(${TABLE_HEADERS.join(",")}) — proceeding without it, but check for a typo.`,
        );
      }
      const cols: ModelColumn[] = [];
      const seen = new Set<string>();
      for (const row of dataRows) {
        const col = csvRowToColumn(row, `Table '${section.name}'`, errors);
        if (!col) continue;
        if (seen.has(col.name)) { errors.push(`Table '${section.name}': duplicate column '${col.name}'.`); continue; }
        seen.add(col.name);
        cols.push(col);
      }
      if (cols.length) tables[section.name] = cols;
    } else if (section.kind === "VIEW") {
      if (!section.name) { errors.push("'## VIEW:' section is missing a view name."); continue; }
      if (views[section.name]) { errors.push(`View '${section.name}' is defined more than once.`); continue; }
      const spec: Record<string, string> = {};
      const columns: ModelViewColumn[] = [];
      let inCols = false;
      for (const row of section.rows) {
        const key = (row[0] ?? "").trim();
        if (key.toLowerCase() === "column_name") { inCols = true; continue; }
        if (!inCols) {
          if (VIEW_KEYS.has(key.toLowerCase())) spec[key.toLowerCase()] = (row[1] ?? "").trim();
          else if (key) errors.push(`View '${section.name}': unrecognized field '${key}' (expected one of ${[...VIEW_KEYS].join(", ")}).`);
        } else if (key) {
          columns.push({ name: key, dtype: (row[1] ?? "string").trim() || "string", derivation: (row[2] ?? "").trim() });
        }
      }
      if (!spec.source_objects) errors.push(`View '${section.name}': source_objects is required.`);
      if (columns.length === 0) errors.push(`View '${section.name}': no output columns defined (add a 'column_name,data_type,derivation' header row followed by one row per column).`);
      views[section.name] = {
        source_objects: spec.source_objects ?? "",
        join_logic: spec.join_logic || null,
        filter_logic: spec.filter_logic || null,
        group_by: spec.group_by || null,
        columns,
      };
    } else {
      const header = section.rows[0].map((h) => h.trim().toLowerCase());
      const headerOk = header[0] === "rule_id";
      const dataRows = headerOk ? section.rows.slice(1) : section.rows;
      for (const row of dataRows) {
        const [rule_id, object, rule_type, definition] = row.map((c) => c.trim());
        if (!rule_id || !object || !rule_type || !definition) {
          errors.push(`Rules: each row needs rule_id, object, rule_type and definition (got ${JSON.stringify(row)}).`);
          continue;
        }
        rules.push({ rule_id, object, rule_type, definition });
      }
    }
  }

  if (Object.keys(tables).length === 0 && errors.length === 0) {
    errors.push("No tables found. At least one '## TABLE:<name>' section is required.");
  }
  for (const view of Object.values(views)) {
    for (const src of view.source_objects.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!tables[src]) errors.push(`View references table '${src}' in source_objects, which is not defined in this file.`);
    }
  }

  if (errors.length > 0) return { spec: null, errors };
  return {
    spec: { tables, rules, inferred_fks: [], warnings: [], ...(Object.keys(views).length ? { views } : {}) },
    errors: [],
  };
}

// --------------------------------------------------------------- JSON -----

interface JsonColumnInput {
  name?: unknown;
  dtype?: unknown;
  pk?: unknown;
  fk_ref?: unknown;
  fk_mode?: unknown;
  cardinality?: unknown;
  orphan_pct?: unknown;
  generator?: unknown;
  params?: unknown;
  nullable_pct?: unknown;
  unique?: unknown;
}

interface JsonViewInput {
  source_objects?: unknown;
  join_logic?: unknown;
  filter_logic?: unknown;
  group_by?: unknown;
  columns?: unknown;
}

interface JsonRuleInput {
  rule_id?: unknown;
  object?: unknown;
  rule_type?: unknown;
  definition?: unknown;
}

interface JsonModelInput {
  tables?: Record<string, unknown>;
  views?: Record<string, unknown>;
  rules?: unknown;
}

function jsonRowToColumn(raw: unknown, where: string, errors: string[]): ModelColumn | null {
  if (typeof raw !== "object" || raw === null) { errors.push(`${where}: each column must be an object.`); return null; }
  const c = raw as JsonColumnInput;
  if (typeof c.name !== "string" || !c.name) { errors.push(`${where}: column "name" is required and must be a string.`); return null; }
  const label = `${where} (${c.name})`;
  if (typeof c.dtype !== "string" || !c.dtype) { errors.push(`${label}: "dtype" is required and must be a string.`); return null; }
  const numField = (v: unknown, field: string): number => {
    if (v == null) return 0;
    if (typeof v !== "number" || !Number.isFinite(v)) { errors.push(`${label}: "${field}" must be a number.`); return 0; }
    return v;
  };
  const boolField = (v: unknown, field: string): boolean => {
    if (v == null) return false;
    if (typeof v !== "boolean") { errors.push(`${label}: "${field}" must be true or false.`); return false; }
    return v;
  };
  const strOrNull = (v: unknown, field: string): string | null => {
    if (v == null) return null;
    if (typeof v !== "string") { errors.push(`${label}: "${field}" must be a string or null.`); return null; }
    return v || null;
  };
  return {
    name: c.name,
    dtype: c.dtype,
    pk: boolField(c.pk, "pk"),
    fk_ref: strOrNull(c.fk_ref, "fk_ref"),
    fk_mode: strOrNull(c.fk_mode, "fk_mode"),
    cardinality: strOrNull(c.cardinality, "cardinality"),
    orphan_pct: numField(c.orphan_pct, "orphan_pct"),
    generator: strOrNull(c.generator, "generator"),
    params: strOrNull(c.params, "params"),
    nullable_pct: numField(c.nullable_pct, "nullable_pct"),
    unique: boolField(c.unique, "unique"),
  };
}

export function parseModelJson(content: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { spec: null, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { spec: null, errors: ['The top-level JSON value must be an object: { "tables": {...}, "rules": [...], "views": {...} }.'] };
  }

  const input = parsed as JsonModelInput;
  const errors: string[] = [];
  const tables: Record<string, ModelColumn[]> = {};
  const views: Record<string, ModelView> = {};
  const rules: ModelRule[] = [];

  if (input.tables == null || typeof input.tables !== "object" || Array.isArray(input.tables)) {
    errors.push('"tables" is required and must be an object mapping table names to column arrays.');
  } else {
    for (const [tableName, rawCols] of Object.entries(input.tables)) {
      if (!Array.isArray(rawCols)) { errors.push(`Table '${tableName}': expected an array of columns.`); continue; }
      const cols: ModelColumn[] = [];
      const seen = new Set<string>();
      for (const raw of rawCols) {
        const col = jsonRowToColumn(raw, `Table '${tableName}'`, errors);
        if (!col) continue;
        if (seen.has(col.name)) { errors.push(`Table '${tableName}': duplicate column '${col.name}'.`); continue; }
        seen.add(col.name);
        cols.push(col);
      }
      if (cols.length) tables[tableName] = cols;
    }
  }

  if (input.views != null) {
    if (typeof input.views !== "object" || Array.isArray(input.views)) {
      errors.push('"views" must be an object mapping view names to view definitions.');
    } else {
      for (const [viewName, raw] of Object.entries(input.views)) {
        if (typeof raw !== "object" || raw === null) { errors.push(`View '${viewName}': expected an object.`); continue; }
        const v = raw as JsonViewInput;
        if (typeof v.source_objects !== "string" || !v.source_objects) {
          errors.push(`View '${viewName}': "source_objects" is required and must be a string.`);
        }
        const columns: ModelViewColumn[] = [];
        if (!Array.isArray(v.columns) || v.columns.length === 0) {
          errors.push(`View '${viewName}': "columns" is required and must be a non-empty array.`);
        } else {
          for (const raw2 of v.columns) {
            if (typeof raw2 !== "object" || raw2 === null) { errors.push(`View '${viewName}': each column must be an object.`); continue; }
            const c = raw2 as { name?: unknown; dtype?: unknown; derivation?: unknown };
            if (typeof c.name !== "string" || !c.name) { errors.push(`View '${viewName}': column "name" is required.`); continue; }
            if (typeof c.derivation !== "string" || !c.derivation) { errors.push(`View '${viewName}' (${c.name}): "derivation" is required.`); continue; }
            columns.push({ name: c.name, dtype: typeof c.dtype === "string" && c.dtype ? c.dtype : "string", derivation: c.derivation });
          }
        }
        views[viewName] = {
          source_objects: typeof v.source_objects === "string" ? v.source_objects : "",
          join_logic: typeof v.join_logic === "string" ? v.join_logic : null,
          filter_logic: typeof v.filter_logic === "string" ? v.filter_logic : null,
          group_by: typeof v.group_by === "string" ? v.group_by : null,
          columns,
        };
      }
    }
  }

  if (input.rules != null) {
    if (!Array.isArray(input.rules)) {
      errors.push('"rules" must be an array.');
    } else {
      input.rules.forEach((raw, i) => {
        if (typeof raw !== "object" || raw === null) { errors.push(`Rule #${i + 1}: expected an object.`); return; }
        const r = raw as JsonRuleInput;
        const missing = (["rule_id", "object", "rule_type", "definition"] as const).filter((f) => typeof r[f] !== "string" || !r[f]);
        if (missing.length) { errors.push(`Rule #${i + 1}: missing or non-string field(s): ${missing.join(", ")}.`); return; }
        rules.push({
          rule_id: r.rule_id as string,
          object: r.object as string,
          rule_type: r.rule_type as string,
          definition: r.definition as string,
        });
      });
    }
  }

  if (Object.keys(tables).length === 0 && errors.length === 0) {
    errors.push('"tables" has no entries. At least one table is required.');
  }
  for (const [viewName, view] of Object.entries(views)) {
    for (const src of view.source_objects.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!tables[src]) errors.push(`View '${viewName}' references table '${src}' in source_objects, which is not defined in "tables".`);
    }
  }

  if (errors.length > 0) return { spec: null, errors };
  return {
    spec: { tables, rules, inferred_fks: [], warnings: [], ...(Object.keys(views).length ? { views } : {}) },
    errors: [],
  };
}
