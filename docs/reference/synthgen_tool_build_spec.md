# SynthGen Tool — Build Specification for AI-Assisted Development
### Feed this document to Claude Code or Cursor. Build phase by phase; each phase has acceptance criteria.

---

## 0. What we are building

A web tool for governed synthetic data generation:

1. **Agent** turns uploaded schema files into data models (CREATE) and adds new
   datasets to existing models (EXTEND) — always as human-reviewed drafts.
2. **Model registry** stores versioned data models.
3. **Generation UI**: select model → see tables → select tables (FK parents
   auto-included) → set rows/seed/format → Generate.
4. **Engine**: the existing Python `synthgen.py` (do NOT rewrite it in JS) invoked
   as a child process, followed by `validate_compliance.py` as a hard gate.
5. **Run history** with reproducibility (model version + seed recorded per run).

Prerequisites on the dev machine: Node.js ≥ 20, git, Python ≥ 3.11 with
`pandas numpy faker openpyxl pyyaml` installed. The two Python files
(`synthgen.py`, `validate_compliance.py`) are provided — copy them into
`/engine` unchanged.

---

## 1. Tech stack (fixed — do not substitute)

| Layer | Choice |
|---|---|
| App framework | Next.js 14 (App Router) — UI + API routes in one project |
| Language | TypeScript |
| DB | SQLite via `better-sqlite3` (models, versions, runs) |
| Model file format | JSON (canonical) + generated .xlsx export via `exceljs` for humans |
| Agent | Anthropic API (`@anthropic-ai/sdk`), model `claude-sonnet-4-6`, temperature 0 |
| Engine invocation | Node `child_process.spawn` → `python synthgen.py …` |
| Styling | Tailwind. Aesthetic: engineering-notebook (paper #FAFAF7, ink #1B2A41, teal #0E7C7B accent, IBM Plex Mono for data, Space Grotesk headings) |

Env vars (`.env.local`): `ANTHROPIC_API_KEY`, `PYTHON_BIN` (default `python3`),
`DATA_DIR` (default `./data`).

---

## 2. Directory layout

```
synthgen-tool/
├── app/                      # Next.js pages + API routes
│   ├── page.tsx              # generation flow (screens 4–8)
│   ├── models/page.tsx       # registry list + upload/create/extend
│   ├── models/review/[draftId]/page.tsx   # agent-draft review & diff
│   └── api/
│       ├── models/route.ts           # GET list, POST register
│       ├── models/draft/route.ts     # POST create|extend  → agent
│       ├── generate/route.ts         # POST run generation
│       └── runs/route.ts             # GET history
├── engine/
│   ├── synthgen.py                   # provided — unchanged
│   ├── validate_compliance.py        # provided — unchanged
│   └── json2xlsx.py                  # small converter (Phase 2)
├── lib/
│   ├── db.ts            # sqlite schema + helpers
│   ├── modelSchema.ts   # zod schema for the model JSON (source of truth)
│   ├── agent.ts         # Claude calls: createModel(), extendModel()
│   ├── deps.ts          # FK closure / dependency resolution
│   └── engine.ts        # spawn python, parse results
└── data/
    ├── models/<modelId>/v<N>.json    # registered model versions
    └── runs/<runId>/                 # outputs, qa_report, snapshot
```

---

## 3. Data contracts (implement exactly)

### 3.1 Model JSON (canonical form of the workbook)
```ts
type Model = {
  name: string; version: number; domain?: string;
  tables: Record<string, Column[]>;
  views: Record<string, ViewSpec>;
  rules: Rule[];
};
type Column = {
  name: string; dtype: string; pk: boolean;
  fk_ref: string | null;            // "PARENT.pk_column"
  fk_mode: "SIZING" | "REFERENCE" | null;
  cardinality: string | null;       // "min,max,poisson(x)"
  orphan_pct: number;
  generator: string | null;         // pattern|faker|choice|numeric|date|date_offset|sequence|fk_lookup|fk_lookup_jitter|derived|case
  params: Record<string, unknown>;
  nullable_pct: number; unique: boolean;
};
type ViewSpec = { source_objects: string; join_logic: string;
  filter_logic?: string; group_by: string;
  columns: {name: string; dtype: string; derivation: string}[] };
type Rule = { rule_id: string; object: string;
  rule_type: "temporal_order"|"bound"|"conditional"|"derived"; definition: string };
```
This mirrors `model_snapshot_*.json` produced by synthgen — keep field names
identical so snapshots and registry entries are interchangeable.

### 3.2 Run config (assembled by the UI, never uploaded)
```ts
type RunConfig = { model: string; seed: number; locale: "en_US";
  targets: Record<string, {rows: number | "derived"}>;
  output: {format: ("csv"|"xlsx")[]; path: string} };
```

### 3.3 SQLite tables
```sql
models(id TEXT PK, name TEXT, latest_version INT, created_at TEXT);
model_versions(model_id TEXT, version INT, json_path TEXT, created_by TEXT,
               change_note TEXT, PRIMARY KEY(model_id, version));
drafts(id TEXT PK, model_id TEXT NULL, base_version INT NULL,
       mode TEXT CHECK(mode IN ('create','extend')),
       draft_json TEXT, diff_json TEXT, status TEXT DEFAULT 'pending');
runs(id TEXT PK, model_id TEXT, model_version INT, seed INT,
     targets_json TEXT, passed INT, out_dir TEXT, created_at TEXT);
```

---

## 4. The Agent (lib/agent.ts) — the core novelty

Two functions, both returning `{draftModel: Model, diff: Diff, warnings: string[]}`.
Both must produce STRICT JSON (instruct the model to output only JSON; parse with
zod `modelSchema`; on parse failure retry once with the error appended).

### 4.1 createModel(schemaText: string)
System prompt (verbatim, tune only if evals fail):
```
You convert database schema descriptions into a synthetic-data model JSON.
Output ONLY valid JSON matching the provided TypeScript schema. Rules:
- Every table needs a pk column. Every non-FK column needs a generator.
- Infer FKs from names (*_id, *_pk, *_ref, *_bk matching another table's PK)
  AND from explicit annotations. Mark every INFERRED fk with a warning string
  "INFERRED FK: table.col -> parent.col".
- Exactly one FK per child table should be SIZING (the structural parent, with
  a cardinality like "1,15,poisson(4)"); other FKs are REFERENCE.
- Choose realistic generators: id-like -> pattern; names/emails/companies ->
  faker; categorical -> choice with weights; money -> numeric lognormal;
  dates -> date or date_offset; per-parent counters -> sequence; columns whose
  names contain corrected/derived/total/status/flag/ind -> propose derived or
  case logic and ADD A WARNING that an SME must confirm it.
- Add temporal_order/bound/conditional rules for date columns.
Never invent tables not present in the input.
```
User message = the schema text + the TS schema definition.

### 4.2 extendModel(existing: Model, newSchemaText: string)
Same system prompt PLUS:
```
You are EXTENDING an existing model. You receive the current model JSON and one
new dataset schema. Return the FULL updated model JSON:
- Do not modify existing tables/views/rules except to add relationships FROM
  the new table TO existing tables.
- Infer FKs from the new table to EXISTING table PKs first (this is the primary
  job); flag each as "INFERRED FK".
- If the new object appears to be derivable from existing tables (aggregation),
  propose it as a VIEW instead of a table, with a warning.
- Increment nothing; versioning is handled outside.
```
Compute `diff` in code (not by the LLM): added tables, added columns, added
FKs/rules — this drives the review screen. **This function is the answer to the
incremental-schema question: input = registry model + new schema only.**

### 4.3 Review flow (models/review/[draftId])
Show: left = current model (if extend), right = draft; changes highlighted;
warnings list (inferred FKs and proposed logic) each with confirm/edit/remove.
Buttons: **Register as v{N+1}** (writes json to data/models, bumps
latest_version, records change_note) or **Discard**. Drafts are never usable
for generation — only registered versions are.

---

## 5. Generation flow (app/page.tsx + api/generate)

1. Model dropdown lists registered models (latest version badge; older versions
   selectable from a submenu).
2. On select: render table cards from `Object.keys(model.tables)` + view cards
   (views labeled "computed — always included when sources selected").
3. Checkbox selection → `lib/deps.ts` computes transitive FK-parent closure and
   auto-checks parents with an info line "Auto-included: X, Y".
4. Options: number inputs for non-SIZING tables (default 200); SIZING tables
   show a locked "derived" pill; seed input (default 42); format multiselect.
5. Generate → POST /api/generate:
   a. Write model JSON → run dir; call `engine/json2xlsx.py` to produce the
      .xlsx the engine reads (Phase 2 deliverable: a ~60-line converter that
      writes _OBJECTS, one sheet per table, view sheets, _RULES — the exact
      layouts synthgen's parse_workbook expects).
   b. Write run_config.yaml from RunConfig.
   c. `spawn(PYTHON_BIN, ["synthgen.py","--model",…,"--config",…])`, stream
      stdout to the UI (SSE or polling).
   d. On exit 0: spawn validate_compliance.py with the produced snapshot; parse
      its stdout into per-object check results.
   e. Persist run row; respond with {passed, checks, files[]}.
6. UI shows validation cards (green/red per object with named checks). Files
   (download links served from data/runs/<id>/) appear ONLY when passed=true.
   On failure show the failed checks verbatim and no files.
7. Run history table at the bottom (model, version, seed, rows, PASS/FAIL);
   a "Repeat run" button re-fires with the recorded version+seed and must
   produce identical files.

---

## 6. Build phases (implement in this order; commit per phase)

| Phase | Deliverable | Acceptance criteria |
|---|---|---|
| P1 | Next.js scaffold, sqlite, model registry CRUD, seed registry with the provided retail model JSON | Can list/inspect a registered model in the UI |
| P2 | `json2xlsx.py` + engine invocation + generation flow (no agent yet) | Selecting retail model → generate → validator PASS → downloadable CSVs; "Repeat run" is byte-identical |
| P3 | Dependency auto-resolution + derived-row locking + validation gate UI | Selecting only order_item auto-adds 4 parents; a deliberately broken model version shows FAIL with no files |
| P4 | Agent CREATE mode + review/register screen | Pasting a plain-text schema (like the ESPM schema doc) yields a draft with inferred FKs flagged; registering makes it generatable |
| P5 | Agent EXTEND mode + diff view + versioning | Uploading ONE new dataset schema against an existing model produces v2 adding only that table with FKs to existing PKs; v1 runs still reproducible |
| P6 | Polish: run history, SSE progress, error surfaces (python stderr shown readably), auth stub | Full demo path clean end to end |

Testing note for the AI assistant: after each phase run the real engine — do not
mock it. The provided retail model must generate ~1.3k orders / ~3.5k items and
pass 46 compliance checks; treat that as the regression fixture.

---

## 7. Incremental model updates — the resolved design (read carefully)

Question this answers: "model exists; I get a schema for one more dataset — do I
re-upload everything?" **No.** The EXTEND flow:

1. User opens the existing model in the registry → "Add dataset" → pastes/uploads
   ONLY the new schema.
2. Backend loads the current version's JSON from the registry and calls
   `extendModel(existing, newSchema)`.
3. Agent returns the full updated model; code computes the diff; review screen
   shows exactly what's new — especially inferred FKs from the new table to
   existing PKs, each requiring explicit confirmation.
4. On approve → registered as v(N+1). v(N) remains in the registry forever.
5. Generation always records model_id+version; old runs re-execute against
   their original version, so extending a model can never silently change
   previously generated data.
6. If the new schema's table name collides with an existing table, the agent
   must diff columns and propose an UPDATE to that table (added columns only),
   never a silent replace — surface this as its own warning class.

Edge cases to implement: new table referencing a PK that doesn't exist yet
(warning: "unresolved FK — register the parent first or mark REFERENCE to a
future table"), and circular references (reject with message, consistent with
the engine).

---

## 8. Definition of done

- A user with zero knowledge of the engine can: upload a schema → review →
  register → select tables → generate → download validated data, in < 3 minutes.
- A second schema can be added to that model with only the new file, producing
  v2, with v1 runs still reproducible.
- No file is ever downloadable from a run that failed validation.
- `git log` shows one commit per phase with the acceptance criteria met.
