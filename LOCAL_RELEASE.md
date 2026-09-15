# SynthGen local development release

Use http://127.0.0.1:3080 after running Start-SynthGen.ps1.
This is a local release, not a public multi-user service.

## Model authoring

Open **Model authoring agent**. Choose Create or Add tables to the selected model.
Upload SQL, JSON, CSV or Excel schema files. Review the draft and confirm its
relationships before registering. Existing manual model import remains available.
UPDATE preserves existing table definitions and rules; intentional changes to
existing tables require the separate rewrite workflow.

Structured Markdown/text using the examples' four-column schema format works
without an API key. It uses rule-based defaults; narrative business constraints
are not inferred in this mode. PDF, Word (.docx), and free-form documents require Claude. The app shows
whether the AI connection is configured. Scanned PDFs require OCR externally.
Limits: 20 files, 10 MB per upload, 100 PDF pages, 100,000 extracted characters
per document and 150,000 characters combined.

## Enable document understanding

Create server/.env locally with ANTHROPIC_API_KEY set to your key.
Optionally set ANTHROPIC_MODEL; the default is claude-sonnet-4-6.
Stop the existing server and run Start-SynthGen.ps1 after configuration changes.
Never commit this file or send the key in chat. A Claude chat subscription is
not the application's API configuration. Uploaded metadata and instructions are
sent to Anthropic only when you submit an AI-enabled job.

The former default claude-sonnet-4-20250514 was retired. Reference:
https://platform.claude.com/docs/en/about-claude/model-deprecations

## Verification

Engine retail demo: 41/41 compliance checks passed.
Agent CREATE and review-gate smoke tests passed.
Agent UPDATE smoke test passed after fixing unintended changes to base tables.
HTTP integration: create, approve, add two tables, approve v2, generate CSV/XLSX
and validate the result passed.
Frontend and backend TypeScript checks and direct esbuild bundle passed.
Live Claude calls remain untested until an API key is configured.

The workforce example created four tables, then added two tables while preserving
the base definitions. Both generated datasets passed compliance (26 and 37 checks).
The engine now uses an AST allowlist for arithmetic, comparisons and filters;
expressions cannot call Python functions or access attributes. The 41-check retail
baseline and five expression/document extraction tests passed after this change.

## Try the sample now

Open the app, open Model authoring agent, choose Create and enter a new model ID.
Upload examples/workforce_sample_metadata.md. Review and register the draft.
Select all four tables and request roles=10, employees=50, projects=12,
assignments=100, then Generate. CSV and Excel exports are available after validation.
To extend it, select the registered model and choose Add tables, then upload
examples/workforce_add_two_tables.md. Review and register the next version.
Select only skills and employee_skills to generate the new tables. SynthGen
reuses the newest compatible successful dataset in the same model family,
including older model versions. Parent definitions and rules must match, and
all required parent files must still exist. Old data is read without rewriting
it; the seed applies to newly generated rows. The result identifies the source run.
Repeated partial runs retain their parent references, and new Excel-only runs
keep internal CSV data for validation and subsequent reuse.
The free-form workforce_business_metadata_for_claude.md example requires an API key.

Incremental generation verification: CREATE v1, generate four tables, UPDATE v2,
generate only two new tables, then generate one child using the previous partial
run. All passed; the original employee file remained byte-for-byte unchanged.
An invalid employee FK was rejected by independent validation. Planner tests
reject changed parent definitions and other model families, skip failed runs,
and find older compatible data when the newest run lacks required files.

## Hosting status

The pilot now rejects invalid row counts and requests over 50,000 rows per
table or 100,000 requested rows per run. One generation run can execute at a
time; a concurrent request receives a retry message. The slot is released after
success or failure. These are in-process limits, not a durable queue or full
multi-user isolation. Existing model-authoring tasks are not covered by this slot.
HTTPS proxy configuration is included in compose.https.yml but has not yet been
tested on a cloud host. AWS credits were confirmed; account verification is pending.

The local app is working. AWS deployment has not happened; 127.0.0.1 is accessible
only on this computer. Docker and production Basic Auth configuration are included
for a shared pilot. The container has not been built/tested here because Docker
is unavailable. See DEPLOYMENT.md for the remaining deployment verification.

Standard Windows venv/pip installation and Vite's subprocess build were blocked
in the restricted agent environment. This computer uses the existing bundled
Python 3.12 runtime plus hash-verified PyPI wheels in engine/python-packages.
The frontend was compiled using esbuild's executable directly. The portable
installer uses normal Python/npm installation for unrestricted environments.

## Next development milestones

Live AI evaluation against your metadata documents; richer schema parsing;
comprehensive rule/parameter validation; durable background queues; authenticated
customer isolation; dependency upgrades and security testing before public hosting.
The current file-based registry and local authentication model are not a
production multi-tenant architecture.