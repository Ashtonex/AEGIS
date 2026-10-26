"""
Regression tests for REG-022 (SYSTEM_REPAIR_REGISTER.md): two site pay runs
drafted at the same time read the same unpaid time entries and both paid
them; workers paid in another currency would be posted to the cashbook as USD.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FINANCE_OPS = (ROOT / "routers" / "finance_ops.py").read_text(encoding="utf-8")


def _body(sig: str) -> str:
    start = FINANCE_OPS.index(sig)
    nxt = re.search(r"\n@router\.", FINANCE_OPS[start:])
    return FINANCE_OPS[start: start + nxt.start()]


class SitePayRunClaimContract(unittest.TestCase):
    def test_unpaid_entries_are_locked_before_pricing(self):
        body = _body("async def create_site_pay_run(")
        claim = body.index("FOR UPDATE")
        price = body.index("SUM(te.regular_hours)")
        self.assertLess(claim, price)
        self.assertIn("te.pay_run_id IS NULL", body[:price])
        self.assertIn("WHERE te.id = ANY(CAST(:ids AS uuid[]))", body)

    def test_non_usd_workers_refused(self):
        body = _body("async def create_site_pay_run(")
        self.assertIn('(w.get("currency") or "USD") != "USD"', body)
        self.assertIn("status_code=422", body)

    def test_paid_or_cancelled_runs_are_final(self):
        body = _body("async def decide_site_pay_run(")
        self.assertIn("FOR UPDATE OF r", body)
        self.assertIn('if current in ("paid", "cancelled"):', body)


if __name__ == "__main__":
    unittest.main()
