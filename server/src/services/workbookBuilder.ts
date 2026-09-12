import * as XLSX from "xlsx";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AgentModelSpec, ModelColumn, ModelRule } from "./modelTypes.js";
import type { AgentDiff } from "./diffService.js";

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

/** Load a registered or draft workbook back into AgentModelSpec. */
export function readWorkbook(inputPath: string): AgentModelSpec {
  const wb = XLSX.read(readFileSync(inputPath), { type: "buffer" });
  const tables: Record<string, ModelColumn[]> = {};
  const rules: ModelRule[] = [];

  for (const sheet of wb.SheetNames) {
    if (sheet.startsWith("_")) continue;
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[sheet], {
      header: 1,
      defval: null,
    });
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

  return { tables, rules, inferred_fks: [], warnings: [] };
}

function tableSignature(cols: ModelColumn[]): string {
  return cols.map((c) => `${c.name}:${c.dtype}:${c.pk ? "pk" : ""}:${c.fk_ref ?? ""}`).join("|");
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

  return {
    mode,
    added_tables,
    added_views: [],
    added_rules,
    inferred_fks: newSpec.inferred_fks,
    modified_tables,
    unchanged_tables,
    removed_tables,
  };
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(objects), "_OBJECTS");

  for (const [tableName, cols] of Object.entries(spec.tables)) {
    const rows = [HEADERS, ...cols.map(colToRow)];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), tableName.slice(0, 31));
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
