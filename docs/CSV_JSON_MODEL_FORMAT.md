# CSV and JSON data model import

"Import data model" (`POST /api/models/register` to create a new family,
`POST /api/models/:family/:version/revise` to add a version) accepts a
`.xlsx`/`.xls` workbook as before, or a **`.csv`** or **`.json`** file
describing the same structure directly — no spreadsheet required.

The file is detected by extension, parsed into the same internal
representation `readWorkbook()` produces from a real workbook
(`server/src/services/modelTypes.ts`'s `AgentModelSpec`), written back out
through the real `writeWorkbook()`, and registered through the identical
path a workbook upload uses. **A CSV or JSON import produces exactly the
model an equivalent workbook would** — same validation
(`engine/validate_model.py`), same registration, same downloadable
`data_model.xlsx` afterward.

Parsing errors are returned as a list of specific, human-readable messages
(`{"error": "...", "fieldErrors": ["...", "..."]}`, HTTP 400) — never a
stack trace. Nothing is registered unless the whole file parses cleanly.

This is a *model* format: it describes tables, generators, rules and views —
the full authoring surface a workbook has. It is unrelated to the smaller
*metadata* formats the model-authoring agent accepts (`.csv`/`.json`/`.sql`/
`.md` describing one table's column names for an LLM or rule-based builder
to design a model *from* — see `templates/payment.csv` /
`templates/payment.json` for those). If you already have a full model, use
this format; if you have a rough table description and want the agent to
build the model, use the authoring agent instead.

---

## JSON shape

```json
{
  "tables": {
    "<table_name>": [
      {
        "name": "column_name",
        "dtype": "string",
        "pk": false,
        "fk_ref": null,
        "fk_mode": null,
        "cardinality": null,
        "orphan_pct": 0,
        "generator": null,
        "params": null,
        "nullable_pct": 0,
        "unique": false
      }
    ]
  },
  "views": {
    "<view_name>": {
      "source_objects": "table_a, table_b",
      "join_logic": "table_a.id = table_b.a_id",
      "filter_logic": "status != 'CANCELLED'",
      "group_by": "col1, col2",
      "columns": [
        { "name": "col1", "dtype": "string", "derivation": "col1" }
      ]
    }
  },
  "rules": [
    { "rule_id": "R1", "object": "table_a", "rule_type": "temporal_order", "definition": "start_date <= end_date" }
  ]
}
```

- **`tables`** (required, object): maps table name → array of column
  objects. At least one table is required.
- Column fields — only `name` and `dtype` are required; everything else
  defaults as shown above:
  | Field | Type | Meaning |
  |---|---|---|
  | `name` | string, required | Physical column name |
  | `dtype` | string, required | `string` / `int` / `float` / `date` / `bool` (or a SQL-ish type like `decimal(12,2)` — the engine only inspects it for its own type coercion, so more specific strings are fine) |
  | `pk` | boolean | Primary key. Composite key = several columns with `pk: true` |
  | `fk_ref` | string or null | `"parent_table.parent_pk_column"` |
  | `fk_mode` | string or null | `"SIZING"` or `"REFERENCE"` — required when `fk_ref` is set |
  | `cardinality` | string or null | SIZING only: `"min,max,distribution"`, e.g. `"1,20,poisson(3)"` |
  | `orphan_pct` | number | Share of parents allowed zero children (SIZING only) |
  | `generator` | string or null | See the generator table in `templates/DATA_MODEL_AUTHORING_GUIDE.md` §6. **Must be null/omitted when `fk_ref` is set** — FK values come from the parent, never a generator |
  | `params` | string or null | Generator arguments, `key=value` pairs separated by `;` — exactly the workbook's `gen_params` column, e.g. `"pattern=CAT-##"` or `"values=A,B; weights=0.5,0.5"` |
  | `nullable_pct` | number | Share of values left null |
  | `unique` | boolean | Forbid duplicate values |

- **`views`** (optional, object): maps view name → view definition.
  `source_objects` and a non-empty `columns` array are required;
  `join_logic`, `filter_logic` and `group_by` are optional (omit `group_by`
  entirely for a pass-through view — every joined/filtered row kept as-is,
  no aggregation). Every view column needs `name` and `derivation`; `dtype`
  defaults to `"string"`. Supported `derivation` grammar: column
  references, arithmetic, `case when … then … else … end`, and the
  aggregates `count/sum/avg/min/max` — see the authoring guide §7.
  Every name in `source_objects` must be a table defined in this same file.
- **`rules`** (optional, array): each entry needs all four fields —
  `rule_id`, `object` (table name), `rule_type`
  (`temporal_order`/`bound`/`conditional`/`derived`), `definition`. See the
  authoring guide §8 for the grammar of each `rule_type`.

## CSV shape

A single file, divided into sections by marker rows. Order doesn't matter;
blank lines between sections are cosmetic only.

```csv
## TABLE:category
column_name,dtype,pk,fk_ref,fk_mode,cardinality,orphan_pct,generator,params,nullable_pct,unique
category_id,string,Y,,,,,pattern,pattern=CAT-##,,Y
category_name,string,N,,,,,choice,"values=Electronics,Clothing; weights=0.5,0.5",,

## TABLE:product
column_name,dtype,pk,fk_ref,fk_mode,cardinality,orphan_pct,generator,params,nullable_pct,unique
product_id,string,Y,,,,,pattern,pattern=PRD-#####,,Y
category_id,string,N,category.category_id,SIZING,"0,20,poisson(4)",0.05,,,,
unit_price,decimal,N,,,,,numeric,dist=uniform; min=5; max=500; round=2,,

## VIEW:active_catalog
source_objects,product
filter_logic,unit_price > 0
column_name,data_type,derivation
product_id,string,product_id
unit_price,decimal,unit_price

## RULES
rule_id,object,rule_type,definition
R1,product,conditional,when unit_price > 0 then product_id NOT NULL
```

- **`## TABLE:<name>`** starts a table section. The next row must be the
  11-column header shown above (same columns, same order, as a workbook
  table sheet — `Y`/`N` for `pk` and `unique`, blank for null/zero), then
  one row per column.
- **`## VIEW:<name>`** starts a view section: one `key,value` row per header
  field you're setting (`source_objects`, `join_logic`, `filter_logic`,
  `group_by` — same meaning as the JSON form), then a
  `column_name,data_type,derivation` header row, then one row per output
  column. Leave `group_by` out entirely for a pass-through view.
- **`## RULES`** starts the rules section: a `rule_id,object,rule_type,definition`
  header row, then one row per rule.
- Standard CSV quoting applies: wrap a field in double quotes if it contains
  a comma (params like `"values=A,B,C; weights=0.5,0.3,0.2"` need this), and
  double a literal quote (`""`) inside a quoted field.
- At least one `## TABLE:` section is required. A file with no recognized
  section marker at all is rejected outright with a message pointing here,
  rather than a confusing "no tables found."

## What gets validated, and where

1. **Parse-time** (`server/src/services/modelImport.ts`): every column
   needs `name` and `dtype`; numeric fields must actually be numbers;
   boolean fields must be `Y`/`N` (CSV) or `true`/`false` (JSON); no
   duplicate column names within a table; every view's `source_objects`
   must name a table defined in the same file. Every problem found is
   collected and returned together — the file is never partially imported.
2. **Registration-time**, identical to a workbook upload: the generated
   `.xlsx` is validated by `engine/validate_model.py` (every table needs a
   primary key, every `fk_ref` must resolve to a real PK, every `SIZING`
   FK needs a `cardinality`, every non-FK column needs a `generator`) before
   anything is written to the registry.

## Samples

`templates/` has a worked example of the same `payment` table across all
four *metadata* formats (`payment.sql`, `retail_add_payment_metadata.md`,
`payment.csv`, `payment.json`) for the authoring agent — not this format.
For a full model example in this format, see the fixture in
`server/src/test-model-import.ts`, which is round-tripped through the real
engine (`validate_model.py` and `synthgen.py`) as part of the test suite.
