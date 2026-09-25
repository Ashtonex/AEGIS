"""Monthly PDF statements: tie-out validation and overlap/gap planning (pure,
no PDF or database needed), plus the endpoint wiring."""
from datetime import date
from decimal import Decimal
from pathlib import Path
import unittest

from app.services.finance.bank_statement_pdf import ParsedStatement, StatementLine, _validate, line_key, plan

ROOT = Path(__file__).resolve().parents[1]
ROUTER = (ROOT / "routers" / "bank_transactions.py").read_text(encoding="utf-8")
SERVICE = (ROOT / "app" / "services" / "finance" / "bank_statement_pdf.py").read_text(encoding="utf-8")
AUDIT = (ROOT / "app" / "services" / "finance" / "bank_books.py").read_text(encoding="utf-8")
D = Decimal


def ln(day, debit=None, credit=None, balance=None, reversal=False):
    return StatementLine(transaction_date=date(2026, 9, day), reference="REF", description="x",
                         debit=None if debit is None else D(debit), credit=None if credit is None else D(credit),
                         balance=None if balance is None else D(balance), reversal=reversal, page=1)


def statement(opening, lines, closing, debits=None, credits=None):
    s = ParsedStatement(opening_balance=D(opening), closing_balance=D(closing), lines=lines,
                        debit_count=sum(l.debit is not None for l in lines) if debits is None else debits,
                        credit_count=sum(l.credit is not None for l in lines) if credits is None else credits)
    _validate(s)
    return s


# 1 Sep: +500 -> 1,500 ; 2 Sep: -30 -> 1,470 ; 2 Sep: -30 -> 1,440 (identical fee, different balance)
SEPT = [ln(1, credit="500.00", balance="1500.00"), ln(2, debit="30.00", balance="1470.00"),
        ln(2, debit="30.00", balance="1440.00")]


def keys(lines):
    return [line_key(l.transaction_date, l.amount, l.balance) for l in lines]


class ValidationTests(unittest.TestCase):
    def test_a_statement_that_ties_out_has_no_problems(self):
        self.assertEqual(statement("1000.00", SEPT, "1440.00").problems, [])

    def test_reversal_flips_the_sign(self):
        s = statement("1000.00", [ln(1, debit="30.00", balance="970.00"),
                                  ln(1, debit="30.00", balance="1000.00", reversal=True)], "1000.00")
        self.assertEqual(s.problems, [])
        self.assertEqual([l.amount for l in s.lines], [D("-30.00"), D("30.00")])

    def test_broken_running_balance_is_caught(self):
        s = statement("1000.00", [ln(1, credit="500.00", balance="1600.00")], "1600.00")
        self.assertTrue(any("running balance" in p for p in s.problems))

    def test_closing_balance_and_counts_are_checked(self):
        self.assertTrue(any("closing balance" in p for p in statement("1000.00", SEPT, "9999.00").problems))
        self.assertTrue(any("bank counts" in p for p in statement("1000.00", SEPT, "1440.00", debits=5).problems))


class OverlapTests(unittest.TestCase):
    def test_empty_account_takes_everything_from_the_statement_opening(self):
        result = plan(statement("1000.00", SEPT, "1440.00"), [], None)
        self.assertEqual((len(result["new"]), result["duplicates"], result["problems"]), (3, 0, []))
        self.assertEqual(result["opening_balance"], D("1000.00"))

    def test_overlap_skips_stored_lines_including_identical_same_day_fees(self):
        # AEGIS already has 1 Sep and the first 30.00 fee of 2 Sep
        stored = keys(SEPT[:2])
        result = plan(statement("1000.00", SEPT, "1440.00"), stored,
                      {"transaction_date": date(2026, 9, 2), "bank_balance": D("1470.00")})
        self.assertEqual(result["duplicates"], 2)
        self.assertEqual([l.balance for l in result["new"]], [D("1440.00")])
        self.assertEqual(result["problems"], [])

    def test_a_gap_is_refused(self):
        # AEGIS stops at 800.00 but this statement opens at 1,000.00 - a month is missing
        result = plan(statement("1000.00", SEPT, "1440.00"), [],
                      {"transaction_date": date(2026, 8, 15), "bank_balance": D("800.00")})
        self.assertTrue(result["problems"] and result["problems"][0].startswith("Gap"))

    def test_same_statement_twice_has_nothing_new(self):
        s = statement("1000.00", SEPT, "1440.00")
        result = plan(s, keys(SEPT), {"transaction_date": date(2026, 9, 2), "bank_balance": D("1440.00")})
        self.assertEqual((result["new"], result["duplicates"]), ([], 3))


class WiringContractTests(unittest.TestCase):
    def test_pdf_endpoints_need_the_import_permission(self):
        for fn in ("async def preview_bank_statement_pdf(", "async def create_bank_statement_pdf_import("):
            self.assertIn('require_permission("finance.reconciliation.import")', ROUTER.split(fn)[1].split("\n@router")[0])

    def test_pdf_import_is_matched_tagged_and_journaled(self):
        body = ROUTER.split("async def create_bank_statement_pdf_import(")[1].split("\n@router")[0]
        self.assertIn("run_matching=True", body)

    def test_import_refuses_problems_and_serialises_per_account(self):
        body = SERVICE.split("async def create_import(")[1]
        self.assertIn("pg_advisory_xact_lock", body)
        self.assertLess(body.find("if problems:"), body.find("INSERT INTO finance.bank_statement_imports"))
        self.assertIn("bank_balance", body)

    def test_audit_allows_for_a_monthly_opening_balance(self):
        self.assertIn("opening_balance", AUDIT.split("async def audit(")[1])


if __name__ == "__main__":
    unittest.main()
