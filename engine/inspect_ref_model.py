import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from synthgen import parse_workbook

m = parse_workbook(str(Path(__file__).parent.parent / "Design docs" / "data_model.xlsx"))
print("TABLES:", list(m["tables"].keys()))
print("RULES:", [(r["rule_id"], r["object"], r["definition"]) for r in m["rules"]])
for t, cols in m["tables"].items():
    print(f"\n=== {t} ===")
    for c in cols:
        print(
            c["name"], c["dtype"],
            "PK" if c["pk"] else "",
            c["fk_ref"] or "",
            c["fk_mode"] or "",
            c["generator"] or "null",
            c["params"],
        )
