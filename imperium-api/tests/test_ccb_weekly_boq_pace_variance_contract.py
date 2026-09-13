from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web" / "src"

MIGRATION = (ROOT / "migrations" / "187_ccb_weekly_boq_pace_variance.sql").read_text(encoding="utf-8")
CCB_MONITOR = (ROOT / "app" / "services" / "finance" / "ccb_monitor.py").read_text(encoding="utf-8")
FINDINGS_ROUTER = (ROOT / "routers" / "finance_ccb_findings.py").read_text(encoding="utf-8")
ARQ_WORKER = (ROOT / "app" / "workers" / "arq_worker.py").read_text(encoding="utf-8")
EXECUTIVE_PAGE = (WEB_ROOT / "app" / "dashboard" / "executive" / "page.tsx").read_text(encoding="utf-8")


class CcbWeeklyBoqPaceVarianceContractTests(unittest.TestCase):
    def test_migration_extends_check_type_constraint(self):
        self.assertIn("DROP CONSTRAINT IF EXISTS ccb_monitor_findings_check_type_check", MIGRATION)
        self.assertIn("'weekly_boq_pace_variance'", MIGRATION)
        # The three pre-existing check types must still be accepted after this migration.
        for existing in ("'budget_boq_overrun'", "'requisition_budget_breach'", "'variance_stale_approval'"):
            self.assertIn(existing, MIGRATION)

    def test_check_compares_planned_qty_against_approved_measurements_in_same_week(self):
        self.assertIn("async def run_weekly_boq_pace_variance_check", CCB_MONITOR)
        self.assertIn("projects.weekly_budget_items", CCB_MONITOR)
        self.assertIn("finance.boq_measurement_entries", CCB_MONITOR)
        self.assertIn("me.status = 'approved'", CCB_MONITOR)
        self.assertIn("me.measurement_date BETWEEN wb.week_start AND (wb.week_start + INTERVAL '6 days')", CCB_MONITOR)
        self.assertIn("wb.status = 'approved'", CCB_MONITOR)

    def test_check_uses_daily_site_reports_as_evidence_signal_not_a_boq_link(self):
        self.assertIn("projects.daily_site_reports", CCB_MONITOR)
        self.assertIn("dsr.report_date BETWEEN wb.week_start AND (wb.week_start + INTERVAL '6 days')", CCB_MONITOR)

    def test_findings_never_use_accusatory_language(self):
        for banned in ("steal", "theft", "accuse"):
            self.assertNotIn(banned, CCB_MONITOR.lower())
        self.assertIn("Unusual pattern", CCB_MONITOR)

    def test_findings_router_accepts_new_check_type(self):
        self.assertIn('"weekly_boq_pace_variance"', FINDINGS_ROUTER)

    def test_worker_registers_daily_cron_job(self):
        self.assertIn("run_weekly_boq_pace_variance_check", ARQ_WORKER)
        self.assertIn("run_ccb_weekly_boq_pace_variance_check_job", ARQ_WORKER)
        self.assertIn("run_ccb_weekly_boq_pace_variance_check_job,", ARQ_WORKER.split("cron_jobs = [")[1])

    def test_executive_panel_has_a_human_label_for_the_new_check_type(self):
        self.assertIn('weekly_boq_pace_variance: "Weekly Pace Variance"', EXECUTIVE_PAGE)


if __name__ == "__main__":
    unittest.main()
