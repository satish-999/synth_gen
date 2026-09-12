# SynthGen Demo Guide (5–7 minutes)

## Setup (once, before the meeting)
1. Folder with: `synthgen.py`, `validate_compliance.py`, `demo_tool.py`,
   `data_model_demo.xlsx` (retail domain — no org data anywhere).
2. `pip install pandas numpy faker openpyxl pyyaml streamlit`
3. Test run: `streamlit run demo_tool.py` → browser opens the tool.

## Talk track

**1. The problem (30s).** "Our objects arrive with schemas but empty datasets —
no data can cross for security reasons. Demos, testing, and dashboard builds all
stall. Hand-writing fake data breaks relationships and business logic."

**2. The idea (30s).** Open `data_model_demo.xlsx`. "Everything about the data
lives in this governed Excel workbook — schema, keys, relationships and their
cardinality, value distributions, business rules, even derived-status logic.
The engine has zero hardcoded knowledge; point it at a different workbook and
it generates a different domain."

**3. Live generation (2 min).** In the tool: pick the model → tables appear →
untick everything except `order_item` → point out the tool auto-includes the
FK parents → set seed, press **Generate** → validation cards go green →
download a CSV. "Five related datasets, ~5,000 rows, referentially perfect,
in seconds."

**4. The two magic moments (2 min).**
- Open `sales_order.csv` + `order_item.csv`: "Every item's order exists; item
  prices track the product catalog ±10%; delivered dates obey status logic —
  PLACED orders have no delivery date, and delivery_status is computed from
  the actual dates."
- Change one thing live: rerun with the same seed → "identical data,
  bit-for-bit — reproducible test fixtures." Then a new seed → "fresh batch,
  same rules."

**5. The guarantee (1 min).** "Generation and validation are separate
programs. The independent validator re-verifies every model promise — keys,
relationships, patterns, distributions, rules, even recomputing the revenue
view from scratch. Anything less than 100% and no files are produced."

**6. Where this goes (30s).** "Same engine runs three ways: laptop (today),
AWS Glue → S3 → Foundry sync, or natively inside Foundry as a transform. The
workbook is the only thing that changes per use case — we've already modeled
a full delivery-performance domain with it."

## Likely questions
- **"How long to onboard a new use case?"** Draft the workbook from schema
  docs (LLM-assisted, minutes), SME review, 2–3 tune-generate loops. Hours,
  not weeks. No code changes.
- **"How do we know the data is right, not just consistent?"** Model review
  checklist + the real dashboards as the oracle + (roadmap) an expectations
  sheet asserting business ranges like "OTD 80–95%".
- **"What about volume?"** pandas engine comfortably to ~5M rows; PySpark
  port planned for beyond, same workbook and config.
- **"Is any real data involved?"** None. The workbook holds metadata only;
  all values are synthesized. Safe for any environment.
