"""Company revenue and cost have one definition (app/services/finance/
company_budget.py). The executive headline, Budget vs Actual, the Finance
budgets page and the department P&L must all read it - two definitions is
how the dashboard once showed a 67% margin next to a loss."""

from pathlib import Path
import unittest

from app.services.finance import company_budget

ROOT = Path(__file__).resolve().parents[1]
EXECUTIVE = (ROOT / "routers" / "executive.py").read_text(encoding="utf-8")
PERFORMANCE = (ROOT / "routers" / "financial_performance.py").read_text(encoding="utf-8")


class OneCostBasisContractTests(unittest.TestCase):
    def test_bank_lines_and_supplier_payments_are_not_also_counted_from_the_cashbook(self):
        for source in ("bank_statement", "bank_statement_line", "project_money_entry",
                       "supplier_invoice", "supplier_payment_batch"):
            self.assertIn(source, company_budget.CASHBOOK_COUNTED_ELSEWHERE)
        self.assertIn("bank_statement_line", company_budget.GL_ONLY_SOURCES)

    def test_only_cost_accounts_count_as_cost(self):
        self.assertEqual(
            set(company_budget.COST_ACCOUNT_CATEGORIES),
            {"direct_project_cost", "operating_expense", "other_expense"},
        )
        sql = company_budget.non_project_cost_sql("month", department_filter=False)
        # A cashbook row whose journal debits petty cash, a loan or suspense
        # is a movement, not spending.
        self.assertIn("ca.account_category <> ALL(:cost_categories)", sql)
        self.assertIn("a.account_category = ANY(:cost_categories)", sql)
        self.assertIn("transfer_in", sql)

    def test_sql_buckets_by_month_or_department_with_optional_department_filter(self):
        by_month = company_budget.non_project_cost_sql("month", department_filter=True)
        by_department = company_budget.non_project_cost_sql("department", department_filter=False)
        self.assertIn("date_trunc('month', cb.transaction_date)", by_month)
        self.assertIn(":department_id", by_month)
        self.assertIn("cb.department_id AS bucket", by_department)
        self.assertNotIn(":department_id", by_department)

    def test_every_consumer_uses_the_shared_definition(self):
        self.assertIn("budgets.get_company_actuals_to_date", EXECUTIVE)
        self.assertNotIn("_KPI_COST_YTD_SQL", EXECUTIVE)
        self.assertIn("company_budget.non_project_cost_sql", PERFORMANCE)
        self.assertNotIn("SELECT SUM(cb.amount) FROM finance.cashbook_transactions cb", PERFORMANCE)


if __name__ == "__main__":
    unittest.main()
