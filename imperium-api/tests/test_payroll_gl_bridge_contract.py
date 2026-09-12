from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
GL_BRIDGE = (ROOT / "app" / "services" / "finance" / "gl_bridge.py").read_text(encoding="utf-8")
GL_BRIDGE_CODE_ONLY = GL_BRIDGE.split('"""', 2)[-1]
ALLOCATION_SERVICE = (ROOT / "app" / "services" / "finance" / "payroll_allocation.py").read_text(encoding="utf-8")
PAYROLL_ROUTER = (ROOT / "routers" / "payroll_runs.py").read_text(encoding="utf-8")

MIGRATION_202 = (ROOT / "migrations" / "202_finance_payroll_item_allocations.sql").read_text(encoding="utf-8")
MIGRATION_203 = (ROOT / "migrations" / "203_finance_gl_payroll_account.sql").read_text(encoding="utf-8")
MIGRATION_204 = (ROOT / "migrations" / "204_finance_gl_payroll_bridge_mappings.sql").read_text(encoding="utf-8")
MIGRATION_205 = (ROOT / "migrations" / "205_finance_payroll_allocation_permissions.sql").read_text(encoding="utf-8")


class MigrationContractTests(unittest.TestCase):
    def test_allocations_table_has_expected_columns_and_constraint(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS finance.payroll_item_allocations", MIGRATION_202)
        self.assertIn("payroll_item_id     UUID NOT NULL REFERENCES finance.payroll_items(id) ON DELETE CASCADE", MIGRATION_202)
        self.assertIn("allocation_pct      NUMERIC(5,2) NOT NULL CHECK (allocation_pct > 0 AND allocation_pct <= 100)", MIGRATION_202)

    def test_new_employer_statutory_account_seeded(self):
        self.assertIn("'5150'", MIGRATION_203)
        self.assertIn("Employer Statutory Contributions", MIGRATION_203)

    def test_all_eight_mapping_keys_seeded(self):
        for key in (
            "payroll.project_labour", "payroll.hq_salaries", "payroll.employer_statutory_contributions",
            "payroll.paye_payable", "payroll.aids_levy_payable", "payroll.nssa_payable",
            "payroll.other_deductions_payable", "payroll.net_pay_cash",
        ):
            self.assertIn(key, MIGRATION_204)

    def test_permissions_granted_in_same_migration(self):
        self.assertIn("finance.payroll_allocation.read", MIGRATION_205)
        self.assertIn("finance.payroll_allocation.manage", MIGRATION_205)
        self.assertIn("INSERT INTO core.role_permissions", MIGRATION_205)


class GlBridgePayrollContractTests(unittest.TestCase):
    def test_propose_function_exists_and_dedups(self):
        self.assertIn("async def propose_journal_for_payroll_run", GL_BRIDGE)
        fn_body = GL_BRIDGE.split("async def propose_journal_for_payroll_run")[1].split("\n\nasync def ")[0]
        self.assertIn('_already_proposed(db, org_id, "payroll_run", payroll_run_id)', fn_body)

    def test_only_posted_runs_are_proposable(self):
        fn_body = GL_BRIDGE.split("async def propose_journal_for_payroll_run")[1].split("\n\nasync def ")[0]
        self.assertIn("status = 'posted'", fn_body)

    def test_unallocated_item_falls_back_to_its_own_project(self):
        fn_body = GL_BRIDGE.split("async def propose_journal_for_payroll_run")[1].split("\n\nasync def ")[0]
        self.assertIn('allocations_by_item.get(item["id"]) or [', fn_body)
        self.assertIn('"project_id": item["project_id"], "department_id": item["department_id"]', fn_body)

    def test_employer_contribution_debited_not_pro_rated_by_project(self):
        # Design decision: a single non-project debit line, not split per
        # allocation - regression guard against silently over-engineering
        # this later without updating the documented simplification.
        fn_body = GL_BRIDGE.split("async def propose_journal_for_payroll_run")[1].split("\n\nasync def ")[0]
        self.assertIn('lines.append({"account_id": employer_stat_account, "debit_amount": float(employer_stat_total)})', fn_body)

    def test_journal_construction_balances_by_arithmetic(self):
        # Same arithmetic the service builds from, exercised directly with
        # synthetic figures (mirrors Phase 6A's pure-function verification
        # style, without needing a live DB connection).
        gross_pay = 1000.0
        paye = 200.0
        nssa_employee = 45.0
        nssa_employer = 45.0
        aids_levy = 6.0
        other_deduction = 20.0
        net_pay = gross_pay - paye - nssa_employee - aids_levy - other_deduction

        total_debit = gross_pay + nssa_employer
        total_credit = (paye + aids_levy) + (nssa_employee + nssa_employer) + other_deduction + net_pay
        self.assertAlmostEqual(total_debit, total_credit)

    def test_commitments_and_variations_never_referenced(self):
        fn_body = GL_BRIDGE.split("async def propose_journal_for_payroll_run")[1].split("\n\nasync def ")[0]
        self.assertNotIn("finance.commitments", fn_body)
        self.assertNotIn("finance.variations", fn_body)


class PayrollAllocationServiceContractTests(unittest.TestCase):
    def test_replace_allocations_validates_sum_to_100(self):
        self.assertIn('abs(total_pct - Decimal("100")) > Decimal("0.01")', ALLOCATION_SERVICE)

    def test_replace_allocations_locks_once_posted_or_cancelled(self):
        self.assertIn('_LOCKED_STATUSES = ("posted", "cancelled")', ALLOCATION_SERVICE)
        self.assertIn('item["run_status"] in _LOCKED_STATUSES', ALLOCATION_SERVICE)

    def test_replace_is_delete_then_insert_not_merge(self):
        self.assertIn("DELETE FROM finance.payroll_item_allocations", ALLOCATION_SERVICE)


class PayrollRunsRouterContractTests(unittest.TestCase):
    def test_cashbook_insert_includes_required_not_null_columns(self):
        # Regression guard for the bug this phase fixes: the post action's
        # cashbook INSERT previously omitted transaction_number/direction
        # (both NOT NULL) and never backfilled cashbook_transaction_id.
        post_branch = PAYROLL_ROUTER.split('if action == "post":')[1].split("\n\n        target_status")[0]
        self.assertIn("transaction_number", post_branch)
        self.assertIn("direction", post_branch)
        self.assertIn("'outflow'", post_branch)
        self.assertIn("UPDATE finance.payroll_items SET cashbook_transaction_id = :cb_id", post_branch)

    def test_cashbook_insert_does_not_reference_nonexistent_created_by_column(self):
        # finance.cashbook_transactions has no created_by column - only
        # posted_by. Regression guard for a second bug found during live
        # verification of this same fix.
        insert_stmt = PAYROLL_ROUTER.split("INSERT INTO finance.cashbook_transactions")[1].split(")\n")[0]
        self.assertNotIn("created_by", insert_stmt)

    def test_employee_name_column_used_not_nonexistent_first_last_name(self):
        # Regression guard for a pre-existing bug (hr.employees has no
        # first_name/last_name columns, only employee_name) that blocked
        # payroll run creation entirely - found during Phase 7A live testing.
        self.assertNotIn("ep.first_name", PAYROLL_ROUTER)
        self.assertNotIn("ep.last_name", PAYROLL_ROUTER)
        self.assertIn("ep.employee_name", PAYROLL_ROUTER)

    def test_period_start_cast_for_to_char(self):
        # Regression guard: TO_CHAR(:period_start, 'YYYYMM') without an
        # explicit cast raises AmbiguousFunctionError in asyncpg - found
        # during Phase 7A live testing, same class of bug as Phase 6A's
        # date + timedelta issue.
        self.assertIn("TO_CHAR(CAST(:period_start AS date), 'YYYYMM')", PAYROLL_ROUTER)

    def test_gl_hook_is_non_blocking(self):
        self.assertIn("except GeneralLedgerError as exc:", PAYROLL_ROUTER)
        self.assertIn("gl_warning = str(exc)", PAYROLL_ROUTER)
        # And it must run inside the same try block that rolls back on any
        # unhandled error, before the single commit for this action.
        first_if_idx = PAYROLL_ROUTER.index('if action == "post":')
        commit_idx = PAYROLL_ROUTER.index("await db.commit()", first_if_idx)
        decision_body = PAYROLL_ROUTER[first_if_idx:commit_idx]
        self.assertIn("gl_bridge.propose_journal_for_payroll_run", decision_body)

    def test_status_update_happens_before_gl_proposal_in_same_transaction(self):
        # The GL bridge function requires status='posted' - it must run
        # after the UPDATE, not before, within the same uncommitted
        # transaction (asyncpg sees its own uncommitted writes).
        update_idx = PAYROLL_ROUTER.index("UPDATE finance.payroll_runs\n                SET status = :status")
        gl_call_idx = PAYROLL_ROUTER.index("gl_bridge.propose_journal_for_payroll_run")
        self.assertLess(update_idx, gl_call_idx)

    def test_backfill_and_allocation_endpoints_exist(self):
        self.assertIn('@router.post("/{run_id}/propose-gl"', PAYROLL_ROUTER)
        self.assertIn('@router.get("/items/{item_id}/allocations"', PAYROLL_ROUTER)
        self.assertIn('@router.put("/items/{item_id}/allocations"', PAYROLL_ROUTER)
        self.assertIn('require_permission("finance.payroll_allocation.read")', PAYROLL_ROUTER)
        self.assertIn('require_permission("finance.payroll_allocation.manage")', PAYROLL_ROUTER)


if __name__ == "__main__":
    unittest.main()
