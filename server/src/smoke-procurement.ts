import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchemaFile } from "./services/schemaParser.js";
import { buildModelFromSchemas } from "./services/ruleBasedAgent.js";
import { validateAgentModel } from "./services/modelValidator.js";
import { buildDraftWorkbook } from "./services/agentService.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test-schemas", "procurement-demo");
const xlsxPath = path.join(dir, "procurement_demo_schemas.xlsx");
const schemas = parseSchemaFile("procurement_demo_schemas.xlsx", readFileSync(xlsxPath));

const spec = buildModelFromSchemas(schemas);
const validation = validateAgentModel(spec);

console.log("tables:", Object.keys(spec.tables).join(", "));
console.log("validation:", validation.ok ? "PASS" : "FAIL", validation.errors);
console.log("FKs:", spec.inferred_fks.length, "rules:", spec.rules.length, "warnings:", spec.warnings.length);

for (const [table, cols] of Object.entries(spec.tables)) {
  const pk = cols.find((c) => c.pk);
  const fks = cols.filter((c) => c.fk_ref);
  console.log(`\n${table}:`);
  if (pk) console.log(`  PK ${pk.name}: ${pk.generator} ${pk.params}`);
  for (const fk of fks) {
    console.log(`  FK ${fk.name} -> ${fk.fk_ref} mode=${fk.fk_mode} gen=${fk.generator} card=${fk.cardinality ?? "-"}`);
  }
  const derived = cols.find((c) => c.generator === "derived");
  if (derived) console.log(`  DERIVED ${derived.name}: ${derived.params}`);
}

spec.inferred_fks.forEach((fk) => console.log(" inferred:", fk.column, "->", fk.fk_ref));

const draftDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "uploads", "drafts", "proc-smoke");
await buildDraftWorkbook(spec, draftDir, { mode: "CREATE" });
console.log("\ndraft workbook validated OK");
