import type { ParsedColumn, ParsedSchema } from "./schemaParser.js";
import type { AgentModelSpec, InferredFK, ModelColumn, ModelRule } from "./modelTypes.js";
import { validateAndNormalize } from "./modelValidator.js";

export type { AgentModelSpec, InferredFK, ModelColumn, ModelRule } from "./modelTypes.js";

const FK_SUFFIX = /_id$|_ref$|_pk$|_bk$|_key$|^id$/i;

const CHOICE_DOMAINS: Record<string, { values: string; weights?: string }> = {
  currency: { values: "USD,EUR,INR,GBP", weights: "0.25,0.25,0.35,0.15" },
  payment_terms: { values: "NET30,NET45,NET60,IMMEDIATE", weights: "0.4,0.25,0.25,0.1" },
  unit_of_measure: { values: "EA,KG,M,L,BOX,LTR", weights: "0.3,0.2,0.15,0.15,0.1,0.1" },
  uom: { values: "EA,KG,M,L,BOX,LTR", weights: "0.3,0.2,0.15,0.15,0.1,0.1" },
  region: { values: "North,South,East,West,Central", weights: "0.25,0.2,0.2,0.2,0.15" },
  country: { values: "India,USA,UK,Germany,China", weights: "0.35,0.2,0.15,0.15,0.15" },
  po_status: { values: "OPEN,APPROVED,RECEIVED,CANCELLED", weights: "0.25,0.3,0.35,0.1" },
  status: { values: "OPEN,APPROVED,RECEIVED,CANCELLED", weights: "0.25,0.3,0.35,0.1" },
};

function isFkCandidate(name: string): boolean {
  return FK_SUFFIX.test(name);
}

function isLineTable(name: string): boolean {
  return /_line$|_item$|_detail$|order_line|line_item/.test(name);
}

function isHeaderTable(name: string): boolean {
  return (/_header$|purchase_order$|sales_order$|_order$/.test(name) || name === "order") && !isLineTable(name);
}

function isDependentChildTable(name: string): boolean {
  return isLineTable(name) || isHeaderTable(name) || /order|invoice|shipment/.test(name);
}

function tablePkPrefix(tableName: string): string {
  return tableName.replace(/_/g, "").toUpperCase();
}

function isLikelyTablePk(colName: string, tableName: string): boolean {
  const n = colName.toLowerCase();
  const t = tableName.toLowerCase();
  if (n === "id" || n === "primary_key") return true;
  if (n === `${t}_id`) return true;
  const singular = t.replace(/s$/, "");
  if (n === `${singular}_id`) return true;
  const tail = t.split("_").pop() ?? t;
  if (n === `${tail}_id`) return true;
  if (n === `${tail.replace(/s$/, "")}_id`) return true;
  if (t.includes("_line") && n.endsWith("_line_id")) return true;
  if (t.includes("_header") && (n === "po_id" || n.endsWith("_header_id"))) return true;
  return false;
}

function bareColumn(c: ParsedColumn): ModelColumn {
  return {
    name: c.name,
    dtype: c.dtype,
    pk: false,
    fk_ref: null,
    fk_mode: null,
    cardinality: null,
    orphan_pct: 0,
    generator: null,
    params: null,
    nullable_pct: c.nullable === false || c.pk ? 0 : c.nullable ? 0.1 : 0,
    unique: false,
  };
}

function designatePrimaryKey(cols: ModelColumn[], tableName: string, parsedCols: ParsedColumn[]): void {
  for (const c of cols) {
    c.pk = false;
    c.unique = false;
  }

  const ddlPk = parsedCols.find((p) => p.pk)?.name;
  const pkName =
    ddlPk ??
    cols.find((c) => isLikelyTablePk(c.name, tableName) && !isFkCandidate(c.name))?.name ??
    cols.find((c) => isLikelyTablePk(c.name, tableName))?.name ??
    cols[0]?.name;

  const pkCol = cols.find((c) => c.name === pkName);
  if (!pkCol) return;

  pkCol.pk = true;
  pkCol.unique = true;
  pkCol.nullable_pct = 0;
  pkCol.generator = "pattern";
  pkCol.params = `pattern=${tablePkPrefix(tableName)}-#####`;
  pkCol.fk_ref = null;
  pkCol.fk_mode = null;
}

function fkMatchesColumn(colName: string, otherTable: string, otherPk: string): boolean {
  const colBase = colName.replace(/_id$|_ref$|_pk$|_bk$|_key$/i, "");
  const tableBase = otherTable.replace(/_/g, "");
  const singular = otherTable.replace(/s$/, "");
  return (
    colName === otherPk ||
    colName === `${otherTable}_id` ||
    colName === `${tableBase}_id` ||
    colName === `${singular}_id` ||
    colBase === tableBase ||
    colBase === singular ||
    colBase.endsWith(`_${singular}`) ||
    (colName.includes(otherTable) && colName !== otherPk) ||
    colName.includes(singular)
  );
}

function inferFksForTables(
  tables: Record<string, ModelColumn[]>,
  pkByTable: Map<string, string>,
  onlyTables?: Set<string>,
): InferredFK[] {
  const inferred_fks: InferredFK[] = [];

  for (const [tableName, cols] of Object.entries(tables)) {
    if (onlyTables && !onlyTables.has(tableName)) continue;
    for (const col of cols) {
      if (col.pk || col.fk_ref) continue;
      if (!isFkCandidate(col.name)) continue;
      if (isLikelyTablePk(col.name, tableName) && col.name === pkByTable.get(tableName)) continue;

      for (const [otherTable, otherPk] of pkByTable) {
        if (otherTable === tableName) continue;
        if (!fkMatchesColumn(col.name, otherTable, otherPk)) continue;

        const pkRef = `${otherTable}.${otherPk}`;
        col.fk_ref = pkRef;
        col.fk_mode = "REFERENCE";
        col.generator = null;
        col.params = null;
        col.unique = false;
        inferred_fks.push({
          column: `${tableName}.${col.name}`,
          fk_ref: pkRef,
          confidence:
            col.name === `${otherTable}_id` || col.name === `${otherTable.replace(/s$/, "")}_id`
              ? "HIGH"
              : "MEDIUM",
          reason: `Column name matches PK ${pkRef}`,
        });
        break;
      }
    }
  }

  return inferred_fks;
}

function assignSizingFk(tableName: string, cols: ModelColumn[]): string | null {
  const fkCols = cols.filter((c) => c.fk_ref && !c.pk);
  if (fkCols.length === 0) return null;

  for (const c of fkCols) {
    c.fk_mode = "REFERENCE";
    c.cardinality = null;
  }

  let sizing: ModelColumn | undefined;

  if (isLineTable(tableName)) {
    sizing = fkCols.find((c) => {
      const [pt] = c.fk_ref!.split(".");
      return isHeaderTable(pt);
    });
    if (sizing) {
      sizing.fk_mode = "SIZING";
      sizing.cardinality = "1,15,poisson(3)";
      sizing.orphan_pct = 0;
      return sizing.name;
    }
  }

  if (isDependentChildTable(tableName)) {
    sizing = fkCols.find((c) => /vendor|supplier|customer/.test(c.name));
    if (sizing) {
      sizing.fk_mode = "SIZING";
      sizing.cardinality = "0,60,poisson(8)";
      sizing.orphan_pct = 0.05;
      return sizing.name;
    }

    sizing = fkCols.find((c) => {
      const [pt] = c.fk_ref!.split(".");
      return isHeaderTable(pt);
    });
    if (sizing) {
      sizing.fk_mode = "SIZING";
      sizing.cardinality = "1,15,poisson(3)";
      sizing.orphan_pct = 0;
      return sizing.name;
    }
  }

  return null;
}

function choiceParams(domain: { values: string; weights?: string }): string {
  return domain.weights ? `values=${domain.values}; weights=${domain.weights}` : `values=${domain.values}`;
}

function semanticGenerator(col: ModelColumn, tableName: string, cols: ModelColumn[], sizingFk: string | null): void {
  if (col.pk || col.fk_ref) return;

  const n = col.name.toLowerCase();

  if (/^email$|_email$/.test(n)) {
    col.generator = "faker";
    col.params = "provider=email";
    return;
  }

  if (/currency/.test(n)) {
    col.generator = "choice";
    col.params = choiceParams(CHOICE_DOMAINS.currency);
    return;
  }

  if (/payment_terms/.test(n)) {
    col.generator = "choice";
    col.params = choiceParams(CHOICE_DOMAINS.payment_terms);
    return;
  }

  if (/unit_of_measure|^uom$/.test(n)) {
    col.generator = "choice";
    col.params = choiceParams(CHOICE_DOMAINS.unit_of_measure);
    return;
  }

  if (/^region$|_region$/.test(n)) {
    col.generator = "choice";
    col.params = choiceParams(CHOICE_DOMAINS.region);
    return;
  }

  if (/^country$|_country$/.test(n)) {
    col.generator = "choice";
    col.params = choiceParams(CHOICE_DOMAINS.country);
    return;
  }

  if (/^status$|_status$|po_status/.test(n)) {
    col.generator = "choice";
    col.params = choiceParams(CHOICE_DOMAINS.po_status);
    return;
  }

  if (/material_name|product_name|item_name/.test(n)) {
    col.generator = "choice";
    col.params =
      "values=Carbon Steel Sheet,A4 Copier Paper,Industrial Solvent,Widget A,Widget B,Component X";
    return;
  }

  if (/vendor_name|supplier_name|company_name/.test(n)) {
    col.generator = "faker";
    col.params = "provider=company";
    return;
  }

  if (/cost_center_name|department_name/.test(n)) {
    col.generator = "choice";
    col.params = "values=Corporate HQ,Plant Operations,IT & Services,Finance,Logistics";
    return;
  }

  if (/buyer_name|employee_name|contact_name|person_name|customer_name/.test(n) || (n.endsWith("_name") && /buyer|employee|contact|person|customer/.test(n))) {
    col.generator = "faker";
    col.params = "provider=name";
    return;
  }

  if (/line_number|line_no|item_number|seq_no/.test(n) && sizingFk) {
    col.generator = "sequence";
    col.params = `scope=${sizingFk}; start=1`;
    return;
  }

  if (n === "unit_price" && cols.some((c) => c.name === "material_id")) {
    col.generator = "fk_lookup_jitter";
    col.params = "source=material.standard_cost; jitter_pct=0.12; round=2";
    return;
  }

  if (/standard_cost|unit_cost|cost|price|amount/.test(n) && !/line_amount|total/.test(n)) {
    col.generator = "numeric";
    col.params = "dist=lognormal; mean=4; sigma=0.6; min=1; max=10000; round=2";
    return;
  }

  if (/^qty$|^quantity$|_qty$/.test(n)) {
    col.generator = "numeric";
    col.params = "dist=uniform_int; min=1; max=100";
    return;
  }

  const dateCols = cols.filter(
    (c) => !c.pk && !c.fk_ref && (/date/.test(c.name.toLowerCase()) || c.dtype === "date"),
  );
  if ((/date/.test(n) || col.dtype === "date") && !col.generator) {
    const baseDate = dateCols.find(
      (c) => /(order|created|start|issue)_?date|^order_date$/.test(c.name.toLowerCase()) && c.name !== col.name,
    );
    if (baseDate) {
      col.generator = "date_offset";
      col.params = `base=${baseDate.name}; min_days=1; max_days=30`;
    } else {
      col.generator = "date";
      col.params = "start=2024-01-01; end=2025-12-31";
    }
    return;
  }

  if (col.dtype === "int") {
    col.generator = "numeric";
    col.params = "dist=uniform_int; min=1; max=1000";
    return;
  }

  if (col.dtype === "float") {
    col.generator = "numeric";
    col.params = "dist=uniform; min=1; max=1000; round=2";
    return;
  }

  if (col.dtype === "bool") {
    col.generator = "choice";
    col.params = "values=TRUE,FALSE";
    return;
  }

  if (/type|category|code/.test(n)) {
    col.generator = "choice";
    col.params = "values=TYPE_A,TYPE_B,TYPE_C";
    return;
  }

  col.generator = "faker";
  col.params = "provider=word";
}

function applyDerivedColumns(tables: Record<string, ModelColumn[]>, rules: ModelRule[], warnings: string[]): void {
  for (const [tableName, cols] of Object.entries(tables)) {
    const amount = cols.find((c) => /^(line_amount|line_total|total_amount)$/.test(c.name));
    const qty = cols.find((c) => /^(qty|quantity)$/.test(c.name));
    const price = cols.find((c) => c.name === "unit_price");
    if (amount && qty && price) {
      amount.generator = "derived";
      amount.params = `expr=${qty.name} * ${price.name}; round=2`;
      const ruleId = `R_DERIVED_${tableName}_${amount.name}`;
      if (!rules.some((r) => r.rule_id === ruleId)) {
        rules.push({
          rule_id: ruleId,
          object: tableName,
          rule_type: "derived",
          definition: `${amount.name} = ${qty.name} * ${price.name}`,
        });
      }
      warnings.push(`SME CONFIRM LOGIC: ${tableName}.${amount.name}`);
    }

    for (const col of cols) {
      if (/^total_/.test(col.name) && col.generator !== "derived" && !col.fk_ref && !col.pk) {
        const parts = cols.filter((c) => /amount|qty|price/.test(c.name) && c.name !== col.name);
        if (parts.length >= 2) {
          col.generator = "derived";
          col.params = `expr=${parts[0].name} + ${parts[1].name}; round=2`;
          warnings.push(`SME CONFIRM LOGIC: ${tableName}.${col.name}`);
        }
      }
    }
  }
}

function applyTemporalRules(tables: Record<string, ModelColumn[]>, rules: ModelRule[]): void {
  for (const [tableName, cols] of Object.entries(tables)) {
    const dateCols = cols.filter((c) => /date/.test(c.name.toLowerCase()) || c.dtype === "date");
    const orderDate = dateCols.find((c) => /order|po|created|start/.test(c.name.toLowerCase()));
    const promised = dateCols.find((c) => /promised|due|expected|delivery|ship/.test(c.name.toLowerCase()));

    if (orderDate && promised) {
      const ruleId = `R_TEMPORAL_${tableName}`;
      if (!rules.some((r) => r.rule_id === ruleId)) {
        rules.push({
          rule_id: ruleId,
          object: tableName,
          rule_type: "temporal_order",
          definition: `${orderDate.name} <= ${promised.name}`,
        });
      }
    }

    const statusCol = cols.find((c) => c.name.toLowerCase() === "status");
    const delivered = dateCols.find((c) => /delivered|shipped|received/.test(c.name.toLowerCase()));
    if (statusCol && delivered) {
      const ruleId = `R_STATUS_${tableName}_cancelled`;
      if (!rules.some((r) => r.rule_id === ruleId)) {
        rules.push({
          rule_id: ruleId,
          object: tableName,
          rule_type: "conditional",
          definition: `when ${statusCol.name} == 'CANCELLED' then ${delivered.name} NULL`,
        });
      }
    }
  }
}

function buildTableColumns(schema: ParsedSchema): ModelColumn[] {
  const cols = schema.columns.map(bareColumn);
  designatePrimaryKey(cols, schema.tableName, schema.columns);
  for (const source of schema.columns) {
    if (!source.fk_ref) continue;
    const column = cols.find(c => c.name === source.name)!;
    column.fk_ref = source.fk_ref;
    column.fk_mode = 'REFERENCE';
    column.generator = null; column.params = null;
  }
  return cols;
}

function finalizeModel(spec: AgentModelSpec): AgentModelSpec {
  const warnings = [...(spec.warnings ?? [])];
  const rules = [...(spec.rules ?? [])];
  const inferred_fks = [...(spec.inferred_fks ?? [])];

  for (const fk of inferred_fks) {
    const msg = `INFERRED FK: ${fk.column} -> ${fk.fk_ref}`;
    if (!warnings.includes(msg)) warnings.push(msg);
  }

  for (const [tableName, cols] of Object.entries(spec.tables)) {
    const sizingFk = assignSizingFk(tableName, cols);
    for (const col of cols) {
      semanticGenerator(col, tableName, cols, sizingFk);
    }
  }

  applyDerivedColumns(spec.tables, rules, warnings);
  applyTemporalRules(spec.tables, rules);

  const { spec: normalized, validation } = validateAndNormalize({
    tables: spec.tables,
    rules,
    inferred_fks,
    warnings,
  });

  if (!validation.ok) {
    normalized.warnings.push(
      `Rule-based model has validation issues: ${validation.errors.join("; ")}`,
    );
  }

  return normalized;
}

/** Rule-based model builder — used when Claude API is unavailable. */
export function buildModelFromSchemas(schemas: ParsedSchema[]): AgentModelSpec {
  const tables: Record<string, ModelColumn[]> = {};

  for (const schema of schemas) {
    tables[schema.tableName] = buildTableColumns(schema);
  }

  const pkByTable = new Map<string, string>();
  for (const [name, cols] of Object.entries(tables)) {
    const pk = cols.find((c) => c.pk);
    if (pk) pkByTable.set(name, pk.name);
  }

  const inferred_fks = inferFksForTables(tables, pkByTable);
  const warnings: string[] = [
    "Built with rule-based agent (no Claude API key). Review FKs before registering.",
    'Generator ranges, categories and dates are local defaults. Review the workbook for business realism; narrative requirements outside structured metadata are not interpreted in local mode.',
  ];

  return finalizeModel({ tables, rules: [], inferred_fks, warnings });
}

/** UPDATE: freeze base tables, add new schemas, infer FKs against base + new PKs. */
export function extendModelFromBase(
  baseSpec: AgentModelSpec,
  newSchemas: ParsedSchema[],
): AgentModelSpec {
  const tables: Record<string, ModelColumn[]> = {};
  for (const [name, cols] of Object.entries(baseSpec.tables)) {
    tables[name] = cols.map((c) => ({ ...c }));
  }

  const warnings = [
    "Built with rule-based agent (no Claude API key). Review FKs before registering.",
    `UPDATE extends base with ${newSchemas.length} new schema(s).`,
  ];

  for (const schema of newSchemas) {
    if (tables[schema.tableName]) {
      warnings.push(`Table '${schema.tableName}' already exists in base model — skipped.`);
      continue;
    }
    tables[schema.tableName] = buildTableColumns(schema);
  }

  const pkByTable = new Map<string, string>();
  for (const [name, cols] of Object.entries(tables)) {
    const pk = cols.find((c) => c.pk);
    if (pk) pkByTable.set(name, pk.name);
  }

  const newTableNames = new Set(newSchemas.map((s) => s.tableName).filter((n) => !(n in baseSpec.tables)));
  const inferred_fks = inferFksForTables(tables, pkByTable, newTableNames);

  const extended = finalizeModel({
    tables,
    rules: [...baseSpec.rules],
    inferred_fks: [...baseSpec.inferred_fks, ...inferred_fks],
    warnings,
  });
  // Finalization assigns generators and rules. Restore the immutable base after
  // applying those defaults, and retain only rules for newly introduced tables.
  for (const [name, columns] of Object.entries(baseSpec.tables)) extended.tables[name] = structuredClone(columns);
  extended.rules = [...structuredClone(baseSpec.rules), ...extended.rules.filter(rule => newTableNames.has(rule.object))];
  const ids = new Set(baseSpec.rules.map(rule => rule.rule_id));
  for (const rule of extended.rules.slice(baseSpec.rules.length)) {
    const original = rule.rule_id;
    let suffix = 1;
    while (ids.has(rule.rule_id)) rule.rule_id = `${original}_new${suffix++}`;
    ids.add(rule.rule_id);
  }
  return extended;
}