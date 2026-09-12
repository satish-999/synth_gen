# SynthGen — Synthetic Data Generation Tool

Metadata-driven synthetic data platform. Schema → Data Model → Config → Generated CSV/XLSX.

## Phase 1 — Python Engine (complete)

```powershell
cd engine
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe verify.py
```

Expected output: `Phase 1 verification: PASS`

### Manual run

```powershell
cd engine
.\.venv\Scripts\python.exe create_demo_model.py
.\.venv\Scripts\python.exe synthgen.py --model data_model_demo.xlsx --config run_config_demo.yaml
.\.venv\Scripts\python.exe validate_compliance.py --snapshot output/run_retail_demo/model_snapshot_*.json --data output/run_retail_demo
```

## Phase 2 — Node.js API (complete)

The server spawns the Python engine, gates downloads on validation PASS, and
records run history. Data is delivered as **CSV and/or Excel**.

```powershell
cd server
npm install
npm run smoke          # end-to-end test through the service layer
npm start              # http://localhost:3000  (set $env:PORT to change)
```

> Uses Node's built-in `node:sqlite` — no native build tools required.

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/health` | Health check |
| GET  | `/api/models` | List available models |
| GET  | `/api/models/:key/objects` | Tables/views + FK parents for a model |
| POST | `/api/generate` | Run generation. Body: `{model, tables[], rows{}, seed, format[]}` |
| GET  | `/api/generate/:runId` | Poll status + validation report |
| GET  | `/api/generate/:runId/download` | Zip of CSV+Excel (only if PASS) |
| GET  | `/api/generate/:runId/files/:name` | Single file (only if PASS) |
| GET  | `/api/runs` | Run history |

Example generate request:

```json
{ "model": "retail_demo", "tables": ["order_item"], "rows": { "customer": 50, "product": 80 }, "seed": 7, "format": ["csv", "xlsx"] }
```

FK parents are auto-included; SIZING tables are forced to `rows: derived`;
on validation FAIL no files are offered.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full end-to-end design.

## Project layout

```
engine/           Python generation + validation (Phase 1)
server/           Node.js API — spawns engine, gates downloads (Phase 2)
Design docs/      Original demo reference files
docs/             Architecture & build guide
runs/             Generation output + SQLite run history (gitignored)
```

## Phase 3 — Model Registry (complete)

Versioned, immutable data models live under `registry/`. On first start the server
bootstraps `retail@v1` from the engine demo workbook.

```
registry/
├── index.json
└── retail/
    ├── meta.json
    └── v1/
        ├── data_model.xlsx      ← immutable
        ├── manifest.json        ← tables, views, FK summary
        └── registration.json
```

### Registry API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/models` | List all families + versions |
| GET | `/api/models/:family/:version` | Metadata + manifest |
| GET | `/api/models/:family/:version/objects` | Tables/views (scoped to this model only) |
| GET | `/api/models/:family/:version/download` | Download registered `.xlsx` |

Generate now accepts `{ "family": "retail", "version": 1, ... }` or legacy `{ "model": "retail@v1" }`.

## Phase 4 — Browser UI (complete)

React UI in `client/` — two-panel layout matching the architecture:

- **Left:** model list (one active at a time)
- **Right:** table picker, row counts, seed, CSV/Excel format, generate, validation, download

```powershell
# Build UI once
cd client
npm install
npm run build

# Start server (serves UI + API on same port)
cd ../server
npm start
# Open http://localhost:3000  (or set $env:PORT if 3000 is taken)
```

Dev mode with hot reload:

```powershell
# Terminal 1 — API
cd server && npm start

# Terminal 2 — UI (proxies /api → localhost:3000)
cd client && npm run dev
# Open http://localhost:5173
```

## Phase 5 — Agent CREATE (complete)

Upload schema files → agent drafts data model (.xlsx) → review → register as v1.

**Without `ANTHROPIC_API_KEY`:** uses rule-based fallback (still validates via Python engine).  
**With API key:** Claude builds richer models with FK/rules inference.

```powershell
cd server
npm run smoke:agent   # library model from test-schemas/
```

### Agent API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/jobs` | multipart: `schemas[]`, `familyId`, `displayName`, `mode=CREATE` |
| GET | `/api/agent/jobs/:id` | Poll job (PENDING → RUNNING → DRAFT_READY) |
| GET | `/api/agent/jobs/:id/draft` | Download draft workbook |
| PUT | `/api/agent/jobs/:id/draft` | Upload edited workbook (re-validates) |
| GET | `/api/agent/jobs/:id/diff` | Structured enriched diff |
| POST | `/api/agent/jobs/:id/approve` | Register as new family v1 (requires review ack + FK confirm) |
| POST | `/api/agent/jobs/:id/reject` | Reject draft |

### UI

Click **+ Create new model** in the left panel → upload `.csv` / `.sql` / `.json` / `.xlsx` → opens **Review draft** screen when ready.

Test schemas: `server/test-schemas/` (members, books, loans).

## Phase 6 — Human review + diff (complete)

Drafts never auto-register. After CREATE finishes, the **Review draft** screen shows:

- **Structured diff** — added tables, inferred FKs (must confirm each), rules
- **Edit draft** — download `.xlsx`, edit in Excel, re-upload (server re-validates)
- **Register gate** — checkbox + all inferred FKs confirmed before **Register model (v1)**

Pending drafts also appear in the left panel under **Pending review**.

```powershell
cd server
npm run smoke:review   # FK confirmation gate smoke test
```

### Review API body (approve)

```json
{
  "reviewAcknowledged": true,
  "confirmedFks": ["member_id", "book_id"]
}
```

Returns `400` if inferred FKs exist but are not all listed in `confirmedFks`.

## Roadmap

| Phase | Status | Scope |
|-------|--------|--------|
| 1 | ✅ Complete | Python engine |
| 2 | ✅ Complete | Node.js API |
| 3 | ✅ Complete | Model registry |
| 4 | ✅ Complete | Browser UI |
| 5 | ✅ Complete | Agent CREATE |
| 6 | ✅ Complete | Human review + diff |
| 7 | ✅ Complete | Agent UPDATE + REWRITE |
| 8 | ✅ Complete | Polish (history rerun, zip, errors, docs) |
| 9 | ✅ Complete | Network deployment (LAN, Docker, HTTPS guide) |

## Phase 7 — Agent UPDATE + REWRITE

Extend or rebuild an existing model version. Both require human review before registering v(N+1).

- **Update model** — upload only new schema file(s); base tables frozen
- **Rewrite model** — upload all schemas; full rebuild with diff vs current version

```powershell
cd server
npm run smoke:update   # adds holds table to library model
```

### Agent API (UPDATE / REWRITE)

```http
POST /api/agent/jobs
Content-Type: multipart/form-data

mode=UPDATE|REWRITE
familyId=library
baseVersion=1
schemas[]=<file>
```

Approve registers `v{baseVersion + 1}` with `diff_from_vN.json` in registry.

## Phase 8 — Polish

- **Run history** — Rerun button reuses same seed, tables, rows, formats
- **Zip download** — already on `/api/generate/:runId/download`
- **`.env.example`** — HOST, PORT, auth keys documented

## Phase 9 — Network deployment

Use from any machine on your LAN or over the internet (with HTTPS).

```powershell
# LAN access
$env:HOST="0.0.0.0"
$env:PORT="3080"
cd server; npm start
# Other devices: http://<your-ip>:3080
```

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for Docker, nginx/Caddy HTTPS, cloud VM, and security checklist.

```powershell
cd client && npm run build
docker compose up --build
```

Health: `GET /api/health`
