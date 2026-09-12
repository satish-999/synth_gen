/** End-to-end: build model from procurement xlsx, generate, run compliance gate. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchemaFile } from "./services/schemaParser.js";
import { buildModelFromSchemas } from "./services/ruleBasedAgent.js";
import { writeWorkbook } from "./services/workbookBuilder.js";
import { generate } from "./services/generationService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, "..", "test-schemas", "procurement-demo");
const xlsxPath = path.join(dir, "procurement_demo_schemas.xlsx");

const schemas = parseSchemaFile("procurement_demo_schemas.xlsx", readFileSync(xlsxPath));
const spec = buildModelFromSchemas(schemas);

const modelPath = path.join(__dirname, "..", "..", "uploads", "drafts", "proc-e2e", "data_model.xlsx");
writeWorkbook(spec, modelPath);
console.log("wrote model:", modelPath);

const result = await generate({
  modelKey: "proc-e2e",
  modelPath,
  selectedTables: ["po_line"],
  requestedRows: { cost_center: 5, vendor: 20, material: 30, buyer: 10 },
  seed: 42,
  locale: "en_US",
  formats: ["csv"],
});

console.log("\nstatus:", result.status);
console.log("auto-included:", result.autoIncluded.join(", "));
console.log("files:", result.files.join(", "));
if (result.error) console.log("ERROR:", result.error);
console.log("outputPath:", result.outputPath);

const fkChecks = result.compliance.checks.filter((c) => c.name.includes(": FK ->"));
console.log("\nFK integrity checks:");
for (const c of fkChecks) console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name} ${c.detail}`);

const derived = result.compliance.checks.filter((c) => /= qty \* unit_price|line_amount/.test(c.name));
for (const c of derived) console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name} ${c.detail}`);

const failed = result.compliance.checks.filter((c) => !c.pass);
console.log(`\ntotal checks: ${result.compliance.checks.length}, failed: ${failed.length}`);
for (const c of failed) console.log(`  FAIL: ${c.name} ${c.detail}`);

process.exit(result.status === "PASS" ? 0 : 1);
