/** Smoke: register Design docs/data_model.xlsx as a new family. */
import { readFileSync, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerWorkbookFromFile } from "./services/modelRegistrationService.js";
import { getFamily } from "./services/registryService.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = path.join(root, "Design docs", "data_model.xlsx");
const family = `ref_model_${Date.now().toString(36)}`;
const staged = path.join(root, "uploads", "register-smoke", `${family}.xlsx`);
mkdirSync(path.dirname(staged), { recursive: true });
copyFileSync(src, staged);

const result = await registerWorkbookFromFile({
  workbookSource: staged,
  family,
  displayName: "Reference Data Model",
  mode: "CREATE",
});

console.log("registered:", result.ref.modelKey, "tables:", result.tableCount);
console.log("family entry:", getFamily(family)?.versions);
