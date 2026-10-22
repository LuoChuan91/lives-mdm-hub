"""Forecasting methods and backtest for monthly purchase-order volumes.

Today's approach (the baseline) is a rolling average of the last 6 months of purchase
orders. The alternatives here are deliberately simple, explainable methods that suit a
short (12-month) history:

    damped trend      exponential smoothing with a trend that flattens over the horizon
    croston (SBA)     for intermittent series that skip months (small accounts, Product C)
    pooled            forecast the regional total per product, then split it by country
                      using recent shares (short, noisy country series borrow strength)
    combined          average of the per-series model and the pooled forecast (our method)

No seasonal model: one year of data shows each calendar month once, which is not enough to
separate a seasonal pattern from noise.
"""
from __future__ import annotations

import itertools
import numpy as np

ALPHAS = (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8)
BETAS = (0.05, 0.1, 0.2, 0.3)
PHIS = (0.8, 0.9, 0.98)


def moving_average(y, k: int = 6) -> float:
    y = np.asarray(y, float)
    return float(y[-k:].mean()) if len(y) else 0.0


def _holt_run(y, a, b, phi):
    level = y[0]
    trend = float(np.mean(np.diff(y[: min(4, len(y))]))) if len(y) > 1 else 0.0
    sse = 0.0
    for t in range(1, len(y)):
        pred = level + phi * trend
        err = y[t] - pred
        sse += err * err
        new_level = a * y[t] + (1 - a) * (level + phi * trend)
        trend = b * (new_level - level) + (1 - b) * phi * trend
        level = new_level
    return sse, level, trend


def damped_trend(y, h: int):
    """Additive damped-trend exponential smoothing, parameters chosen by in-sample one-step error."""
    y = np.asarray(y, float)
    if len(y) < 4:
        return [float(y.mean()) if len(y) else 0.0] * h
    best = None
    for a, b, phi in itertools.product(ALPHAS, BETAS, PHIS):
        sse, level, trend = _holt_run(y, a, b, phi)
        if best is None or sse < best[0]:
            best = (sse, level, trend, phi)
    _, level, trend, phi = best
    out, damp = [], 0.0
    for i in range(1, h + 1):
        damp += phi ** i
        out.append(max(0.0, level + damp * trend))
    return out


def adi(y) -> float:
    y = np.asarray(y, float)
    nz = np.count_nonzero(y)
    return len(y) / nz if nz else float("inf")


def croston_sba(y, h: int, alpha: float = 0.15):
    """Syntetos-Boylan approximation of Croston's method for intermittent demand."""
    y = np.asarray(y, float)
    nz = np.nonzero(y)[0]
    if len(nz) == 0:
        return [0.0] * h
    z, p, q = y[nz[0]], float(nz[0] + 1), 1
    for t in range(nz[0] + 1, len(y)):
        if y[t] > 0:
            z += alpha * (y[t] - z)
            p += alpha * (q - p)
            q = 1
        else:
            q += 1
    return [max(0.0, (1 - alpha / 2) * z / p)] * h


def per_series(y, h: int):
    """Damped trend for regular series; Croston (SBA) when the series skips many months."""
    return croston_sba(y, h) if adi(y) > 1.32 else damped_trend(y, h)


# ---------------------------------------------------------------- multi-series methods
# Each method takes {(country, product): history array} and returns {(country, product): [h forecasts]}
def m_naive(train, h):
    return {k: [float(v[-1])] * h for k, v in train.items()}


def m_ma6(train, h):
    return {k: [moving_average(v, 6)] * h for k, v in train.items()}


def m_ma_all(train, h):
    return {k: [moving_average(v, 12)] * h for k, v in train.items()}


def m_damped(train, h):
    return {k: per_series(v, h) for k, v in train.items()}


def m_pooled(train, h):
    out = {}
    for prod in sorted({p for _, p in train}):
        keys = [k for k in train if k[1] == prod]
        total = np.sum([train[k] for k in keys], axis=0)
        f_total = damped_trend(total, h)
        recent = sum(train[k][-3:].sum() for k in keys)
        for k in keys:
            share = train[k][-3:].sum() / recent if recent else 1 / len(keys)
            out[k] = [share * f for f in f_total]
    return out


def m_combined(train, h):
    a, b = m_damped(train, h), m_pooled(train, h)
    return {k: [(x + y) / 2 for x, y in zip(a[k], b[k])] for k in train}


METHODS = {
    "naive": ("Last month", m_naive),
    "ma6": ("6-month average (today)", m_ma6),
    "ma_all": ("Average of all months", m_ma_all),
    "damped": ("Damped trend per series", m_damped),
    "pooled": ("Pooled regional, split by share", m_pooled),
    "combined": ("Combined (our method)", m_combined),
}


def backtest(series: dict, prices: dict, origins=(5, 6, 7, 8), horizon: int = 3):
    """Rolling-origin backtest. Training uses months 0..origin; scores the next `horizon` months.

    Returns per-method WAPE and bias by product and overall (value-weighted), plus raw records.
    """
    n = len(next(iter(series.values())))
    rows = []
    for o in origins:
        train = {k: v[: o + 1] for k, v in series.items()}
        for code, (_, fn) in METHODS.items():
            fc = fn(train, horizon)
            for k, f in fc.items():
                for hh in range(1, horizon + 1):
                    t = o + hh
                    if t >= n:
                        continue
                    rows.append(dict(method=code, origin=o, h=hh, country=k[0], product=k[1],
                                     actual=float(series[k][t]), forecast=float(f[hh - 1])))
    results = {}
    for code in METHODS:
        mr = [r for r in rows if r["method"] == code]
        by_prod = {}
        for prod in sorted(prices):
            pr = [r for r in mr if r["product"] == prod]
            act = sum(r["actual"] for r in pr)
            by_prod[prod] = dict(
                wape=sum(abs(r["forecast"] - r["actual"]) for r in pr) / act if act else None,
                bias=sum(r["forecast"] - r["actual"] for r in pr) / act if act else None)
        act_v = sum(r["actual"] * prices[r["product"]] for r in mr)
        overall = dict(
            wape=sum(abs(r["forecast"] - r["actual"]) * prices[r["product"]] for r in mr) / act_v,
            bias=sum((r["forecast"] - r["actual"]) * prices[r["product"]] for r in mr) / act_v)
        results[code] = dict(label=METHODS[code][0], by_product=by_prod, overall=overall)
    return results, rows


def interval_multipliers(rows, method="combined", lo_q=0.1, hi_q=0.9):
    """Percentage-error quantiles by product and horizon, used for forward forecast bands."""
    out = {}
    for prod in sorted({r["product"] for r in rows}):
        for hh in sorted({r["h"] for r in rows}):
            errs = [(r["actual"] - r["forecast"]) / r["forecast"] for r in rows
                    if r["method"] == method and r["product"] == prod and r["h"] == hh and r["forecast"] > 0]
            if errs:
                out[(prod, hh)] = (float(np.quantile(errs, lo_q)), float(np.quantile(errs, hi_q)))
    return out


def forecast_swing(series: dict, origins=range(5, 11)):
    """Average month-to-month change in each method's next-month forecast, relative to the series level.

    A forecast that jumps around with every unusual month makes stock plans nervous even when its
    average error is low.
    """
    out = {}
    for code, (_, fn) in METHODS.items():
        fc = {}
        for o in origins:
            for k, v in fn({k: v[: o + 1] for k, v in series.items()}, 1).items():
                fc.setdefault(k, []).append(v[0])
        swings = [np.mean(np.abs(np.diff(fc[k]))) / np.mean(series[k]) for k in series if np.mean(series[k]) > 0]
        out[code] = float(np.mean(swings))
    return out

