from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent
EXECUTIVE = (ROOT / "routers" / "executive.py").read_text(encoding="utf-8")


class ExecutiveMaterialsForecastTruthContractTests(unittest.TestCase):
    """GET /executive/materials/forecast-alerts queried columns that don't
    exist on procurement.inventory_items (`name`, `unit_price` - the real
    columns are `item_name` and `standard_cost`/`unit_price_ex_vat`), so
    the real-data query has thrown on every single call in production;
    _rows() swallowed that exception and returned [], which unconditionally
    triggered a fallback of 3 entirely fabricated commodities (cement,
    rebar, diesel with invented dates and prices) for every organization,
    every time - real procurement data never had a chance to be shown.
    These tests pin both fixes: the query now uses real columns, and the
    fabricated commodity fallback is gone in favor of an honest
    truth_status per real material.
    """

    def test_query_uses_real_inventory_item_columns(self):
        self.assertIn("item_name", EXECUTIVE)
        self.assertIn("standard_cost", EXECUTIVE)
        # The old, nonexistent columns must not be queried from inventory_items.
        self.assertNotIn("SELECT name, COALESCE(unit_price, 0)", EXECUTIVE)

    def test_fabricated_commodity_fallback_is_gone(self):
        self.assertNotIn("default_commodities", EXECUTIVE)
        self.assertNotIn("OPC Cement (50kg)", EXECUTIVE)
        self.assertNotIn("Reinforcement Rebar (Y25/Ton)", EXECUTIVE)
        self.assertNotIn("Diesel Fuel (per Litre)", EXECUTIVE)

    def test_sparse_history_is_labelled_incomplete_not_faked(self):
        self.assertIn('"truth_status": "INCOMPLETE"', EXECUTIVE)
        self.assertIn("a trend needs at least 2 dated price points", EXECUTIVE)

    def test_real_trend_is_labelled_system_generated(self):
        self.assertIn('"truth_status": "SYSTEM_GENERATED"', EXECUTIVE)


if __name__ == "__main__":
    unittest.main()
