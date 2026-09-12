"""
demo_tool.py — Synthetic Data Generator demo UI (Streamlit).
Implements: select model -> see objects -> pick datasets (FK deps auto-resolved)
-> set rows/seed/format -> Generate -> validation gate -> download files.

Run:  streamlit run demo_tool.py
Needs synthgen.py + validate_compliance.py in the same folder, models as .xlsx.
"""
import glob
import subprocess
import sys
import time
from pathlib import Path

import pandas as pd
import streamlit as st

from synthgen import Engine, parse_workbook, validate_model, validate_output

st.set_page_config(page_title="Synthetic Data Generator", layout="wide")
st.title("Synthetic Data Generator")
st.caption("Metadata-driven, relationship-aware synthetic data — pick a model, "
           "pick datasets, generate. Every run is validated before download.")

# ---------------- 1. select data model ----------------------------------------
models = sorted(glob.glob("data_model*.xlsx"))
if not models:
    st.error("No data model workbooks (data_model*.xlsx) found in this folder.")
    st.stop()
model_path = st.selectbox("Data model", models)

try:
    model = parse_workbook(model_path)
    validate_model(model)
except SystemExit as e:
    st.error(f"Model failed validation:\n{e}")
    st.stop()

tables, views = list(model["tables"]), list(model["views"])
parents_of = {t: {c["fk_ref"].split(".")[0] for c in cols if c["fk_ref"]}
              for t, cols in model["tables"].items()}
sizing_child = {t for t, cols in model["tables"].items()
                if any(c["fk_mode"] == "SIZING" for c in cols)}

# ---------------- 2. pick datasets (deps auto-resolved) ------------------------
st.subheader("Datasets")
picked = [t for t in tables if st.checkbox(t, value=True, key=f"pick_{t}")]

selected, added = set(picked), []
changed = True
while changed:                      # transitive FK closure
    changed = False
    for t in list(selected):
        for p in parents_of.get(t, set()):
            if p not in selected:
                selected.add(p); added.append(p); changed = True
if added:
    st.info(f"Auto-included FK parents: {', '.join(sorted(set(added)))}")

# ---------------- 3. options (this screen IS the config) -----------------------
st.subheader("Options")
c1, c2 = st.columns(2)
targets = {}
with c1:
    for t in tables:
        if t not in selected:
            continue
        if t in sizing_child:
            st.text_input(f"{t} rows", value="derived", disabled=True, key=f"rows_{t}")
            targets[t] = {"rows": "derived"}
        else:
            targets[t] = {"rows": int(st.number_input(
                f"{t} rows", min_value=1, value=200, key=f"rows_{t}"))}
with c2:
    seed = int(st.number_input("Seed (same seed = identical data)", value=42))
    fmts = st.multiselect("Output format", ["csv", "xlsx"], default=["csv"])

# ---------------- 4. generate + validation gate --------------------------------
if st.button("Generate", type="primary"):
    run_dir = Path(f"demo_output/run_{int(time.time())}")
    run_dir.mkdir(parents=True, exist_ok=True)
    cfg = {"seed": seed, "locale": "en_US", "targets": targets,
           "output": {"format": fmts, "path": str(run_dir)}}

    with st.spinner("Generating..."):
        eng = Engine(model, cfg)
        order_tables, order_views = eng.order()
        for t in order_tables:
            if t in targets:
                eng.generate_table(t)
        for v in order_views:
            srcs = [s.strip() for s in model["views"][v]["source_objects"].split(",")]
            if all(s in eng.frames for s in srcs):
                eng.materialize_view(v)

        ok, report = validate_output(model, eng.frames)
        for name, df in eng.frames.items():
            w = df.copy()
            for c in w.columns:
                if pd.api.types.is_datetime64_any_dtype(w[c]):
                    w[c] = w[c].dt.strftime("%Y-%m-%d")
            w.to_csv(run_dir / f"{name}.csv", index=False)

    st.subheader("Validation")
    cols_ui = st.columns(min(4, len(report)))
    for i, (obj, checks) in enumerate(report.items()):
        with cols_ui[i % len(cols_ui)]:
            good = all(c["pass"] for c in checks)
            (st.success if good else st.error)(
                f"{obj}: {'PASS' if good else 'FAIL'} ({len(checks)} checks)")

    if not ok:
        st.error("Validation FAILED — no files offered. Fix the model and rerun.")
        st.stop()

    st.success("All integrity checks passed. Files ready:")
    dcols = st.columns(3)
    for i, f in enumerate(sorted(run_dir.glob("*.csv"))):
        with dcols[i % 3]:
            st.metric(f.stem, f"{sum(1 for _ in open(f)) - 1:,} rows")
            st.download_button(f"Download {f.name}", f.read_bytes(),
                               file_name=f.name, key=f"dl_{f.name}")

    st.session_state.setdefault("history", []).append(
        {"run": run_dir.name, "model": model_path, "seed": seed,
         "objects": len(eng.frames)})

# ---------------- 5. run history ------------------------------------------------
if st.session_state.get("history"):
    st.subheader("Run history (this session)")
    st.table(pd.DataFrame(st.session_state["history"]))
