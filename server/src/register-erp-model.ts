import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerWorkbookFromFile } from "./services/modelRegistrationService.js";

const wb = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "Design docs", "data_model_erp.xlsx");
const family = process.argv[2] ?? "erp_emp_dept";

const r = await registerWorkbookFromFile({
  workbookSource: wb,
  family,
  displayName: "ERP — Dept, Employee, Services",
  mode: "CREATE",
});
console.log("Registered", r.ref.modelKey, "tables:", r.tableCount);
