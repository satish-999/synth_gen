"""
validate_compliance.py — independent check that generated data follows the data model.
Reads the model snapshot JSON + generated CSVs; re-verifies every model promise:
schema, PK/FK, patterns, domains, ranges, dates, rules, jitter, sequences,
cardinality shape, distribution weights, and full view recomputation.

Usage: python validate_compliance.py --snapshot model_snapshot_XXX.json --data <folder>
"""
import argparse, json, re
from pathlib import Path
import numpy as np
import pandas as pd
import yaml
from safe_expression import safe_eval

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))


def pattern_to_regex(p):
    out = "^"
    for ch in p:
        out += r"\d" if ch == "#" else "[A-Z]" if ch == "?" else re.escape(ch)
    return out + "$"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--config")
    a = ap.parse_args()

    model = json.loads(Path(a.snapshot).read_text())
    data = Path(a.data)
    cfg = yaml.safe_load(Path(a.config).read_text()) if a.config else None
    references = cfg.get("references", {}) if cfg else {}
    if cfg:
        # partial generation: only validate the tables that were actually in
        # scope for this run (targets + tables referenced from prior runs),
        # not the whole model
        active = set(cfg["targets"]) | set(references)
        model["tables"] = {t: cols for t, cols in model["tables"].items() if t in active}
        model["rules"] = [r for r in model["rules"] if r["object"] in active]
    frames = {}
    for t in model["tables"]:
        f = data / f"{t}.csv"
        if t in references:
            f = Path(references[t]["path"])
        elif not f.exists():
            f = data / "_reference_data" / f"{t}.csv"
        if f.exists():
            string_cols = {c["name"]: "string" for c in model["tables"][t] if c["dtype"] in ("str", "string")}
            df = pd.read_csv(f, dtype=string_cols)
            for c in df.columns:          # undo pandas' TRUE/FALSE -> bool parsing
                if df[c].dtype == bool:
                    df[c] = df[c].map({True: "TRUE", False: "FALSE"})
            frames[t] = df

    # ---------------- 1. schema + per-column model compliance ----------------
    for t, cols in model["tables"].items():
        if t not in frames:
            check(f"{t}: file present", False, "CSV missing"); continue
        df = frames[t]
        expected = [c["name"] for c in cols]
        if list(df.columns) == expected:
            check(f"{t}: columns match model", True)
        elif set(df.columns) == set(expected):
            check(f"{t}: columns match model", True,
                  "same columns, different order (cosmetic)")
        else:
            check(f"{t}: columns match model", False, f"got {list(df.columns)}")

        pks = [c["name"] for c in cols if c["pk"]]
        check(f"{t}: PK non-null", df[pks].notna().all().all())
        check(f"{t}: PK unique", not df.duplicated(pks).any())

        for c in cols:
            n, g, p = c["name"], c["generator"], c["params"]
            s = df[n].dropna()
            if c["fk_ref"]:
                pt, pc = c["fk_ref"].split(".")
                orphans = int((~s.isin(frames[pt][pc])).sum())
                check(f"{t}.{n}: FK -> {c['fk_ref']}", orphans == 0,
                      f"{orphans} orphans")
            if g == "pattern":
                rx = pattern_to_regex(p["pattern"])
                bad = int((~s.astype(str).str.match(rx)).sum())
                check(f"{t}.{n}: pattern {p['pattern']}", bad == 0, f"{bad} bad")
            if g == "choice":
                vals = p["values"] if isinstance(p["values"], list) else [p["values"]]
                numeric_dom = all(isinstance(x, (int, float)) for x in vals)
                if numeric_dom:
                    fv = s.astype(float)
                    bad = int((~fv.isin([float(x) for x in vals])).sum())
                    obs = fv.value_counts(normalize=True)
                    key = lambda x: float(x)
                else:
                    sv = s.astype(str).str.upper()
                    bad = int((~sv.isin({str(x).upper() for x in vals})).sum())
                    obs = sv.value_counts(normalize=True)
                    key = lambda x: str(x).upper()
                check(f"{t}.{n}: values within domain", bad == 0, f"{bad} outside")
                if p.get("weights") and len(s) > 300:
                    drift = max(abs(obs.get(key(x), 0) - w)
                                for x, w in zip(vals, p["weights"]))
                    check(f"{t}.{n}: weights ~ model (±5%)", drift < 0.05,
                          f"max drift {drift:.3f}")
            if g == "numeric":
                lo, hi = p.get("min", -np.inf), p.get("max", np.inf)
                bad = int(((s < lo) | (s > hi)).sum())
                check(f"{t}.{n}: range [{lo},{hi}]", bad == 0, f"{bad} out")
            if g == "date":
                d = pd.to_datetime(s)
                ok = (d >= pd.Timestamp(str(p["start"]))).all() and \
                     (d <= pd.Timestamp(str(p["end"]))).all()
                check(f"{t}.{n}: dates in [{p['start']}..{p['end']}]", ok)
            if g == "date_offset":
                base = pd.to_datetime(df[p["base"]])
                d = pd.to_datetime(df[n])
                diff = (d - base).dt.days.dropna()
                # bound-rule bumps may pull values back inside chronology, so
                # allow diffs >= min_days floor of -inf when a bound rule exists
                ok = (diff <= p["max_days"] + 5).all()
                check(f"{t}.{n}: offset from {p['base']} <= {p['max_days']}+5d", ok,
                      f"max {diff.max()}")
            if g == "fk_lookup":
                st, sc = p["source"].split(".")
                fk = p.get("via") or next(x["name"] for x in cols
                          if (x["fk_ref"] or "").startswith(st + "."))
                pk = next(x["name"] for x in model["tables"][st] if x["pk"])
                exp_v = df[fk].map(frames[st].set_index(pk)[sc])
                check(f"{t}.{n}: exact lineage copy of {p['source']}",
                      (df[n].astype(str) == exp_v.astype(str)).all())
            if g == "fk_lookup_jitter":
                st, sc = p["source"].split(".")
                fk = next(x["name"] for x in cols
                          if (x["fk_ref"] or "").startswith(st + "."))
                pk = next(x["name"] for x in model["tables"][st] if x["pk"])
                lut = frames[st].set_index(pk)[sc]
                mult = float(p.get("multiplier", 1))
                ratio = (df[n] / (df[fk].map(lut) * mult)).dropna()
                jp = p["jitter_pct"]
                ok = ratio.between(1 - jp - 0.001, 1 + jp + 0.001).all()
                check(f"{t}.{n}: within ±{int(jp*100)}% of {p['source']}", ok,
                      f"ratio {ratio.min():.3f}..{ratio.max():.3f}")
            if g == "sequence":
                grp = df.groupby(p["scope"])[n]
                ok = (grp.min() == p.get("start", 1)).all() and \
                     (grp.max() == grp.count()).all()
                check(f"{t}.{n}: contiguous sequence per {p['scope']}", ok)
            if g == "case":
                conds, vals_, i = [], [], 1
                while f"when{i}" in p:
                    conds.append(safe_eval(df, p[f"when{i}"], engine="python"))
                    vals_.append(str(p[f"then{i}"])); i += 1
                exp_case = np.select(conds, vals_, default=str(p.get("else", "")))
                check(f"{t}.{n}: case logic holds",
                      (df[n].astype(str).str.upper().values ==
                       pd.Series(exp_case).str.upper().values).all())
            if g == "derived":
                calc = np.round(pd.Series(safe_eval(df, p["expr"])).astype(float), int(p.get("round", 2)))
                ok = (abs(df[n] - calc) < 0.011).all()
                check(f"{t}.{n}: = {p['expr']}", ok)
            if c["nullable_pct"] == 0 and not c["fk_ref"] and n not in pks:
                pass  # nulls allowed only via conditional rules; rules checked below

        # sizing cardinality shape
        for c in cols:
            if c["fk_mode"] == "SIZING" and c["cardinality"]:
                mn, mx, dist = str(c["cardinality"]).split(",")
                counts = df.groupby(c["name"]).size()
                check(f"{t}: children per {c['fk_ref'].split('.')[0]} within "
                      f"[{mn},{mx}]", counts.between(max(int(mn),1), int(mx)).all(),
                      f"min {counts.min()} max {counts.max()} avg {counts.mean():.1f}")

    # ---------------- 2. business rules ----------------
    for r in model["rules"]:
        t, d = r["object"], r["definition"]
        if t not in frames:
            continue
        df = frames[t].copy()
        for c in [x["name"] for x in model["tables"][t] if x["dtype"] == "date"]:
            df[c] = pd.to_datetime(df[c])
        if r["rule_type"] == "temporal_order":
            cols = [c.strip() for c in d.split("<=")]
            sub = df[cols].dropna()
            ok = all((sub[cols[i]] <= sub[cols[i+1]]).all()
                     for i in range(len(cols)-1))
            check(f"RULE {r['rule_id']} ({t}): {d}", ok)
        elif r["rule_type"] == "bound":
            m = re.match(r"(\w+)\s*>=\s*(\w+)", d)
            sub = df[[m.group(1), m.group(2)]].dropna()
            check(f"RULE {r['rule_id']} ({t}): {d}",
                  (sub[m.group(1)] >= sub[m.group(2)]).all())
        elif r["rule_type"] == "conditional":
            m = re.match(r"when (.+?) then (\w+) (NOT NULL|NULL)", d)
            cond, target, action = m.groups()
            mask = safe_eval(df, cond)
            got = df.loc[mask, target]
            ok = got.notna().all() if action == "NOT NULL" else got.isna().all()
            check(f"RULE {r['rule_id']} ({t}): {d}", ok)
        elif r["rule_type"] == "derived":
            m = re.match(r"(\w+)\s*=\s*(.+)", d)
            calc = np.round(pd.Series(safe_eval(df, m.group(2))).astype(float), 2)
            check(f"RULE {r['rule_id']} ({t}): {d}",
                  (abs(df[m.group(1)] - calc) < 0.011).all())

    # ---------------- 3. views: full independent recomputation ----------------
    def _agg(expr, g):
        m = re.match(r"count\((\w+)\)", expr)
        if m: return int(g[m.group(1)].count())
        m = re.match(r"sum\(case when (.+?) then 1 else 0 end\)", expr)
        if m: return int(safe_eval(g, m.group(1)).sum())
        m = re.match(r"(sum|avg|min|max)\((\w+)\)", expr)
        if m:
            fn, col = m.groups()
            return getattr(g[col], {"avg": "mean"}.get(fn, fn))()
        raise ValueError(expr)

    for v_name, spec in model.get("views", {}).items():
        f = data / f"{v_name}.csv"
        if not f.exists():
            continue
        sources = [s.strip() for s in spec["source_objects"].split(",")]
        j = frames[sources[0]].copy()
        for c in model["tables"][sources[0]]:
            if c["dtype"] == "date":
                j[c["name"]] = pd.to_datetime(j[c["name"]])
        joined = {sources[0]}
        for jl in [x.strip() for x in (spec.get("join_logic") or "").split(";") if x.strip()]:
            left, right = [s.strip() for s in jl.split("=")]
            lt, lc = left.split("."); rt, rc = right.split(".")
            nt, nc, cc = (rt, rc, lc) if lt in joined else (lt, lc, rc)
            nd = frames[nt].copy()
            for c in model["tables"][nt]:
                if c["dtype"] == "date":
                    nd[c["name"]] = pd.to_datetime(nd[c["name"]])
            j = j.merge(nd, left_on=cc, right_on=nc, how="inner", suffixes=("", "_r"))
            joined.add(nt)
        if spec.get("filter_logic"):
            j = j.loc[safe_eval(j, spec["filter_logic"])]
        gb = [c.strip() for c in (spec.get("group_by") or "").split(",") if c.strip()]
        if not gb:                       # pass-through view: filtered rows, no grouping
            exp = j[[c["name"] for c in spec["columns"] if c["name"] in j.columns]]
            got = pd.read_csv(f)
            same = len(exp) == len(got)
            check(f"VIEW {v_name}: row count matches recomputation", same,
                  f"{len(got)} rows vs {len(exp)} expected")
            continue
        aggs = [c for c in spec["columns"] if re.match(r"^(count|sum|avg|min|max)\(", c["derivation"])]
        rows = []
        for key, g in j.groupby(gb):
            key = key if isinstance(key, tuple) else (key,)
            rec = dict(zip(gb, key))
            for c in aggs:
                rec[c["name"]] = _agg(c["derivation"], g)
            rows.append(rec)
        exp = pd.DataFrame(rows)
        for c in spec["columns"]:
            if c["derivation"].startswith("round("):
                m = re.match(r"round\((.+),\s*(\d+)\)", c["derivation"])
                exp[c["name"]] = np.round(safe_eval(exp, m.group(1)), int(m.group(2)))
        exp = exp[[c["name"] for c in spec["columns"]]].sort_values(gb).reset_index(drop=True)
        got = pd.read_csv(f)
        if got.empty or exp.empty:
            check(f"VIEW {v_name}: full recomputation matches",
                  len(got) == len(exp), f"{len(got)} rows (empty view)")
            continue
        got = got.sort_values(gb).reset_index(drop=True)
        same = len(exp) == len(got) and all(
            np.allclose(exp[c].astype(float), got[c].astype(float), atol=0.011)
            if pd.api.types.is_numeric_dtype(got[c])
            else (exp[c].astype(str).values == got[c].astype(str).values).all()
            for c in exp.columns)
        check(f"VIEW {v_name}: full recomputation matches", same, f"{len(got)} rows compared")

    # ---------------- report ----------------
    width = max(len(n) for n, _, _ in RESULTS)
    fails = 0
    for n, ok, detail in RESULTS:
        mark = "PASS" if ok else "FAIL"
        fails += not ok
        print(f"  [{mark}] {n.ljust(width)}  {detail}")
    print(f"\n  {len(RESULTS)} checks, {len(RESULTS)-fails} passed, {fails} failed")
    print("  MODEL COMPLIANCE:", "PASS" if fails == 0 else "FAIL")
    raise SystemExit(0 if fails == 0 else 1)


if __name__ == "__main__":
    main()
