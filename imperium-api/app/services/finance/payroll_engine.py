"""
Payroll engine: pure computation of one employee's pay for one run.

No database access here, so every rule can be unit-tested with plain numbers.
The DB side (loading rate tables, codes, YTD figures, writing rows) lives in
app/services/finance/payroll_service.py.

Order of calculation (one currency portion):

    earnings          = every earning line
    taxable earnings  = taxable earning lines - tax-free part of bonus
    NSSA insurable    = earning lines flagged NSSA-insurable
    NSSA employee     = nssa_employee table on insurable (ceiling in the table)
    pre-tax           = deduction lines flagged reduces_taxable (e.g. pension)
    taxable income    = taxable earnings - pre-tax - NSSA employee (if the
                        org setting nssa_reduces_taxable is on)
    PAYE before credit= paye table on taxable income
    credits           = tax_credit lines + deduction x tax_credit_pct
                        (e.g. medical aid 50%), never more than the PAYE
    PAYE              = PAYE before credit - credits
    AIDS levy         = aids_levy table on PAYE (after credits)
    net               = earnings - PAYE - AIDS levy - NSSA employee
                        - every deduction line

Split pay (part of the salary paid in a second currency, e.g. ZiG):

    base_tables      Tax the whole salary on the base (USD) tables, then split
                     every figure by the currency share. ZIMRA's PAYE explainer
                     says mixed salaries use the USD tables.
    separate_tables  Tax each currency portion on its own currency's tables.

All amounts handed in and returned at item level are in the base currency.
Second-currency figures are returned separately, in that currency.

No rate is a constant here: every rate comes from a RateTable. A missing
PAYE or employee-NSSA table is the caller's problem (NoRateTableError).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from app.services.finance.tax_rates import RateTable, apply_bracket_table, apply_flat_with_cap

ZERO = Decimal("0")
HUNDRED = Decimal("100")
_CENTS = Decimal("0.01")

SPLIT_METHODS = ("base_tables", "separate_tables")
LINE_KINDS = ("earning", "deduction", "tax_credit", "employer_contribution")


def money(value: Decimal) -> Decimal:
    return value.quantize(_CENTS, rounding=ROUND_HALF_UP)


class PayrollComputationError(Exception):
    """A pay figure that cannot be computed correctly. Callers turn this into
    a 422; never into a guessed figure."""


@dataclass
class PayLine:
    kind: str
    code: str
    name: str
    amount: Decimal
    is_taxable: bool = False
    is_nssa_insurable: bool = False
    is_bonus: bool = False
    reduces_taxable: bool = False
    tax_credit_pct: Decimal = ZERO
    is_loan: bool = False
    quantity: Optional[Decimal] = None
    rate: Optional[Decimal] = None
    pay_element_id: Optional[str] = None
    employee_pay_element_id: Optional[str] = None
    sort_order: int = 100

    def __post_init__(self) -> None:
        if self.kind not in LINE_KINDS:
            raise PayrollComputationError(f"Unknown pay line kind '{self.kind}' on {self.code}.")
        if self.amount < 0:
            raise PayrollComputationError(f"Pay line {self.code} has a negative amount.")
        self.amount = money(self.amount)


@dataclass
class CurrencyTables:
    paye: RateTable
    nssa_employee: RateTable
    nssa_employer: Optional[RateTable] = None
    aids_levy: Optional[RateTable] = None


@dataclass
class Portion:
    """Statutory figures for one currency portion, in that currency."""

    currency: str
    factor: Decimal
    total_earnings: Decimal
    taxable_earnings: Decimal
    nssa_insurable: Decimal
    bonus_exempt: Decimal
    pre_tax_deductions: Decimal
    nssa_employee: Decimal
    nssa_employer: Decimal
    taxable_income: Decimal
    paye_before_credits: Decimal
    tax_credits: Decimal
    paye: Decimal
    aids_levy: Decimal
    other_deductions: Decimal

    @property
    def net(self) -> Decimal:
        return self.total_earnings - self.paye - self.aids_levy - self.nssa_employee - self.other_deductions


@dataclass
class ItemResult:
    lines: list[PayLine]
    statutory_lines: list[PayLine]
    total_earnings: Decimal
    bonus_amount: Decimal
    bonus_exempt: Decimal
    nssa_insurable: Decimal
    pre_tax_deductions: Decimal
    taxable_income: Decimal
    paye_before_credits: Decimal
    tax_credits: Decimal
    paye: Decimal
    aids_levy: Decimal
    nssa_employee: Decimal
    nssa_employer: Decimal
    other_deductions: Decimal
    net_pay: Decimal
    secondary_currency: Optional[str] = None
    secondary_share_pct: Decimal = ZERO
    exchange_rate: Optional[Decimal] = None
    gross_secondary: Decimal = ZERO
    paye_secondary: Decimal = ZERO
    aids_levy_secondary: Decimal = ZERO
    nssa_employee_secondary: Decimal = ZERO
    nssa_employer_secondary: Decimal = ZERO
    net_pay_secondary: Decimal = ZERO
    paye_rate_table_id: Optional[str] = None
    trace: dict = field(default_factory=dict)

    @property
    def net_pay_base_part(self) -> Decimal:
        """The part of net pay paid in the base currency."""
        if not self.secondary_share_pct or not self.exchange_rate:
            return self.net_pay
        return money(self.net_pay - self.net_pay_secondary / self.exchange_rate)


# ---------------------------------------------------------------------------
# Table helpers
# ---------------------------------------------------------------------------

def _bracket(table: RateTable, amount: Decimal) -> Decimal:
    """PAYE bracket lookup on a monthly figure. An annual table is applied to
    the annualised amount and the result brought back to a month."""
    if table.period_basis == "annual":
        return apply_bracket_table(table, amount * 12) / 12
    if table.period_basis != "monthly":
        raise PayrollComputationError(
            f"PAYE rate table {table.id} has period basis '{table.period_basis}'; payroll needs a monthly or annual table."
        )
    return apply_bracket_table(table, amount)


def _flat(table: Optional[RateTable], base: Decimal) -> Decimal:
    if table is None:
        return ZERO
    return apply_flat_with_cap(table, base)


def bonus_exemption_remaining(table: Optional[RateTable], used_this_year: Decimal) -> Decimal:
    """Tax-free bonus still available this tax year. The bonus_exemption rate
    table holds the annual tax-free amount as the upper_bound of its single
    band. No table means no exemption (the whole bonus is taxed)."""
    if table is None or not table.bands or table.bands[0].upper_bound is None:
        return ZERO
    return max(ZERO, table.bands[0].upper_bound - used_this_year)


# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------

def _portion(
    lines: list[PayLine],
    *,
    currency: str,
    factor: Decimal,
    tables: CurrencyTables,
    bonus_exempt_base: Decimal,
    nssa_reduces_taxable: bool,
) -> Portion:
    """Statutory figures for the share of every line given by `factor`
    (share x exchange rate), in `currency`."""

    def total(predicate) -> Decimal:
        return sum((ln.amount for ln in lines if predicate(ln)), ZERO)

    earnings = money(total(lambda ln: ln.kind == "earning") * factor)
    taxable_earnings = total(lambda ln: ln.kind == "earning" and ln.is_taxable)
    bonus_exempt = money(bonus_exempt_base * factor)
    taxable_earnings = money(taxable_earnings * factor) - bonus_exempt
    insurable = money(total(lambda ln: ln.kind == "earning" and ln.is_nssa_insurable) * factor)
    pre_tax = money(total(lambda ln: ln.kind == "deduction" and ln.reduces_taxable) * factor)
    other_deductions = money(total(lambda ln: ln.kind == "deduction") * factor)

    nssa_employee = money(_flat(tables.nssa_employee, insurable))
    nssa_employer = money(_flat(tables.nssa_employer, insurable))

    taxable_income = taxable_earnings - pre_tax
    if nssa_reduces_taxable:
        taxable_income -= nssa_employee
    taxable_income = max(ZERO, money(taxable_income))

    paye_before = money(_bracket(tables.paye, taxable_income))
    credits_claimed = total(lambda ln: ln.kind == "tax_credit") + sum(
        (ln.amount * ln.tax_credit_pct / HUNDRED for ln in lines if ln.kind == "deduction" and ln.tax_credit_pct),
        ZERO,
    )
    credits = min(paye_before, money(credits_claimed * factor))
    paye = paye_before - credits
    aids_levy = money(_flat(tables.aids_levy, paye))

    return Portion(
        currency=currency,
        factor=factor,
        total_earnings=earnings,
        taxable_earnings=taxable_earnings,
        nssa_insurable=insurable,
        bonus_exempt=bonus_exempt,
        pre_tax_deductions=pre_tax,
        nssa_employee=nssa_employee,
        nssa_employer=nssa_employer,
        taxable_income=taxable_income,
        paye_before_credits=paye_before,
        tax_credits=credits,
        paye=paye,
        aids_levy=aids_levy,
        other_deductions=other_deductions,
    )


def compute_item(
    *,
    lines: list[PayLine],
    base_currency: str,
    base_tables: CurrencyTables,
    secondary_currency: Optional[str] = None,
    secondary_tables: Optional[CurrencyTables] = None,
    secondary_share_pct: Decimal = ZERO,
    exchange_rate: Optional[Decimal] = None,
    method: str = "base_tables",
    bonus_exempt_remaining: Decimal = ZERO,
    nssa_reduces_taxable: bool = True,
    employee_label: str = "employee",
) -> ItemResult:
    if method not in SPLIT_METHODS:
        raise PayrollComputationError(f"Unknown split-currency tax method '{method}'.")

    share = Decimal(secondary_share_pct or 0) / HUNDRED
    if share < 0 or share >= 1:
        raise PayrollComputationError(f"Second-currency share for {employee_label} must be from 0 to under 100%.")
    if share > 0:
        if not secondary_currency or secondary_currency == base_currency:
            raise PayrollComputationError(f"{employee_label} has a split salary but no second currency.")
        if not exchange_rate or exchange_rate <= 0:
            raise PayrollComputationError(
                f"{employee_label} is paid partly in {secondary_currency}: the run needs an exchange rate."
            )
        if method == "separate_tables" and secondary_tables is None:
            raise PayrollComputationError(f"No {secondary_currency} rate tables loaded for {employee_label}.")

    bonus_amount = money(sum((ln.amount for ln in lines if ln.kind == "earning" and ln.is_bonus and ln.is_taxable), ZERO))
    bonus_exempt = min(bonus_amount, max(ZERO, money(bonus_exempt_remaining)))

    common = dict(bonus_exempt_base=bonus_exempt, nssa_reduces_taxable=nssa_reduces_taxable)
    sec: Optional[Portion] = None

    if share == 0 or method == "base_tables":
        base = _portion(lines, currency=base_currency, factor=Decimal(1), tables=base_tables, **common)
        totals = {
            "total_earnings": base.total_earnings,
            "nssa_insurable": base.nssa_insurable,
            "pre_tax_deductions": base.pre_tax_deductions,
            "taxable_income": base.taxable_income,
            "paye_before_credits": base.paye_before_credits,
            "tax_credits": base.tax_credits,
            "paye": base.paye,
            "aids_levy": base.aids_levy,
            "nssa_employee": base.nssa_employee,
            "nssa_employer": base.nssa_employer,
            "other_deductions": base.other_deductions,
        }
        portions = [base]
    else:
        base = _portion(lines, currency=base_currency, factor=Decimal(1) - share, tables=base_tables, **common)
        sec = _portion(
            lines, currency=secondary_currency, factor=share * exchange_rate, tables=secondary_tables, **common
        )

        def combined(attr: str) -> Decimal:
            return money(getattr(base, attr) + getattr(sec, attr) / exchange_rate)

        totals = {
            key: combined(attr)
            for key, attr in [
                ("total_earnings", "total_earnings"),
                ("nssa_insurable", "nssa_insurable"),
                ("pre_tax_deductions", "pre_tax_deductions"),
                ("taxable_income", "taxable_income"),
                ("paye_before_credits", "paye_before_credits"),
                ("tax_credits", "tax_credits"),
                ("paye", "paye"),
                ("aids_levy", "aids_levy"),
                ("nssa_employee", "nssa_employee"),
                ("nssa_employer", "nssa_employer"),
                ("other_deductions", "other_deductions"),
            ]
        }
        # Earnings and deductions are the base-currency lines themselves, so
        # use them as entered rather than a re-converted (rounded) figure.
        totals["total_earnings"] = money(sum((ln.amount for ln in lines if ln.kind == "earning"), ZERO))
        totals["other_deductions"] = money(sum((ln.amount for ln in lines if ln.kind == "deduction"), ZERO))
        portions = [base, sec]

    net = (
        totals["total_earnings"] - totals["paye"] - totals["aids_levy"]
        - totals["nssa_employee"] - totals["other_deductions"]
    )
    if net < 0:
        raise PayrollComputationError(
            f"Deductions for {employee_label} exceed pay by {money(-net)} {base_currency}. "
            "Reduce a deduction or loan instalment for this run."
        )

    result = ItemResult(
        lines=sorted(lines, key=lambda ln: (ln.sort_order, ln.code)),
        statutory_lines=[],
        total_earnings=totals["total_earnings"],
        bonus_amount=bonus_amount,
        bonus_exempt=bonus_exempt,
        nssa_insurable=totals["nssa_insurable"],
        pre_tax_deductions=totals["pre_tax_deductions"],
        taxable_income=totals["taxable_income"],
        paye_before_credits=totals["paye_before_credits"],
        tax_credits=totals["tax_credits"],
        paye=totals["paye"],
        aids_levy=totals["aids_levy"],
        nssa_employee=totals["nssa_employee"],
        nssa_employer=totals["nssa_employer"],
        other_deductions=totals["other_deductions"],
        net_pay=money(net),
        paye_rate_table_id=base_tables.paye.id,
    )

    if share > 0:
        fx = exchange_rate
        result.secondary_currency = secondary_currency
        result.secondary_share_pct = Decimal(secondary_share_pct)
        result.exchange_rate = fx
        if method == "base_tables":
            def part(value: Decimal) -> Decimal:
                return money(value * share * fx)

            result.gross_secondary = part(result.total_earnings)
            result.paye_secondary = part(result.paye)
            result.aids_levy_secondary = part(result.aids_levy)
            result.nssa_employee_secondary = part(result.nssa_employee)
            result.nssa_employer_secondary = part(result.nssa_employer)
            result.net_pay_secondary = part(result.net_pay)
        else:
            result.gross_secondary = sec.total_earnings
            result.paye_secondary = sec.paye
            result.aids_levy_secondary = sec.aids_levy
            result.nssa_employee_secondary = sec.nssa_employee
            result.nssa_employer_secondary = sec.nssa_employer
            result.net_pay_secondary = money(sec.net)
        if result.net_pay_secondary > money(result.net_pay * fx):
            raise PayrollComputationError(f"Second-currency net pay for {employee_label} exceeds total net pay.")

    def stat(code: str, name: str, amount: Decimal, kind: str = "deduction", order: int = 300) -> None:
        if amount:
            result.statutory_lines.append(PayLine(kind=kind, code=code, name=name, amount=amount, sort_order=order))

    stat("PAYE", "PAYE", result.paye, order=300)
    stat("AIDS", "AIDS levy", result.aids_levy, order=310)
    stat("NSSA", "NSSA (employee)", result.nssa_employee, order=320)
    stat("NSSA_ER", "NSSA (employer)", result.nssa_employer, kind="employer_contribution", order=330)

    def portion_trace(p: Portion) -> dict:
        return {k: str(v) if isinstance(v, Decimal) else v for k, v in p.__dict__.items()}

    result.trace = {
        "method": method if share > 0 else "single_currency",
        "nssa_reduces_taxable": nssa_reduces_taxable,
        "bonus_amount": str(bonus_amount),
        "bonus_exempt": str(bonus_exempt),
        "bonus_exempt_remaining_before": str(money(bonus_exempt_remaining)),
        "rate_tables": {
            "paye": base_tables.paye.id,
            "nssa_employee": base_tables.nssa_employee.id,
            "nssa_employer": base_tables.nssa_employer.id if base_tables.nssa_employer else None,
            "aids_levy": base_tables.aids_levy.id if base_tables.aids_levy else None,
            **(
                {"secondary_paye": secondary_tables.paye.id, "secondary_nssa_employee": secondary_tables.nssa_employee.id}
                if sec is not None and secondary_tables is not None
                else {}
            ),
        },
        "portions": [portion_trace(p) for p in portions],
    }
    return result


# ---------------------------------------------------------------------------
# Building lines from a pay profile and recurring codes
# ---------------------------------------------------------------------------

def basic_and_overtime(
    *, pay_type: str, base_rate: Decimal, overtime_rate: Decimal, regular_hours: Decimal, overtime_hours: Decimal
) -> tuple[Decimal, Decimal]:
    """Basic pay and overtime from the pay profile. Same formulas the payroll
    run has always used (routers/payroll_runs.py::_compute_gross), split in two
    so each becomes its own payslip line."""
    if pay_type == "monthly_salary":
        basic = base_rate
        ot = overtime_hours * overtime_rate if overtime_rate else ZERO
    elif pay_type == "hourly":
        basic = regular_hours * base_rate
        ot = overtime_hours * (overtime_rate or base_rate * Decimal("1.5"))
    elif pay_type == "daily":
        basic = regular_hours / Decimal(8) * base_rate
        ot = overtime_hours * (overtime_rate or base_rate / Decimal(8) * Decimal("1.5"))
    else:
        basic = base_rate
        ot = ZERO
    return money(basic), money(ot)


def element_amount(
    *, calc_method: str, amount: Decimal, basic: Decimal, regular_hours: Decimal
) -> tuple[Decimal, Optional[Decimal], Optional[Decimal]]:
    """(amount, quantity, rate) for a recurring code."""
    if calc_method == "fixed":
        return money(amount), None, None
    if calc_method == "pct_of_basic":
        return money(basic * amount / HUNDRED), None, amount
    if calc_method == "per_hour":
        return money(regular_hours * amount), regular_hours, amount
    if calc_method == "per_day":
        days = regular_hours / Decimal(8)
        return money(days * amount), days, amount
    raise PayrollComputationError(f"Unknown calculation method '{calc_method}'.")
