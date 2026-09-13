from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent
EXECUTIVE = (ROOT / "routers" / "executive.py").read_text(encoding="utf-8")


class ExecutiveTruthStateContractTests(unittest.TestCase):
    """GET /executive/hse/ltifr used to fall back to a hardcoded 85,000
    man-hour "operational baseline" whenever hr.timesheets had no rows,
    which produced a real-looking LTIFR number (and a false "compliant"
    reading) from a denominator nobody ever measured. GET
    /executive/financial-runway used to blend a hardcoded $3,500/employee
    payroll guess into total_burn silently, and returned a 99.0-months
    runway sentinel that read as a calculated figure when there was no
    burn signal at all. These tests pin both fixes: fabricated numbers are
    gone, and the true absence of data now surfaces as UNKNOWN, not as a
    plausible-looking zero or a magic constant.
    """

    def test_ltifr_hardcoded_man_hour_fallback_is_gone(self):
        self.assertNotIn("85000.0", EXECUTIVE)
        self.assertNotIn("Fallback default operational baseline", EXECUTIVE)

    def test_ltifr_reports_unknown_without_a_real_denominator(self):
        self.assertIn('"status": "UNKNOWN"', EXECUTIVE)
        self.assertIn('"truth_status": "UNKNOWN"', EXECUTIVE)
        self.assertIn("LTIFR cannot be ", EXECUTIVE)
        self.assertIn("calculated without a real man-hours denominator.", EXECUTIVE)

    def test_ltifr_labels_a_real_calculation_as_system_generated(self):
        self.assertIn('"truth_status": "SYSTEM_GENERATED"', EXECUTIVE)

    def test_runway_sentinel_99_months_is_gone(self):
        self.assertNotIn("else 99.0", EXECUTIVE)

    def test_runway_labels_the_payroll_estimate_as_estimated_not_fact(self):
        self.assertIn("estimation_basis", EXECUTIVE)
        self.assertIn('"ESTIMATED"', EXECUTIVE)
        self.assertIn("not sourced from actual payroll runs or payslips", EXECUTIVE)

    def test_runway_treats_a_failed_cash_source_as_unavailable_not_zero(self):
        self.assertIn("cash_unavailable", EXECUTIVE)
        self.assertIn("Cash reserves source (finance.cash_accounts) is unavailable", EXECUTIVE)


if __name__ == "__main__":
    unittest.main()
