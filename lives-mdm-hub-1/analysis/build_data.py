"""Runs the analysis on data/ and writes assets/data.js and analysis/output/."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import triage  # noqa: E402
from dedup import CFG, cluster, score_item  # noqa: E402
from forecasting import backtest, forecast_swing, interval_multipliers, m_combined, m_ma6  # noqa: E402
from process_sim import CURRENT, PROPOSED, histogram, simulate, summarise  # noqa: E402
import propensity  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "analysis" / "output"
AS_OF = pd.Timestamp("2026-09-30")
MONTHS = [f"{y}-{m:02d}" for y, m in [(2025, 10), (2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 10)]]
Q2 = MONTHS[6:9]
Q3 = MONTHS[9:12]
COUNTRIES = {"SG": "Singapore", "MY": "Malaysia", "ID": "Indonesia", "TH": "Thailand", "VN": "Vietnam"}
PRODUCTS = {
    "A": dict(name="Diagnostic reagents", entity="SPD", unit="kits", price=185.0),
    "B": dict(name="Lab consumables", entity="QTS", unit="boxes", price=24.0),
    "C": dict(name="Instruments & service", entity="QTG", unit="units", price=1450.0),
}
PRICES = {p: v["price"] for p, v in PRODUCTS.items()}

# Business-case assumptions. Every one of these is shown and labelled in the app.
ASSUMPTIONS = dict(
    mdm_minutes_today=50, mdm_minutes_hub=13,          # forwarding, chasing, re-keying vs final check + import
    requester_minutes_today=30, requester_minutes_hub=5,  # status chasing and re-submitting
    approver_minutes_today=10, approver_minutes_hub=4,  # finding the thread vs one card in Teams
    hourly_cost_sgd=55,                                 # loaded cost of an hour of staff time
    duplicate_rate_today=0.08, duplicate_catch_rate=0.9, duplicate_fix_hours=6,
    forecast_hours_today_per_month=16, forecast_hours_hub_per_month=2,
    triage_minutes_saved_per_message=1.5,
    build_internal_hours=156, outside_help_days=10, outside_day_rate_sgd=1200,
    licence_cost_sgd=0,
)


def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, float) and np.isnan(o):
        return None
    if isinstance(o, (pd.Timestamp,)):
        return o.strftime("%Y-%m-%d")
    return o


def r1(x):
    return None if x is None else round(float(x), 1)


def r3(x):
    return None if x is None else round(float(x), 3)


cust = pd.read_csv(DATA / "customers.csv", dtype=str).fillna("")
cust["credit_limit"] = pd.to_numeric(cust["credit_limit"])
items = pd.read_csv(DATA / "items.csv", dtype=str).fillna("")
vendors = pd.read_csv(DATA / "vendors.csv", dtype=str).fillna("")
ccs = pd.read_csv(DATA / "cost_centres.csv", dtype=str).fillna("")
po = pd.read_csv(DATA / "purchase_orders.csv")
po["po_date"] = pd.to_datetime(po["po_date"])
msgs = pd.read_csv(DATA / "inbound_messages.csv", dtype=str).fillna("")
hist = pd.read_csv(DATA / "mdm_requests.csv")
prospects = pd.read_csv(DATA / "prospects.csv", dtype=str).fillna("")
truth = json.loads((DATA / "planted_patterns.json").read_text())
cinfo = cust.set_index("customer_id")

recs = [dict(id=r.customer_id, name=r["name"], reg_no=r.reg_no, phone=r.phone, address=r.address,
             country=r.country, city=r.city, email=r.email, created=r.created) for _, r in cust.iterrows()]
clusters, review, scored = cluster(recs, "customer")
master = {m: cl["master_id"] for cl in clusters for m in cl["member_ids"]}
po["master_id"] = po["customer_id"].map(lambda x: master.get(x, x))
po["country_raw"] = po["country"]
po["country_dedup"] = po["master_id"].map(cinfo["country"])

planted = {frozenset([d["original_id"], d["duplicate_id"]]) for d in truth["duplicate_customers"]}
found = {frozenset(cl["member_ids"]) for cl in clusters}
match_quality = dict(planted=len(planted), found=len(found & planted), false_merges=len(found - planted),
                     review_pairs=len(review))

vend_recs = [dict(id=r.vendor_code, name=r["name"], reg_no=r.reg_no, country=r.country, bank_account=r.bank_account,
                  created=r.created) for _, r in vendors.iterrows()]
vend_clusters, vend_review, _ = cluster(vend_recs, "vendor")
item_pairs = []
irows = items.to_dict("records")
for i in range(len(irows)):
    for j in range(i + 1, len(irows)):
        s = score_item(irows[i], irows[j])
        if s["score"] >= 90:
            a, b = sorted([irows[i], irows[j]], key=lambda r: r["created"])
            item_pairs.append(dict(master=a["item_code"], duplicate=b["item_code"], master_name=a["description"],
                                   duplicate_name=b["description"], score=s["score"], band=s["band"], reasons=s["reasons"]))


def view_cols(view):
    return ("customer_id", "country_raw") if view == "raw" else ("master_id", "country_dedup")


def cname(cid):
    return cinfo.loc[cid, "name"]


def regional(view):
    cid, cc = view_cols(view)
    units = {c: {p: [0.0] * 12 for p in PRODUCTS} for c in COUNTRIES}
    value = {c: {p: [0.0] * 12 for p in PRODUCTS} for c in COUNTRIES}
    g = po.groupby([cc, "product", "month"]).agg(qty=("qty", "sum"), val=("value_sgd", "sum")).reset_index()
    for _, r in g.iterrows():
        mi = MONTHS.index(r["month"])
        units[r[cc]][r["product"]][mi] = float(r["qty"])
        value[r[cc]][r["product"]][mi] = round(float(r["val"]), 2)
    table = []
    for c in COUNTRIES:
        for p in PRODUCTS:
            u = units[c][p]
            q2, q3 = sum(u[6:9]), sum(u[9:12])
            buyers = po[(po[cc] == c) & (po["product"] == p) & po["month"].isin(Q3)][cid].nunique()
            table.append(dict(country=c, product=p, q2=q2, q3=q3, growth=r3(q3 / q2 - 1) if q2 else None,
                              q3_value=round(sum(value[c][p][9:12])), buyers_q3=int(buyers), trend=u))
    prod_tot = {}
    for p in PRODUCTS:
        u = [sum(units[c][p][i] for c in COUNTRIES) for i in range(12)]
        v = [sum(value[c][p][i] for c in COUNTRIES) for i in range(12)]
        prod_tot[p] = dict(units=u, value=[round(x) for x in v], q2=sum(u[6:9]), q3=sum(u[9:12]),
                           growth=r3(sum(u[9:12]) / sum(u[6:9]) - 1), q3_value=round(sum(v[9:12])))
    country_tot = {}
    for c in COUNTRIES:
        v = [sum(value[c][p][i] for p in PRODUCTS) for i in range(12)]
        country_tot[c] = dict(value=[round(x) for x in v], q2_value=round(sum(v[6:9])), q3_value=round(sum(v[9:12])),
                              growth=r3(sum(v[9:12]) / sum(v[6:9]) - 1),
                              active_q3=int(po[(po[cc] == c) & po["month"].isin(Q3)][cid].nunique()))
    v_all = [sum(country_tot[c]["value"][i] for c in COUNTRIES) for i in range(12)]
    q3 = po[po["month"].isin(Q3)]
    top = (q3.groupby(cid).agg(value=("value_sgd", "sum"), products=("product", lambda s: "".join(sorted(set(s)))))
           .sort_values("value", ascending=False).head(10))
    top_rows = [dict(id=i, name=cname(i), country=cinfo.loc[i, "country"] if view == "raw" else cinfo.loc[i, "country"],
                     value=round(float(r["value"])), products=r["products"]) for i, r in top.iterrows()]
    return dict(units=units, value=value, table=table, products=prod_tot, countries=country_tot,
                region=dict(value=v_all, q2_value=round(sum(v_all[6:9])), q3_value=round(sum(v_all[9:12])),
                            growth=r3(sum(v_all[9:12]) / sum(v_all[6:9]) - 1),
                            active_q3=int(q3[cid].nunique()), records_with_orders=int(po[cid].nunique())),
                top_customers=top_rows)


def decomposition(view, product=None):
    cid, cc = view_cols(view)
    first_any = po.groupby(cid)["po_date"].min()
    df = po[po["product"] == product] if product else po
    measure = "qty" if product else "value_sgd"
    q2 = df[df["month"].isin(Q2)].groupby(cid)[measure].sum()
    q3 = df[df["month"].isin(Q3)].groupby(cid)[measure].sum()
    ids = sorted(set(q2.index) | set(q3.index))
    new, stopped, existing = [], [], []
    for i in ids:
        a, b = float(q2.get(i, 0)), float(q3.get(i, 0))
        if a == 0 and b > 0 and first_any[i] >= pd.Timestamp("2026-07-01"):
            new.append((i, b))
        elif a > 0 and b == 0:
            stopped.append((i, a))
        else:
            existing.append((i, b - a))

    def names(rows):
        return [dict(id=i, name=cname(i), value=round(v)) for i, v in sorted(rows, key=lambda r: -abs(r[1]))[:6]]
    return dict(q2=round(float(q2.sum())), q3=round(float(q3.sum())),
                new=round(sum(v for _, v in new)), new_count=len(new), new_names=names(new),
                stopped=round(sum(v for _, v in stopped)), stopped_count=len(stopped), stopped_names=names(stopped),
                existing=round(sum(v for _, v in existing)), existing_count=len(existing))


def going_quiet(view):
    """Customers whose last order is well past their usual rhythm for their main product."""
    cid, cc = view_cols(view)
    rows = []
    for i, d in po.groupby(cid):
        main = d.groupby("product")["value_sgd"].sum().idxmax()
        mdates = d[d["product"] == main].groupby("month")["po_date"].min().sort_values()
        if len(mdates) < 4:
            continue
        gaps = np.diff(mdates.values).astype("timedelta64[D]").astype(int)
        usual = float(np.median(gaps))
        last = d["po_date"].max()
        since = int((AS_OF - last).days)
        if since > max(2 * usual, 60):
            window = d[d["po_date"] > last - pd.Timedelta(days=182)]
            monthly = float(window["value_sgd"].sum()) / 6
            artifact = None
            if view == "raw" and i in master:
                others = po[(po["master_id"] == master[i]) & (po["customer_id"] != i)]
                if len(others) and others["po_date"].max() > last:
                    other_id = others["customer_id"].iloc[-1]
                    artifact = dict(id=other_id, name=cname(other_id), last=others["po_date"].max().strftime("%Y-%m-%d"))
            rows.append(dict(id=i, name=cname(i), country=cinfo.loc[i, "country"], segment=cinfo.loc[i, "segment"],
                             main_product=main, last_order=last.strftime("%Y-%m-%d"), usual_gap=int(round(usual)),
                             days_since=since, monthly_value=round(monthly), duplicate_artifact=artifact))
    return sorted(rows, key=lambda r: -r["monthly_value"])


def cross_sell(view):
    cid, cc = view_cols(view)
    recent = po[po["po_date"] > AS_OF - pd.Timedelta(days=183)]
    bought = po.groupby(cid)["product"].agg(lambda s: set(s))
    bought_recent = recent.groupby(cid)["product"].agg(lambda s: set(s))
    first = po.groupby(cid)["po_date"].min()
    last_any = po.groupby(cid)["po_date"].max()
    ab_value = recent[recent["product"].isin(["A", "B"])].groupby(cid)["value_sgd"].sum()
    c_value = po[po["product"] == "C"].groupby(cid)["value_sgd"].sum() / 12
    seg_ok = {"Public hospital", "Private hospital", "Independent lab"}
    pool = [i for i in bought_recent.index if cinfo.loc[i, "segment"] in seg_ok and cinfo.loc[i, "size"] in ("L", "M")
            and {"A", "B"} <= bought_recent[i]]
    rows = []
    for i in pool:
        if "C" in bought[i] or first[i] > pd.Timestamp("2026-06-30") or (AS_OF - last_any[i]).days > 60:
            continue
        peers = [j for j in pool if j != i and cinfo.loc[j, "segment"] == cinfo.loc[i, "segment"]
                 and cinfo.loc[j, "size"] == cinfo.loc[i, "size"]]
        if len(peers) < 3:
            continue
        with_c = [j for j in peers if "C" in bought[j]]
        adoption = len(with_c) / len(peers)
        if adoption >= 0.4:
            scale = float(np.clip(ab_value[i] / np.median([ab_value[j] for j in peers]), 0.5, 2.0))
            potential = float(np.median([c_value[j] for j in with_c])) * scale
            false_positive = None
            if view == "raw" and i in master:
                sib = po[(po["master_id"] == master[i]) & (po["customer_id"] != i) & (po["product"] == "C")]
                if len(sib):
                    false_positive = dict(id=sib["customer_id"].iloc[0], name=cname(sib["customer_id"].iloc[0]))
            rows.append(dict(id=i, name=cname(i), country=cinfo.loc[i, "country"], segment=cinfo.loc[i, "segment"],
                             size=cinfo.loc[i, "size"], peers=len(peers), peer_adoption=r3(adoption),
                             potential_monthly=round(potential), already_buys_c_elsewhere=false_positive))
    return sorted(rows, key=lambda r: -r["potential_monthly"])


def concentration(view):
    cid, cc = view_cols(view)
    q3 = po[po["month"].isin(Q3)]
    reg = regional(view)
    growth = {(r["country"], r["product"]): r["growth"] for r in reg["table"]}
    rows = []
    for (c, p), d in q3.groupby([cc, "product"]):
        s = d.groupby(cid)["qty"].sum().sort_values(ascending=False)
        share = float(s.head(3).sum() / s.sum())
        rows.append(dict(country=c, product=p, buyers=int(len(s)), top3_share=r3(share), growth=growth.get((c, p)),
                         top3=[dict(id=i, name=cname(i), units=float(v)) for i, v in s.head(3).items()],
                         flag=bool(share >= 0.6 and (growth.get((c, p)) or 0) >= 0.15)))
    return sorted(rows, key=lambda r: (-r["flag"], -r["top3_share"]))


msgs["month"] = msgs["received_at"].str[:7]
types = ["purchase_order", "enquiry", "setup_request", "follow_up"]
by_type_month = {t: [int(((msgs["true_type"] == t) & (msgs["month"] == m)).sum()) for m in MONTHS] for t in types}
q3m = msgs[msgs["month"].isin(Q3)]
by_country_q3 = []
for c in COUNTRIES:
    d = q3m[q3m["country"] == c]
    counts = {t: int((d["true_type"] == t).sum()) for t in types}
    by_country_q3.append(dict(country=c, **counts, total=int(len(d)),
                              actionable_share=r3(counts["purchase_order"] / len(d)) if len(d) else None))

new_rows = []
for nc in truth["new_customers"]:
    i = nc["customer_id"]
    d = po[po["customer_id"] == i].sort_values("po_date")
    first_order = d["po_date"].min()
    sub = pd.Timestamp(nc["setup_submitted"])
    created = pd.Timestamp(nc["account_created"])
    first3 = d[d["po_date"] < first_order + pd.Timedelta(days=91)]
    enq = msgs[(msgs["linked_ref"] == i) & (msgs["true_type"] == "enquiry")]
    first_enq = pd.Timestamp(enq["received_at"].min()) if len(enq) else sub
    new_rows.append(dict(id=i, name=nc["name"], country=nc["country"], segment=cinfo.loc[i, "segment"],
                         size=cinfo.loc[i, "size"], setup_submitted=nc["setup_submitted"],
                         account_created=nc["account_created"], first_order=first_order.strftime("%Y-%m-%d"),
                         enquiry_to_request=int((sub - first_enq).days), setup_days=int((created - sub).days),
                         created_to_first_order=int((first_order - created).days),
                         monthly_value=round(float(first3["value_sgd"].sum()) / 3)))
nr = pd.DataFrame(new_rows)
waited_value = float((nr["monthly_value"] / 30 * nr["setup_days"]).sum())


def expected_value(segment, size):
    m = nr[(nr["segment"] == segment) & (nr["size"] == size)]["monthly_value"]
    if len(m) == 0:
        m = nr[nr["size"] == size]["monthly_value"]
    if len(m) == 0:
        m = nr["monthly_value"]
    return float(m.median())


open_hist = hist[hist["status"] == "Open"]
pipeline = []
for _, p in prospects.iterrows():
    h = open_hist[open_hist["subject"] == f"New customer: {p['name']}"]
    pipeline.append(dict(id=p["prospect_id"], name=p["name"], country=p["country"], segment=p["segment"], size=p["size"],
                         submitted=p["setup_submitted"], days_waiting=int((AS_OF - pd.Timestamp(p["setup_submitted"])).days),
                         waiting_on=(h["current_step"].iloc[0].replace(" approves", "").replace("MDM keys record into SAP B1", "MDM keying")
                                     if len(h) else ""),
                         expected_monthly=round(expected_value(p["segment"], p["size"]), -2)))
pipeline.sort(key=lambda r: (-r["expected_monthly"], -r["days_waiting"]))
pipe_by_country = {c: dict(count=sum(1 for r in pipeline if r["country"] == c),
                           monthly=sum(r["expected_monthly"] for r in pipeline if r["country"] == c)) for c in COUNTRIES}

def series(view):
    cid, cc = view_cols(view)
    pv = po.pivot_table(index=[cc, "product"], columns="month", values="qty", aggfunc="sum").reindex(columns=MONTHS).fillna(0)
    out = {k: v.values.astype(float) for k, v in pv.iterrows()}
    for c in COUNTRIES:
        for p in PRODUCTS:
            out.setdefault((c, p), np.zeros(12))
    return out


forecast = {}
for view in ("dedup", "raw"):
    s = series(view)
    res, rows = backtest(s, PRICES)
    swing = forecast_swing(s)
    mult = interval_multipliers(rows)
    fwd = m_combined(s, 3)
    ma = m_ma6(s, 3)
    june_c = m_combined({k: v[:9] for k, v in s.items()}, 3)
    june_ma = m_ma6({k: v[:9] for k, v in s.items()}, 3)
    per = {c: {} for c in COUNTRIES}
    for (c, p), y in s.items():
        lo = [max(0.0, f * (1 + mult.get((p, h + 1), (-0.2, 0.2))[0])) for h, f in enumerate(fwd[(c, p)])]
        hi = [f * (1 + mult.get((p, h + 1), (-0.2, 0.2))[1]) for h, f in enumerate(fwd[(c, p)])]
        per[c][p] = dict(actual=[float(v) for v in y], forecast=[r1(v) for v in fwd[(c, p)]], lo=[r1(v) for v in lo],
                         hi=[r1(v) for v in hi], ma6=[r1(v) for v in ma[(c, p)]],
                         june_combined=[r1(v) for v in june_c[(c, p)]], june_ma6=[r1(v) for v in june_ma[(c, p)]])
    region = {}
    for p in PRODUCTS:
        keys = [(c, p) for c in COUNTRIES]
        region[p] = dict(actual=[float(sum(s[k][i] for k in keys)) for i in range(12)],
                         forecast=[r1(sum(fwd[k][h] for k in keys)) for h in range(3)],
                         lo=[r1(sum(per[k[0]][p]["lo"][h] for k in keys)) for h in range(3)],
                         hi=[r1(sum(per[k[0]][p]["hi"][h] for k in keys)) for h in range(3)],
                         ma6=[r1(sum(ma[k][h] for k in keys)) for h in range(3)],
                         june_combined=[r1(sum(june_c[k][h] for k in keys)) for h in range(3)],
                         june_ma6=[r1(sum(june_ma[k][h] for k in keys)) for h in range(3)])
    forecast[view] = dict(
        methods=[dict(code=k, label=v["label"], wape=r3(v["overall"]["wape"]), bias=r3(v["overall"]["bias"]), swing=r3(swing[k]),
                      by_product={p: dict(wape=r3(v["by_product"][p]["wape"]), bias=r3(v["by_product"][p]["bias"]))
                                  for p in PRODUCTS}) for k, v in res.items()],
        series=per, region=region, months_forward=["2026-10", "2026-11", "2026-12"])

base_w = next(m for m in forecast["dedup"]["methods"] if m["code"] == "ma6")
ours_w = next(m for m in forecast["dedup"]["methods"] if m["code"] == "combined")
naive_w = next(m for m in forecast["dedup"]["methods"] if m["code"] == "naive")
forecast_gain = dict(baseline_wape=base_w["wape"], ours_wape=ours_w["wape"], baseline_bias=base_w["bias"],
                     ours_bias=ours_w["bias"], relative_reduction=r3(1 - ours_w["wape"] / base_w["wape"]),
                     ours_swing=ours_w["swing"], naive_wape=naive_w["wape"], naive_swing=naive_w["swing"])

# Market scenario assumptions (used by marketScenario in assets/engine.js)
CURRENCY = {"SG": "SGD", "MY": "MYR", "ID": "IDR", "TH": "THB", "VN": "VND"}
MARKET_ASSUMPTIONS = dict(
    elasticity={"A": -0.3, "B": -0.6, "C": -1.2},
    elasticity_note={"A": "Reagents are needed for every test run, so orders barely move with price",
                     "B": "Consumables can be bought from cheaper suppliers",
                     "C": "Instruments are capital purchases a hospital can postpone"},
    sensitivity={"Public hospital": 0.5, "Private hospital": 1.0, "Independent lab": 1.0, "Clinic group": 1.2,
                 "Research institute": 0.8},
    sensitivity_note="Public hospitals buy on fixed tenders and budgets, so they react least; clinic groups react most.",
    fx_pass=0.5, tariff_pass=0.8,
)
MARKET_PRESETS = [
    dict(key="none", label="No change", fx={}, demand={}, tariff={}, tariff_countries=[]),
    dict(key="fx", label="Weaker regional currencies", fx={"MY": 3, "ID": 6, "TH": 4, "VN": 5}, demand={}, tariff={}, tariff_countries=[]),
    dict(key="tariff", label="Tariff on imported instruments", fx={}, demand={}, tariff={"C": 5}, tariff_countries=["ID", "TH", "VN"]),
    dict(key="budget", label="Slower hospital spending", fx={}, demand={"TH": -6, "VN": -4}, tariff={}, tariff_countries=[]),
    dict(key="stress", label="All three at once", fx={"MY": 3, "ID": 6, "TH": 4, "VN": 5}, demand={"TH": -6, "VN": -4},
         tariff={"C": 5}, tariff_countries=["ID", "TH", "VN"]),
]
masters_df = cust[cust["customer_id"].map(lambda x: master.get(x, x) == x)]
q3po = po[po["month"].isin(Q3)]
fseries = forecast["dedup"]["series"]
market_cells, market_customers = [], []
for c in COUNTRIES:
    for p in PRODUCTS:
        sub = q3po[(q3po["country_dedup"] == c) & (q3po["product"] == p)]
        seg_value = sub.groupby(sub["master_id"].map(cinfo["segment"]))["value_sgd"].sum()
        tot = float(seg_value.sum())
        market_cells.append(dict(country=c, product=p, q3_units=r1(sum(fseries[c][p]["actual"][9:12])),
                                 q4_units=r1(sum(fseries[c][p]["forecast"])), price=PRICES[p],
                                 segment_share={k: r3(v / tot) for k, v in seg_value.items()} if tot else {}))
growth = {(m["country"], m["product"]): (m["q4_units"] / m["q3_units"] if m["q3_units"] else 1.0) for m in market_cells}
for cid, g in q3po.groupby("master_id"):
    row = cinfo.loc[cid]
    vals = {p: r1(float(g[g["product"] == p]["value_sgd"].sum()) * growth[(row["country"], p)]) for p in PRODUCTS}
    if sum(vals.values()) > 0:
        market_customers.append(dict(id=cid, name=row["name"], country=row["country"], segment=row["segment"], q4_value=vals))
prop_score, prop_metrics, prop_drivers = propensity.train(po, masters_df, MONTHS, PRICES)
market = dict(assumptions=MARKET_ASSUMPTIONS, presets=MARKET_PRESETS, currency=CURRENCY, cells=market_cells,
              customers=market_customers, propensity=dict(metrics=prop_metrics, drivers=prop_drivers))

model, tmetrics, parity, vec, clf = triage.train(msgs)
msgs["predicted"] = triage.predict_all(msgs, vec, clf)
pred_q3 = {t: int((msgs[msgs["month"].isin(Q3)]["predicted"] == t).sum()) for t in types}
examples = []
for t in types:
    ex = msgs[(msgs["true_type"] == t)].sample(2, random_state=3)
    for _, r in ex.iterrows():
        examples.append(dict(type=t, subject=r["subject"], body=r["body"]))
ambiguous = msgs[msgs["subject"].str.contains(r"quick question|account opening|updated yet", case=False, regex=True)].head(3)
for _, r in ambiguous.iterrows():
    examples.append(dict(type=r["true_type"], subject=r["subject"], body=r["body"], ambiguous=True))
(ROOT / "tests" / "fixtures").mkdir(parents=True, exist_ok=True)
(ROOT / "tests" / "fixtures" / "triage_parity.json").write_text(json.dumps(dict(classes=model["classes"], cases=parity)))

# dedup parity fixture: Python scores the browser engine must reproduce
from dedup import score_party  # noqa: E402

_rng = np.random.default_rng(11)
_pairs = [(i, j) for i, j, _ in scored]
for _ in range(250):
    i, j = sorted(_rng.choice(len(recs), 2, replace=False).tolist())
    _pairs.append((i, j))
_queries = ["NUH", "Natl Univ Hosp", "National University", "KVSH", "Saigon Riverside Eye", "Lion City Diagnostic",
            "Chiangmai Clinical Lab", "PT RS Surabaya Medika", "Bangkok Riverside", "Hanoi Central Hosp"]
_iq = ["HbA1c Reagent Kit, 200 tests", "Nitrile gloves large 100/box", "Pipette tips 200uL", "Troponin I assay 100T",
       "Centrifuge rotor 24 place", "Procalcitonin Rapid Test, 25 tests"]
dedup_fixture = dict(
    customer_pairs=[dict(a=recs[i], b=recs[j], score=score_party(recs[i], recs[j])["score"]) for i, j in _pairs],
    customer_queries=[dict(q=dict(name=q), b=r, score=score_party(dict(name=q), r)["score"]) for q in _queries for r in recs],
    vendor_pairs=[dict(a=a, b=b, score=score_party(a, b, "vendor")["score"]) for a in vend_recs for b in vend_recs if a["id"] < b["id"]],
    item_pairs=[dict(a=irows[i], b=irows[j], score=score_item(irows[i], irows[j])["score"])
                for i in range(len(irows)) for j in range(i + 1, len(irows))],
    item_queries=[dict(q=dict(description=q), b=r, score=score_item(dict(description=q), r)["score"]) for q in _iq for r in irows],
)
(ROOT / "tests" / "fixtures" / "dedup_parity.json").write_text(json.dumps(clean(dedup_fixture)))

done = hist[hist["status"] == "Completed"].copy()
done["turnaround_days"] = pd.to_numeric(done["turnaround_days"])
counts = hist["approvals"].value_counts().sort_index()
approval_counts = counts.index.to_numpy()
approval_probs = (counts / counts.sum()).to_numpy()
cur_sim, new_sim = simulate(approval_counts, approval_probs)
edges = list(range(0, 42, 2))
per_year = len(hist)
cust_setups = int((hist["domain"] == "Customer").sum())
history = dict(
    requests=int(len(hist)), per_month=r1(len(hist) / 12), completed=int(len(done)), open=int((hist["status"] == "Open").sum()),
    mean=r1(done["turnaround_days"].mean()), median=r1(done["turnaround_days"].median()),
    p90=r1(done["turnaround_days"].quantile(0.9)), max=r1(done["turnaround_days"].max()),
    bounce_rate=r3((hist["bounce_backs"] > 0).mean()), approvals_mean=r1(hist["approvals"].mean()),
    clarification_rate=r3((hist["clarifications"] > 0).mean()),
    by_domain=[dict(domain=d, requests=int(len(g)), mean=r1(g["turnaround_days"].mean())) for d, g in done.groupby("domain")],
    histogram=histogram(done["turnaround_days"].to_numpy(), edges),
    approval_counts=[int(x) for x in approval_counts], approval_probs=[r3(x) for x in approval_probs],
)
sim = dict(current=summarise(cur_sim), proposed=summarise(new_sim), edges=edges,
           current_hist=histogram(cur_sim, edges), proposed_hist=histogram(new_sim, edges),
           params_current=CURRENT, params_proposed=PROPOSED)

A = ASSUMPTIONS
appr_per_req = float(hist["approvals"].mean())
mdm_hours = per_year * (A["mdm_minutes_today"] - A["mdm_minutes_hub"]) / 60
req_hours = per_year * (A["requester_minutes_today"] - A["requester_minutes_hub"]) / 60
appr_hours = per_year * appr_per_req * (A["approver_minutes_today"] - A["approver_minutes_hub"]) / 60
dups_prevented = cust_setups * A["duplicate_rate_today"] * A["duplicate_catch_rate"]
dup_hours = dups_prevented * A["duplicate_fix_hours"]
fc_hours = 12 * (A["forecast_hours_today_per_month"] - A["forecast_hours_hub_per_month"])
msgs_per_year = len(msgs)
triage_hours = msgs_per_year * tmetrics["auto_share"] * A["triage_minutes_saved_per_message"] / 60
cust_mean_today = float(done[done["domain"] == "Customer"]["turnaround_days"].mean())
days_saved_setup = cust_mean_today - sim["proposed"]["mean"]
new_per_year = len(nr) + len(pipeline)
daily_new = float(nr["monthly_value"].mean()) / 30
pulled_forward = new_per_year * days_saved_setup * daily_new
total_hours = mdm_hours + req_hours + appr_hours + dup_hours + fc_hours + triage_hours
annual_benefit = total_hours * A["hourly_cost_sgd"]
build_cost = A["build_internal_hours"] * A["hourly_cost_sgd"] + A["outside_help_days"] * A["outside_day_rate_sgd"] + A["licence_cost_sgd"]
impacts = dict(
    mdm_hours=round(mdm_hours), requester_hours=round(req_hours), approver_hours=round(appr_hours),
    duplicates_prevented=r1(dups_prevented), duplicate_hours=round(dup_hours), forecast_hours=round(fc_hours),
    triage_hours=round(triage_hours), total_hours=round(total_hours), fte=r1(total_hours / 1650),
    annual_benefit_sgd=round(annual_benefit, -2), build_cost_sgd=round(build_cost, -2),
    payback_months=r1(build_cost / (annual_benefit / 12)),
    customer_setup_days_today=r1(cust_mean_today), customer_setup_days_hub=sim["proposed"]["mean"],
    days_saved_per_setup=r1(days_saved_setup), new_accounts_per_year=int(new_per_year),
    revenue_pulled_forward_sgd=round(pulled_forward, -3), value_waited_on_setup_sgd=round(waited_value, -3),
    requests_per_year=int(per_year), customer_setups_per_year=cust_setups, messages_per_year=int(msgs_per_year),
)

reg_raw, reg_dedup = regional("raw"), regional("dedup")
gq_raw, gq_dedup = going_quiet("raw"), going_quiet("dedup")
xs_raw, xs_dedup = cross_sell("raw"), cross_sell("dedup")
conc_raw, conc_dedup = concentration("raw"), concentration("dedup")
dec = {view: {"all": decomposition(view), **{p: decomposition(view, p) for p in PRODUCTS}} for view in ("raw", "dedup")}
raw_ids = {r["id"] for r in xs_raw}
dedup_ids = {r["id"] for r in xs_dedup}
missed = [r for r in xs_dedup if r["id"] not in raw_ids and r["id"] in master.values()]


def tbl(reg, c, p):
    return next(r for r in reg["table"] if r["country"] == c and r["product"] == p)


def conc_of(rows, c, p):
    return next((r for r in rows if r["country"] == c and r["product"] == p), None)


dedup_impact = dict(
    records=int(len(cust)), customers=int(len(cust) - sum(len(cl["member_ids"]) - 1 for cl in clusters)),
    active_q3=dict(raw=reg_raw["region"]["active_q3"], dedup=reg_dedup["region"]["active_q3"]),
    going_quiet=dict(raw=len(gq_raw), dedup=len(gq_dedup), false=sum(1 for r in gq_raw if r["duplicate_artifact"])),
    new_accounts_q3=dict(raw=dec["raw"]["all"]["new_count"], dedup=dec["dedup"]["all"]["new_count"]),
    stopped_accounts_q3=dict(raw=dec["raw"]["all"]["stopped_count"], dedup=dec["dedup"]["all"]["stopped_count"]),
    cross_sell=dict(raw=len(xs_raw), dedup=len(xs_dedup),
                    false=sum(1 for r in xs_raw if r["already_buys_c_elsewhere"]), missed=len(missed),
                    missed_names=[r["name"] for r in missed]),
    my_b_q3=dict(raw=tbl(reg_raw, "MY", "B")["q3"], dedup=tbl(reg_dedup, "MY", "B")["q3"],
                 growth_raw=tbl(reg_raw, "MY", "B")["growth"], growth_dedup=tbl(reg_dedup, "MY", "B")["growth"]),
    sg_b_q3=dict(raw=tbl(reg_raw, "SG", "B")["q3"], dedup=tbl(reg_dedup, "SG", "B")["q3"]),
    vn_c_top3=dict(raw=(conc_of(conc_raw, "VN", "C") or {}).get("top3_share"),
                   dedup=(conc_of(conc_dedup, "VN", "C") or {}).get("top3_share")),
)

cluster_rows = []
for cl in clusters:
    members = []
    for m in cl["member_ids"]:
        d = po[po["customer_id"] == m]
        members.append(dict(id=m, name=cname(m), entity=cinfo.loc[m, "entity"], country=cinfo.loc[m, "country"],
                            created=cinfo.loc[m, "created"], reg_no=cinfo.loc[m, "reg_no"],
                            products="".join(sorted(set(d["product"]))),
                            first_month=d["month"].min() if len(d) else "", last_month=d["month"].max() if len(d) else "",
                            orders=int(len(d)), value=round(float(d["value_sgd"].sum()))))
    link = cl["links"][0]
    cluster_rows.append(dict(master_id=cl["master_id"], members=members, score=link["score"], reasons=link["reasons"]))
cluster_rows.sort(key=lambda r: -sum(m["value"] for m in r["members"]))

def words(n):
    return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] if 0 <= n <= 10 else str(n)


def pct(x):
    return f"{x * 100:+.0f}%"


t_d = {(r["country"], r["product"]): r for r in reg_dedup["table"]}
id_new = [r for r in new_rows if r["country"] == "ID"]
vn_c = conc_of(conc_dedup, "VN", "C")
th_worst = min((t_d[("TH", p)] for p in PRODUCTS), key=lambda r: r["growth"] or 0)
pattaya = next((r for r in gq_dedup if "Pattaya" in r["name"]), None)
c_d = reg_dedup["countries"]
year_gain = {c: sum(c_d[c]["value"][9:12]) - sum(c_d[c]["value"][0:3]) for c in COUNTRIES}  # Jul-Sep 2026 against Oct-Dec 2025
fastest_q = max(COUNTRIES, key=lambda c: c_d[c]["growth"])
implications = [
    dict(title="Indonesia adds the most new business",
         text=f"Quarterly orders are worth about SGD {year_gain['ID'] / 1000:,.0f}k more than a year ago, more than any other country"
              f"{'' if max(year_gain, key=year_gain.get) == 'ID' else ' (check: not the largest)'}. "
              f"Product A grew {t_d[('ID', 'A')]['growth'] * 100:.0f}% and Product B {t_d[('ID', 'B')]['growth'] * 100:.0f}% quarter on quarter. "
              f"{len(id_new)} Indonesian hospitals opened accounts this year and {pipe_by_country['ID']['count']} more are waiting on setup, "
              f"worth about SGD {pipe_by_country['ID']['monthly'] / 1000:,.0f}k a month.",
         action="Fast-track Indonesian account setups and plan extra Product A and B stock for Q4."),
    dict(title=f"Vietnam's instrument growth rests on {words(min(3, vn_c['buyers']))} hospitals",
         text=(f"{'Vietnam grew fastest this quarter, with order value up ' + format(c_d['VN']['growth'] * 100, '.0f') + '%. ' if fastest_q == 'VN' else ''}"
               f"Product C grew {t_d[('VN', 'C')]['growth'] * 100:.0f}% quarter on quarter, and all of that volume came from just {words(vn_c['buyers'])} hospitals."
               if vn_c["top3_share"] >= 0.999 else
               f"Product C grew {t_d[('VN', 'C')]['growth'] * 100:.0f}% quarter on quarter, but the top three buyers take {vn_c['top3_share'] * 100:.0f}% of the volume."),
         action="Win more instrument and service accounts in Vietnam before planning on this growth continuing."),
    dict(title=f"Thailand {PRODUCTS[th_worst['product']]['name'].lower()} are falling",
         text=f"Product {th_worst['product']} fell {abs(th_worst['growth']) * 100:.0f}% quarter on quarter"
              + (f"; Pattaya Bay Hospital, worth about SGD {pattaya['monthly_value'] / 1000:,.0f}k a month, has not ordered since {pd.Timestamp(pattaya['last_order']):%d %b}." if pattaya else "."),
         action="Account manager to call Pattaya Bay this week and review the competing offer."),
    dict(title="Hospitals that buy two product lines but not the third",
         text=f"{len(xs_dedup)} hospitals buy reagents and consumables but no instruments or service, while most similar hospitals buy all three. "
              f"Potential: about SGD {sum(r['potential_monthly'] for r in xs_dedup) / 1000:,.0f}k a month.",
         action="Give the target list to the instruments team (QTG) for Q4 visits."),
    dict(title="Forecasts that keep up with growth",
         text=f"Today's 6-month average under-forecast by {abs(base_w['bias']) * 100:.0f}% because it lags behind growth. "
              f"The combined method cuts forecast error from {base_w['wape'] * 100:.1f}% to {ours_w['wape'] * 100:.1f}% and refreshes in seconds.",
         action="Use the combined forecast for monthly stock planning; review it with country teams instead of rebuilding spreadsheets."),
    dict(title="Duplicate records distort the customer view",
         text=f"{len(clusters)} customers exist twice in SAP B1. Before merging, {dedup_impact['going_quiet']['false']} of "
              f"{dedup_impact['going_quiet']['raw']} 'going quiet' alerts were false, {dedup_impact['new_accounts_q3']['raw'] - dedup_impact['new_accounts_q3']['dedup']} "
              f"'new accounts' were existing customers, and a Malaysian hospital's Product B orders were counted in Singapore.",
         action="Merge the duplicate records and stop new ones at the request form."),
]

def recs_out(df, cols):
    return [{c: r[c] for c in cols} for r in df.to_dict("records")]


master_data = dict(
    customers=recs_out(cust.assign(credit_limit=cust["credit_limit"].astype(int)),
                       ["customer_id", "name", "entity", "country", "city", "segment", "size", "reg_no", "address", "phone",
                        "email", "payment_terms", "credit_limit", "created"]),
    items=recs_out(items, ["item_code", "description", "product_line", "category", "uom", "manufacturer", "mfr_part_no",
                           "licence_no", "storage", "list_price", "entity", "created"]),
    vendors=recs_out(vendors, ["vendor_code", "name", "country", "vendor_type", "reg_no", "bank_name", "bank_account",
                               "swift", "payment_terms", "created"]),
    cost_centres=recs_out(ccs, ["code", "name", "entity", "country", "owner", "valid_from"]),
    prospects=recs_out(prospects, ["prospect_id", "name", "country", "city", "segment", "size", "entity", "products",
                                   "reg_no", "address", "phone", "setup_submitted"]),
)

HUB = clean(dict(
    meta=dict(title="MDM Request Hub", as_of="2026-09-30", period=dict(start="2025-10", end="2026-09"), months=MONTHS,
              q2=Q2, q3=Q3, seed=2026, synthetic=True, countries=[dict(code=k, name=v) for k, v in COUNTRIES.items()],
              products=[dict(code=k, **v) for k, v in PRODUCTS.items()],
              entities=[dict(code="SPD", name="SPD", sells="A"), dict(code="QTS", name="QTS", sells="B"),
                        dict(code="QTG", name="QTG", sells="C")]),
    textnorm=CFG,
    master=master_data,
    regional=dict(raw=reg_raw, dedup=reg_dedup),
    decomposition=dec,
    requests=dict(types=types, by_type_month=by_type_month, by_country_q3=by_country_q3, predicted_q3=pred_q3,
                  actual_q3={t: int((q3m["true_type"] == t).sum()) for t in types},
                  new_accounts=new_rows,
                  new_account_medians=dict(enquiry_to_request=r1(nr["enquiry_to_request"].median()),
                                           setup_days=r1(nr["setup_days"].median()),
                                           created_to_first_order=r1(nr["created_to_first_order"].median())),
                  value_waited_on_setup=round(waited_value, -3), pipeline=pipeline, pipeline_by_country=pipe_by_country),
    forecast=forecast, forecast_gain=forecast_gain,
    dedup=dict(quality=match_quality, clusters=cluster_rows, review=[dict(a=cname(r["a"]), b=cname(r["b"]), a_id=r["a"],
                                                                         b_id=r["b"], score=r["score"], reasons=r["reasons"])
                                                                    for r in review],
               items=item_pairs, vendors=[dict(master_id=cl["master_id"], member_ids=cl["member_ids"],
                                              names=[vendors.set_index("vendor_code").loc[m, "name"] for m in cl["member_ids"]],
                                              score=cl["links"][0]["score"], reasons=cl["links"][0]["reasons"])
                                         for cl in vend_clusters],
               impact=dedup_impact),
    signals=dict(going_quiet=dict(raw=gq_raw, dedup=gq_dedup), cross_sell=dict(raw=xs_raw, dedup=xs_dedup),
                 concentration=dict(raw=conc_raw, dedup=conc_dedup), pipeline=pipeline),
    business_case=dict(history=history, sim=sim, assumptions=ASSUMPTIONS, impacts=impacts),
    triage=dict(model=model, metrics=tmetrics, examples=examples),
    implications=implications,
    market=market,
))

OUT.mkdir(parents=True, exist_ok=True)
(ROOT / "assets").mkdir(exist_ok=True)
js = "/* Generated by analysis/build_data.py from synthetic data. Do not edit by hand. */\nwindow.HUB_DATA = " + \
     json.dumps(HUB, separators=(",", ":"), ensure_ascii=False) + ";\n"
(ROOT / "assets" / "data.js").write_text(js, encoding="utf-8")
results = {k: HUB[k] for k in ("forecast_gain", "implications")}
results.update(dedup_quality=match_quality, dedup_impact=dedup_impact, history=history, sim=sim, impacts=impacts,
               triage=tmetrics, forecast_methods=forecast["dedup"]["methods"], propensity=prop_metrics)
(OUT / "results.json").write_text(json.dumps(clean(results), indent=2))

lines = ["# Results digest (synthetic data)", "",
         "Generated by `analysis/build_data.py`. All figures come from the synthetic dataset in `data/`.", "",
         "## Duplicate matching",
         f"- Planted duplicate customer pairs found: {match_quality['found']} of {match_quality['planted']}; false merges: {match_quality['false_merges']}",
         f"- Look-alike pairs sent for human review (score 75-89): {match_quality['review_pairs']}",
         f"- Item near-duplicates flagged: {len(item_pairs)}; vendor duplicate clusters: {len(vend_clusters)}", "",
         "## Forecast backtest (rolling origins Mar-Jun 2026, 1-3 months ahead, value-weighted WAPE)"]
for m in forecast["dedup"]["methods"]:
    lines.append(f"- {m['label']}: WAPE {m['wape'] * 100:.1f}%, bias {m['bias'] * 100:+.1f}%, month-to-month swing {m['swing'] * 100:.1f}%")
lines += ["", "## Request turnaround",
          f"- Email-era history: {history['requests']} requests, mean {history['mean']} days, median {history['median']}, P90 {history['p90']}",
          f"- Simulated today: mean {sim['current']['mean']} days; simulated hub: mean {sim['proposed']['mean']} days, P90 {sim['proposed']['p90']}",
          "", "## Annual impact (assumptions in ASSUMPTIONS)"]
for k, v in impacts.items():
    lines.append(f"- {k}: {v}")
lines += ["", "## Inbox triage model",
          f"- Accuracy on held-out messages: {tmetrics['accuracy'] * 100:.1f}% ({tmetrics['test_size']} messages)",
          f"- Share handled automatically at >= 0.8 confidence: {tmetrics['auto_share'] * 100:.0f}% (accuracy {tmetrics['auto_accuracy'] * 100:.1f}%)",
          "", "## Purchase likelihood (customer x product, next quarter)",
          f"- Held-out quarter (Jul-Sep 2026): logistic regression AUC {prop_metrics['auc']}, boosted trees {prop_metrics['auc_boosted']}, "
          f"rule 'ordered in the last 3 months' {prop_metrics['auc_rule']}; base rate {prop_metrics['base_rate']}",
          "- On this data the model adds almost nothing over the rule, so market scenarios use the rule-based baseline",
          "", "## What it means"]
for imp in implications:
    lines.append(f"- **{imp['title']}.** {imp['text']} {imp['action']}")
lines += ["", "## Effect of duplicates", json.dumps(clean(dedup_impact), indent=2)]
(OUT / "RESULTS.md").write_text("\n".join(lines) + "\n")
print("\n".join(lines[:40]))
print(f"\nassets/data.js: {len(js) / 1024:.0f} KB")
