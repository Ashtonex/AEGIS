"""HQ office reserve (migration 290): the rules that need no database.
The ledger behaviour is checked end to end by scripts/verify_hq_reserve.py."""

from decimal import Decimal

from app.services.finance import bank_books, company_budget, hq_reserve


def test_contribution_is_rate_of_receipts_rounded_to_cents():
    assert hq_reserve.contribution_amount(Decimal("1000"), Decimal("5")) == Decimal("50.00")
    assert hq_reserve.contribution_amount(Decimal("333.33"), Decimal("2.5")) == Decimal("8.33")
    assert hq_reserve.contribution_amount(Decimal("0.10"), Decimal("5")) == Decimal("0.01")   # half up


def test_no_contribution_on_zero_rate_or_a_month_that_nets_to_a_refund():
    assert hq_reserve.contribution_amount(Decimal("5000"), Decimal("0")) == 0
    assert hq_reserve.contribution_amount(Decimal("-200"), Decimal("5")) == 0


def test_receipts_are_cash_receipts_not_invoicing():
    # revenue or receivable credited by money actually received ...
    assert set(hq_reserve.RECEIPT_ACCOUNTS) == {bank_books.REVENUE, bank_books.RECEIVABLE}
    assert set(hq_reserve.RECEIPT_SOURCES) == {"bank_statement_line", "project_money_entry", "bank_line_allocation"}
    # ... never a claim being certified or invoiced
    assert "progress_claim" not in hq_reserve.RECEIPT_SOURCES


def test_company_budget_sees_the_recovery_so_the_reserve_nets_to_zero():
    # the project cost row is counted from cost_transactions; the 6990 credit
    # must be read from the GL or company actuals would overstate cost
    assert hq_reserve.SOURCE in company_budget.GL_ONLY_SOURCES
    assert (hq_reserve.CONTRIBUTION, hq_reserve.RECOVERED) == ("5970", "6990")
