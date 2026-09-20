# SynthGen — Complete Architecture & Design Document
**Synthetic Data Generation Tool**
Status as of this document: working locally, reachable remotely via tunnel, three
engine layers proven across five different data models.

---

## 1. What the tool does

Ontology objects and their backing datasets arrive empty — schemas cross the
boundary, data does not, for security and governance reasons. Without data,
dashboards can't be built, pipelines can't be tested, ontology links can't be
verified, demos have nothing to show.

SynthGen generates **relationally correct synthetic data** from a governed data
model: a user picks a model, picks datasets, sets row counts, presses Generate,
and downloads validated CSV/Excel files. Foreign keys resolve, business rules
hold, derived columns compute correctly, and nothing is released unless an
independent validator passes it.

---

## 2. Architecture

### 2.1 Component map

```
 ┌──────────────────────── YOUR MACHINE ─────────────────────────┐
 │                                                               │
 │  client/dist  ──served by──►  server (Node + TypeScript)      │
 │  (React UI)                    tsx watch src/index.ts         │
 │                                port 3000, HOST=0.0.0.0        │
 │                                       │                       │
 │                                       │ child_process.spawn   │
 │                                       ▼                       │
 │                         engine/  (Python)                     │
 │                          ├─ synthgen.py           generation  │
 │                          └─ validate_compliance.py  audit     │
 │                                       │                       │
 │                          registry/  model workbooks (.xlsx)   │
 │                          runs/      per-run outputs + reports │
 │                          uploads/   imported models           │
 └───────────────────────────────────────────────────────────────┘
                    │                        │
          LAN 192.168.x.x:3000      cloudflared tunnel
          (same Wi-Fi only)         https://<random>.trycloudflare.com
                                    (any network, while PC is on)
```

### 2.2 The three layers (the core design principle)

| Layer | Artifact | Owned by | Changes per use case? |
|---|---|---|---|
| **Knowledge** | Data model workbook (.xlsx) | Data/SME team | **Yes** — this is the only thing that changes |
| **Instruction** | Run config (built by the UI) | End user, per run | Per run |
| **Machinery** | `synthgen.py` + `validate_compliance.py` | Engineering | **No** — never |

The engine contains **zero** knowledge of any table. Point it at a different
workbook and it generates a different domain. This is what makes one tool serve
SUMMIT, PBOMAT, QDSS, or anything else without code changes.

---

## 3. How it runs, and what the links mean

### 3.1 Correcting one assumption: it is **not** running on a public IP

Your machine sits behind NAT on a private address (192.168.x.x). That address is
not routable from the internet. Three different access paths exist, and only one
works off-network:

| Link | Scope | Requirement |
|---|---|---|
| `http://localhost:3000` | That PC only | Server running |
| `http://192.168.19.95:3000` | Same Wi-Fi only | Server running + `HOST=0.0.0.0` + firewall rule |
| `https://<random>.trycloudflare.com` | **Any network** | Server running **and** `cloudflared` running |

The tunnel is what makes it reachable publicly — not a public IP. Cloudflare
holds the public address and forwards traffic down an outbound connection your
machine opened.

### 3.2 The startup sequence (both processes required)

```powershell
# window 1 — the server
cd C:\Users\hi\projects\synthetic-data-gen\server
$env:HOST="0.0.0.0"
npm run dev
# -> SynthGen server listening on http://0.0.0.0:3000

# window 2 — the public link
cloudflared tunnel --url http://localhost:3000
# -> https://<random-words>.trycloudflare.com
```

**Consequences to understand:**
- Close either window, sleep the PC, or shut down → every link dies instantly.
- Each tunnel restart produces a **different random URL**; the old one is
  permanently dead (`DNS_PROBE_FINISHED_NXDOMAIN`).
- `npm run dev` doesn't "create a link" — it starts the server. The tunnel
  creates the link.

---

## 4. Data model design (what the tool follows)

The workbook **is** the model. The engine reads only this file.

### 4.1 Workbook structure

| Sheet | Purpose |
|---|---|
| `_OBJECTS` | Registry of every table and view; read first |
| One sheet per TABLE | One row per column, 12 attributes |
| One sheet per VIEW | Derivation logic (different layout) |
| `_RULES` | Cross-column business rules |

Sheet names must match `_OBJECTS.object_name` exactly.

### 4.2 Table sheet — the 12 columns

| # | Column | Meaning | Example |
|---|---|---|---|
| 1 | `column_name` | Physical name | `po_number` |
| 2 | `data_type` | string / int / decimal(p,s) / date / boolean | `decimal(12,2)` |
| 3 | `is_pk` | `Y` for key columns (composite = several `Y`) | `Y` |
| 4 | `fk_ref` | `PARENT_TABLE.parent_pk` | `SUPPLIER.supplier_id` |
| 5 | `fk_mode` | `SIZING` or `REFERENCE` | `SIZING` |
| 6 | `cardinality` | SIZING only: `min,max,poisson(avg)` | `1,20,poisson(3)` |
| 7 | `orphan_pct` | Share of parents with zero children | `0.05` |
| 8 | `generator` | How values are produced | `pattern` |
| 9 | `gen_params` | `key=value` pairs separated by `;` | `pattern=PO-2026-#####` |
| 10 | `nullable_pct` | Null share, **as a fraction** (0.05 not 5) | `0.05` |
| 11 | `is_unique` | `Y` forbids duplicates | `Y` |
| 12 | `business_rule` | Rule IDs from `_RULES` | `R2,R3` |

**The single most important rule:** a column with `fk_ref` filled must have
`generator` **empty**. FK values are taken from the parent; giving an FK column a
generator produces keys that look right and reference nothing.

### 4.3 Relationship modes

| Mode | Meaning | Row production |
|---|---|---|
| `SIZING` | Parent owns the child; parent count drives child rows | Per parent, roll cardinality, stamp that parent's key onto that many rows |
| `REFERENCE` | Row count decided elsewhere | Sample a valid key from the parent |

Exactly one SIZING FK per child table. `1,20,poisson(3)` = "around 3 children per
parent, never fewer than 1, never more than 20."

### 4.4 Generator catalogue (all implemented)

| Generator | Produces | Params example |
|---|---|---|
| `pattern` | Codes; `#`=digit, `?`=letter | `pattern=PO-2026-#####` |
| `faker` | Names, companies, emails | `provider=company` |
| `choice` | Weighted categorical | `values=A,B,C; weights=0.5,0.3,0.2` |
| `numeric` | uniform / uniform_int / lognormal | `dist=lognormal; mean=6.5; sigma=1.2; round=2` |
| `date` | Date in a window | `start=2025-07-01; end=2026-06-30` |
| `date_offset` | Date relative to another column | `base=order_date; min_days=14; max_days=120` |
| `sequence` | Counter restarting per parent | `scope=po_number; start=1` |
| `fk_lookup` | Exact copy of a parent attribute (lineage) | `source=DEMANDS.period_start; via=demand_id` |
| `fk_lookup_jitter` | Parent value ± % (optional `multiplier`) | `source=PART.unit_cost; jitter_pct=0.15; multiplier=1.45` |
| `derived` | Arithmetic over sibling columns | `expr=quantity * unit_price; round=2` |
| `case` | Conditional label from other columns | `when1=late_qty > 0; then1=LATE; else=ON_TIME` |

### 4.5 View sheet

Views are **computed from generated tables, never generated randomly**, so they
always reconcile.

```
source_objects   PURCHASE_ORDER, PO_LINE, SUPPLIER
join_logic       PO_LINE.po_number = PURCHASE_ORDER.po_number; ...
filter_logic     status != 'CANCELLED'
group_by         supplier_id, supplier_name
(blank row)
column_name  | data_type    | derivation
supplier_id  | string       | supplier_id
total_lines  | int          | count(line_number)
on_time_lines| int          | sum(case when actual <= promised then 1 else 0 end)
otd_pct      | decimal(5,2) | round(on_time_lines / total_lines * 100, 2)
```

Grammar: column refs, arithmetic, `case when…end`, and `count/sum/avg/min/max`.
`group_by` may be empty for a pass-through (filtered) view.

### 4.6 `_RULES` sheet

| rule_type | Enforces | Example |
|---|---|---|
| `temporal_order` | Dates ascending on every row | `order_date <= promised_date` |
| `bound` | One date never precedes another | `delivery_date >= order_date` |
| `conditional` | Status implies set/null | `when status == 'DELIVERED' then delivery_date NOT NULL` |
| `derived` | Arithmetic identity holds | `line_total = quantity * unit_price` |

Rules run **after** base generation as a correction pass; `case` columns are
evaluated after rules so labels always agree with corrected values.

---

## 5. Config design

The UI builds this; the user never uploads it.

```yaml
model: data_model.xlsx
seed: 42                       # same seed + same row counts = identical data
locale: en_US

targets:
  SUPPLIER:        {rows: 200}       # independent table → explicit count
  PART:            {rows: 1500}
  PURCHASE_ORDER:  {rows: derived}   # SIZING child → sized by cardinality
  PO_LINE:         {rows: derived}

references:                          # optional: reuse a previous run's parents
  SUPPLIER: {path: ./output/run_demo/SUPPLIER.csv}

output:
  format: [csv, xlsx]
  path: ./runs/<run_id>/
```

Rules: tables with a SIZING FK must be `derived`; views take no row count;
`references` load parents from prior CSVs instead of regenerating them.

---

## 6. How data is actually generated (the mechanics)

1. **Parse workbook** → in-memory model; validate it (every FK resolves, every
   column has a generator or an FK, every SIZING FK has cardinality).
2. **Topologically sort** the FK graph → parents always generate before children.
3. **Per table, in order:**
   - **Per-table reseed:** `seed = f(global_seed, table_name)` so a table's values
     depend only on itself — generating a subset reproduces identical rows.
   - **SIZING allocation:** for each parent, roll the cardinality distribution and
     repeat that parent's key that many times. An orphan is mechanically impossible.
   - **Column generation** in sheet order; REFERENCE FKs sample real parent keys;
     `fk_lookup` copies a parent attribute through the FK; `derived` computes from
     sibling columns; uniqueness enforced with a bounded retry.
   - **Rule pass:** dates sorted, bounds applied, conditionals enforced, identities
     recomputed. Then `case` columns evaluate against the corrected values.
4. **Views computed** from the generated tables.
5. **Validation** by a *separate program* — PK uniqueness/non-null, zero FK orphans,
   cardinality shape, patterns, categorical domains, numeric ranges, date windows,
   jitter bands, every rule, and full view recomputation.
6. **Release gate:** any failure → report only, **no files**. Pass → CSV/XLSX +
   `qa_report.json` + `model_snapshot_<runid>.json`.

**Why integrity holds:** it is constructional, not corrective. FK values are
copies or picks of real parent keys; dependent values are computed from the row
and the rows it references; rules repair what randomness got semantically wrong.

---

## 7. What has been achieved

| # | Achievement | Evidence |
|---|---|---|
| 1 | Metadata-driven engine, zero table knowledge in code | Five models run through the identical engine |
| 2 | Relationship-aware generation (SIZING + REFERENCE + lineage) | Zero FK orphans across every run |
| 3 | Business rules: temporal, bound, conditional, derived, case | Verified row-by-row on 3,900+ ESPM rows |
| 4 | Computed views that reconcile with base data | View totals equal base counts exactly |
| 5 | Independent validator + hard release gate | Failed runs produce no files |
| 6 | Reproducibility, including **subsets** | Per-table seeding: `books` alone == `books` in a full run, byte-identical |
| 7 | Incremental generation via `references` | New PO lines generated against previously uploaded parents |
| 8 | Web tool: model registry, dataset picker with FK auto-include, options, validation cards, run history, downloads | Running at `:3000` |
| 9 | Remote access | LAN + Cloudflare tunnel |
| 10 | Model versioning (v1, v2, v3 …) in the registry | Visible in the UI |
| 11 | Documentation set: solution overview, authoring guide, template workbook, agent prompt, build spec, hosting guide | Delivered |

**Models proven end to end**

| Model | Objects | Rows | Compliance |
|---|---|---|---|
| Supply chain (PO/lines/OTD view) | 5 | ~7,600 | 42/42 PASS |
| ESPM delivery performance | 7 | ~6,900 | 99/99 PASS |
| Retail demo | 6 | ~5,700 | 46/46 PASS |
| Library | 3 | ~1,000 | 28/28 PASS |
| UC03 workforce | 8 | ~21,000 | 85/85 PASS |

---

## 8. Implementation history — what was built, in order

| Phase | Work | Outcome |
|---|---|---|
| 1 | Framework design; merged v1.0 doc with technical spec → v1.1 | Three-layer architecture agreed |
| 2 | Built workbook + engine + config; first supply-chain model | 42/42 PASS |
| 3 | Added independent validator | Generation and audit separated |
| 4 | `references` mode | Single-dataset runs against existing parents |
| 5 | ESPM model: `fk_lookup`, multi-hop `via`, `case` generator | 99/99 PASS |
| 6 | Status/flag logic (ON_TIME/EARLY/LATE) | `case` evaluation moved after rules |
| 7 | Demo assets: retail model, Streamlit app, single-file HTML tool | Zero-install demo |
| 8 | Tool build spec (Next.js/Node) → **you built the web tool** | Registry, picker, gate, history |
| 9 | Hosting: LAN binding, firewall, Cloudflare tunnel | Remote access working |
| 10 | Per-table seeding | Subset runs reproducible |
| 11 | Bounded uniqueness retry | Infinite "RUNNING" hang fixed |
| 12 | Pass-through views, empty-view handling, `multiplier` param | Engine hardening |
| 13 | Model repairs: library v2, WMIP normalization, UC03 v3 → fixed | Each validated |

---

## 9. What has NOT been achieved, and why

### 9.1 Engine limitations (genuine gaps)

| Gap | Why | Workaround |
|---|---|---|
| **Polymorphic FK** — one column referencing two tables | The engine samples from exactly one parent frame | Merge the parents, or use paired nullable FK columns |
| **Deliberate defect injection** — "a few invalid references" | Generators either guarantee validity or don't; no "N% invalid" concept | Corrupt N rows with a post-script |
| **Cross-row constraints** — "no person exceeds 100% total allocation" | Generation is row-wise; there is no aggregate feedback loop | Tune distributions so violations are rare |
| **Conditional generators** — different ranges per category | `case` produces labels, not numeric branches | Numeric driver column (`is_contractor` 0/1) feeding arithmetic |
| **Time-series / recurrence** — regular intervals, running totals | No stateful generators | Approximate with `date` windows and numeric ranges |
| **Domain solvers** — physics/finance formulas in expressions | `pandas.eval` supports arithmetic only, no function registry | Replace with numeric ranges, or register functions (engine work) |
| **Appending across runs** | Key uniqueness is guaranteed within a run only | Run-scoped key patterns, or snapshot-replace |
| **Scale** | pandas, single process | Comfortable to ~5M rows; PySpark port planned |

### 9.2 Hosting limitation

The tool runs entirely on your PC. Turn it off and everything stops. A permanent
link requires hosting (Render free tier documented in `FREE_HOSTING_GUIDE.md`),
which has not been done yet.

### 9.3 The model-generation agent — clarifying the real status

**The agent exists and works.** Your tool imports schema files and produces model
workbooks — that is how `library_v1`, the WMIP model, and UC03 were created. The
Anthropic SDK is installed in the server. So "we can't add the agent" is not
accurate.

**What's missing is the layer around it.** Agent-produced models have repeatedly
shipped with defects that only surfaced at generation time:

| Defect seen | Consequence |
|---|---|
| FK columns given their own `pattern` generator | `loan.member_id = "LOA-12345"` — referenced nothing |
| PK column with `nullable_pct = 0.1` | 10% null primary keys → validation FAIL |
| `nullable_pct` written as `90` instead of `0.9` | 9000% null rate |
| ID pattern too narrow (`ROLE-##` = 100 values) for 200 rows | **Infinite hang** |
| `faker provider=word` on categorical columns | `currency = "hair"` |
| Prose leaked into a pattern (`DMD-###### (Sec 3.4 …)`) | Every ID corrupted |
| Prose in `_RULES` typed as an executable rule | Parser crash |
| Generators that don't exist (`timeseries`, `recurrence`) | 6 tables ungeneratable |
| `target_rows` prose parsed as a fixed count | Cardinality violations |

Every one of these is **mechanically detectable**. The fix is a **normalizer**
between import and registration:

```
upload → parse → deterministic checks → auto-repair what's safe
       → LLM only for judgment calls → diff for human review → register
```

with changes classified **FIXED / APPROXIMATED / NOT SUPPORTED**. The
deterministic rule set is already written (`agent_model_generation_prompt.md`
§ code-side validation), and a working prototype exists (`fix_wmip.py` applied
163 transforms to a 22-table model automatically). **This is the single highest-value
next piece of work** — it converts the agent from "usually produces something" to
"always produces something the engine can run."

---

## 10. Recommended next steps

| Priority | Work | Value |
|---|---|---|
| 1 | Build `engine/normalize_model.py` + wire into import | Ends the class of failures in §9.3 |
| 2 | Deploy to Render free tier | Permanent link; PC can be off |
| 3 | Lock SIZING tables to `derived` in the UI | Prevents guaranteed-fail runs |
| 4 | Add basic auth before sharing any public link | Tool spawns processes and writes files |
| 5 | `_EXPECTATIONS` sheet (SME business ranges, validator-enforced) | Catches "model doesn't match reality" |
| 6 | PySpark execution profile | Removes the ~5M row ceiling |

---

## 11. Companion files

| File | What it is |
|---|---|
| `data_model_TEMPLATE.xlsx` | Authoring template: guide sheet, generator cheat sheet, worked sample model |
| `DATA_MODEL_AUTHORING_GUIDE.md` | Full authoring reference |
| `sample_run_config.yaml` | Annotated config example |
| `UC03_Data_Model_FINAL_v3_FIXED.xlsx` | Real working model (85/85 PASS) |
| `data_model_espm.xlsx` | Complex model: lineage, corrected measures, case logic (99/99) |
| `uc03_v3_fixed_output.zip` | Sample generated output + QA report |
| `agent_model_generation_prompt.md` | Agent prompt + deterministic checklist |
| `synthgen_tool_build_spec.md` | Web tool architecture and phased plan |
| `FREE_HOSTING_GUIDE.md` | Render deployment |
| `synthgen.py` / `validate_compliance.py` | The engine and the auditor |
