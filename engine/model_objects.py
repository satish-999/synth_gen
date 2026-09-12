"""
model_objects.py — emit a JSON summary of a data model workbook for the Node server.

Reuses synthgen.parse_workbook so the server and engine agree on structure.
Output (stdout): {
  "tables": {
    "<name>": {
      "pk": ["col", ...],
      "sizing": true|false,          # has a SIZING fk (row count is derived)
      "parents": ["parent_table", ...]
    }, ...
  },
  "views": ["<name>", ...]
}

Usage: python model_objects.py --model data_model.xlsx
"""
import argparse
import json

from synthgen import parse_workbook


def summarize(path):
    model = parse_workbook(path)
    tables = {}
    for name, cols in model["tables"].items():
        pk = [c["name"] for c in cols if c["pk"]]
        sizing = any(c["fk_mode"] == "SIZING" for c in cols)
        parents = sorted({
            c["fk_ref"].split(".")[0]
            for c in cols
            if c["fk_ref"] and c["fk_ref"].split(".")[0] != name
        })
        tables[name] = {"pk": pk, "sizing": sizing, "parents": parents}
    return {"tables": tables, "views": list(model["views"].keys())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    args = ap.parse_args()
    print(json.dumps(summarize(args.model)))


if __name__ == "__main__":
    main()
