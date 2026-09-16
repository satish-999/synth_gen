import * as XLSX from "xlsx";
import * as fs from "node:fs";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AgentModelSpec, ModelColumn, ModelRule, ModelView, ModelViewColumn } from "./modelTypes.js";
import type { AgentDiff } from "./diffService.js";

// xlsx 0.20.x cannot reach the filesystem under ESM unless fs is bound
// explicitly. Without this, XLSX.writeFile throws "cannot save file" before
// touching disk, which breaks every CREATE and UPDATE draft.
XLSX.set_fs(fs);

const HEADERS = [
  "column_name", "dtype", "pk", "fk_ref", "fk_mode", "cardinality",
  "orphan_pct", "generator", "params", "nullable_pct", "unique",
];

function colToRow(c: ModelColumn): (string | number | null)[] {
  return [
    c.name,
    c.dtype,
    c.pk ? "Y" : "N",
    c.fk_ref,
    c.fk_mode,
    c.cardinality,
    c.orphan_pct,
    c.generator,
    c.params,
    c.nullable_pct,
    c.unique ? "Y" : "N",
  ];
}

function rowToCol(row: (string | number | null)[]): ModelColumn {
  const yn = (v: unknown) => String(v ?? "").toUpperCase() === "Y";
  return {
    name: String(row[0] ?? ""),
    dtype: String(row[1] ?? "str"),
    pk: yn(row[2]),
    fk_ref: row[3] ? String(row[3]) : null,
    fk_mode: row[4] ? String(row[4]) : null,
    cardinality: row[5] ? String(row[5]) : null,
    orphan_pct: Number(row[6] ?? 0),
    generator: row[7] ? String(row[7]) : null,
    params: row[8] ? String(row[8]) : null,
    nullable_pct: Number(row[9] ?? 0),
    unique: yn(row[10]),
  };
}

/**
 * Parse a VIEW sheet exactly the way engine/synthgen.py's parse_workbook()
 * does: header-block key/value rows (source_objects, join_logic,
 * filter_logic, group_by) until a row whose first cell is literally
 * "column_name", then one row per output column. There is no end-of-section
 * marker in either implementation — keep both in sync.
 */
function parseViewSheet(rows: (string | number | null)[][]): ModelView {
  const spec: Record<string, string> = {};
  const columns: ModelViewColumn[] = [];
  let inCols = false;
  for (const row of rows) {
    if (row[0] === "column_name") {
      inCols = true;
      continue;
    }
    if (!inCols && row[0]) {
      spec[String(row[0])] = row[1] != null ? String(row[1]) : "";
    } else if (inCols && row[0]) {
      columns.push({ name: String(row[0]), dtype: String(row[1] ?? "string"), derivation: String(row[2] ?? "") });
    }
  }
  return {
    source_objects: spec.source_objects ?? "",
    join_logic: spec.join_logic || null,
    filter_logic: spec.filter_logic || null,
    group_by: spec.group_by || null,
    columns,
  };
}

/** Load a registered or draft workbook back into AgentModelSpec. */
export function readWorkbook(inputPath: string): AgentModelSpec {
  const wb = XLSX.read(readFileSync(inputPath), { type: "buffer" });
  const tables: Record<string, ModelColumn[]> = {};
  const views: Record<string, ModelView> = {};
  const rules: ModelRule[] = [];

  const objects = wb.Sheets._OBJECTS ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets._OBJECTS) : [];
  const objectType = (sheet: string): string | undefined =>
    objects.find((o) => o.object_name === sheet)?.object_type as string | undefined;

  for (const sheet of wb.SheetNames) {
    if (sheet.startsWith("_")) continue;
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[sheet], {
      header: 1,
      defval: null,
    });
    if (objectType(sheet) === "VIEW") {
      views[sheet] = parseViewSheet(rows);
      continue;
    }
    if (rows.length < 2) continue;
    tables[sheet] = rows.slice(1).map(rowToCol).filter((c) => c.name);
  }

  if (wb.SheetNames.includes("_RULES")) {
    const ruleRows = XLSX.utils.sheet_to_json<(string | null)[]>(wb.Sheets["_RULES"], {
      header: 1,
      defval: null,
    });
    for (const row of ruleRows.slice(1)) {
      if (!row[0]) continue;
      rules.push({
        rule_id: String(row[0]),
        object: String(row[1] ?? ""),
        rule_type: String(row[2] ?? ""),
        definition: String(row[3] ?? ""),
      });
    }
  }

  return { tables, rules, inferred_fks: [], warnings: [], ...(Object.keys(views).length ? { views } : {}) };
}

/** Keep original table sheets, guide, views and authoring metadata on additive updates. */
export function preserveBaseWorkbook(basePath: string, draftPath: string): void {
  const base = XLSX.read(readFileSync(basePath), { type: 'buffer', cellStyles: true });
  const draft = XLSX.read(readFileSync(draftPath), { type: 'buffer', cellStyles: true });
  const newNames = draft.SheetNames.filter(name => !name.startsWith('_') && !base.SheetNames.includes(name));
  for (const name of newNames) XLSX.utils.book_append_sheet(base, draft.Sheets[name], name);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(base.Sheets._OBJECTS, { header: 1, defval: null });
  // Two columns, matching every other row in this sheet (writeWorkbook never
  // writes a third). A mismatched row width here produces a ragged sheet.
  for (const name of newNames) rows.push([name, 'TABLE']);
  base.Sheets._OBJECTS = XLSX.utils.aoa_to_sheet(rows);
  // Draft rules already include the unchanged base rules plus new-table rules.
  if (draft.Sheets._RULES) base.Sheets._RULES = draft.Sheets._RULES;
  XLSX.writeFile(base, draftPath);
}

function tableSignature(cols: ModelColumn[]): string {
  return JSON.stringify(cols);
}

export function computeDiff(
  baseSpec: AgentModelSpec | null,
  newSpec: AgentModelSpec,
  mode: string,
): AgentDiff {
  const baseTables = baseSpec?.tables ?? {};
  const newTables = newSpec.tables;
  const baseNames = new Set(Object.keys(baseTables));
  const newNames = new Set(Object.keys(newTables));

  const added_tables = [...newNames].filter((n) => !baseNames.has(n));
  const removed_tables = [...baseNames].filter((n) => !newNames.has(n));
  const unchanged_tables: string[] = [];
  const modified_tables: string[] = [];

  for (const name of [...baseNames].filter((n) => newNames.has(n))) {
    if (tableSignature(baseTables[name]) === tableSignature(newTables[name])) {
      unchanged_tables.push(name);
    } else {
      modified_tables.push(name);
    }
  }

  const baseRuleIds = new Set((baseSpec?.rules ?? []).map((r) => r.rule_id));
  const added_rules = newSpec.rules.filter((r) => !baseRuleIds.has(r.rule_id));

  const baseViewNames = new Set(Object.keys(baseSpec?.views ?? {}));
  const added_views = Object.keys(newSpec.views ?? {}).filter((n) => !baseViewNames.has(n));

  return {
    mode,
    added_tables,
    added_views,
    added_rules,
    inferred_fks: newSpec.inferred_fks,
    modified_tables,
    unchanged_tables,
    removed_tables,
  };
}

function viewToRows(view: ModelView): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [
    ["source_objects", view.source_objects],
    ["join_logic", view.join_logic],
    ["filter_logic", view.filter_logic],
    ["group_by", view.group_by],
    [null, null],
    ["column_name", "data_type", "derivation"],
  ];
  for (const c of view.columns) rows.push([c.name, c.dtype, c.derivation]);
  return rows;
}

export function writeWorkbook(spec: AgentModelSpec, outputPath: string): void {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const wb = XLSX.utils.book_new();

  const objects: (string | number)[][] = [
    ["object_name", "object_type"],
    ["workbook_version", "1.1"],
  ];
  for (const name of Object.keys(spec.tables)) {
    objects.push([name, "TABLE"]);
  }
  for (const name of Object.keys(spec.views ?? {})) {
    objects.push([name, "VIEW"]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(objects), "_OBJECTS");

  for (const [tableName, cols] of Object.entries(spec.tables)) {
    const rows = [HEADERS, ...cols.map(colToRow)];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), tableName.slice(0, 31));
  }

  for (const [viewName, view] of Object.entries(spec.views ?? {})) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(viewToRows(view)), viewName.slice(0, 31));
  }

  const rules: (string | null)[][] = [["rule_id", "object", "rule_type", "definition"]];
  for (const r of spec.rules) {
    rules.push([r.rule_id, r.object, r.rule_type, r.definition]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rules), "_RULES");

  XLSX.writeFile(wb, outputPath);
}

export function writeManifest(spec: AgentModelSpec, outputPath: string): void {
  const manifest = {
    tables: Object.fromEntries(
      Object.entries(spec.tables).map(([name, cols]) => [
        name,
        { columns: cols.length, pk: cols.find((c) => c.pk)?.name ?? null },
      ]),
    ),
    inferred_fks: spec.inferred_fks,
    warnings: spec.warnings,
    rules: spec.rules.length,
  };
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
}

export function writeDiff(spec: AgentModelSpec, outputPath: string, mode: string): void {
  writeDiffCompare(null, spec, outputPath, mode);
}

export function writeDiffCompare(
  baseSpec: AgentModelSpec | null,
  newSpec: AgentModelSpec,
  outputPath: string,
  mode: string,
): void {
  const diff = computeDiff(baseSpec, newSpec, mode);
  writeFileSync(outputPath, JSON.stringify(diff, null, 2));
}