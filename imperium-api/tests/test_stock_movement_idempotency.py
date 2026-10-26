"""
Regression tests for REG-023..REG-025 (SYSTEM_REPAIR_REGISTER.md).

* Manual receipts/issues/transfers/adjustments got a fresh random source id
  per request, so a double submit booked the stock twice.
* Work-order and vehicle issues used the work order / vehicle id as the
  ledger source id: a second issue of the same item was silently dropped,
  and the parts cost shared its key with the work order completion cost
  (which overwrites on conflict).
* Issuing to a work order or vehicle always failed with a 500: the
  reference checker did not list the fleet tables.
"""

import re
import unittest
from pathlib import Path

from routers.inventory import AdjustStockPayload, StockMovementPayload, TransferStockPayload

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = (ROOT / "routers" / "inventory.py").read_text(encoding="utf-8")


def _body(sig: str) -> str:
    start = INVENTORY.index(sig)
    nxt = re.search(r"\n@router\.", INVENTORY[start + 10:])
    return INVENTORY[start: start + 10 + (nxt.start() if nxt else len(INVENTORY))]


class StockIdempotencyContract(unittest.TestCase):
    def test_payloads_accept_request_id(self):
        for model in (StockMovementPayload, TransferStockPayload, AdjustStockPayload):
            self.assertIn("request_id", model.model_fields)

    def test_each_endpoint_returns_the_recorded_movement_on_repeat(self):
        for sig, source in (
            ("async def receive_stock(", '"manual_receipt"'),
            ("async def issue_stock(", "target_source_type"),
            ("async def transfer_stock(", '"inventory_transfer"'),
            ("async def record_adjustment(", '"inventory_adjustment"'),
        ):
            body = _body(sig)
            self.assertIn(f"_already_recorded(db, user[\"org_id\"], {source}, payload.request_id)", body, sig)
            self.assertIn('"already_recorded": True', body, sig)

    def test_issue_source_is_never_the_work_order_or_vehicle(self):
        body = _body("async def issue_stock(")
        self.assertNotIn("target_source_id = payload.work_order_id", body)
        self.assertNotIn("target_source_id = payload.fleet_id", body)
        self.assertNotIn('"fleet_maintenance_work_order"', body)  # the completion cost's key
        self.assertIn('"work_order_parts_issue"', body)

    def test_fleet_tables_can_be_referenced(self):
        checker = INVENTORY[INVENTORY.index("async def require_ref("):INVENTORY.index("async def require_site_for_project(")]
        self.assertIn('"fleet.maintenance_work_orders"', checker)
        self.assertIn('"fleet.fleet"', checker)


if __name__ == "__main__":
    unittest.main()
