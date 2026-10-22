"""Tests for the Python analysis. Run: python -m unittest discover -s tests -p "test_*.py" """
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "analysis"))

import pandas as pd  # noqa: E402

from dedup import cluster, score_item, score_party  # noqa: E402
from forecasting import backtest, croston_sba, damped_trend  # noqa: E402

HUB = json.loads((ROOT / "assets" / "data.js").read_text().split("=", 1)[1].strip().rstrip(";"))
TRUTH = json.loads((ROOT / "data" / "planted_patterns.json").read_text())


def customer_records():
    c = pd.read_csv(ROOT / "data" / "customers.csv", dtype=str).fillna("")
    return [dict(id=r.customer_id, name=r["name"], reg_no=r.reg_no, phone=r.phone, address=r.address, country=r.country,
                 city=r.city, email=r.email, created=r.created) for _, r in c.iterrows()]


class Dedup(unittest.TestCase):
    def test_finds_every_planted_duplicate_without_false_merges(self):
        clusters, _, _ = cluster(customer_records())
        found = {frozenset(c["member_ids"]) for c in clusters}
        planted = {frozenset([d["original_id"], d["duplicate_id"]]) for d in TRUTH["duplicate_customers"]}
        self.assertEqual(found, planted)

    def test_look_alike_customers_are_not_merged(self):
        recs = {r["id"]: r for r in customer_records()}
        for a, b in TRUTH["near_miss_pairs_not_duplicates"]:
            self.assertLess(score_party(recs[a], recs[b])["score"], 90, (recs[a]["name"], recs[b]["name"]))

    def test_initials_and_wrong_country(self):
        recs = customer_records()
        nuh = next(r for r in recs if r["name"] == "National University Hospital")
        self.assertGreaterEqual(score_party({"name": "NUH"}, nuh)["score"], 90)
        johor = next(d for d in TRUTH["duplicate_customers"] if d["wrong_country"])
        a = next(r for r in recs if r["id"] == johor["original_id"])
        b = next(r for r in recs if r["id"] == johor["duplicate_id"])
        self.assertNotEqual(a["country"], b["country"])
        self.assertGreaterEqual(score_party(a, b)["score"], 90)

    def test_item_pack_size_and_variant(self):
        base = {"description": "HbA1c Reagent Kit, 100 tests", "product_line": "A"}
        self.assertEqual(score_item({"description": "HbA1c Reagent Kit, 200 tests"}, base)["band"], "possible")
        self.assertEqual(score_item({"description": "HBA1C RGT KIT 100T"}, base)["band"], "likely")
        gloves = {"description": "Nitrile Examination Gloves, Medium, 100/box"}
        self.assertEqual(score_item({"description": "Nitrile Examination Gloves, Large, 100/box"}, gloves)["band"], "none")

    def test_item_and_vendor_duplicates_in_master_health(self):
        self.assertEqual(len(HUB["dedup"]["items"]), len(TRUTH["duplicate_items"]))
        self.assertEqual(len(HUB["dedup"]["vendors"]), len(TRUTH["duplicate_vendors"]))


class Forecast(unittest.TestCase):
    def test_combined_beats_todays_six_month_average(self):
        m = {x["code"]: x for x in HUB["forecast"]["dedup"]["methods"]}
        self.assertLess(m["combined"]["wape"], m["ma6"]["wape"])
        self.assertLess(abs(m["combined"]["bias"]), abs(m["ma6"]["bias"]))
        self.assertLess(m["combined"]["swing"], m["naive"]["swing"])

    def test_methods_on_simple_series(self):
        trend = [100 + 10 * i for i in range(9)]
        self.assertGreater(damped_trend(trend, 1)[0], 170)
        self.assertAlmostEqual(croston_sba([0, 4, 0, 0, 4, 0, 4, 0], 1)[0], croston_sba([0, 4, 0, 0, 4, 0, 4, 0], 1)[0])
        self.assertGreater(croston_sba([0, 4, 0, 0, 4, 0, 4, 0], 1)[0], 0)

    def test_backtest_shapes(self):
        series = {("SG", "A"): [float(100 + i) for i in range(12)], ("MY", "A"): [float(50) for _ in range(12)]}
        import numpy as np
        res, rows = backtest({k: np.array(v) for k, v in series.items()}, {"A": 1.0})
        self.assertIn("combined", res)
        self.assertEqual(len([r for r in rows if r["method"] == "ma6"]), 2 * (3 + 3 + 3 + 3))


class RegionalView(unittest.TestCase):
    def test_growth_is_q3_over_q2(self):
        for row in HUB["regional"]["dedup"]["table"]:
            u = row["trend"]
            q2, q3 = sum(u[6:9]), sum(u[9:12])
            self.assertEqual(row["q2"], q2)
            if q2:
                self.assertAlmostEqual(row["growth"], round(q3 / q2 - 1, 3), places=3)
        self.assertEqual(len(HUB["regional"]["dedup"]["table"]), 15)

    def test_merging_moves_malaysian_volume_out_of_singapore(self):
        imp = HUB["dedup"]["impact"]
        self.assertGreater(imp["my_b_q3"]["dedup"], imp["my_b_q3"]["raw"])
        self.assertLess(imp["sg_b_q3"]["dedup"], imp["sg_b_q3"]["raw"])
        self.assertEqual(imp["going_quiet"]["raw"] - imp["going_quiet"]["false"], imp["going_quiet"]["dedup"])

    def test_requests_are_separated_by_type(self):
        r = HUB["requests"]
        self.assertEqual(set(r["types"]), {"purchase_order", "enquiry", "setup_request", "follow_up"})
        self.assertTrue(all(len(v) == 12 for v in r["by_type_month"].values()))
        self.assertGreater(len(r["pipeline"]), 0)


class BusinessCase(unittest.TestCase):
    def test_simulation_is_calibrated_to_history(self):
        bc = HUB["business_case"]
        self.assertLess(abs(bc["sim"]["current"]["mean"] - bc["history"]["mean"]), 2.5)
        self.assertLess(bc["sim"]["proposed"]["mean"], 5)
        self.assertLess(bc["sim"]["proposed"]["p90"], 7)

    def test_triage_model_is_useful_but_not_perfect(self):
        m = HUB["triage"]["metrics"]
        self.assertGreater(m["accuracy"], 0.9)
        self.assertLess(m["accuracy"], 0.995)


if __name__ == "__main__":
    unittest.main()
