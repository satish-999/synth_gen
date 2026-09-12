import { readWorkbook } from "./services/workbookBuilder.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wb = path.resolve(__dirname, "../../registry/erp_demo/v2/data_model.xlsx");

const s = readWorkbook(wb);
for (const t of ["purchase_order", "purchase_order_line", "employees", "suppliers"]) {
  console.log("---", t);
  for (const c of s.tables[t]) {
    console.log(
      `  ${c.name} pk=${c.pk} fk=${c.fk_ref ?? "-"} gen=${c.generator ?? "-"} params=${c.params ?? "-"}`,
    );
  }
}
