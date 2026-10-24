import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INV_SERVICE = (ROOT / "app" / "services" / "inventory_service.py").read_text(encoding="utf-8")


class InventoryAtomicIsolationContractTests(unittest.TestCase):
    """Pin the concurrency isolation guardrail for multi-store transfers and issues:
    stock_balance supports for_update=True which acquires a row-level lock
    (SELECT ... FOR UPDATE) on procurement.inventory_items so that concurrent
    mutations are serialized and cannot double-spend or create phantom inventory.
    """

    def test_stock_balance_supports_for_update_parameter(self):
        self.assertIn("for_update: bool = False", INV_SERVICE)
        self.assertIn("FOR UPDATE", INV_SERVICE)
        self.assertIn("SELECT id FROM procurement.inventory_items", INV_SERVICE)

    def test_issue_stock_requests_row_lock(self):
        self.assertIn("stock_balance(\n        db, org_id=user[\"org_id\"], item_id=item_id, store_id=store_id, for_update=True", INV_SERVICE)

    def test_transfer_stock_requests_row_lock(self):
        self.assertIn("stock_balance(\n        db, org_id=user[\"org_id\"], item_id=item_id, store_id=from_store_id, for_update=True", INV_SERVICE)

    def test_adjust_stock_requests_row_lock_on_negative_delta(self):
        self.assertIn("stock_balance(\n            db, org_id=user[\"org_id\"], item_id=item_id, store_id=store_id, for_update=True", INV_SERVICE)


if __name__ == "__main__":
    unittest.main()
