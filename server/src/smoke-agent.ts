/**
 * Phase 5 smoke — CREATE agent job from test schemas, validate draft, register library v1.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchemaFile } from "./services/schemaParser.js";
import { generateCreateModel, buildDraftWorkbook } from "./services/agentService.js";
import { registerVersion, getFamily } from "./services/registryService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.join(__dirname, "..", "test-schemas");

async function main() {
  const files = ["members.csv", "books.csv", "loans.sql"];
  const schemas = files.flatMap((f) =>
    parseSchemaFile(f, readFileSync(path.join(schemasDir, f))),
  );

  console.log(`>> parsed ${schemas.length} tables: ${schemas.map((s) => s.tableName).join(", ")}`);

  const spec = await generateCreateModel(schemas, "library lending");
  console.log(`>> agent built model: ${Object.keys(spec.tables).join(", ")}`);
  console.log(`>> inferred FKs: ${spec.inferred_fks.length}`);

  const draftDir = path.join(__dirname, "..", "..", "uploads", "drafts", "smoke-test");
  const { workbookPath } = await buildDraftWorkbook(spec, draftDir);
  console.log(`>> draft workbook validated: ${workbookPath}`);

  const family = "library";
  if (getFamily(family)) {
    console.log(`   family '${family}' already registered — skipping approve`);
  } else {
    const ref = await registerVersion({
      family,
      displayName: "Library Demo",
      description: "Phase 5 smoke test model",
      workbookSource: workbookPath,
      mode: "BOOTSTRAP",
      registeredBy: "smoke-agent",
      version: 1,
    });
    console.log(`>> registered ${ref.modelKey}`);
  }

  console.log("\nPhase 5 smoke: PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
