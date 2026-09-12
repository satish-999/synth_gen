# SynthGen — Solution Summary

**Synthetic Data Generator**  
*Metadata-driven, relationship-aware synthetic data for demos, testing, and development*

---

## 1. Executive Summary

**SynthGen** is a web-based tool that turns client **schemas** (table structures without real data) into **referentially correct synthetic datasets** in CSV and Excel format. All business rules, primary keys, foreign keys, cardinality, and generators are defined in a governed **data model workbook** (Excel). A Python generation engine produces the data; an independent validator blocks any download until every integrity check passes.

The solution was built as a full-stack application:

| Layer | Technology | Role |
|-------|------------|------|
| **Engine** | Python (`synthgen.py`, `validate_compliance.py`) | Parse model, generate data, validate PK/FK/rules |
| **API** | Node.js / Express / TypeScript | Orchestrate runs, registry, agent, file downloads |
| **UI** | React / Vite | Model selection, dataset picker, options, validation, downloads |
| **Registry** | Versioned file store + SQLite | Immutable model versions, run history |

Users work through a simple pipeline: **Model → Datasets → Options → Generate → Validation → Files**.

---

## 2. The Problem

Organizations often receive **schemas only** from clients — column names, types, and relationships — but no actual data (due to security, compliance, or IP restrictions). Teams still need realistic data to:

- Build and demo dashboards
- Run integration and UAT tests
- Prototype applications before production access

**Traditional approaches fail because:**

| Challenge | Impact |
|-----------|--------|
| Hand-written fake data | PK/FK orphans, broken relationships |
| Random generators | No adherence to business rules, patterns, or domains |
| One-off scripts | Not reusable, not governed, not validated |
| Schema-only inputs | No standard path from schema → consistent multi-table data |
| Partial table needs | Regenerating everything when only one table changes |

---

## 3. The Solution

SynthGen implements a **three-artifact pipeline**:

```
  DATA MODEL              RUN CONFIG              GENERATED OUTPUT
  (Excel workbook)   →    (run_config.yaml)  →    (CSV / XLSX)
  PK, FK, rules,          selected tables,
  generators,             row counts, seed,
  cardinality             output format
```

### Core principles

1. **Metadata-driven** — All domain knowledge lives in the data model workbook, not in code.
2. **Relationship-aware** — FK parents are resolved automatically; SIZING tables follow cardinality rules or explicit row counts.
3. **Validation-gated** — No file is offered unless inline QA and independent compliance checks pass.
4. **Versioned models** — Each model family (`retail`, `erp_demo`, etc.) has immutable versions (`v1`, `v2`, …).
5. **Human-in-the-loop** — Model changes require review before registration; inferred FKs must be confirmed.

---

## 4. What Was Built

### 4.1 Python generation engine (Phase 1)

- **`synthgen.py`** — Reads the data model workbook and run config; generates tables in dependency order; materializes views; writes CSV/XLSX.
- **`validate_compliance.py`** — Independent second-pass validator: schema, PK uniqueness, FK integrity, patterns, domains, date ranges, business rules, cardinality, and view recomputation.
- **`model_objects.py`** — Exposes table metadata (PK, FK parents, SIZING flag) to the Node server.
- **Demo and ERP models** — Retail demo bootstrap; ERP/procurement models (`department`, `employee`, `supplier`, `product`, `purchase_order`, `purchase_order_line`, `service`).

### 4.2 Node.js API and orchestration (Phase 2)

- Spawns Python engine and validator as child processes.
- Builds `run_config.yaml` from UI selections (tables, rows, seed, format).
- **Download gate** — Zip and per-file downloads only when status is `PASS`.
- **SQLite run history** — Every run recorded with model, seed, targets, status, and file list.
- **Rerun** — Replay a prior run with the same parameters.

### 4.3 Versioned model registry (Phase 3)

- Immutable model versions under `registry/<family>/vN/`.
- Each version includes `data_model.xlsx`, `manifest.json`, and registration metadata.
- Bootstrap on first start (e.g. `retail@v1` from demo workbook).
- API to list families, fetch objects, and download workbooks.

### 4.4 Browser UI (Phase 4)

- **Left panel** — Data model list; one active model at a time.
- **Datasets** — Table grid with PK/FK info; checkbox selection; auto-included FK parents shown.
- **Options** — Row counts (selected tables only), seed, CSV/XLSX format.
- **Pipeline rail** — Visual progress: Model → Datasets → Options → Generate → Validation → Files.
- **Validation cards** — Per-table and per-rule PASS/FAIL display.
- **File downloads** — Individual CSVs, combined Excel, or zip archive.

### 4.5 Agent and model authoring (Phases 5–7)

- **CREATE** — Upload schema files (CSV, SQL, JSON, XLSX); agent drafts a data model workbook.
- **UPDATE** — Upload only new schema; agent extends existing model to v(N+1).
- **REWRITE** — Upload full schema set; agent rebuilds model with diff vs current version.
- **Rule-based fallback** — Works without an LLM API key; Claude optional for richer inference.
- **Human review** — Diff viewer, FK confirmation gate, edit-and-reupload workbook before register.

### 4.6 Direct workbook import (primary UI path)

- **Import data model** — Upload a completed `data_model.xlsx` (aligned with reference design).
- **Upload new version** — Register v(N+1) from an edited workbook.
- **Rewrite model** — Replace model from a new workbook with diff tracking.
- **Open in Excel** — Download the active model workbook for editing.

This path matches the reference `Design docs/data_model.xlsx` workflow and is the recommended way to register production-quality models.

### 4.7 ERP / procurement data models

Built and registered ERP-style models covering:

| Table | Role |
|-------|------|
| `department` | Root organizational unit |
| `employee` | FK → department |
| `supplier` | Vendor master |
| `product` | Item master |
| `purchase_order` | SIZING table; FK → employee, supplier |
| `purchase_order_line` | SIZING table; FK → purchase_order, product |
| `service` | Service catalog |

Reference workbook: `Design docs/data_model_erp.xlsx`.

### 4.8 Partial generation with FK reuse (latest behavior)

When the user selects **only some tables**:

- **Only selected tables** are regenerated and written to output files.
- **FK parent tables** are loaded from the **last successful run with the same model and seed** — not regenerated.
- PK/FK integrity is preserved without producing extra CSV files.
- **Prerequisite** — User must run a **full generation once** with the same seed before subset runs.
- **SIZING row-count fix** — When the user explicitly selects a SIZING table (`purchase_order`, `purchase_order_line`), a fixed row count is used instead of cardinality-derived thousands of rows.

### 4.9 Deployment and access (Phase 9)

- Configurable `HOST` and `PORT` for LAN access (`0.0.0.0`).
- Health endpoint: `GET /api/health`.
- Docker Compose and `DEPLOYMENT.md` for production-style hosting.
- Public access via Cloudflare quick tunnel for temporary shareable URLs.

---

## 5. Main Problems Resolved

### 5.1 Broken referential integrity

**Before:** Manually created fake data produced FK orphans and inconsistent IDs across tables.  
**After:** Engine generates tables in FK order; validator enforces zero orphan FKs; partial runs reuse parent data from prior validated runs.

### 5.2 No governed path from schema to data

**Before:** Ad-hoc scripts per project; no reusable model or version control.  
**After:** Versioned registry, immutable workbooks, manifest and diff tracking, import/update/rewrite flows.

### 5.3 Agent-generated models with invalid FKs and generators

**Before:** LLM drafts put pattern generators on FK columns, mis-inferred dates from ID patterns, broken cardinality syntax.  
**After:** `modelValidator.ts` and `ruleBasedAgent.ts` enforce PK prefixes, null generators on FK columns, SIZING modes, semantic generators, and derived-column rules; Python engine re-validates before register.

### 5.4 SIZING tables producing thousands of rows

**Before:** `purchase_order` and `purchase_order_line` always used `rows: derived` from cardinality × parent counts (e.g. 200 suppliers × Poisson → thousands of rows).  
**After:** User-selected SIZING tables accept an explicit row count (default 50); only auto-included SIZING parents stay derived.

### 5.5 Partial generation failing validation

**Before:** Selecting one table caused compliance to fail on missing unrelated tables (e.g. `service` not generated).  
**After:** Compliance validates only generated targets; references supply parent frames for FK checks without re-validating reused parents as new output.

### 5.6 Unwanted regeneration of unselected tables

**Before:** Selecting two tables still generated and downloaded all FK parents as new files.  
**After:** Only checked tables appear in output; parents are referenced from the prior PASS run (same seed).

### 5.7 No validation gate before download

**Before:** Risk of shipping bad data to demos or tests.  
**After:** Two-layer validation (inline `qa_report.json` + `validate_compliance.py`); downloads blocked on FAIL.

### 5.8 Inflexible output formats

**Before:** Teams needed both flat files and Excel for different consumers.  
**After:** User chooses CSV, XLSX, or both per run; combined `synthetic_data.xlsx` with one sheet per table.

### 5.9 Model evolution without full re-upload

**Before:** Adding one table required rebuilding everything manually.  
**After:** UPDATE mode ingests only the new schema; REWRITE for full domain refresh; direct workbook upload for Excel-first workflows.

### 5.10 Reproducibility

**Before:** Different data every run; hard to debug issues.  
**After:** Fixed seed produces identical data; subset runs with same seed reuse parent CSVs for consistency.

---

## 6. End-to-End User Workflow

### First-time setup (full model)

1. **Import** or select a data model (e.g. `erp@v2`).
2. **Select all tables** (or the full set needed for your domain).
3. Set **row counts**, **seed** (e.g. 42), and **format** (CSV + XLSX).
4. Click **Generate** → wait for **PASS**.
5. **Download** files from the Files section or run history.

### Incremental generation (subset)

1. Ensure a **full PASS run** exists with the **same seed**.
2. Select **only the tables** you need (e.g. `purchase_order`, `purchase_order_line`).
3. Set row counts for those tables only.
4. Click **Generate** — FK parents are reused; only selected tables appear in output.

### Model maintenance

1. Download model workbook → edit in Excel **or** use Import / Upload new version / Rewrite.
2. Re-register as next version after validation.
3. Generate against the new version from the left panel.

---

## 7. Technical Validation

Automated smoke and end-to-end tests in `server/`:

| Script | Purpose |
|--------|---------|
| `npm run smoke` | Basic API + generation |
| `npm run smoke:agent` | Agent CREATE from test schemas |
| `npm run smoke:review` | FK confirmation gate |
| `npm run smoke:update` | Agent UPDATE flow |
| `npm run smoke:partial` | Partial generation + SIZING row counts |
| `npm run verify:e2e` | Full procurement model compliance |
| `npm run register:erp` | Register ERP workbook |

Engine verification: `engine/verify.py` (Phase 1 pipeline).

---

## 8. Project Structure

```
synthetic-data-gen/
├── engine/                 Python generation + validation
├── server/                 Node.js API, agent, registry services
├── client/                 React UI (built to client/dist)
├── registry/               Versioned data model families
├── runs/                   Generation output + SQLite history
├── Design docs/            Reference workbooks and demo package
├── docs/
│   ├── ARCHITECTURE.md     Full technical design
│   ├── SOLUTION_SUMMARY.md This document
│   └── ...
├── DEPLOYMENT.md           LAN, Docker, HTTPS, cloud
└── README.md               Quick start and phase checklist
```

---

## 9. Business Value

| Stakeholder | Benefit |
|-------------|---------|
| **Delivery / demo teams** | Realistic multi-table data in minutes, not days |
| **QA / integration** | Repeatable seeds, validated FK integrity |
| **Architects** | Governed data models as the single source of truth |
| **Clients** | No exposure of production data; schema-only handoff is enough |
| **Platform owners** | Extensible registry; new domains via workbook or agent |

---

## 10. Summary

SynthGen delivers a **complete synthetic data platform**: governed Excel data models, a validated Python engine, a versioned registry, an optional AI-assisted authoring pipeline, and a browser UI with validation-gated downloads. The main outcomes are **referentially correct data**, **controlled row counts** (including SIZING tables), **partial regeneration** that reuses prior parent data, and **repeatable runs** — resolving the gap between schema-only client deliverables and production-quality test and demo datasets.

For operational setup, see [README.md](../README.md) and [DEPLOYMENT.md](../DEPLOYMENT.md).  
For full technical design, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

*Document version: July 2026 — reflects ERP models, workbook import, partial generation with FK reuse, and SIZING row-count controls.*
