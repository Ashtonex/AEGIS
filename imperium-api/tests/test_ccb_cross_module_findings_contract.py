from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web" / "src"

MIGRATION = (ROOT / "migrations" / "214_ccb_cross_module_findings.sql").read_text(encoding="utf-8")
CCB_MONITOR = (ROOT / "app" / "services" / "finance" / "ccb_monitor.py").read_text(encoding="utf-8")
FINDINGS_ROUTER = (ROOT / "routers" / "finance_ccb_findings.py").read_text(encoding="utf-8")
ARQ_WORKER = (ROOT / "app" / "workers" / "arq_worker.py").read_text(encoding="utf-8")
EXECUTIVE_PAGE = (WEB_ROOT / "app" / "dashboard" / "executive" / "page.tsx").read_text(encoding="utf-8")

_ALL_15_CHECK_TYPES = (
    "budget_boq_overrun",
    "requisition_budget_breach",
    "variance_stale_approval",
    "weekly_boq_pace_variance",
    "invoice_line_price_variance",
    "invoice_line_quantity_variance",
    "invoice_missing_po_or_grn",
    "duplicate_invoice_suspected",
    "invoice_unapproved_supplier",
    "supplier_bank_changed",
    "input_vat_rate_mismatch",
    "gl_proposal_stale_review",
    "labour_headcount_mismatch",
    "fuel_hours_variance",
    "stock_consumption_variance",
)


class MigrationContractTests(unittest.TestCase):
    def test_migration_widens_check_type_constraint_to_all_15_values(self):
        self.assertIn("DROP CONSTRAINT IF EXISTS ccb_monitor_findings_check_type_check", MIGRATION)
        for check_type in _ALL_15_CHECK_TYPES:
            self.assertIn(f"'{check_type}'", MIGRATION)

    def test_migration_never_removes_an_existing_value(self):
        # Backward-compatible widening only - every value from migrations
        # 113/187/190/206 must still appear here.
        for existing in (
            "budget_boq_overrun",
            "requisition_budget_breach",
            "variance_stale_approval",
            "weekly_boq_pace_variance",
            "invoice_line_price_variance",
            "invoice_line_quantity_variance",
            "invoice_missing_po_or_grn",
            "duplicate_invoice_suspected",
            "invoice_unapproved_supplier",
            "supplier_bank_changed",
            "input_vat_rate_mismatch",
        ):
            self.assertIn(f"'{existing}'", MIGRATION)


class GlProposalStaleReviewCheckContractTests(unittest.TestCase):
    def _fn_body(self) -> str:
        return CCB_MONITOR.split("async def run_gl_proposal_stale_review_check")[1].split(
            "\n\ndef _labour_headcount_natural_key"
        )[0]

    def test_check_function_exists_and_uses_shared_helpers(self):
        self.assertIn("async def run_gl_proposal_stale_review_check", CCB_MONITOR)
        fn_body = self._fn_body()
        self.assertIn("_upsert_finding", fn_body)
        self.assertIn("_resolve_finding", fn_body)
        self.assertIn("emit_role_notification", fn_body)

    def test_scoped_to_system_proposed_pending_review_journals(self):
        self.assertIn("origination = 'system_proposed'", CCB_MONITOR)
        self.assertIn("proposal_status = 'pending_review'", CCB_MONITOR)

    def test_scoped_only_to_journals_with_a_project_tagged_line(self):
        # A company-wide (project-less) journal must never be assigned an
        # arbitrary project - it is out of scope for this check.
        candidates_fn = CCB_MONITOR.split("async def _find_stale_gl_proposals")[1].split(
            "\n\nasync def run_gl_proposal_stale_review_check"
        )[0]
        self.assertIn("jl.project_id IS NOT NULL", candidates_fn)


class LabourHeadcountMismatchCheckContractTests(unittest.TestCase):
    def _fn_body(self) -> str:
        return CCB_MONITOR.split("async def run_labour_headcount_mismatch_check")[1].split(
            "\n\ndef _fuel_hours_natural_key"
        )[0]

    def test_check_function_exists_and_uses_shared_helpers(self):
        self.assertIn("async def run_labour_headcount_mismatch_check", CCB_MONITOR)
        fn_body = self._fn_body()
        self.assertIn("_upsert_finding", fn_body)
        self.assertIn("_resolve_finding", fn_body)
        self.assertIn("emit_role_notification", fn_body)

    def test_uses_approved_timesheets_not_the_other_two_attendance_shapes(self):
        # hr.timesheets is the only one of the three attendance shapes with
        # a real approval workflow (Phase 7A's own audit finding) - the
        # other two must never be substituted in.
        candidates_fn = CCB_MONITOR.split("async def _find_labour_headcount_candidates")[1].split(
            "\n\nasync def run_labour_headcount_mismatch_check"
        )[0]
        self.assertIn("hr.timesheets", candidates_fn)
        self.assertIn("ts.status = 'approved'", candidates_fn)
        self.assertNotIn("hr.attendance_records", candidates_fn)
        self.assertNotIn("hr.attendance_events", candidates_fn)

    def test_threshold_requires_more_than_one_employee_difference(self):
        fn_body = self._fn_body()
        self.assertIn("_LABOUR_HEADCOUNT_MISMATCH_THRESHOLD", fn_body)


class FuelHoursVarianceCheckContractTests(unittest.TestCase):
    def _candidates_fn(self) -> str:
        return CCB_MONITOR.split("async def _find_fuel_variance_candidates")[1].split(
            "\n\nasync def run_fuel_hours_variance_check"
        )[0]

    def test_check_function_exists_and_uses_shared_helpers(self):
        self.assertIn("async def run_fuel_hours_variance_check", CCB_MONITOR)
        fn_body = CCB_MONITOR.split("async def run_fuel_hours_variance_check")[1].split(
            "\n\ndef _stock_consumption_natural_key"
        )[0]
        self.assertIn("_upsert_finding", fn_body)
        self.assertIn("emit_role_notification", fn_body)

    def test_reuses_already_computed_columns_rather_than_recomputing(self):
        candidates_fn = self._candidates_fn()
        self.assertIn("ft.variance_litres", candidates_fn)
        self.assertIn("ft.expected_consumption_litres", candidates_fn)

    def test_scoped_to_project_tagged_transactions_only(self):
        candidates_fn = self._candidates_fn()
        self.assertIn("ft.project_id IS NOT NULL", candidates_fn)


class StockConsumptionVarianceCheckContractTests(unittest.TestCase):
    def _fn_body(self) -> str:
        return CCB_MONITOR.split("async def run_stock_consumption_variance_check")[1]

    def test_check_function_exists_and_uses_shared_helpers(self):
        self.assertIn("async def run_stock_consumption_variance_check", CCB_MONITOR)
        fn_body = self._fn_body()
        self.assertIn("_upsert_finding", fn_body)
        self.assertIn("_resolve_finding", fn_body)
        self.assertIn("emit_role_notification", fn_body)

    def test_compares_stock_issues_against_reported_usage_and_wastage(self):
        candidates_fn = CCB_MONITOR.split("async def _find_stock_consumption_candidates")[1].split(
            "\n\nasync def run_stock_consumption_variance_check"
        )[0]
        self.assertIn("procurement.stock_ledger", candidates_fn)
        self.assertIn("movement_type = 'issue'", candidates_fn)
        self.assertIn("projects.daily_report_materials", candidates_fn)
        self.assertIn("drm.quantity_used + drm.wastage_quantity", candidates_fn)


class FindingLanguageContractTests(unittest.TestCase):
    def test_findings_never_use_accusatory_language(self):
        for banned in ("steal", "theft", "accuse"):
            self.assertNotIn(banned, CCB_MONITOR.lower())

    def test_advisory_checks_use_review_not_accusation_phrasing(self):
        self.assertIn("worth reviewing", CCB_MONITOR)
        self.assertIn("worth following up", CCB_MONITOR)


class FindingsRouterAllowListContractTests(unittest.TestCase):
    def test_router_accepts_all_15_check_types(self):
        for check_type in _ALL_15_CHECK_TYPES:
            self.assertIn(f'"{check_type}"', FINDINGS_ROUTER)


class ArqWorkerRegistrationContractTests(unittest.TestCase):
    def test_all_four_new_functions_imported_from_ccb_monitor(self):
        import_block = ARQ_WORKER.split("from app.services.finance.ccb_monitor import (")[1].split(")")[0]
        for fn_name in (
            "run_gl_proposal_stale_review_check",
            "run_labour_headcount_mismatch_check",
            "run_fuel_hours_variance_check",
            "run_stock_consumption_variance_check",
        ):
            self.assertIn(fn_name, import_block)

    def test_all_four_jobs_registered_in_functions_list(self):
        functions_block = ARQ_WORKER.split("functions = [")[1].split("]")[0]
        for job_name in (
            "run_ccb_gl_proposal_stale_review_check_job",
            "run_ccb_labour_headcount_mismatch_check_job",
            "run_ccb_fuel_hours_variance_check_job",
            "run_ccb_stock_consumption_variance_check_job",
        ):
            self.assertIn(job_name, functions_block)

    def test_all_four_jobs_registered_as_cron_jobs(self):
        cron_block = ARQ_WORKER.split("cron_jobs = [")[1]
        for job_name in (
            "run_ccb_gl_proposal_stale_review_check_job",
            "run_ccb_labour_headcount_mismatch_check_job",
            "run_ccb_fuel_hours_variance_check_job",
            "run_ccb_stock_consumption_variance_check_job",
        ):
            self.assertIn(job_name, cron_block)

    def test_new_jobs_use_a_fresh_time_slot_not_colliding_with_tax_deadline_job(self):
        # check_tax_deadline_alerts_job (Phase 8C) already owns hour=4, minute=0.
        cron_block = ARQ_WORKER.split("cron_jobs = [")[1]
        self.assertIn("hour=3,\n            minute=50", cron_block)
        self.assertIn("hour=3,\n            minute=55", cron_block)
        self.assertIn("hour=4,\n            minute=5", cron_block)
        self.assertIn("hour=4,\n            minute=10", cron_block)


class ExecutiveDashboardLabelContractTests(unittest.TestCase):
    def test_all_15_check_types_have_a_human_label(self):
        for check_type in _ALL_15_CHECK_TYPES:
            self.assertIn(f"{check_type}:", EXECUTIVE_PAGE)


if __name__ == "__main__":
    unittest.main()
