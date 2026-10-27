"""Purchase likelihood per customer and product line for next quarter.

Trained on Jan-Mar 2026 snapshots, tested on the June 2026 snapshot.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.preprocessing import StandardScaler

PRODUCTS = ["A", "B", "C"]
TRAIN_CUTOFFS = [3, 4, 5]  # Jan, Feb, Mar 2026: labels end by Jun 2026, before the test window
TEST_CUTOFF = 8            # Jun 2026: labels Jul to Sep 2026
FINAL_CUTOFFS = [3, 4, 5, 6, 7, 8]
SCORE_CUTOFF = 11          # Sep 2026: predicts Oct to Dec 2026

FEATURE_LABELS = {
    "bought_last3": "Ordered this product in the last 3 months",
    "months_active6": "Months with an order, last 6",
    "log_units3": "Units in the last 3 months (log)",
    "trend": "Last 3 months against the 3 before (log ratio)",
    "months_since": "Months since the last order of this product",
    "ever_bought": "Has ever ordered this product",
    "other_lines": "Other product lines bought, last 6 months",
    "log_value6": "Customer's total order value, last 6 months (log)",
    "peer_share": "Share of similar customers buying this product",
    "tenure": "Months as a customer",
}


def build_panel(po: pd.DataFrame, customers: pd.DataFrame, months: list[str], cutoff: int, with_label: bool = True):
    """One row per (customer, product) at a cutoff month index."""
    m_index = {m: i for i, m in enumerate(months)}
    po = po.assign(mi=po["month"].map(m_index))
    units = po.pivot_table(index=["master_id", "product"], columns="mi", values="qty", aggfunc="sum").reindex(columns=range(len(months))).fillna(0)
    value = po.pivot_table(index="master_id", columns="mi", values="value_sgd", aggfunc="sum").reindex(columns=range(len(months))).fillna(0)
    rows = []
    cutoff_month = pd.Period(months[cutoff], "M")
    active = customers[customers["created_month"] <= cutoff_month]
    # peer share: by segment and size, who bought each product in the last 6 months
    bought6 = {}
    for (cid, p), r in units.iterrows():
        if r.loc[max(0, cutoff - 5):cutoff].sum() > 0:
            bought6.setdefault(p, set()).add(cid)
    seg_members = active.groupby(["segment", "size"])["customer_id"].apply(set).to_dict()
    for _, c in active.iterrows():
        cid = c["customer_id"]
        peers = seg_members.get((c["segment"], c["size"]), set()) - {cid}
        lines6 = {p for p in PRODUCTS if cid in bought6.get(p, set())}
        v6 = value.loc[cid, max(0, cutoff - 5):cutoff].sum() if cid in value.index else 0.0
        tenure = (cutoff_month - c["created_month"]).n
        for p in PRODUCTS:
            u = units.loc[(cid, p)] if (cid, p) in units.index else pd.Series(0.0, index=range(len(months)))
            last3 = u.loc[max(0, cutoff - 2):cutoff].sum()
            prev3 = u.loc[max(0, cutoff - 5):max(0, cutoff - 3)].sum()
            hist = u.loc[:cutoff]
            nz = np.nonzero(hist.values)[0]
            since = cutoff - nz[-1] if len(nz) else 12
            row = dict(customer_id=cid, product=p, cutoff=cutoff, segment=c["segment"], size=c["size"], country=c["country"],
                       bought_last3=float(last3 > 0), months_active6=float((u.loc[max(0, cutoff - 5):cutoff] > 0).sum()),
                       log_units3=float(np.log1p(last3)), trend=float(np.log((last3 + 1) / (prev3 + 1))),
                       months_since=float(min(since, 12)), ever_bought=float(len(nz) > 0),
                       other_lines=float(len(lines6 - {p})), log_value6=float(np.log1p(v6)),
                       peer_share=float(len(peers & bought6.get(p, set())) / len(peers)) if peers else 0.0,
                       tenure=float(min(tenure, 60)),
                       units3=float(last3), units6=float(u.loc[max(0, cutoff - 5):cutoff].sum()))
            if with_label:
                nxt = u.loc[cutoff + 1:cutoff + 3]
                row["label"] = float(nxt.sum() > 0)
                row["next_units"] = float(nxt.sum())
            rows.append(row)
    return pd.DataFrame(rows)


def design(df: pd.DataFrame, columns=None):
    x = df[list(FEATURE_LABELS)].copy()
    for p in PRODUCTS:
        x[f"product_{p}"] = (df["product"] == p).astype(float)
    for s in sorted(df["segment"].unique()):
        x[f"segment_{s}"] = (df["segment"] == s).astype(float)
    if columns is not None:
        for col in columns:
            if col not in x:
                x[col] = 0.0
        x = x[columns]
    return x


def train(po: pd.DataFrame, customers: pd.DataFrame, months: list[str], prices: dict[str, float]):
    customers = customers.copy()
    customers["created_month"] = pd.to_datetime(customers["created"]).dt.to_period("M")
    panels = {k: build_panel(po, customers, months, k) for k in sorted(set(TRAIN_CUTOFFS + FINAL_CUTOFFS + [TEST_CUTOFF]))}
    tr = pd.concat([panels[k] for k in TRAIN_CUTOFFS])
    te = panels[TEST_CUTOFF]
    xtr = design(tr)
    cols = list(xtr.columns)
    xte = design(te, cols)
    scaler = StandardScaler().fit(xtr)
    lr = LogisticRegression(max_iter=2000, C=1.0).fit(scaler.transform(xtr), tr["label"])
    p_lr = lr.predict_proba(scaler.transform(xte))[:, 1]
    gb = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_depth=3, random_state=7).fit(xtr, tr["label"])
    p_gb = gb.predict_proba(xte)[:, 1]
    # simple rule today: "they ordered it in the last 3 months, so they will again"
    p_rule = te["bought_last3"].values
    base = float(te["label"].mean())
    deciles = []
    order = np.argsort(-p_lr)
    for i in range(5):
        idx = order[i * len(order) // 5:(i + 1) * len(order) // 5]
        deciles.append(dict(band=f"{i * 20}-{(i + 1) * 20}%", predicted=round(float(p_lr[idx].mean()), 3), actual=round(float(te["label"].values[idx].mean()), 3)))
    # new buyers in the test window: share the model ranked in its top 20%
    new_buy = (te["label"] == 1) & (te["months_active6"] == 0)
    top = p_lr >= np.quantile(p_lr, 0.8)
    metrics = dict(
        train_rows=int(len(tr)), test_rows=int(len(te)), base_rate=round(base, 3),
        auc=round(float(roc_auc_score(te["label"], p_lr)), 3),
        auc_boosted=round(float(roc_auc_score(te["label"], p_gb)), 3),
        auc_rule=round(float(roc_auc_score(te["label"], p_rule)), 3),
        brier=round(float(brier_score_loss(te["label"], p_lr)), 3),
        brier_rule=round(float(brier_score_loss(te["label"], p_rule)), 3),
        calibration=deciles,
        lapsed_found=dict(total=int(((te["label"] == 0) & (te["bought_last3"] == 1)).sum()),
                          flagged=int(((te["label"] == 0) & (te["bought_last3"] == 1) & (p_lr < 0.5)).sum())),
        new_buyers=dict(total=int(new_buy.sum()), in_top_fifth=int((new_buy & top).sum())),
    )
    # final model on every labelled snapshot, scoring September 2026
    fin = pd.concat([panels[k] for k in FINAL_CUTOFFS])
    xf = design(fin, cols)
    scaler_f = StandardScaler().fit(xf)
    lr_f = LogisticRegression(max_iter=2000, C=1.0).fit(scaler_f.transform(xf), fin["label"])
    score = build_panel(po, customers, months, SCORE_CUTOFF, with_label=False)
    prob = lr_f.predict_proba(scaler_f.transform(design(score, cols)))[:, 1]
    score["prob"] = prob
    # order value: the customer's recent quarter, else the median for similar customers
    buyers = fin[fin["label"] == 1]
    typical = buyers.groupby(["segment", "size", "product"])["next_units"].median().to_dict()
    score["units_if_buy"] = [
        r.units6 / 2 if r.units6 > 0 else typical.get((r.segment, r.size, r.product), buyers[buyers["product"] == r.product]["next_units"].median())
        for r in score.itertuples()]
    score["value_if_buy"] = score["units_if_buy"] * score["product"].map(prices)
    coef = sorted(((FEATURE_LABELS.get(c, c.replace("_", ": ", 1)), float(w)) for c, w in zip(cols, lr_f.coef_[0])),
                  key=lambda t: -abs(t[1]))
    drivers = [dict(feature=f, weight=round(w, 3)) for f, w in coef if not f.startswith(("product", "segment"))][:8]
    return score, metrics, drivers
