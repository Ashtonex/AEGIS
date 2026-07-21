from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
MIGRATION = (ROOT / "migrations" / "034_finance_treasury_payroll.sql").read_text(encoding="utf-8")
ROUTER = (ROOT / "routers" / "financial_performance.py").read_text(encoding="utf-8")
WEB_API = (REPO / "aegis-web" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
FINANCE_PAGE = (REPO / "aegis-web" / "src" / "app" / "dashboard" / "finance" / "page.tsx").read_text(encoding="utf-8")
OPS_PANEL = (REPO / "aegis-web" / "src" / "app" / "dashboard" / "finance" / "FinanceOperationsPanel.tsx").read_text(encoding="utf-8")


class FinanceTreasuryPayrollContractTests(unittest.TestCase):
    def test_migration_adds_source_backed_finance_ledgers_with_rls(self):
        for table in [
            "finance.cash_accounts",
            "finance.cashbook_transactions",
            "finance.receipt_allocations",
            "finance.supplier_payment_batches",
            "finance.supplier_payment_items",
            "finance.employee_pay_profiles",
            "finance.payroll_runs",
            "finance.payroll_items",
        ]:
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table}", MIGRATION)
            self.assertIn(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY", MIGRATION)
            self.assertIn(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY", MIGRATION)

    def test_migration_registers_treasury_payroll_permissions(self):
        for permission in [
            "finance.cash.read",
            "finance.cash.manage",
            "finance.cash.post",
            "finance.receipt.allocate",
            "finance.supplier_payment.post",
            "finance.payroll.read",
            "finance.payroll.manage",
            "finance.payroll.post",
        ]:
            self.assertIn(permission, MIGRATION)

    def test_router_exposes_guarded_cash_supplier_and_payroll_workflows(self):
        for route in [
            '@router.get("/cash-accounts")',
            '@router.post("/cash-accounts"',
            '@router.get("/cashbook")',
            '@router.post("/cashbook"',
            '@router.post("/receipts/allocate"',
            '@router.get("/supplier-payments")',
            '@router.post("/supplier-payments"',
            '@router.get("/payroll/profiles")',
            '@router.post("/payroll/profiles"',
            '@router.get("/payroll/runs")',
            '@router.post("/payroll/runs"',
            '@router.post("/payroll/runs/{run_id}/decision")',
            '@router.post("/payroll/runs/{run_id}/post")',
        ]:
            self.assertIn(route, ROUTER)
        for permission in [
            'require_permission("finance.cash.read")',
            'require_permission("finance.cash.manage")',
            'require_permission("finance.cash.post")',
            'require_permission("finance.receipt.allocate")',
            'require_permission("finance.supplier_payment.post")',
            'require_permission("finance.payroll.read")',
            'require_permission("finance.payroll.manage")',
            'require_permission("finance.payroll.post")',
        ]:
            self.assertIn(permission, ROUTER)
        self.assertNotIn('@router.get("/{item_id}")', ROUTER)

    def test_frontend_calls_real_finance_endpoints_without_fallbacks(self):
        for helper in [
            "getFinanceCashAccounts",
            "createFinanceCashAccount",
            "getFinanceCashbook",
            "postFinanceCashbookTransaction",
            "allocateFinanceReceipt",
            "getFinanceSupplierPayments",
            "postFinanceSupplierPaymentBatch",
            "getFinancePayrollProfiles",
            "upsertFinancePayrollProfile",
            "getFinancePayrollRuns",
            "createFinancePayrollRun",
            "decideFinancePayrollRun",
            "postFinancePayrollRun",
        ]:
            self.assertIn(helper, WEB_API)
        for path in [
            "/api/v1/financial-performance/cash-accounts",
            "/api/v1/financial-performance/cashbook",
            "/api/v1/financial-performance/receipts/allocate",
            "/api/v1/financial-performance/supplier-payments",
            "/api/v1/financial-performance/payroll/profiles",
            "/api/v1/financial-performance/payroll/runs",
        ]:
            self.assertIn(path, WEB_API)
        self.assertIn("allowFallback: false", WEB_API)

    def test_finance_dashboard_surfaces_operational_tabs(self):
        for tab in ["cash-accounts", "cashbook", "supplier-payments", "payroll"]:
            self.assertIn(tab, FINANCE_PAGE)
        self.assertIn("FinanceOperationsPanel", FINANCE_PAGE)
        for workflow in [
            "createFinanceCashAccount",
            "postFinanceCashbookTransaction",
            "allocateFinanceReceipt",
            "postFinanceSupplierPaymentBatch",
            "upsertFinancePayrollProfile",
            "createFinancePayrollRun",
            "postFinancePayrollRun",
        ]:
            self.assertIn(workflow, OPS_PANEL)


if __name__ == "__main__":
    unittest.main()
