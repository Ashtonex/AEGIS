"""Payroll engine (Phase 1) - pure calculation tests.

Rate tables here are FIXTURES with round, made-up numbers chosen so the
expected figures can be checked by hand. They are not ZIMRA or NSSA rates.

Fixture PAYE (monthly): 0-100 at 0%, 100-300 at 20% less 20,
300-1000 at 25% less 35, 1000+ at 30% less 85.
Fixture NSSA employee: 4.5% on insurable earnings capped at 700.
Fixture AIDS levy: 3% of PAYE.
"""

import unittest
from decimal import Decimal as D

from app.services.finance.payroll_engine import (
    CurrencyTables,
    PayLine,
    PayrollComputationError,
    basic_and_overtime,
    bonus_exemption_remaining,
    compute_item,
    element_amount,
)
from app.services.finance.payroll_service import ItemInput, OneOffInput, PayrollServiceError, build_lines, split_amount
from app.services.finance.tax_rates import RateBand, RateTable


def band(order, lower, upper, rate, fixed=0, cap=None):
    return RateBand(
        band_order=order,
        lower_bound=D(str(lower)),
        upper_bound=D(str(upper)) if upper is not None else None,
        rate_pct=D(str(rate)),
        fixed_deduction=D(str(fixed)),
        band_cap_amount=D(str(cap)) if cap is not None else None,
    )


def paye_table(tid="paye-usd", basis="monthly", scale=1):
    s = D(scale)
    return RateTable(id=tid, tax_type="paye", currency="USD", period_basis=basis, bands=[
        band(1, 0, 100 * s, 0),
        band(2, 100 * s, 300 * s, 20, 20 * s),
        band(3, 300 * s, 1000 * s, 25, 35 * s),
        band(4, 1000 * s, None, 30, 85 * s),
    ])


def flat_table(tid, tax_type, rate, upper=None):
    return RateTable(id=tid, tax_type=tax_type, currency="USD", period_basis="monthly", bands=[band(1, 0, upper, rate)])


def usd_tables(**kw):
    return CurrencyTables(
        paye=kw.get("paye", paye_table()),
        nssa_employee=flat_table("nssa-ee", "nssa_employee", "4.5", 700),
        nssa_employer=flat_table("nssa-er", "nssa_employer", "4.5", 700),
        aids_levy=flat_table("aids", "aids_levy", 3),
    )


def earning(code, amount, taxable=True, insurable=True, bonus=False):
    return PayLine(kind="earning", code=code, name=code, amount=D(str(amount)),
                   is_taxable=taxable, is_nssa_insurable=insurable, is_bonus=bonus)


def deduction(code, amount, pre_tax=False, credit_pct=0, loan=False):
    return PayLine(kind="deduction", code=code, name=code, amount=D(str(amount)),
                   reduces_taxable=pre_tax, tax_credit_pct=D(str(credit_pct)), is_loan=loan)


def gl_balances(r):
    """The GL bridge relies on: net = gross - PAYE - AIDS - NSSA(ee) - other."""
    return r.net_pay == r.total_earnings - r.paye - r.aids_levy - r.nssa_employee - r.other_deductions


class SingleCurrencyTests(unittest.TestCase):
    def test_full_payslip_by_hand(self):
        lines = [
            earning("BASIC", 800),
            earning("HOUSING", 200),
            earning("MEAL", 50, taxable=False, insurable=False),
            deduction("PENSION", 40, pre_tax=True),
            deduction("MEDAID", 60, credit_pct=50),
            deduction("LOAN", 100, loan=True),
        ]
        r = compute_item(lines=lines, base_currency="USD", base_tables=usd_tables())
        self.assertEqual(r.total_earnings, D("1050.00"))
        self.assertEqual(r.nssa_insurable, D("1000.00"))
        self.assertEqual(r.nssa_employee, D("31.50"))            # 4.5% of the 700 ceiling
        self.assertEqual(r.nssa_employer, D("31.50"))
        self.assertEqual(r.pre_tax_deductions, D("40.00"))
        self.assertEqual(r.taxable_income, D("928.50"))          # 1000 - 40 pension - 31.50 NSSA
        self.assertEqual(r.paye_before_credits, D("197.13"))     # 928.50 x 25% - 35
        self.assertEqual(r.tax_credits, D("30.00"))              # 50% of 60 medical aid
        self.assertEqual(r.paye, D("167.13"))
        self.assertEqual(r.aids_levy, D("5.01"))                 # 3% of PAYE after credits
        self.assertEqual(r.other_deductions, D("200.00"))
        self.assertEqual(r.net_pay, D("646.36"))
        self.assertTrue(gl_balances(r))
        codes = [ln.code for ln in r.statutory_lines]
        self.assertEqual(codes, ["PAYE", "AIDS", "NSSA", "NSSA_ER"])

    def test_nssa_not_deducted_from_taxable_when_setting_off(self):
        r = compute_item(lines=[earning("BASIC", 500)], base_currency="USD", base_tables=usd_tables(),
                         nssa_reduces_taxable=False)
        self.assertEqual(r.taxable_income, D("500.00"))
        self.assertEqual(r.paye, D("90.00"))                     # 500 x 25% - 35

    def test_non_taxable_earning_is_paid_but_not_taxed(self):
        with_meal = compute_item(lines=[earning("BASIC", 500), earning("MEAL", 100, taxable=False, insurable=False)],
                                 base_currency="USD", base_tables=usd_tables())
        without = compute_item(lines=[earning("BASIC", 500)], base_currency="USD", base_tables=usd_tables())
        self.assertEqual(with_meal.paye, without.paye)
        self.assertEqual(with_meal.net_pay - without.net_pay, D("100.00"))

    def test_below_threshold_pays_no_tax(self):
        r = compute_item(lines=[earning("BASIC", 90)], base_currency="USD", base_tables=usd_tables())
        self.assertEqual(r.paye, D("0"))
        self.assertEqual(r.aids_levy, D("0.00"))
        self.assertTrue(gl_balances(r))

    def test_credits_never_exceed_tax(self):
        lines = [earning("BASIC", 200), PayLine(kind="tax_credit", code="CR_ELDER", name="Elderly", amount=D("75"))]
        r = compute_item(lines=lines, base_currency="USD", base_tables=usd_tables())
        self.assertEqual(r.paye_before_credits, D("18.20"))      # (200 - 9 NSSA) x 20% - 20
        self.assertEqual(r.tax_credits, D("18.20"))
        self.assertEqual(r.paye, D("0.00"))
        self.assertEqual(r.net_pay, D("191.00"))                 # a credit is never paid out

    def test_bonus_exemption_partly_used(self):
        lines = [earning("BASIC", 500), earning("BONUS", 400, insurable=False, bonus=True)]
        r = compute_item(lines=lines, base_currency="USD", base_tables=usd_tables(), bonus_exempt_remaining=D("150"))
        self.assertEqual(r.bonus_amount, D("400.00"))
        self.assertEqual(r.bonus_exempt, D("150.00"))
        self.assertEqual(r.taxable_income, D("727.50"))          # 500 + 400 - 150 - 22.50 NSSA

    def test_bonus_remaining_from_table(self):
        table = RateTable(id="bx", tax_type="bonus_exemption", currency="USD", period_basis="annual",
                          bands=[band(1, 0, 700, 0)])
        self.assertEqual(bonus_exemption_remaining(table, D("500")), D("200"))
        self.assertEqual(bonus_exemption_remaining(table, D("900")), D("0"))
        self.assertEqual(bonus_exemption_remaining(None, D("0")), D("0"))

    def test_deductions_above_pay_are_refused(self):
        with self.assertRaises(PayrollComputationError):
            compute_item(lines=[earning("BASIC", 100), deduction("LOAN", 500, loan=True)],
                         base_currency="USD", base_tables=usd_tables())

    def test_annual_table_is_annualised(self):
        monthly = compute_item(lines=[earning("BASIC", 1500)], base_currency="USD", base_tables=usd_tables())
        annual = compute_item(lines=[earning("BASIC", 1500)], base_currency="USD",
                              base_tables=usd_tables(paye=paye_table(basis="annual", scale=12)))
        self.assertEqual(monthly.paye, annual.paye)

    def test_per_transaction_paye_table_is_refused(self):
        with self.assertRaises(PayrollComputationError):
            compute_item(lines=[earning("BASIC", 500)], base_currency="USD",
                         base_tables=usd_tables(paye=paye_table(basis="per_transaction")))


class SplitCurrencyTests(unittest.TestCase):
    lines = [earning("BASIC", 1000), deduction("UNION", 20)]

    def test_base_tables_method_apportions_every_figure(self):
        r = compute_item(lines=self.lines, base_currency="USD", base_tables=usd_tables(),
                         secondary_currency="ZWG", secondary_share_pct=D("40"), exchange_rate=D("26.5"),
                         method="base_tables")
        single = compute_item(lines=self.lines, base_currency="USD", base_tables=usd_tables())
        # Tax is the same as if it were all USD (ZIMRA: mixed salaries use USD tables).
        self.assertEqual(r.paye, single.paye)
        self.assertEqual(r.net_pay, single.net_pay)
        self.assertEqual(r.paye_secondary, (r.paye * D("0.4") * D("26.5")).quantize(D("0.01")))
        self.assertEqual(r.net_pay_secondary, (r.net_pay * D("0.4") * D("26.5")).quantize(D("0.01")))
        base_part, sec_part = split_amount(r.net_pay, r.net_pay_secondary, r.exchange_rate)
        self.assertEqual(base_part, r.net_pay_base_part)
        self.assertLessEqual(abs(base_part + sec_part / r.exchange_rate - r.net_pay), D("0.01"))
        self.assertTrue(gl_balances(r))

    def test_separate_tables_method_taxes_each_portion(self):
        zwg = CurrencyTables(
            paye=RateTable(id="paye-zwg", tax_type="paye", currency="ZWG", period_basis="monthly",
                           bands=[band(1, 0, None, 10)]),
            nssa_employee=RateTable(id="nssa-zwg", tax_type="nssa_employee", currency="ZWG",
                                    period_basis="monthly", bands=[band(1, 0, None, "4.5")]),
        )
        r = compute_item(lines=self.lines, base_currency="USD", base_tables=usd_tables(),
                         secondary_currency="ZWG", secondary_tables=zwg, secondary_share_pct=D("40"),
                         exchange_rate=D("25"), method="separate_tables")
        # ZWG portion: 400 USD x 25 = 10,000 ZWG; NSSA 450; taxable 9,550; PAYE 10% = 955.
        self.assertEqual(r.gross_secondary, D("10000.00"))
        self.assertEqual(r.nssa_employee_secondary, D("450.00"))
        self.assertEqual(r.paye_secondary, D("955.00"))
        self.assertEqual(r.trace["rate_tables"]["secondary_paye"], "paye-zwg")
        # USD portion: 600; NSSA 4.5% of 600 = 27; taxable 573 -> 573 x 25% - 35 = 108.25.
        self.assertEqual(r.paye, (D("108.25") + D("955") / 25).quantize(D("0.01")))
        self.assertTrue(gl_balances(r))

    def test_split_needs_exchange_rate(self):
        with self.assertRaises(PayrollComputationError):
            compute_item(lines=self.lines, base_currency="USD", base_tables=usd_tables(),
                         secondary_currency="ZWG", secondary_share_pct=D("40"))

    def test_separate_tables_needs_secondary_tables(self):
        with self.assertRaises(PayrollComputationError):
            compute_item(lines=self.lines, base_currency="USD", base_tables=usd_tables(),
                         secondary_currency="ZWG", secondary_share_pct=D("40"), exchange_rate=D("25"),
                         method="separate_tables")


class LineBuildingTests(unittest.TestCase):
    elements = {
        "BASIC": {"id": "e-basic", "code": "BASIC", "name": "Basic pay", "element_type": "earning", "is_taxable": True,
                  "is_nssa_insurable": True, "is_bonus": False, "reduces_taxable": False, "tax_credit_pct": 0,
                  "is_loan": False, "is_active": True, "sort_order": 10},
        "BONUS": {"id": "e-bonus", "code": "BONUS", "name": "Bonus", "element_type": "earning", "is_taxable": True,
                  "is_nssa_insurable": False, "is_bonus": True, "reduces_taxable": False, "tax_credit_pct": 0,
                  "is_loan": False, "is_active": True, "sort_order": 50},
    }
    profile = {"pay_type": "hourly", "base_rate": D("5"), "overtime_rate": D("0")}

    def recurring(self, **kw):
        base = {"employee_pay_element_id": "epe-1", "pay_element_id": "e-loan", "code": "LOAN", "name": "Loan",
                "element_type": "deduction", "calc_method": "fixed", "amount": D("100"), "loan_balance": None,
                "is_taxable": False, "is_nssa_insurable": False, "is_bonus": False, "reduces_taxable": False,
                "tax_credit_pct": 0, "is_loan": True, "sort_order": 130}
        return {**base, **kw}

    def test_hours_overtime_and_loan_cap(self):
        lines = build_lines(
            profile=self.profile,
            item=ItemInput(employee_id="x", regular_hours=D("160"), overtime_hours=D("10")),
            recurring=[self.recurring(loan_balance=D("60"))],
            elements_by_code=self.elements,
            employee_label="Test",
        )
        by_code = {ln.code: ln for ln in lines}
        self.assertEqual(by_code["BASIC"].amount, D("800.00"))
        self.assertEqual(by_code["OT"].amount, D("75.00"))        # 10 h x 5 x 1.5 (no OT rate set)
        self.assertEqual(by_code["LOAN"].amount, D("60.00"))      # capped at remaining balance
        self.assertEqual(by_code["LOAN"].employee_pay_element_id, "epe-1")

    def test_cleared_loan_is_skipped(self):
        lines = build_lines(profile=self.profile, item=ItemInput(employee_id="x", regular_hours=D("8")),
                            recurring=[self.recurring(loan_balance=D("0"))], elements_by_code=self.elements,
                            employee_label="Test")
        self.assertNotIn("LOAN", [ln.code for ln in lines])

    def test_pct_of_basic_allowance(self):
        housing = self.recurring(code="HOUSING", element_type="earning", calc_method="pct_of_basic", amount=D("10"),
                                 is_taxable=True, is_loan=False)
        lines = build_lines(profile={"pay_type": "monthly_salary", "base_rate": D("1200"), "overtime_rate": D("0")},
                            item=ItemInput(employee_id="x"), recurring=[housing], elements_by_code=self.elements,
                            employee_label="Test")
        self.assertEqual({ln.code: ln.amount for ln in lines}["HOUSING"], D("120.00"))

    def test_one_off_bonus_and_unknown_code(self):
        lines = build_lines(profile=self.profile, item=ItemInput(employee_id="x", regular_hours=D("8"),
                            one_offs=[OneOffInput(code="bonus", amount=D("250"))]), recurring=[],
                            elements_by_code=self.elements, employee_label="Test")
        bonus = {ln.code: ln for ln in lines}["BONUS"]
        self.assertTrue(bonus.is_bonus)
        self.assertEqual(bonus.pay_element_id, "e-bonus")
        with self.assertRaises(PayrollServiceError):
            build_lines(profile=self.profile, item=ItemInput(employee_id="x", one_offs=[OneOffInput("NOPE", D("1"))]),
                        recurring=[], elements_by_code=self.elements, employee_label="Test")
        with self.assertRaises(PayrollServiceError):
            build_lines(profile=self.profile, item=ItemInput(employee_id="x", one_offs=[OneOffInput("BASIC", D("1"))]),
                        recurring=[], elements_by_code=self.elements, employee_label="Test")

    def test_formula_helpers(self):
        self.assertEqual(basic_and_overtime(pay_type="daily", base_rate=D("40"), overtime_rate=D("0"),
                                            regular_hours=D("80"), overtime_hours=D("4")), (D("400.00"), D("30.00")))
        self.assertEqual(element_amount(calc_method="per_day", amount=D("3"), basic=D("0"), regular_hours=D("40")),
                         (D("15.00"), D("5"), D("3")))


if __name__ == "__main__":
    unittest.main()
