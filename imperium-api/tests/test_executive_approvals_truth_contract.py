from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent
EXECUTIVE = (ROOT / "routers" / "executive.py").read_text(encoding="utf-8")
PROCUREMENT = (ROOT / "routers" / "procurement.py").read_text(encoding="utf-8")


class ExecutiveApprovalsTruthContractTests(unittest.TestCase):
    """GET /executive/approvals/pending used to list every purchase order
    over $25k regardless of status, every quotation ever created (no
    margin-approval field exists anywhere in the schema), and every expired
    compliance item labelled as an "override request" with no such workflow
    behind it - and POST /executive/approvals/{type}/{id}/decide accepted
    any decision and persisted nothing. These tests pin the fix: the
    endpoint now only lists items in a real pending state, and the fake
    decide endpoint is gone rather than left lying.
    """

    def test_purchase_order_query_uses_the_real_pending_state(self):
        self.assertIn("status = 'draft'", EXECUTIVE)
        # The old fabricated $25k-regardless-of-status filter must be gone.
        self.assertNotIn("total_amount > 25000", EXECUTIVE)

    def test_fabricated_categories_are_removed_not_faked(self):
        self.assertNotIn("quotation_margin", EXECUTIVE)
        self.assertNotIn("compliance_override", EXECUTIVE)
        self.assertNotIn("Requires commercial margin approval", EXECUTIVE)

    def test_no_op_decide_endpoint_is_removed(self):
        self.assertNotIn("approvals/{approval_type}/{item_id}/decide", EXECUTIVE)
        self.assertNotIn("def approve_reject_item", EXECUTIVE)
        self.assertNotIn("successfully {decision} by executive authorization", EXECUTIVE)

    def test_pending_approvals_points_at_the_real_decision_endpoint(self):
        self.assertIn("purchase-orders/{id}/decision", EXECUTIVE)
        # That real endpoint must actually exist in procurement.py.
        self.assertIn('@router.post("/purchase-orders/{po_id}/decision")', PROCUREMENT)


if __name__ == "__main__":
    unittest.main()
