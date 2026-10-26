"""
Regression tests for REG-014/REG-015 (SYSTEM_REPAIR_REGISTER.md).

* A VAT-bearing invoice could never be 'matched': its VAT-inclusive total was
  compared with GRN value built from ex-VAT unit prices, so payment approval
  (which requires 'matched') was impossible for VAT suppliers.
* Each invoice was compared with the whole PO, so a second invoice for the
  same delivery also showed 'matched'.
* The duplicate supplier-reference constraint is DEFERRABLE INITIALLY
  DEFERRED, so the INSERT-time IntegrityError handler never fired and a
  duplicate surfaced as a 500 at commit.
"""

import re
import unittest
from decimal import Decimal as D
from pathlib import Path

from routers.procurement import three_way_match

ROOT = Path(__file__).resolve().parents[1]
PROCUREMENT_ROUTER = (ROOT / "routers" / "procurement.py").read_text(encoding="utf-8")


def match(sub, total, po=D("1000"), received=D("1000"), other=D("0")):
    return three_way_match(invoice_subtotal=sub, invoice_total=total, po_subtotal=po,
                           received_value=received, other_invoiced=other)


class ThreeWayMatchTests(unittest.TestCase):
    def test_vat_invoice_for_full_delivery_matches(self):
        self.assertEqual(match(D("1000"), D("1155")), ("matched", D("1155")))

    def test_invoice_ahead_of_delivery_is_partial(self):
        status, matched = match(D("1000"), D("1155"), received=D("400"))
        self.assertEqual(status, "partial_match")
        self.assertEqual(matched, D("462.00"))  # 40% of the VAT-inclusive total

    def test_invoice_above_po_is_over_invoice(self):
        status, matched = match(D("1200"), D("1386"))
        self.assertEqual(status, "over_invoice")
        self.assertEqual(matched, D("1155.00"))  # 1000/1200 of the total

    def test_second_invoice_for_same_delivery_does_not_match(self):
        status, matched = match(D("1000"), D("1155"), other=D("1000"))
        self.assertEqual(status, "over_invoice")
        self.assertEqual(matched, D("0.00"))

    def test_split_invoices_each_match_their_share(self):
        self.assertEqual(match(D("600"), D("693"))[0], "matched")
        self.assertEqual(match(D("400"), D("462"), other=D("600"))[0], "matched")

    def test_rounding_within_documented_tolerance_matches(self):
        self.assertEqual(match(D("1004.99"), D("1004.99"))[0], "matched")  # $4.99 and 0.5%
        self.assertNotEqual(match(D("1005.01"), D("1005.01"))[0], "matched")  # over $5
        self.assertNotEqual(match(D("103"), D("103"), po=D("100"), received=D("100"))[0], "matched")  # 3% of a small PO


class InvoiceEndpointContract(unittest.TestCase):
    def _body(self, sig):
        start = PROCUREMENT_ROUTER.index(sig)
        nxt = re.search(r"\n@router\.", PROCUREMENT_ROUTER[start + 10:])
        return PROCUREMENT_ROUTER[start: start + 10 + nxt.start()]

    def test_duplicate_reference_checked_before_insert_and_at_commit(self):
        body = self._body("async def create_invoice(")
        self.assertIn("lower(trim(supplier_invoice_ref)) = lower(trim(:ref))", body)
        self.assertRegex(body, r"try:\s+await db\.commit\(\)\s+except IntegrityError")

    def test_generated_variance_column_is_never_written(self):
        self.assertNotIn("variance_amount=:", self._body("async def match_invoice("))

    def test_match_locks_po_and_counts_other_invoices(self):
        body = self._body("async def match_invoice(")
        self.assertIn("FOR UPDATE OF po", body)
        self.assertIn("other_invoiced", body)
        self.assertNotIn("po.total_amount AS po_total", body)  # no VAT-inclusive PO comparison

    def test_inspection_payment_flag_mirrors_server_rule(self):
        self.assertIn('"can_approve_payment": inv["match_status"] == "matched" and', PROCUREMENT_ROUTER)


if __name__ == "__main__":
    unittest.main()
