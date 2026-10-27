"""Monte Carlo turnaround model: email process vs the hub. Same model as simulateTurnaround in engine.js."""
from __future__ import annotations

import math
import numpy as np

CURRENT = dict(
    triage_mean=1.3, triage_sd=0.9,            # MDM reads the email and forwards it
    bounce_p=0.40, bounce_mean=4.0, bounce_sd=3.0,  # incomplete form goes back to the requester
    approver_mean=4.6, approver_sd=3.6,        # each approver notices the email and replies (sequential)
    clar_p=0.15, clar_mean=2.5, clar_sd=1.5,   # approver asks a clarifying question
    keying_mean=1.5, keying_sd=1.0,            # MDM keys the record into SAP B1
)
PROPOSED = dict(
    routing_mean=0.05,                          # rules route instantly
    bounce_p=0.05, bounce_mean=1.5, bounce_sd=1.0,  # required fields enforced, residual issues only
    approver_mean=1.4, approver_sd=1.2,         # Teams/Outlook notification, approvals run in parallel
    sla_days=2.8,                               # 2 working days, in calendar days
    after_reminder_mean=0.7, after_reminder_sd=0.6,
    escalate_days=4.2,                          # 3 working days
    after_escalation_mean=0.4, after_escalation_sd=0.3,
    clar_p=0.08, clar_mean=1.5, clar_sd=1.0,
    check_mean=0.6, check_sd=0.4,               # MDM final check and import file
)


def _ln(rng, mean, sd, size):
    sigma2 = math.log(1 + (sd * sd) / (mean * mean))
    return rng.lognormal(math.log(mean) - sigma2 / 2, math.sqrt(sigma2), size)


def simulate(approval_counts, approval_probs, n=20000, seed=7, cur=CURRENT, new=PROPOSED):
    rng = np.random.default_rng(seed)
    k = rng.choice(approval_counts, size=n, p=approval_probs)
    kmax = int(max(approval_counts))
    # today: sequential approvals
    t = _ln(rng, cur["triage_mean"], cur["triage_sd"], n)
    bounced = rng.random(n) < cur["bounce_p"]
    t += bounced * (_ln(rng, cur["bounce_mean"], cur["bounce_sd"], n) + 0.5)
    appr = _ln(rng, cur["approver_mean"], cur["approver_sd"], (n, kmax))
    clar = (rng.random((n, kmax)) < cur["clar_p"]) * _ln(rng, cur["clar_mean"], cur["clar_sd"], (n, kmax))
    mask = np.arange(kmax)[None, :] < k[:, None]
    t += ((appr + clar) * mask).sum(axis=1)
    t += _ln(rng, cur["keying_mean"], cur["keying_sd"], n)
    current = t

    # proposed: parallel approvals with reminder and escalation
    t = np.full(n, new["routing_mean"])
    bounced = rng.random(n) < new["bounce_p"]
    t += bounced * _ln(rng, new["bounce_mean"], new["bounce_sd"], n)
    resp = _ln(rng, new["approver_mean"], new["approver_sd"], (n, kmax))
    late = resp > new["sla_days"]
    resp = np.where(late, new["sla_days"] + _ln(rng, new["after_reminder_mean"], new["after_reminder_sd"], (n, kmax)), resp)
    later = resp > new["escalate_days"]
    resp = np.where(later, new["escalate_days"] + _ln(rng, new["after_escalation_mean"], new["after_escalation_sd"], (n, kmax)), resp)
    clar = (rng.random((n, kmax)) < new["clar_p"]) * _ln(rng, new["clar_mean"], new["clar_sd"], (n, kmax))
    t += np.where(mask, resp + clar, 0).max(axis=1)
    t += _ln(rng, new["check_mean"], new["check_sd"], n)
    proposed = t
    return current, proposed


def summarise(x):
    return dict(mean=round(float(x.mean()), 1), median=round(float(np.median(x)), 1),
                p90=round(float(np.quantile(x, 0.9)), 1), share_within_5=round(float((x <= 5).mean()), 3))


def histogram(x, edges):
    counts, _ = np.histogram(np.clip(x, edges[0], edges[-1] - 1e-9), bins=edges)
    return [round(float(c) / len(x), 4) for c in counts]
