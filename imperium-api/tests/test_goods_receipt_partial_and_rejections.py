"""
Regression tests for REG-012/REG-013 (SYSTEM_REPAIR_REGISTER.md): a goods
receipt always booked the full outstanding quantity of every PO line - no
partial deliveries, shortages or rejected goods - and nothing serialised
two receipts against the same PO.
"""

import re
import unittest
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from routers.procurement import GoodsReceivedLinePayload, _grn_receipts

ROOT = Path(__file__).resolve().parents[1]
PROCUREMENT_ROUTER = (ROOT / "routers" / "procurement.py").read_text(encoding="utf-8")


def _line(qty, received=0, description="Cement 50kg"):
    return {"id": uuid4(), "quantity": Decimal(str(qty)), "quantity_received": Decimal(str(received)), "description": description}


def _req(line, received, rejected=0, reason=None):
    return GoodsReceivedLinePayload(
        po_line_id=line["id"], quantity_received=Decimal(str(received)),
        quantity_rejected=Decimal(str(rejected)), rejection_reason=reason,
    )


class GrnReceiptsTests(unittest.TestCase):
    def test_no_lines_means_full_outstanding_delivery(self):
        a, b = _line(10, 4), _line(5)
        out = _grn_receipts([a, b], None)
        self.assertEqual([(r[1], r[2]) for r in out], [(Decimal("6"), 0), (Decimal("5"), 0)])

    def test_partial_receipt_books_only_what_arrived(self):
        a, b = _line(10), _line(5)
        out = _grn_receipts([a, b], [_req(a, 3)])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0][1], Decimal("3"))

    def test_rejected_quantity_needs_a_reason(self):
        a = _line(10)
        with self.assertRaises(HTTPException) as ctx:
            _grn_receipts([a], [_req(a, 8, rejected=2)])
        self.assertEqual(ctx.exception.status_code, 422)
        out = _grn_receipts([a], [_req(a, 8, rejected=2, reason="Bags split")])
        self.assertEqual((out[0][1], out[0][2], out[0][3]), (Decimal("8"), Decimal("2"), "Bags split"))

    def test_cannot_receive_more_than_outstanding(self):
        a = _line(10, 7)
        with self.assertRaises(HTTPException) as ctx:
            _grn_receipts([a], [_req(a, 4)])
        self.assertIn("only 3", ctx.exception.detail)

    def test_line_not_on_po_is_refused(self):
        a, stranger = _line(10), _line(1)
        with self.assertRaises(HTTPException):
            _grn_receipts([a], [_req(stranger, 1)])

    def test_duplicate_line_refused(self):
        a = _line(10)
        with self.assertRaises(HTTPException):
            _grn_receipts([a], [_req(a, 1), _req(a, 1)])

    def test_all_zero_delivery_refused(self):
        a = _line(10)
        with self.assertRaises(HTTPException):
            _grn_receipts([a], [_req(a, 0)])


class GrnEndpointContract(unittest.TestCase):
    def _body(self):
        start = PROCUREMENT_ROUTER.index("async def receive_goods(")
        nxt = re.search(r"\n@router\.", PROCUREMENT_ROUTER[start:])
        return PROCUREMENT_ROUTER[start: start + nxt.start()]

    def test_po_and_lines_locked(self):
        body = self._body()
        self.assertIn("is_deleted=false FOR UPDATE", body)
        self.assertRegex(body, r"quantity_received < quantity\s+FOR UPDATE")

    def test_same_delivery_note_not_recorded_twice(self):
        self.assertIn("lower(trim(delivery_note_ref)) = lower(trim(:ref))", self._body())

    def test_rejections_persisted_and_kept_out_of_stock(self):
        body = self._body()
        self.assertIn(":rejected, :unit_price, :rejection_reason", body)
        self.assertIn("if remaining <= 0:", body)


if __name__ == "__main__":
    unittest.main()
