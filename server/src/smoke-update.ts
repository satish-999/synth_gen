/**
 * Phase 7 smoke — UPDATE adds a table to an existing family as v(N+1).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { parseSchemaFile } from "./services/schemaParser.js";
import { generateUpdateModel, buildDraftWorkbook } from "./services/agentService.js";
import { readWorkbook } from "./services/workbookBuilder.js";
import { insertAgentJob, getAgentJob, updateAgentJob } from "./db/agentJobs.js";
import { registerVersion, workbookPath, getFamily } from "./services/registryService.js";
import { DRAFTS_PATH } from "./config.js";
import { mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const family = "library";
  const fam = getFamily(family);
  if (!fam) throw new Error("library family missing — run npm run smoke:agent first");

  const baseVersion = fam.latest_version;
  const baseSpec = readWorkbook(workbookPath(family, baseVersion));

  const newSchema = `CREATE TABLE holds (
  hold_id INTEGER PRIMARY KEY,
  member_id INTEGER,
  book_id INTEGER,
  hold_date DATE
);`;
  const newSchemas = parseSchemaFile("holds.sql", Buffer.from(newSchema));

  const spec = await generateUpdateModel(baseSpec, newSchemas, family, baseVersion);
  const jobId = `upd${uuidv4().slice(0, 8)}`;
  const draftDir = path.join(DRAFTS_PATH, jobId);
  mkdirSync(draftDir, { recursive: true });

  const { manifestPath, diffPath } = await buildDraftWorkbook(spec, draftDir, {
    mode: "UPDATE",
    baseSpec,
  });

  insertAgentJob({
    job_id: jobId,
    mode: "UPDATE",
    family_id: family,
    display_name: fam.display_name,
    base_version: baseVersion,
    status: "DRAFT_READY",
    draft_path: draftDir,
    manifest: readFileSync(manifestPath, "utf8"),
    diff: readFileSync(diffPath, "utf8"),
    schema_files: JSON.stringify(["holds.sql"]),
    error: null,
    agent_source: "smoke",
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  const diff = JSON.parse(readFileSync(diffPath, "utf8"));
  if (!diff.added_tables.includes("holds")) {
    throw new Error(`Expected 'holds' in added_tables, got ${diff.added_tables}`);
  }

  const ref = await registerVersion({
    family,
    displayName: fam.display_name,
    workbookSource: path.join(draftDir, "data_model.xlsx"),
    mode: "UPDATE",
    registeredBy: "smoke-update",
    version: baseVersion + 1,
    agentJobId: jobId,
    sourceSchemasDir: path.join(draftDir, "source_schemas"),
    diffSourcePath: diffPath,
    baseVersion,
  });

  updateAgentJob(jobId, { status: "APPROVED" });
  writeFileSync(path.join(draftDir, "smoke_ok.txt"), ref.modelKey);

  console.log(`>> UPDATE smoke: ${family} v${baseVersion} → ${ref.modelKey}`);
  console.log(`>> added tables: ${diff.added_tables.join(", ")}`);
  console.log("\nPhase 7 smoke: PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
