from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
COA_MIGRATION = (ROOT / "migrations" / "180_finance_gl_chart_of_accounts.sql").read_text(encoding="utf-8")
PERIODS_MIGRATION = (ROOT / "migrations" / "181_finance_gl_accounting_periods.sql").read_text(encoding="utf-8")
JOURNAL_MIGRATION = (ROOT / "migrations" / "182_finance_gl_journal_entries.sql").read_text(encoding="utf-8")
PERMISSIONS_MIGRATION = (ROOT / "migrations" / "183_finance_gl_permissions.sql").read_text(encoding="utf-8")
ROUTER = (ROOT / "routers" / "general_ledger.py").read_text(encoding="utf-8")
SERVICE = (ROOT / "app" / "services" / "finance" / "general_ledger.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")


class GeneralLedgerSchemaContractTests(unittest.TestCase):
    def test_new_tables_are_created_with_rls_and_no_existing_table_is_altered(self):
        tables = {
            COA_MIGRATION: "finance.chart_of_accounts",
            PERIODS_MIGRATION: "finance.accounting_periods",
        }
        for migration, table in tables.items():
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table}", migration)
            self.assertIn(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY", migration)
            self.assertIn(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY", migration)
            self.assertNotIn("ALTER TABLE finance.cost_transactions", migration)
            self.assertNotIn("ALTER TABLE finance.department_transfers", migration)

        for table in ("finance.journal_entries", "finance.journal_lines"):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table}", JOURNAL_MIGRATION)
            self.assertIn(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY", JOURNAL_MIGRATION)
            self.assertIn(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY", JOURNAL_MIGRATION)

        # Phase 1 is purely additive - no ALTER TABLE against any pre-existing
        # operational table anywhere in the four new migrations.
        for migration in (COA_MIGRATION, PERIODS_MIGRATION, JOURNAL_MIGRATION, PERMISSIONS_MIGRATION):
            self.assertNotIn("ALTER TABLE finance.cashbook_transactions", migration)
            self.assertNotIn("ALTER TABLE finance.payroll_items", migration)
            self.assertNotIn("ALTER TABLE projects.projects", migration)

    def test_chart_of_accounts_seeds_construction_specific_accounts_per_organization(self):
        self.assertIn("FROM core.organizations o", COA_MIGRATION)
        self.assertIn("WHERE o.is_deleted = false", COA_MIGRATION)
        for account_code, name_fragment in [
            ("4000", "Contract Revenue"),
            ("1200", "Retention Receivable"),
            ("5000", "Materials"),
            ("5100", "Direct Labour"),
            ("5200", "Subcontractors"),
            ("5300", "Plant Hire"),
            ("5400", "Fuel"),
            ("1300", "Work in Progress"),
            ("2100", "Accrued Project Costs"),
            ("2200", "Retentions Payable"),
        ]:
            self.assertIn(f"'{account_code}'", COA_MIGRATION)
            self.assertIn(name_fragment, COA_MIGRATION)

    def test_accounting_periods_have_a_five_state_lifecycle(self):
        self.assertIn(
            "CHECK (status IN ('open', 'soft_closed', 'closed', 'audited', 'locked'))",
            PERIODS_MIGRATION,
        )
        self.assertIn("reopen_reason", PERIODS_MIGRATION)

    def test_journal_header_has_no_balance_check_constraint_but_lines_do(self):
        # Draft journals may be temporarily unbalanced while being built line by
        # line - balance is enforced only at post time by trigger, not by a
        # header-level CHECK that would reject a normal in-progress draft.
        self.assertNotIn("CHECK (total_debit = total_credit)", JOURNAL_MIGRATION)
        self.assertIn("CHECK (NOT (debit_amount > 0 AND credit_amount > 0))", JOURNAL_MIGRATION)
        self.assertIn("CHECK (debit_amount > 0 OR credit_amount > 0)", JOURNAL_MIGRATION)

    def test_journal_entries_enforce_balance_and_period_status_before_posting(self):
        self.assertIn("finance.enforce_journal_entry_rules", JOURNAL_MIGRATION)
        self.assertIn("NEW.total_debit <> NEW.total_credit OR NEW.total_debit <= 0", JOURNAL_MIGRATION)
        self.assertIn("period_status NOT IN ('open', 'soft_closed')", JOURNAL_MIGRATION)

    def test_posted_journals_are_immutable_except_for_reversal_linkage(self):
        self.assertIn("finance.enforce_journal_entry_rules", JOURNAL_MIGRATION)
        self.assertIn("is immutable", JOURNAL_MIGRATION)
        self.assertIn("- 'reversed_by_journal_id'", JOURNAL_MIGRATION)
        self.assertIn("Cannot delete posted journal entry", JOURNAL_MIGRATION)

    def test_journal_lines_of_a_posted_journal_cannot_be_modified(self):
        self.assertIn("finance.enforce_journal_line_rules", JOURNAL_MIGRATION)
        self.assertIn("Cannot modify lines of a posted journal entry", JOURNAL_MIGRATION)
        self.assertIn(
            "BEFORE INSERT OR UPDATE OR DELETE ON finance.journal_lines",
            JOURNAL_MIGRATION,
        )

    def test_journal_lines_carry_the_full_dimension_set(self):
        for dimension in (
            "department_id", "project_id", "cost_code_id",
            "supplier_id", "client_id", "employee_id", "currency_code",
        ):
            self.assertIn(dimension, JOURNAL_MIGRATION)

    def test_audit_and_live_push_triggers_are_attached_to_every_new_table(self):
        for migration, tables in [
            (COA_MIGRATION, ["chart_of_accounts"]),
            (PERIODS_MIGRATION, ["accounting_periods"]),
            (JOURNAL_MIGRATION, ["journal_entries", "journal_lines"]),
        ]:
            for table in tables:
                self.assertIn(f"'{table}'", migration)
            self.assertIn("core.process_audit_log()", migration)
        self.assertIn("core.notify_table_change()", COA_MIGRATION)
        self.assertIn("core.notify_table_change()", PERIODS_MIGRATION)
        self.assertIn("core.notify_table_change()", JOURNAL_MIGRATION)


class GeneralLedgerPermissionMatrixContractTests(unittest.TestCase):
    PERMISSION_KEYS = (
        "finance.coa.read", "finance.coa.write", "finance.gl.read",
        "finance.journal.create", "finance.journal.post", "finance.journal.reverse",
        "finance.period.read", "finance.period.manage", "finance.period.close",
        "finance.period.reopen", "finance.period.lock",
    )

    def test_all_permission_keys_are_defined(self):
        for key in self.PERMISSION_KEYS:
            self.assertIn(f"'{key}'", PERMISSIONS_MIGRATION)

    def test_permissions_are_granted_in_the_same_migration_that_defines_them(self):
        # Regression guard for the exact bug that produced migrations 056, 081
        # and 095: a permission key must never be defined without also being
        # granted to at least one role in the same file.
        self.assertIn("INSERT INTO core.role_permissions", PERMISSIONS_MIGRATION)
        self.assertGreaterEqual(PERMISSIONS_MIGRATION.count("INSERT INTO core.role_permissions"), 4)

    def test_superadmin_and_finance_manager_get_full_operational_access(self):
        self.assertIn("r.name = 'SUPERADMIN'", PERMISSIONS_MIGRATION)
        self.assertIn("r.name = 'Finance Manager'", PERMISSIONS_MIGRATION)
        finance_manager_block = PERMISSIONS_MIGRATION.split("r.name = 'Finance Manager'")[0].split(
            "INSERT INTO core.role_permissions"
        )[-1]
        for key in ("finance.journal.create", "finance.journal.post", "finance.period.close"):
            self.assertIn(key, finance_manager_block)

    def test_period_lock_is_reserved_for_superadmin_and_executive_authority_only(self):
        # Finance Manager must NOT hold finance.period.lock - only SUPERADMIN
        # and Managing Director / Executive (Admin) may lock/reopen a locked
        # period, per the approved Phase 1 plan's segregation of duties.
        finance_manager_section = PERMISSIONS_MIGRATION.split("-- Managing Director")[0]
        self.assertNotIn("finance.period.lock", finance_manager_section.split("Finance Manager:")[-1])
        self.assertIn("'Managing Director', 'Executive (Admin)'", PERMISSIONS_MIGRATION)

    def test_project_manager_and_qs_are_read_only(self):
        self.assertIn("'Project Manager', 'Quantity Surveyor'", PERMISSIONS_MIGRATION)
        pm_qs_block = PERMISSIONS_MIGRATION.split("'Project Manager', 'Quantity Surveyor'")[0].split(
            "INSERT INTO core.role_permissions"
        )[-1]
        self.assertIn("finance.coa.read", pm_qs_block)
        self.assertIn("finance.gl.read", pm_qs_block)
        for write_key in ("finance.journal.create", "finance.journal.post", "finance.period.close"):
            self.assertNotIn(write_key, pm_qs_block)


class GeneralLedgerRouterContractTests(unittest.TestCase):
    def test_sensitive_actions_use_dedicated_permission_keys_not_generic_crud(self):
        # Posting, closing and reopening are independently-grantable actions,
        # not folded into a single coarse resource permission - this is the
        # architectural choice the Phase 1 plan made specifically to avoid
        # repeating the class of bug fixed by migrations 056/081/095.
        expectations = {
            '@router.post("/journals/{journal_id}/post")': 'require_permission("finance.journal.post")',
            '@router.post("/journals/{journal_id}/reverse")': 'require_permission("finance.journal.reverse")',
            '@router.post("/periods/{period_id}/close")': 'require_permission("finance.period.close")',
            '@router.post("/periods/{period_id}/reopen")': 'require_permission("finance.period.reopen")',
            '@router.post("/periods/{period_id}/lock")': 'require_permission("finance.period.lock")',
        }
        for route_decorator, expected_permission in expectations.items():
            self.assertIn(route_decorator, ROUTER)
            route_index = ROUTER.index(route_decorator)
            following_snippet = ROUTER[route_index:route_index + 400]
            self.assertIn(expected_permission, following_snippet)
        self.assertNotIn("require_resource_permission", ROUTER)

    def test_router_exposes_full_gl_surface(self):
        for route in [
            '@router.get("/accounts")',
            '@router.post("/accounts"',
            '@router.get("/accounts/{account_id}/ledger")',
            '@router.get("/trial-balance")',
            '@router.get("/periods")',
            '@router.post("/periods/{period_id}/soft-close")',
            '@router.get("/journals")',
            '@router.post("/journals"',
            '@router.get("/journals/{journal_id}/audit-history")',
        ]:
            self.assertIn(route, ROUTER)

    def test_general_ledger_router_is_mounted(self):
        self.assertIn("from routers import general_ledger", MAIN)
        self.assertIn(
            'app.include_router(general_ledger.router, prefix="/api/v1/finance/gl"',
            MAIN,
        )


class GeneralLedgerServiceContractTests(unittest.TestCase):
    def test_service_validates_balance_before_ever_reaching_the_database_trigger(self):
        self.assertIn("does not balance", SERVICE)
        self.assertIn("round(total_debit, 2) != round(total_credit, 2)", SERVICE)

    def test_posting_locks_the_row_and_rechecks_period_status(self):
        self.assertIn("FOR UPDATE", SERVICE)
        self.assertIn("_assert_period_open_for_posting", SERVICE)

    def test_reversal_creates_a_new_journal_rather_than_flipping_status(self):
        self.assertIn("journal_type=\"reversal\"", SERVICE)
        self.assertIn("reverses_journal_id", SERVICE)
        self.assertIn("reversed_by_journal_id", SERVICE)
        # The linkage on the ORIGINAL posted journal is the one sanctioned
        # mutation of a posted row - it must be set via UPDATE after the
        # reversal is created and posted, never by editing debit/credit lines.
        self.assertIn("UPDATE finance.journal_entries SET reversed_by_journal_id", SERVICE)

    def test_closing_a_period_is_blocked_while_draft_journals_remain(self):
        self.assertIn("Cannot close period while draft journal entries remain", SERVICE)

    def test_reopening_a_period_requires_a_reason(self):
        self.assertIn("A reason is required to reopen an accounting period", SERVICE)


if __name__ == "__main__":
    unittest.main()
