"""Payroll phase 2: layouts, per-currency figures and file rendering (pure)."""
import csv
import io
import unittest
from datetime import date
from decimal import Decimal as D

from app.services.finance import payroll_exports as px
from app.services.finance.payroll_service import PayrollServiceError
from app.services.finance.tax_rates import RateBand, RateTable


def item(**overrides):
    base = {
        "base_currency": "USD", "secondary_currency": None, "exchange_rate": None,
        "total_earnings": D("1200.00"), "gross_secondary": D("0"),
        "taxable_gross": D("1000.00"), "pre_tax_deductions": D("40.00"), "bonus_amount": D("0"),
        "bonus_exempt_amount": D("0"), "paye_before_credits": D("215.00"), "tax_credits_amount": D("30.00"),
        "nssa_insurable": D("1200.00"), "basic_amount": D("1000.00"),
        "paye_amount": D("185.00"), "paye_secondary": D("0"),
        "aids_levy_amount": D("5.55"), "aids_levy_secondary": D("0"),
        "nssa_employee_amount": D("31.50"), "nssa_employee_secondary": D("0"),
        "nssa_employer_amount": D("31.50"), "nssa_employer_secondary": D("0"),
        "net_pay": D("917.95"), "net_pay_secondary": D("0"), "calc_trace": {"method": "single_currency"},
    }
    base.update(overrides)
    return base


def split_item():
    # 40% in ZWG at 25: secondary amounts are 40% x 25 of the whole.
    return item(
        secondary_currency="ZWG", exchange_rate=D("25"),
        gross_secondary=D("12000.00"), paye_secondary=D("1850.00"), aids_levy_secondary=D("55.50"),
        nssa_employee_secondary=D("315.00"), nssa_employer_secondary=D("315.00"), net_pay_secondary=D("9179.50"),
        calc_trace={"method": "base_tables"},
    )


class CurrencyFigureTests(unittest.TestCase):
    def test_single_currency_is_whole_item(self):
        f = px.currency_figures(item(), "USD")
        self.assertEqual(f["gross_earnings"], D("1200.00"))
        self.assertEqual(f["paye"], D("185.00"))
        self.assertEqual(f["taxable_income"], D("1000.00"))
        self.assertIsNone(px.currency_figures(item(), "ZWG"))

    def test_split_matches_posting_split(self):
        it = split_item()
        usd, zwg = px.currency_figures(it, "USD"), px.currency_figures(it, "ZWG")
        # Same split as payroll_service.split_amount: base = total - secondary / fx.
        self.assertEqual(usd["paye"], D("111.00"))
        self.assertEqual(zwg["paye"], D("1850.00"))
        self.assertEqual(usd["net_pay"], D("550.77"))
        self.assertEqual(zwg["net_pay"], D("9179.50"))
        self.assertEqual(usd["gross_earnings"], D("720.00"))
        # Unstored figures pro rata to gross: 60% in USD, 40% x 25 in ZWG.
        self.assertEqual(usd["taxable_income"], D("600.00"))
        self.assertEqual(zwg["taxable_income"], D("10000.00"))
        self.assertEqual(zwg["basic_salary"], D("10000.00"))

    def test_separate_tables_uses_engine_portion(self):
        it = split_item()
        it["calc_trace"] = {"method": "separate_tables", "portions": [
            {"currency": "USD", "taxable_income": "590.00", "tax_credits": "18.00"},
            {"currency": "ZWG", "taxable_income": "11060.00", "tax_credits": "300.00"},
        ]}
        zwg = px.currency_figures(it, "ZWG")
        self.assertEqual(zwg["taxable_income"], D("11060.00"))
        self.assertEqual(zwg["tax_credits"], D("300.00"))
        # Not in the portion: still pro rata.
        self.assertEqual(zwg["bonus"], D("0.00"))


class LayoutTests(unittest.TestCase):
    def test_builtin_layouts_are_valid(self):
        for kind, layout in px.BUILTIN_LAYOUTS.items():
            cols = px.validate_layout(kind, layout["columns"], layout["delimiter"], layout["date_format"])
            self.assertEqual(len(cols), len(layout["columns"]))

    def test_rejects_unknown_field_and_bank_without_amount(self):
        with self.assertRaises(PayrollServiceError):
            px.validate_layout("paye", [{"field": "account_number"}], ",", "YYYY-MM-DD")
        with self.assertRaises(PayrollServiceError):
            px.validate_layout("bank", [{"field": "account_number"}], ",", "YYYY-MM-DD")
        with self.assertRaises(PayrollServiceError):
            px.validate_layout("bank", [{"field": "amount"}], "/", "YYYY-MM-DD")

    def test_constant_column_and_default_header(self):
        cols = px.validate_layout("bank", [{"field": "constant", "value": "SAL", "header": "Type"},
                                           {"field": "amount"}], ",", "YYYY-MM-DD")
        self.assertEqual(cols[0], {"field": "constant", "value": "SAL", "header": "Type"})
        self.assertEqual(cols[1]["header"], "Amount")


class RenderTests(unittest.TestCase):
    layout = {"delimiter": ";", "include_header": True, "date_format": "DD/MM/YYYY", "columns": [
        {"field": "constant", "value": "SAL", "header": "Type"},
        {"field": "account_name", "header": "Name"},
        {"field": "account_number", "header": "Account"},
        {"field": "amount", "header": "Amount"},
        {"field": "payment_date", "header": "Date"},
    ]}

    def test_render_bank_rows(self):
        rows = [
            {"account_name": "Tendai Moyo", "account_number": "0012345678", "amount": D("917.954"),
             "payment_date": date(2026, 11, 25)},
            {"account_name": "=HYPERLINK(\"x\")", "account_number": "77", "amount": D("10"),
             "payment_date": date(2026, 11, 25)},
        ]
        out = list(csv.reader(io.StringIO(px.render_csv(self.layout, "bank", rows)), delimiter=";"))
        self.assertEqual(out[0], ["Type", "Name", "Account", "Amount", "Date"])
        # Leading zeros kept, money to 2 dp, date in the layout's format.
        self.assertEqual(out[1], ["SAL", "Tendai Moyo", "0012345678", "917.95", "25/11/2026"])
        # A formula typed into a name is neutralised.
        self.assertTrue(out[2][1].startswith("'="))

    def test_no_header_and_tab(self):
        layout = {**self.layout, "delimiter": "tab", "include_header": False}
        content = px.render_csv(layout, "bank", [{"account_name": "A", "amount": D("1")}])
        self.assertEqual(content, "SAL\tA\t\t1.00\t\r\n")

    def test_helpers(self):
        self.assertEqual(px.split_name("Tendai Grace Moyo"), ("Moyo", "Tendai Grace"))
        self.assertEqual(px.split_name("Madonna"), ("Madonna", ""))
        self.assertEqual(px.mask_account("0012345678"), "••••5678")
        table = RateTable(id="t", tax_type="nssa_employee", currency="USD", period_basis="monthly", bands=[
            RateBand(1, D("0"), D("700"), D("4.5"), D("0"), None)])
        self.assertEqual(px.nssa_ceiling(table), D("700.00"))
        self.assertIsNone(px.nssa_ceiling(None))


if __name__ == "__main__":
    unittest.main()
