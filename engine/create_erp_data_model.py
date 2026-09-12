"""Create ERP data_model.xlsx — department, employee, service, supplier, product, PO, PO lines."""
from pathlib import Path
from openpyxl import Workbook

HEADERS = [
    "column_name", "dtype", "pk", "fk_ref", "fk_mode", "cardinality",
    "orphan_pct", "generator", "params", "nullable_pct", "unique",
]

OUT = Path(__file__).parent.parent / "Design docs" / "data_model_erp.xlsx"


def write_table(ws, rows):
    ws.append(HEADERS)
    for row in rows:
        ws.append(row)


def main():
    wb = Workbook()
    wb.remove(wb.active)

    tables = (
        "department",
        "employee",
        "service",
        "supplier",
        "product",
        "purchase_order",
        "purchase_order_line",
    )

    objects = wb.create_sheet("_OBJECTS")
    objects.append(["object_name", "object_type"])
    objects.append(["workbook_version", "1.1"])
    for name in tables:
        objects.append([name, "TABLE"])

    write_table(wb.create_sheet("department"), [
        ["department_id", "string", "Y", None, None, None, 0, "pattern", "pattern=DEPT-###", 0, "Y"],
        ["department_name", "string", "N", None, None, None, 0, "choice",
         "values=Finance,Procurement,Warehouse,IT Services,HR,Facilities", 0, "N"],
        ["cost_center", "string", "N", None, None, None, 0, "choice",
         "values=CC-100,CC-200,CC-300,CC-400,CC-500", 0, "N"],
        ["location", "string", "N", None, None, None, 0, "choice",
         "values=Head Office,Plant A,Plant B,Remote", 0, "N"],
    ])

    write_table(wb.create_sheet("employee"), [
        ["employee_id", "string", "Y", None, None, None, 0, "pattern", "pattern=EMP-#####", 0, "Y"],
        ["employee_name", "string", "N", None, None, None, 0, "faker", "provider=name", 0, "N"],
        ["email", "string", "N", None, None, None, 0, "faker", "provider=email", 0, "N"],
        ["department_id", "string", "N", "department.department_id", "REFERENCE", None, 0, None, None, 0, "N"],
        ["job_title", "string", "N", None, None, None, 0, "choice",
         "values=Accountant,Buyer,Warehouse Lead,Analyst,Manager,Technician", 0, "N"],
        ["hire_date", "date", "N", None, None, None, 0, "date", "start=2018-01-01; end=2025-12-31", 0, "N"],
    ])

    write_table(wb.create_sheet("service"), [
        ["service_id", "string", "Y", None, None, None, 0, "pattern", "pattern=SVC-####", 0, "Y"],
        ["service_name", "string", "N", None, None, None, 0, "choice",
         "values=IT Support,Payroll Processing,Facilities Maintenance,Security,Logistics,Help Desk", 0, "N"],
        ["department_id", "string", "N", "department.department_id", "REFERENCE", None, 0, None, None, 0, "N"],
        ["service_type", "string", "N", None, None, None, 0, "choice",
         "values=INTERNAL,EXTERNAL,SHARED; weights=0.5,0.3,0.2", 0, "N"],
        ["hourly_rate", "float", "N", None, None, None, 0, "numeric",
         "dist=lognormal; mean=4; sigma=0.5; min=25; max=500; round=2", 0, "N"],
        ["active_flag", "string", "N", None, None, None, 0, "choice",
         "values=TRUE,FALSE; weights=0.9,0.1", 0, "N"],
    ])

    write_table(wb.create_sheet("supplier"), [
        ["supplier_id", "string", "Y", None, None, None, 0, "pattern", "pattern=SUP-###", 0, "Y"],
        ["supplier_name", "string", "N", None, None, None, 0, "faker", "provider=company", 0, "N"],
        ["contact_email", "string", "N", None, None, None, 0, "faker", "provider=email", 0, "N"],
        ["payment_terms", "string", "N", None, None, None, 0, "choice",
         "values=NET30,NET45,NET60,IMMEDIATE; weights=0.4,0.25,0.25,0.1", 0, "N"],
        ["country", "string", "N", None, None, None, 0, "choice",
         "values=India,USA,UK,Germany; weights=0.4,0.25,0.2,0.15", 0, "N"],
    ])

    write_table(wb.create_sheet("product"), [
        ["product_id", "string", "Y", None, None, None, 0, "pattern", "pattern=PRD-#####", 0, "Y"],
        ["product_name", "string", "N", None, None, None, 0, "choice",
         "values=Office Chair,A4 Paper Ream,Steel Bolt M8,Industrial Solvent,Copier Toner", 0, "N"],
        ["category", "string", "N", None, None, None, 0, "choice",
         "values=Office Supplies,Raw Material,MRO,IT Equipment", 0, "N"],
        ["unit_price", "float", "N", None, None, None, 0, "numeric",
         "dist=uniform; min=0.5; max=500; round=2", 0, "N"],
        ["unit_of_measure", "string", "N", None, None, None, 0, "choice",
         "values=EA,KG,BOX,L; weights=0.5,0.2,0.2,0.1", 0, "N"],
    ])

    write_table(wb.create_sheet("purchase_order"), [
        ["purchase_order_id", "string", "Y", None, None, None, 0, "pattern", "pattern=PO-######", 0, "Y"],
        ["supplier_id", "string", "N", "supplier.supplier_id", "SIZING", "0,60,poisson(8)", 0.05, None, None, 0, "N"],
        ["order_date", "date", "N", None, None, None, 0, "date", "start=2024-01-01; end=2025-12-31", 0, "N"],
        ["status", "string", "N", None, None, None, 0, "choice",
         "values=OPEN,APPROVED,RECEIVED,CANCELLED; weights=0.2,0.3,0.45,0.05", 0, "N"],
        ["created_by_employee_id", "string", "N", "employee.employee_id", "REFERENCE", None, 0, None, None, 0, "N"],
    ])

    write_table(wb.create_sheet("purchase_order_line"), [
        ["line_id", "string", "Y", None, None, None, 0, "pattern", "pattern=LIN-#####", 0, "Y"],
        ["purchase_order_id", "string", "N", "purchase_order.purchase_order_id", "SIZING", "1,15,poisson(3)", 0, None, None, 0, "N"],
        ["line_number", "int", "N", None, None, None, 0, "sequence", "scope=purchase_order_id; start=1", 0, "N"],
        ["product_id", "string", "N", "product.product_id", "REFERENCE", None, 0, None, None, 0, "N"],
        ["quantity", "int", "N", None, None, None, 0, "numeric", "dist=uniform_int; min=1; max=100", 0, "N"],
        ["unit_price", "float", "N", None, None, None, 0, "fk_lookup_jitter",
         "source=product.unit_price; jitter_pct=0.12; round=2", 0, "N"],
        ["line_total", "float", "N", None, None, None, 0, "derived", "expr=quantity * unit_price; round=2", 0, "N"],
    ])

    rules = wb.create_sheet("_RULES")
    rules.append(["rule_id", "object", "rule_type", "definition"])
    rules.append(["R_ERP_DERIVED", "purchase_order_line", "derived", "line_total = quantity * unit_price"])
    rules.append(["R_ERP_CANCEL", "purchase_order", "conditional", "when status == 'CANCELLED' then order_date NOT NULL"])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"Created {OUT}")


if __name__ == "__main__":
    main()
