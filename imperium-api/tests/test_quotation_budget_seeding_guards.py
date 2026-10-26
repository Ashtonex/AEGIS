"""
Regression tests for REG-001..REG-004 (SYSTEM_REPAIR_REGISTER.md):

* Winning / linking / converting an unpriced quotation replaced a project's
  real approved budget with an approved $0 budget and superseded every
  active BOQ line (TBTS4, 2026-10-22).
* "Sync from Quotation" priced budgets with a separate estimator that, for a
  quotation without a breakdown, invented a 45/25/15/10/5 split of the sell
  price; it also reused the raw path ref after resolving the project.
* Lump-sum quotation lines (amount only) were read as $0.
"""

import asyncio
import re
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from app.services.finance.project_forecast import (
    UnpricedQuotationError,
    execution_budget_total,
    quotation_budget_block_reason,
    quotation_budget_categories,
    quotation_budget_lines,
    seed_boq_line_items_from_quotation,
    seed_project_budget_from_quotation,
)
from app.services.quotations.calculator import (
    QuotationCalculator,
    build_calc_input_from_metadata,
    quotation_item_qty_rate,
)

ROOT = Path(__file__).resolve().parents[1]
PROJECTS_ROUTER = (ROOT / "routers" / "projects.py").read_text(encoding="utf-8")
QUOTATIONS_ROUTER = (ROOT / "routers" / "quotations.py").read_text(encoding="utf-8")


def _calc(metadata):
    return QuotationCalculator.calculate(build_calc_input_from_metadata("QT-1", metadata))


def _function_source(source: str, signature: str) -> str:
    start = source.index(signature)
    nxt = re.search(r"\n@router\.|\nclass |\ndef |\nasync def ", source[start + len(signature):])
    return source[start: start + len(signature) + (nxt.start() if nxt else len(source))]


class UnpricedQuotationGuardTests(unittest.TestCase):
    def test_quotation_without_items_is_blocked(self):
        meta = {"items": []}
        self.assertIn("no BOQ line items", quotation_budget_block_reason(meta, _calc(meta)))

    def test_quotation_with_only_unpriced_items_is_blocked(self):
        meta = {"items": [{"description": "Excavation", "qty": 40, "rate": 0, "unit": "m3"}]}
        self.assertIn("unpriced", quotation_budget_block_reason(meta, _calc(meta)))

    def test_priced_quotation_is_allowed(self):
        meta = {"items": [{"description": "Excavation", "qty": 40, "rate": 12.5, "unit": "m3"}]}
        self.assertIsNone(quotation_budget_block_reason(meta, _calc(meta)))

    def test_seed_refuses_zero_execution_budget_before_touching_db(self):
        db = AsyncMock()
        with self.assertRaises(UnpricedQuotationError):
            asyncio.run(seed_project_budget_from_quotation(db, "org", "proj", "QT-1", _calc({"items": []})))
        db.execute.assert_not_awaited()

    def test_boq_seed_without_measurable_lines_leaves_active_lines_alone(self):
        db = AsyncMock()
        seeded = asyncio.run(seed_boq_line_items_from_quotation(
            db, "org", "proj", "QT-1", {"items": [{"description": "TBC", "qty": 0, "rate": 0}]},
        ))
        self.assertEqual(seeded, 0)
        db.execute.assert_not_awaited()  # no supersede UPDATE


class LumpSumItemTests(unittest.TestCase):
    def test_amount_only_line_is_one_sum(self):
        self.assertEqual(quotation_item_qty_rate({"amount": 1665, "description": "Earthworks"}), (1, 1665, "sum"))

    def test_qty_rate_line_unchanged(self):
        self.assertEqual(quotation_item_qty_rate({"qty": 2, "rate": 5, "unit": "m"}), (2, 5, "m"))

    def test_quantity_key_is_read(self):
        self.assertEqual(quotation_item_qty_rate({"quantity": 3, "rate": 4})[:2], (3, 4))

    def test_lump_sum_quotation_prices_and_seeds_boq_lines(self):
        meta = {"items": [
            {"item_no": "1", "description": "Earthworks", "amount": 1665},
            {"item_no": "2", "description": "Pavers", "amount": 6591},
        ]}
        self.assertEqual(execution_budget_total(_calc(meta)), 8256.0)
        db = AsyncMock()
        seeded = asyncio.run(seed_boq_line_items_from_quotation(db, "org", "proj", "QT-1", meta))
        self.assertEqual(seeded, 2)
        insert_params = db.execute.await_args_list[1].args[1]
        self.assertEqual((insert_params["contract_qty"], insert_params["rate"], insert_params["unit"]), (1.0, 1665.0, "sum"))


class BudgetLinesAddUpTests(unittest.TestCase):
    def test_lines_sum_to_header_for_mixed_flat_rate_and_buildup_items(self):
        meta = {
            "items": [
                {"description": "Flat-rate item", "qty": 10, "rate": 100},
                {"description": "Built-up item", "qty": 5, "rate": 0, "buildup": [
                    {"type": "material", "qty": 1, "rate": 30},
                    {"type": "labour", "qty": 1, "rate": 20},
                ]},
            ],
            "preliminaries": 500,
            "overhead_pct": 5,
            "contingency_pct": 10,
            "profit_pct": 15,
        }
        calc = _calc(meta)
        lines = quotation_budget_lines(calc, "QT-1")
        self.assertAlmostEqual(sum(a for _c, _d, a in lines), execution_budget_total(calc), places=2)
        cats = quotation_budget_categories(calc)
        self.assertGreater(cats["contingency"], 0)  # contingency is its own category, not 'overhead'
        self.assertEqual(cats["other"], 1000.0)  # the flat-rate item with no split
        self.assertLess(cats["total"], float(calc.grand_total))  # profit excluded


class SyncFromQuotationEndpointContract(unittest.TestCase):
    def test_preview_never_invents_a_split_of_the_sell_price(self):
        from routers.projects import extract_quotation_cost_breakdown

        res = extract_quotation_cost_breakdown("QT-9", {"items": []}, 100000)
        self.assertEqual(res["total"], 0)
        self.assertNotIn("quote_amount * 0.45", PROJECTS_ROUTER)

    def test_import_uses_canonical_seed_and_resolved_project_id(self):
        body = _function_source(PROJECTS_ROUTER, "async def import_budget_from_quotation(")
        self.assertIn("seed_project_budget_from_quotation(", body)
        self.assertIn("quotation_budget_block_reason(", body)
        self.assertIn("protected_budget_block_reason(", body)
        self.assertIn("FOR UPDATE", body)
        self.assertNotIn("except Exception", body)  # no swallowed partial writes
        self.assertNotIn('"project_id": project_id', body)  # never the raw path ref
        self.assertNotIn("str(project_id)", body)

    def test_linked_quotation_is_never_a_client_name_guess(self):
        summary = _function_source(PROJECTS_ROUTER, "async def get_budget_category_summary(")
        importer = _function_source(PROJECTS_ROUTER, "async def import_budget_from_quotation(")
        for body in (summary, importer):
            self.assertNotIn("client_name)) = lower", body)
            self.assertNotIn("client_org_id =", body)
        self.assertIn('require_permission("projects.read")', summary)


class QuotationDecisionContract(unittest.TestCase):
    def test_won_auto_link_uses_lineage_only(self):
        body = _function_source(QUOTATIONS_ROUTER, "async def decide_quotation(")
        self.assertNotIn("lower(trim(client_name))", body)
        self.assertNotIn("client_org_id = :client_org_id", body)
        self.assertIn("opportunity_id, tender_id", body)  # actually selected now

    def test_every_quotation_seed_path_is_guarded(self):
        for sig in (
            "async def decide_quotation(",
            "async def convert_quotation_to_project(",
            "async def link_quotation_to_project(",
        ):
            body = _function_source(QUOTATIONS_ROUTER, sig)
            self.assertIn("quotation_budget_block_reason(", body, sig)
            self.assertIn("budget_pending_reason", body, sig)
            self.assertNotIn("Could not auto-seed budget", body, sig)
        for sig in ("async def decide_quotation(", "async def link_quotation_to_project("):
            self.assertIn("protected_budget_block_reason(", _function_source(QUOTATIONS_ROUTER, sig), sig)


class ProtectedBaselineTests(unittest.TestCase):
    """Replacing an approved budget is reserved for projects.budget_baseline.lock
    (same rule as POST /projects/{id}/budget)."""

    def _db(self, has_approved):
        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock(scalar=MagicMock(return_value=1 if has_approved else None)))
        return db

    def _reason(self, db, user, granted):
        import app.services.finance.project_forecast as pf

        original = pf.user_has_permission
        pf.user_has_permission = AsyncMock(return_value=granted)
        try:
            return asyncio.run(pf.protected_budget_block_reason(db, user, "p"))
        finally:
            pf.user_has_permission = original

    def test_first_budget_is_not_blocked(self):
        self.assertIsNone(self._reason(self._db(False), {"org_id": "o", "role": "QS"}, granted=False))

    def test_existing_baseline_blocks_without_lock_permission(self):
        self.assertIn("Only Finance", self._reason(self._db(True), {"org_id": "o", "role": "QS"}, granted=False))

    def test_existing_baseline_allowed_with_lock_permission(self):
        self.assertIsNone(self._reason(self._db(True), {"org_id": "o", "role": "Finance"}, granted=True))


class RepeatDecisionContract(unittest.TestCase):
    def test_repeat_decision_is_a_locked_no_op(self):
        body = _function_source(QUOTATIONS_ROUTER, "async def decide_quotation(")
        self.assertIn("FOR UPDATE", body)
        self.assertIn('"already_decided": True', body)


class ProjectCodeDeepLinkScopeTests(unittest.TestCase):
    """A site user assigned to a project could not open it by its code
    (/dashboard/projects/EHTRW): the scope check compared the code to UUIDs."""

    def _db(self, visible, resolved):
        from core.project_scope import _CACHE_KEY

        db = MagicMock()
        db.info = {_CACHE_KEY: (("u1", "o1"), visible)}
        db.execute = AsyncMock(return_value=MagicMock(scalar=MagicMock(return_value=resolved)))
        return db

    def test_assigned_project_opens_by_code(self):
        from core.project_scope import require_project_access

        asyncio.run(require_project_access(self._db(["p-uuid"], "p-uuid"), {"user_id": "u1", "org_id": "o1"}, "EHTRW"))

    def test_unassigned_project_code_still_404s(self):
        from fastapi import HTTPException

        from core.project_scope import require_project_access

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(require_project_access(self._db(["p-uuid"], "other-uuid"), {"user_id": "u1", "org_id": "o1"}, "OTHER"))
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
