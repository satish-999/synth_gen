/**
 * Smoke: full run then partial — only selected tables in output.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveModelRef } from "./services/registryService.js";
import { generate } from "./services/generationService.js";

const seed = 42;
const ref =
  resolveModelRef("erp_emp_dept", 1) ??
  resolveModelRef("erp_demo", 2) ??
  resolveModelRef("erp_demo", 3);

if (!ref) {
  console.error("No erp model found — import data_model_erp.xlsx first");
  process.exit(1);
}

console.log("Model:", ref.modelKey);

const full = await generate({
  modelKey: ref.modelKey,
  modelPath: ref.modelPath,
  family: ref.family,
  version: ref.version,
  selectedTables: [
    "department",
    "employee",
    "service",
    "supplier",
    "product",
    "purchase_order",
    "purchase_order_line",
  ],
  requestedRows: {
    department: 20,
    employee: 50,
    service: 30,
    supplier: 30,
    product: 80,
    purchase_order: 40,
    purchase_order_line: 60,
  },
  seed,
  locale: "en_US",
  formats: ["csv"],
});

console.log("Full run:", full.status, "files:", full.files.length);
if (full.status !== "PASS") {
  console.error(full.error ?? full.compliance.checks.filter((c) => !c.pass).map((c) => c.name));
  process.exit(1);
}

const partial = await generate({
  modelKey: ref.modelKey,
  modelPath: ref.modelPath,
  family: ref.family,
  version: ref.version,
  selectedTables: ["purchase_order", "purchase_order_line"],
  requestedRows: { purchase_order: 25, purchase_order_line: 50 },
  seed,
  locale: "en_US",
  formats: ["csv"],
});

console.log("Partial targets:", partial.targets);
console.log("Referenced:", partial.referencedTables?.join(", "));
console.log("Partial files:", partial.files.join(", "));

if (partial.status !== "PASS") {
  console.error(partial.error);
  process.exit(1);
}

if (partial.files.some((f) => f === "department.csv" || f === "employee.csv")) {
  console.error("Should not output unselected parent tables");
  process.exit(1);
}

const poCount =
  readFileSync(join(partial.outputPath, "purchase_order.csv"), "utf8").trim().split("\n").length - 1;
const lineCount =
  readFileSync(join(partial.outputPath, "purchase_order_line.csv"), "utf8")
    .trim()
    .split("\n").length - 1;

console.log("PO rows:", poCount, "line rows:", lineCount);
if (poCount !== 25 || lineCount !== 50) {
  console.error("Row counts mismatch");
  process.exit(1);
}

console.log("\nPartial generation smoke: PASS");
