from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent
EXECUTIVE = (ROOT / "routers" / "executive.py").read_text(encoding="utf-8")


class ExecutiveStatsTruthContractTests(unittest.TestCase):
    """GET /executive/stats ran 9 independent try/except query blocks that
    each collapsed a genuine result AND a query failure to the same
    hardcoded 0 (or "$0.00" for money fields), with no error recorded
    anywhere - the canonical AEGIS truth-rule violation, and the one this
    router's own _rows() helper was specifically built to avoid everywhere
    else in this file. These tests pin the fix: a query failure now
    produces None (which the frontend already renders as "Not recorded")
    and a recorded meta.source_errors entry, while a real zero-row result
    is still reported as a true 0.
    """

    def test_stat_scalar_helper_returns_none_not_zero_on_failure(self):
        self.assertIn("async def _stat_scalar", EXECUTIVE)
        self.assertIn("return result.scalar() or 0", EXECUTIVE)
        self.assertIn("return None", EXECUTIVE)

    def test_stats_endpoint_reports_source_errors_in_meta(self):
        # Old behaviour returned a bare {} with no error visibility at all.
        self.assertNotIn('"meta": {},\n    }\n\n\nasync def _source_health', EXECUTIVE)
        self.assertIn('"meta": {"source_errors": source_errors},', EXECUTIVE)

    def test_no_stat_field_silently_defaults_to_zero_on_exception(self):
        # None of the old bare `except Exception:` blocks assigning `= 0` /
        # `= 0.0` inside get_executive_stats should remain.
        stats_section = EXECUTIVE.split('@router.get("/stats")')[1].split('@router.get("/approvals/pending"')[0] \
            if '@router.get("/approvals/pending"' in EXECUTIVE else EXECUTIVE.split('@router.get("/stats")')[1]
        self.assertNotIn("projects_count = 0", stats_section)
        self.assertNotIn("machinery_count = 0", stats_section)
        self.assertNotIn("workforce_count = 0", stats_section)

    def test_money_fields_are_none_not_fake_dollar_zero_on_failure(self):
        self.assertIn('f"${inventory_value:,.2f}" if inventory_value is not None else None', EXECUTIVE)
        self.assertIn('f"${open_pipeline_value:,.2f}" if open_pipeline_value is not None else None', EXECUTIVE)
        self.assertIn('f"${plant_contribution_margin:,.2f}" if plant_contribution_margin is not None else None', EXECUTIVE)


if __name__ == "__main__":
    unittest.main()
