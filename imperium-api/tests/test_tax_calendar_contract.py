from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
STATUTORY_ACCRUAL = (ROOT / "app" / "services" / "finance" / "statutory_accrual.py").read_text(encoding="utf-8")
TAX_CALENDAR = (ROOT / "app" / "services" / "finance" / "tax_calendar.py").read_text(encoding="utf-8")
ARQ_WORKER = (ROOT / "app" / "workers" / "arq_worker.py").read_text(encoding="utf-8")
FINANCE_STATUTORY_ROUTER = (ROOT / "routers" / "finance_statutory.py").read_text(encoding="utf-8")


class DueDateComputationContractTests(unittest.TestCase):
    def test_filing_day_column_mapping_is_explicit(self):
        self.assertIn('"vat": "vat_filing_day"', STATUTORY_ACCRUAL)
        self.assertIn('"paye": "paye_filing_day"', STATUTORY_ACCRUAL)
        self.assertIn('"nssa_employee": "nssa_filing_day"', STATUTORY_ACCRUAL)
        self.assertIn('"nssa_employer": "nssa_filing_day"', STATUTORY_ACCRUAL)

    def test_aids_levy_reuses_paye_filing_day_documented(self):
        # Regression guard: this is a deliberate domain assumption (AIDS
        # Levy is remitted on the same P2 return as PAYE) - must not
        # silently drift to None in a future edit.
        self.assertIn('"aids_levy": "paye_filing_day"', STATUTORY_ACCRUAL)

    def test_withholding_tax_and_other_get_no_computed_due_date(self):
        # The comment explaining this is allowed to mention the words - only
        # assert neither is an actual dict key (would need a trailing colon).
        mapping_block = STATUTORY_ACCRUAL.split("_FILING_DAY_COLUMN_FOR_LIABILITY_TYPE = {")[1].split("}")[0]
        self.assertNotIn('"withholding_tax":', mapping_block)
        self.assertNotIn('"other":', mapping_block)

    def test_accrue_liability_line_upsert_includes_due_date_in_insert_and_update(self):
        fn_body = STATUTORY_ACCRUAL.split("async def accrue_liability_line")[1].split("\n\nasync def _insert")[0] \
            if "\n\nasync def _insert" in STATUTORY_ACCRUAL.split("async def accrue_liability_line")[1] \
            else STATUTORY_ACCRUAL.split("async def accrue_liability_line")[1]
        self.assertIn("period_end, due_date", fn_body)
        self.assertIn("DO UPDATE SET due_date = :due_date", fn_body)
        self.assertIn("due_date = await _compute_due_date(db, org_id, liability_type, period_end)", fn_body)


class TaxCalendarServiceContractTests(unittest.TestCase):
    def test_stages_are_exactly_the_master_spec_list(self):
        self.assertIn("STAGES = (30, 14, 7, 3, 1)", TAX_CALENDAR)

    def test_overdue_is_negative_days_until_due(self):
        fn_body = TAX_CALENDAR.split("def _stage_for")[1].split("\n\n\n")[0]
        self.assertIn("days_until_due < 0", fn_body)
        self.assertIn('"overdue"', fn_body)

    def test_upcoming_deadlines_excludes_paid_and_waived(self):
        fn_body = TAX_CALENDAR.split("async def get_upcoming_deadlines")[1].split("\n\n\n")[0]
        self.assertIn("status NOT IN ('paid', 'waived')", fn_body)
        self.assertIn("due_date IS NOT NULL", fn_body)

    def test_notify_deadline_escalates_overdue_to_executives(self):
        fn_body = TAX_CALENDAR.split("async def notify_deadline")[1].split("\n\n\n")[0]
        self.assertIn('["Finance Manager", "Managing Director", "Executive (Admin)"]', fn_body)
        self.assertIn('role_names = ["Finance Manager"]', fn_body)

    def test_check_tax_deadline_alerts_has_no_dedupe_by_design(self):
        # This is the direct/test-facing convenience sweep - dedupe lives
        # only in the cron job wrapper (see ARQ_WORKER tests below). The
        # docstring is allowed to explain that in prose; only the actual
        # code must never reference redis.
        fn_body = TAX_CALENDAR.split("async def check_tax_deadline_alerts")[1]
        code_only = fn_body.split('"""', 2)[-1]
        self.assertNotIn("redis", code_only.lower())

    def test_org_sweep_scoping_matches_ccb_monitor_idiom(self):
        fn_body = TAX_CALENDAR.split("async def list_deadline_candidates")[1].split("\n\n\n")[0]
        self.assertIn("CAST(:org_id AS uuid) IS NULL OR organization_id = :org_id", fn_body)

    def test_org_id_cast_uses_cast_not_the_broken_double_colon_syntax(self):
        # Regression guard: ":param::type" inside SQLAlchemy text() misparses
        # as an escaped colon and raises a Postgres syntax error - found
        # during Phase 8C live verification, same class of bug as Phase
        # 6A/7A's date-cast issues. Must always use CAST(...) instead.
        self.assertNotIn(":org_id::", TAX_CALENDAR)


class TaxDeadlineCronJobContractTests(unittest.TestCase):
    def test_job_registered_in_functions_and_cron_jobs(self):
        self.assertIn("check_tax_deadline_alerts_job,", ARQ_WORKER)
        functions_block = ARQ_WORKER.split("functions = [")[1].split("]")[0]
        cron_jobs_block = ARQ_WORKER.split("cron_jobs = [")[1].split("]")[0]
        self.assertIn("check_tax_deadline_alerts_job", functions_block)
        self.assertIn("check_tax_deadline_alerts_job", cron_jobs_block)

    def test_dedupe_key_is_long_lived_not_per_day(self):
        # Regression guard: unlike poll_ticket_sla_triggers_job's per-day
        # key, a liability's due_date is fixed - the key must not include a
        # date component, or a stage could re-fire on later days.
        job_body = ARQ_WORKER.split("async def check_tax_deadline_alerts_job")[1].split("\n\n\ndef time_now")[0]
        self.assertIn('f"aegis:tax_deadline:{candidate[\'id\']}:{candidate[\'stage\']}"', job_body)
        self.assertNotIn("time_today", job_body)
        self.assertIn("180 * 86400", job_body)

    def test_job_checks_redis_before_notifying(self):
        job_body = ARQ_WORKER.split("async def check_tax_deadline_alerts_job")[1].split("\n\n\ndef time_now")[0]
        self.assertIn("if await redis_pool.get(dedupe_key):", job_body)
        self.assertIn("continue", job_body)
        self.assertIn("await notify_deadline(db, candidate=candidate)", job_body)

    def test_job_wrapped_in_retry_matching_established_pattern(self):
        job_body = ARQ_WORKER.split("async def check_tax_deadline_alerts_job")[1].split("\n\n\ndef time_now")[0]
        self.assertIn("except Exception as exc:", job_body)
        self.assertIn("raise Retry(defer=exponential_backoff_retry(ctx)) from exc", job_body)


class TaxCalendarEndpointContractTests(unittest.TestCase):
    def test_endpoint_exists_with_existing_permission_no_new_keys(self):
        self.assertIn('@router.get("/tax-calendar")', FINANCE_STATUTORY_ROUTER)
        fn_body = FINANCE_STATUTORY_ROUTER.split('@router.get("/tax-calendar")')[1].split("\n\n\n@router")[0]
        self.assertIn('require_permission("finance.statutory.read")', fn_body)

    def test_endpoint_is_read_only_never_triggers_alerts(self):
        # The docstring is allowed to mention the cron job by name for
        # context - only assert the code never actually calls the
        # alert-firing functions (a call always has a trailing "(").
        fn_body = FINANCE_STATUTORY_ROUTER.split('@router.get("/tax-calendar")')[1].split("\n\n\n@router")[0]
        code_only = fn_body.split('"""', 2)[-1]
        self.assertNotIn("check_tax_deadline_alerts(", code_only)
        self.assertNotIn("notify_deadline(", code_only)
        self.assertIn("get_upcoming_deadlines(", code_only)


if __name__ == "__main__":
    unittest.main()
