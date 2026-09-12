/**
 * Phase 3 smoke test — registry bootstrap, model listing, generation via retail@v1.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { REGISTRY_PATH } from "./config.js";
import { bootstrapRegistryIfEmpty, listFamilies, resolveModelRef } from "./services/registryService.js";
import { generate } from "./services/generationService.js";

async function main() {
  console.log(">> bootstrap registry");
  await bootstrapRegistryIfEmpty();

  const families = listFamilies();
  if (families.length === 0) {
    console.error("No families in registry. Run engine/verify.py first.");
    process.exit(1);
  }
  console.log(`   families: ${families.map((f) => `${f.id} v${f.latest_version}`).join(", ")}`);

  const ref = resolveModelRef("retail", 1);
  if (!ref) {
    console.error("retail@v1 not found in registry.");
    process.exit(1);
  }
  console.log(`   workbook: ${ref.modelPath}`);

  console.log(">> generate (order_item only, FK parents auto-included)");
  const result = await generate({
    modelKey: ref.modelKey,
    modelPath: ref.modelPath,
    family: ref.family,
    version: ref.version,
    selectedTables: ["order_item"],
    requestedRows: { customer: 50, product: 80, category: 6 },
    seed: 7,
    locale: "en_US",
    formats: ["csv", "xlsx"],
  });

  console.log(`   run:           ${result.runId}`);
  console.log(`   status:        ${result.status}`);
  console.log(`   auto-included: ${result.autoIncluded.join(", ")}`);
  console.log(`   files:         ${result.files.join(", ")}`);

  const failures: string[] = [];
  if (result.status !== "PASS") failures.push(`status is ${result.status}`);
  if (!result.files.includes("synthetic_data.xlsx")) failures.push("no XLSX");
  if (!existsSync(path.join(REGISTRY_PATH, "retail", "v1", "data_model.xlsx"))) {
    failures.push("registry/retail/v1/data_model.xlsx missing");
  }
  if (!existsSync(path.join(REGISTRY_PATH, "index.json"))) {
    failures.push("registry/index.json missing");
  }

  if (failures.length) {
    console.error("\nSMOKE FAIL:\n - " + failures.join("\n - "));
    process.exit(1);
  }
  console.log("\nPhase 3 smoke: PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
