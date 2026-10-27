"""Duplicate matching for customers, vendors, items and cost centres (same rules as assets/engine.js)."""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

CFG = json.loads(Path(__file__).with_name("textnorm.json").read_text())
PHRASES = sorted(CFG["phrases"], key=lambda p: -len(p[0]))
STRIP = set(CFG["strip_tokens"])
ABBR = CFG["abbrev"]
GENERIC = set(CFG["generic"])
COUNTRY_WORDS = {"singapore", "malaysia", "indonesia", "thailand", "vietnam"}
KINDS = CFG["kinds"]
STOP = set(CFG["stopwords"])
ITEM_ABBR = CFG["item_abbrev"]
ITEM_GENERIC = set(CFG["item_generic"])
ITEM_VARIANTS = set(CFG["item_variants"])
LIKELY = CFG["thresholds"]["likely"]
POSSIBLE = CFG["thresholds"]["possible"]
FREE_MAIL = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com"}
ADDR_ABBR = {"jln": "jalan", "jl": "jalan", "rd": "road", "st": "street", "ave": "avenue", "dr": "drive",
             "blvd": "boulevard", "cres": "crescent", "no": ""}


def fold(s: str) -> str:
    s = (s or "").replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def lcs_len(a: str, b: str) -> int:
    if not a or not b:
        return 0
    prev = [0] * (len(b) + 1)
    for ch in a:
        cur = [0]
        for j, cb in enumerate(b, 1):
            cur.append(prev[j - 1] + 1 if ch == cb else max(prev[j], cur[j - 1]))
        prev = cur
    return prev[-1]


def ratio(a: str, b: str) -> float:
    """Similarity 0-100 based on the longest common subsequence (InDel similarity)."""
    if not a and not b:
        return 100.0
    if not a or not b:
        return 0.0
    return 200.0 * lcs_len(a, b) / (len(a) + len(b))


def within_one_edit(a: str, b: str) -> bool:
    if a == b:
        return False
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    if len(a) > len(b):
        a, b = b, a
    i = j = 0
    skipped = False
    while i < len(a) and j < len(b):
        if a[i] != b[j]:
            if skipped:
                return False
            skipped = True
            j += 1
        else:
            i += 1
            j += 1
    return True


def initials(tokens) -> str:
    return "".join(t[0] for t in tokens if t and t not in STOP and not t.isdigit())


def name_tokens(name: str) -> list[str]:
    s = fold(name).lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = " " + " ".join(s.split()) + " "
    for a, b in PHRASES:
        s = s.replace(" " + a + " ", " " + b + " ")
    toks = [ABBR.get(t, t) for t in s.split()]
    toks = [t for t in toks if t and t not in STRIP]
    if len(toks) > 2:  # drop an acronym that abbreviates the rest ("KVSH - Klang Valley Specialist Hospital")
        for t in list(toks):
            rest = [x for x in toks if x != t]
            if len(t) >= 3 and t == initials(rest):
                toks = rest
                break
    return toks


def distinctive(tokens):
    return [t for t in tokens if t not in GENERIC]


def name_score(ta, tb) -> float:
    if not ta or not tb:
        return 0.0
    full = ratio(" ".join(sorted(ta)), " ".join(sorted(tb)))
    compact = ratio("".join(ta), "".join(tb))
    da, db = distinctive(ta), distinctive(tb)
    if da and db:
        dist = max(ratio(" ".join(sorted(da)), " ".join(sorted(db))), ratio("".join(da), "".join(db)))
        return 0.4 * max(full, compact) + 0.6 * dist
    return 0.85 * max(full, compact)


def address_key(addr: str) -> str:
    s = re.sub(r"[^a-z0-9]+", " ", fold(addr).lower())
    toks = [ADDR_ABBR.get(t, t) for t in s.split()]
    toks = [t for t in toks if t and t not in COUNTRY_WORDS]
    return " ".join(sorted(toks))


def norm_reg(r: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (r or "").upper())


def digits(p: str) -> str:
    return re.sub(r"\D", "", p or "")


def email_domain(e: str) -> str:
    e = (e or "").lower().strip()
    d = e.split("@")[-1] if "@" in e else ""
    return "" if d in FREE_MAIL else d


def fmt(x: float) -> int:
    return int(round(x))


def score_party(q: dict, c: dict, kind: str = "customer") -> dict:
    """Score a customer or vendor record q against an existing record c."""
    ta, tb = name_tokens(q.get("name", "")), name_tokens(c.get("name", ""))
    reasons = []
    ns = name_score(ta, tb)
    init = 0.0
    if len(ta) == 1 and 2 <= len(ta[0]) <= 6 and ta[0] == initials(tb):
        init = 92.0
    if len(tb) == 1 and 2 <= len(tb[0]) <= 6 and tb[0] == initials(ta):
        init = 92.0
    base = max(ns, init)
    if init and init >= ns:
        reasons.append("Typed name matches the initials of this record")
    elif ns >= 50:
        reasons.append(f"Name {fmt(ns)}% similar")
    ka = {KINDS[t] for t in ta if t in KINDS}
    kb = {KINDS[t] for t in tb if t in KINDS}
    if ka and kb and not (ka & kb):
        base -= 15
        reasons.append("Different type of facility")
    ga = {t for t in ta if t in GENERIC and t not in COUNTRY_WORDS and t not in STOP}
    gb = {t for t in tb if t in GENERIC and t not in COUNTRY_WORDS and t not in STOP}
    if ga and gb and not (ga & gb):
        base -= 10
    rq, rc = norm_reg(q.get("reg_no")), norm_reg(c.get("reg_no"))
    id_match = len(rq) >= 6 and rq == rc
    reg_near = (not id_match) and len(rq) >= 6 and len(rc) >= 6 and within_one_edit(rq, rc)
    dq, dc = digits(q.get("phone")), digits(c.get("phone"))
    phone_match = len(dq) >= 8 and len(dc) >= 8 and dq[-8:] == dc[-8:]
    aq, ac = address_key(q.get("address", "")), address_key(c.get("address", ""))
    asim = ratio(aq, ac) if aq and ac else 0.0
    bank_match = False
    if kind == "vendor":
        bq, bc = digits(q.get("bank_account")), digits(c.get("bank_account"))
        bank_match = len(bq) >= 6 and bq == bc
    corroborated = id_match or reg_near or phone_match or asim >= 85 or bank_match
    cq, cc = (q.get("country") or "").upper(), (c.get("country") or "").upper()
    if cq and cc and cq != cc:
        if corroborated:
            reasons.append(f"Same organisation recorded under a different country ({cc})")
        else:
            base -= 10
            reasons.append(f"Different country ({cc})")
    tq, tc = name_tokens(q.get("city", "")), name_tokens(c.get("city", ""))
    if tq and tc and tq != tc and not corroborated:
        base -= 8
    if phone_match:
        base += 5
        reasons.append("Same phone number")
    if asim >= 85:
        base += 5
        reasons.append(f"Address {fmt(asim)}% similar")
    if reg_near:
        base += 6
        reasons.append("Registration no. differs by one character")
    if bank_match:
        base += 10
        reasons.append(f"Same bank account (ending {digits(c.get('bank_account'))[-4:]})")
    eq, ec = email_domain(q.get("email")), email_domain(c.get("email"))
    if eq and eq == ec:
        base += 3
        reasons.append("Same email domain")
    if id_match:
        base = max(base, 100.0 if ns >= 80 else 98.0)
        reasons.insert(0, "Same registration no.")
    score = max(0.0, min(100.0, base))
    return dict(score=round(score, 1), band=band(score), reasons=reasons, name_score=round(ns, 1))


def item_tokens(desc: str) -> list[str]:
    s = fold(desc).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"(\d)([a-z])", r"\1 \2", s)
    s = re.sub(r"([a-z])(\d)", r"\1 \2", s)
    toks = []
    for t in s.split():
        t = ITEM_ABBR.get(t, t)
        if not t:
            continue
        if len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
            t = t[:-1]
        toks.append(t)
    return toks


def score_item(q: dict, c: dict) -> dict:
    ta, tb = item_tokens(q.get("description", "")), item_tokens(c.get("description", ""))
    reasons = []
    if not ta or not tb:
        return dict(score=0.0, band="none", reasons=[])
    full = max(ratio(" ".join(sorted(ta)), " ".join(sorted(tb))), ratio(" ".join(ta), " ".join(tb)))
    da = [t for t in ta if t not in ITEM_GENERIC and not t.isdigit() and len(t) > 1]
    db = [t for t in tb if t not in ITEM_GENERIC and not t.isdigit() and len(t) > 1]
    if da and db:
        dist = max(ratio(" ".join(sorted(da)), " ".join(sorted(db))), ratio("".join(da), "".join(db)))
        s = 0.4 * full + 0.6 * dist
    else:
        s = 0.85 * full
    if s >= 50:
        reasons.append(f"Description {fmt(s)}% similar")
    va = {t for t in ta if t in ITEM_VARIANTS}
    vb = {t for t in tb if t in ITEM_VARIANTS}
    if va and vb and va != vb:
        s -= 20
        reasons.append(f"Different variant ({', '.join(sorted(va))} vs {', '.join(sorted(vb))})")
    na = {t for t in ta if t.isdigit() and len(t) > 1}
    nb = {t for t in tb if t.isdigit() and len(t) > 1}
    if na and nb and na != nb:
        s -= 15
        reasons.append(f"Different pack size or strength ({', '.join(sorted(na))} vs {', '.join(sorted(nb))})")
    lq, lc = q.get("product_line"), c.get("product_line")
    if lq and lc and lq != lc:
        s -= 20
        reasons.append("Different product line")
    pq, pc = norm_reg(q.get("mfr_part_no")), norm_reg(c.get("mfr_part_no"))
    if len(pq) >= 4 and pq == pc:
        s = 100.0
        reasons.insert(0, "Same manufacturer part no.")
    s = max(0.0, min(100.0, s))
    return dict(score=round(s, 1), band=band(s), reasons=reasons)


def score_cost_centre(q: dict, c: dict) -> dict:
    reasons = []
    if norm_reg(q.get("code")) and norm_reg(q.get("code")) == norm_reg(c.get("code")):
        return dict(score=100.0, band="likely", reasons=["Same cost centre code"])
    s = ratio(" ".join(sorted(name_tokens(q.get("name", "")))), " ".join(sorted(name_tokens(c.get("name", "")))))
    if s >= 50:
        reasons.append(f"Name {fmt(s)}% similar")
    if q.get("entity") and c.get("entity") and q["entity"] != c["entity"]:
        s -= 10
    s = max(0.0, min(100.0, s))
    return dict(score=round(s, 1), band=band(s), reasons=reasons)


def band(score: float) -> str:
    return "likely" if score >= LIKELY else "possible" if score >= POSSIBLE else "none"


def blocking_keys(rec: dict) -> set[str]:
    toks = name_tokens(rec.get("name", ""))
    keys = {"t:" + t[:4] for t in (distinctive(toks) or toks)}
    if norm_reg(rec.get("reg_no")):
        keys.add("r:" + norm_reg(rec.get("reg_no"))[:5])
    d = digits(rec.get("phone"))
    if len(d) >= 8:
        keys.add("p:" + d[-8:])
    if len(toks) == 1:
        keys.add("i:" + toks[0])
    else:
        keys.add("i:" + initials(toks))
    return keys


def candidate_pairs(records: list[dict]):
    index: dict[str, list[int]] = {}
    for i, r in enumerate(records):
        for k in blocking_keys(r):
            index.setdefault(k, []).append(i)
    pairs = set()
    for idx in index.values():
        for a in range(len(idx)):
            for b in range(a + 1, len(idx)):
                pairs.add((idx[a], idx[b]))
    return sorted(pairs)


def cluster(records: list[dict], kind: str = "customer"):
    """Find duplicate clusters. Returns (clusters, review_pairs, scored_pairs)."""
    scored = []
    for i, j in candidate_pairs(records):
        s = score_party(records[i], records[j], kind)
        scored.append((i, j, s))
    parent = list(range(len(records)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, j, s in scored:
        if s["score"] >= LIKELY:
            parent[find(i)] = find(j)
    groups: dict[int, list[int]] = {}
    for i in range(len(records)):
        groups.setdefault(find(i), []).append(i)
    clusters = []
    for members in groups.values():
        if len(members) < 2:
            continue
        members.sort(key=lambda k: (records[k].get("created") or "9999", records[k]["id"]))
        master = members[0]
        links = [dict(id=records[j]["id"], score=s["score"], reasons=s["reasons"]) for i, j, s in scored
                 if s["score"] >= LIKELY and {i, j} <= set(members)]
        clusters.append(dict(master_id=records[master]["id"], member_ids=[records[k]["id"] for k in members], links=links))
    review = [dict(a=records[i]["id"], b=records[j]["id"], score=s["score"], reasons=s["reasons"])
              for i, j, s in scored if POSSIBLE <= s["score"] < LIKELY]
    return clusters, review, scored
