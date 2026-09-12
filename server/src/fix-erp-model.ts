/**
 * Rebuild erp_demo from schemas with fixed PK/FK logic → register v2.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchemaFile } from "./services/schemaParser.js";
import { buildModelFromSchemas } from "./services/ruleBasedAgent.js";
import { buildDraftWorkbook } from "./services/agentService.js";
import { registerVersion, getFamily } from "./services/registryService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.join(__dirname, "..", "test-schemas", "erp-demo");

async function main() {
  const fam = getFamily("erp_demo");
  if (!fam) throw new Error("erp_demo not registered — create it first");

  const files = readdirSync(schemasDir);
  const schemas = files.flatMap((f) =>
    parseSchemaFile(f, readFileSync(path.join(schemasDir, f))),
  );

  const spec = buildModelFromSchemas(schemas);
  const draftDir = path.join(__dirname, "..", "..", "uploads", "drafts", "erp-fix");
  const { workbookPath } = await buildDraftWorkbook(spec, draftDir, { mode: "REWRITE" });

  const ref = await registerVersion({
    family: "erp_demo",
    displayName: fam.display_name,
    workbookSource: workbookPath,
    mode: "REWRITE",
    registeredBy: "erp-fix-script",
    version: fam.latest_version + 1,
    baseVersion: fam.latest_version,
    diffSourcePath: path.join(draftDir, "diff.json"),
    sourceSchemasDir: schemasDir,
  });

  console.log(`Registered ${ref.modelKey}`);
  console.log(`FKs inferred: ${spec.inferred_fks.length}`);
  console.log(`Rules: ${spec.rules.length}`);
  spec.inferred_fks.forEach((fk) => console.log(`  ${fk.column} → ${fk.fk_ref}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
