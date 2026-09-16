# Data Model Authoring Guide
### How the data model Excel workbook must be built
Companion file: **data_model_TEMPLATE.xlsx** — open it alongside this guide; it
contains the same sample model, a generator cheat sheet, and the authoring
checklist.

---

## 1. What the workbook is

The workbook **is** the data model. The generation engine reads only this file
and does exactly what it says. Anything you omit is not generated:

| If you omit… | The generated data will… |
|---|---|
| a foreign key | contain orphan references — links break in the ontology |
| a cardinality | have unrealistic shape (every parent identical, or wrong volumes) |
| a value domain (`choice`) | contain nonsense strings in status/country/currency columns |
| a derived expression | have totals that don't equal their components |
| a business rule | have delivery dates before order dates, delivered orders with no delivery date |

So the workbook is not documentation *about* the model — it is the model.

---

## 2. Workbook structure

| Sheet | Required | Purpose |
|---|---|---|
| `_OBJECTS` | Yes | Registry of every table and view. The engine reads it first. |
| One sheet per TABLE | Yes | One row per column, 12 attributes each. |
| One sheet per VIEW | If you have views | Derivation logic (different layout). |
| `_RULES` | Yes (may be empty) | Cross-column business rules. |
| `_GENERATORS` | Optional | Cheat sheet for authors; ignored by the engine. |

**Sheet names must match `_OBJECTS.object_name` exactly** — same case, same
underscores. This is the most common cause of "table not found" errors.

---

## 3. Sheet `_OBJECTS`

| object_name | object_type | description |
|---|---|---|
| SUPPLIER | TABLE | Supplier master |
| PART | TABLE | Part master |
| PURCHASE_ORDER | TABLE | Purchase order header |
| PO_LINE | TABLE | Purchase order line items |
| VW_OTD_SCORECARD | VIEW | On-time delivery rollup by supplier |
| workbook_version | 1.1 | Model format version — keep this row |

`object_type` is `TABLE` (generated) or `VIEW` (computed from tables). Order
doesn't matter — the engine works out dependencies itself.

---

## 4. Table sheets — the 12 columns

Every table sheet has this header row, then one row per column of that table.

| # | Column | Meaning | Example |
|---|---|---|---|
| 1 | `column_name` | Physical column name | `po_number` |
| 2 | `data_type` | string / int / decimal(p,s) / date / timestamp / boolean | `decimal(12,2)` |
| 3 | `is_pk` | `Y` for key columns. Composite key = several `Y` rows | `Y` |
| 4 | `fk_ref` | `PARENT_TABLE.parent_pk_column` | `SUPPLIER.supplier_id` |
| 5 | `fk_mode` | `SIZING` or `REFERENCE` (see §5) | `SIZING` |
| 6 | `cardinality` | SIZING only: `min,max,distribution` | `1,20,poisson(3)` |
| 7 | `orphan_pct` | Share of parents allowed zero children | `0.05` |
| 8 | `generator` | How values are produced (see §6) | `pattern` |
| 9 | `gen_params` | Generator arguments, `key=value` separated by `;` | `pattern=PO-2026-#####` |
| 10 | `nullable_pct` | Share of values left null | `0.1` |
| 11 | `is_unique` | `Y` to forbid duplicates | `Y` |
| 12 | `business_rule` | Rule IDs from `_RULES` that touch this column | `R2,R3` |

### The rule that matters most
> **A column with `fk_ref` filled must have `generator` EMPTY.**

Foreign key values are taken from the parent table, never invented. Giving an FK
column a generator is the single most damaging authoring error — it produces
keys that look right and reference nothing.

---

## 5. Relationships: SIZING vs REFERENCE

Every child table has **exactly one** `SIZING` foreign key — its structural
parent, the thing that *owns* it — and any number of `REFERENCE` foreign keys.

| Mode | Meaning | How rows are produced | Example |
|---|---|---|---|
| `SIZING` | Parent decides how many child rows exist | For each parent, roll the cardinality distribution and create that many rows carrying the parent's key | A PO owns its lines: `1,20,poisson(3)` |
| `REFERENCE` | Row count already decided; just pick a valid parent | Sample from the parent's generated keys | A line refers to a part |

### Reading `1,20,poisson(3)`
- `poisson(3)` — roll a count averaging **3**, varying naturally (some 1, some 6)
- `1` — minimum (a PO always has at least one line)
- `20` — maximum (cap outliers)

So 1,500 POs × ~3 → roughly 4,600 lines, with realistic variation instead of a
flat 3 everywhere. Raise the middle number for more children per parent; raise
`orphan_pct` to allow parents with none.

---

## 6. Generators — choose by meaning, not convenience

| Generator | Produces | `gen_params` example | Result |
|---|---|---|---|
| `pattern` | Codes; `#`=digit, `?`=letter | `pattern=PO-2026-#####` | `PO-2026-41235` |
| `faker` | Person/company names, emails | `provider=company` | `Gray Group` |
| `choice` | Weighted categorical | `values=OPEN,SHIPPED,DELIVERED; weights=0.25,0.2,0.55` | `DELIVERED` |
| `numeric` | uniform / uniform_int / lognormal | `dist=lognormal; mean=6.5; sigma=1.2; min=10; max=250000; round=2` | `1091.73` |
| `date` | Date in a window | `start=2025-07-01; end=2026-06-30` | `2026-01-18` |
| `date_offset` | Date relative to another column | `base=order_date; min_days=14; max_days=120` | `2026-04-08` |
| `sequence` | Counter restarting per parent | `scope=po_number; start=1` | `1,2,3` per PO |
| `fk_lookup` | Exact copy of a parent attribute | `source=PURCHASE_ORDER.po_nbr; via=po_header_ref` | lineage column |
| `fk_lookup_jitter` | Parent value ± percentage | `source=PART.unit_cost; jitter_pct=0.15; round=2` | `1033.12` |
| `derived` | Arithmetic over sibling columns | `expr=quantity * unit_price; round=2` | `84715.84` |
| `case` | Conditional text/flag | `when1=late_qty > 0; then1=LATE; when2=early_qty > 0; then2=EARLY; else=ON_TIME` | `ON_TIME` |

Two frequent mistakes: using `faker` for categorical columns (produces random
words in a `currency` column), and using `faker provider=name` for non-person
entities like materials or cost centres.

---

## 7. View sheets

A view is **computed from the generated tables, never generated randomly** — so
it always reconciles with its base data. Layout differs from a table sheet:

**Header block (rows 1–4)**

| key | value |
|---|---|
| `source_objects` | `PURCHASE_ORDER, PO_LINE, SUPPLIER` |
| `join_logic` | `PO_LINE.po_number = PURCHASE_ORDER.po_number; PURCHASE_ORDER.supplier_id = SUPPLIER.supplier_id` |
| `filter_logic` | `status != 'CANCELLED'` |
| `group_by` | `supplier_id, supplier_name` |

**Column rows (blank row, then a header row, then one row per output column)**

| column_name | data_type | derivation |
|---|---|---|
| supplier_id | string | `supplier_id` |
| supplier_name | string | `supplier_name` |
| total_lines | int | `count(line_number)` |
| on_time_lines | int | `sum(case when actual_delivery_date <= promised_date then 1 else 0 end)` |
| otd_pct | decimal(5,2) | `round(on_time_lines / total_lines * 100, 2)` |

Supported grammar: column references, arithmetic, `case when … then … else … end`,
and the aggregates `count / sum / avg / min / max`. Anything outside it is a
parse error, never silently ignored.

---

## 8. Sheet `_RULES`

| rule_id | object | rule_type | definition |
|---|---|---|---|
| R1 | PURCHASE_ORDER | `temporal_order` | `order_date <= promised_date` |
| R5 | PURCHASE_ORDER | `bound` | `actual_delivery_date >= order_date` |
| R2 | PURCHASE_ORDER | `conditional` | `when status == 'DELIVERED' then actual_delivery_date NOT NULL` |
| R3 | PURCHASE_ORDER | `conditional` | `when status in ('OPEN','CANCELLED') then actual_delivery_date NULL` |
| R4 | PO_LINE | `derived` | `line_total = quantity * unit_price` |

| rule_type | Enforces |
|---|---|
| `temporal_order` | Listed dates are in ascending order on every row |
| `bound` | One date never precedes another |
| `conditional` | A status value implies a column is set or null |
| `derived` | An arithmetic identity always holds |

Rules run **after** base generation, as a correction pass; `case` columns are
evaluated after rules, so status columns always agree with the corrected values.

---

## 9. Worked sample — the model in the template

Four tables and one view, exercising every concept:

```
PART ──REFERENCE──┐
                  ├──► PO_LINE ──SIZING──► PURCHASE_ORDER ──SIZING──► SUPPLIER
                  │    (1–20 per PO,                (0–60 per supplier,
                  │     poisson 3)                   poisson 8, 5% orphans)
                  │
                  └─ unit_price = PART.unit_cost ±15%   (fk_lookup_jitter)
                     line_total = quantity × unit_price (derived, rule R4)
                     line_number restarts at 1 per PO   (sequence)

VW_OTD_SCORECARD = computed from PO_LINE + PURCHASE_ORDER + SUPPLIER
```

Generating from it with 200 suppliers and 1,500 parts yields ~1,500 POs and
~4,600 lines, 100% referentially valid, every rule satisfied, and a scorecard
whose totals reconcile exactly against the lines.

---

## 10. Authoring checklist

Before the first generation run:

- ☐ Every table has a primary key marked (composite = several `Y` rows)
- ☐ Every foreign key found — **including ones the source system never declared**
      (look for `*_id`, `*_pk`, `*_ref`, `*_bk` matching another table's key)
- ☐ Every FK column has `generator` empty
- ☐ Exactly one `SIZING` FK per child table, with `cardinality` and `orphan_pct`
- ☐ Every non-FK column has a generator, chosen by meaning
- ☐ Categorical columns use `choice` with realistic domains and weights
- ☐ Every computed column (`*_total`, `*_amount`, `*_corrected`, flags, statuses)
      uses `derived` or `case` and has a `_RULES` row
- ☐ Every date pair has a `temporal_order` or `bound` rule
- ☐ Status ↔ nullable date relationships captured as `conditional` rules
- ☐ Sheet names match `_OBJECTS` exactly
- ☐ An SME has reviewed the distributions — weights, poisson averages, ranges

---

## 11. Tuning after the first run

Expect the first model to need adjustment; that is normal and cheap. Generate a
small run, load it into the real dashboard, and look at it with an SME:

| Symptom | Fix (one workbook cell) |
|---|---|
| On-time delivery near 0% or 100% | Adjust the `date_offset` window on the delivery date |
| Too many / too few child rows | Change the poisson average in `cardinality` |
| A category looks over-represented | Adjust `weights` in that column's `choice` |
| Amounts unrealistic | Change `mean` / `sigma` / `min` / `max` in `numeric` |
| Status distribution wrong | Adjust `weights` on the status column |

Then regenerate. No code is ever touched — that is the whole point of the design.
