/** Generate procurement_demo_schemas.xlsx — all tables in one workbook. */
import * as XLSX from "xlsx";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "test-schemas", "procurement-demo");
const outPath = path.join(outDir, "procurement_demo_schemas.xlsx");

const sheets: Record<string, (string | number)[][]> = {
  cost_center: [
    ["cost_center_id", "cost_center_name", "region"],
    ["CC-100", "Corporate HQ", "North"],
    ["CC-200", "Plant Operations", "West"],
    ["CC-300", "IT & Services", "East"],
  ],
  vendor: [
    ["vendor_id", "vendor_name", "payment_terms", "country"],
    ["VEN-001", "SteelWorks Ltd", "Net 30", "India"],
    ["VEN-002", "OfficeMart Supplies", "Net 15", "India"],
    ["VEN-003", "ChemSource Global", "Net 45", "India"],
  ],
  material: [
    ["material_id", "material_name", "unit_of_measure", "standard_cost"],
    ["MAT-1001", "Carbon Steel Sheet", "KG", 85.5],
    ["MAT-1002", "A4 Copier Paper", "BOX", 12.0],
    ["MAT-1003", "Industrial Solvent", "LTR", 45.75],
  ],
  buyer: [
    ["buyer_id", "buyer_name", "email", "cost_center_id"],
    ["BUY-001", "Anita Sharma", "anita.sharma@company.com", "CC-200"],
    ["BUY-002", "Rahul Mehta", "rahul.mehta@company.com", "CC-100"],
    ["BUY-003", "Priya Nair", "priya.nair@company.com", "CC-300"],
  ],
  po_header: [
    ["po_id", "vendor_id", "buyer_id", "po_date", "status", "currency"],
    ["PO-00001", "VEN-001", "BUY-001", "2025-01-15", "APPROVED", "INR"],
    ["PO-00002", "VEN-002", "BUY-002", "2025-02-20", "OPEN", "INR"],
  ],
  po_line: [
    ["po_line_id", "po_id", "material_id", "qty", "unit_price", "line_amount"],
    ["POL-00001", "PO-00001", "MAT-1001", 10, 85.5, 855.0],
    ["POL-00002", "PO-00001", "MAT-1002", 5, 12.0, 60.0],
    ["POL-00003", "PO-00002", "MAT-1003", 20, 45.75, 915.0],
  ],
};

const wb = XLSX.utils.book_new();
for (const [name, rows] of Object.entries(sheets)) {
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
}
XLSX.writeFile(wb, outPath);
console.log(`Wrote ${outPath}`);
