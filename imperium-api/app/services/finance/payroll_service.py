"""
Payroll service: the database side of a payroll run.

Loads what the pure engine (payroll_engine.py) needs - org settings, rate
tables, the pay profile, recurring codes, year-to-date bonus exemption used -
and writes the results: run header, items, payslip lines. Also owns the
controls around a run: monthly period locks, the double-payment guard,
loan balances and the two-currency cash/statutory posting.

Every failure a user can fix is a PayrollServiceError carrying an HTTP status,
so routers stay thin and the deprecated router cannot drift from this one.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.payroll_engine import (
    ZERO,
    CurrencyTables,
    ItemResult,
    PayLine,
    PayrollComputationError,
    basic_and_overtime,
    bonus_exemption_remaining,
    compute_item,
    element_amount,
    money,
)
from app.services.finance.tax_rates import NoRateTableError, RateTable, resolve_rate_table

SYSTEM_CODES = ("BASIC", "OT")


class PayrollServiceError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------

@dataclass
class OneOffInput:
    code: str
    amount: Decimal


@dataclass
class ItemInput:
    employee_id: str
    project_id: Optional[str] = None
    department_id: Optional[str] = None
    regular_hours: Decimal = ZERO
    overtime_hours: Decimal = ZERO
    other_deduction: Decimal = ZERO
    one_offs: list[OneOffInput] = field(default_factory=list)
    notes: Optional[str] = None


@dataclass
class RunInput:
    period_start: date
    period_end: date
    payment_date: date
    cash_account_id: Optional[str]
    items: list[ItemInput]
    secondary_currency: Optional[str] = None
    exchange_rate: Optional[Decimal] = None
    secondary_cash_account_id: Optional[str] = None
    run_number: Optional[str] = None


# ---------------------------------------------------------------------------
# Settings, tables, periods
# ---------------------------------------------------------------------------

DEFAULT_SETTINGS = {"base_currency": "USD", "split_tax_method": "base_tables", "nssa_reduces_taxable": True}


async def get_settings(db: AsyncSession, org_id: str) -> dict[str, Any]:
    row = (await db.execute(
        text("""
            SELECT base_currency, split_tax_method, nssa_reduces_taxable, updated_at
            FROM finance.payroll_settings WHERE organization_id = :org_id
        """),
        {"org_id": org_id},
    )).mappings().first()
    return {**DEFAULT_SETTINGS, **(dict(row) if row else {})}


async def update_settings(db: AsyncSession, org_id: str, user_id: Optional[str], changes: dict[str, Any]) -> dict[str, Any]:
    current = await get_settings(db, org_id)
    merged = {**current, **{k: v for k, v in changes.items() if v is not None}}
    if merged["split_tax_method"] not in ("base_tables", "separate_tables"):
        raise PayrollServiceError(422, "split_tax_method must be base_tables or separate_tables.")
    await db.execute(
        text("""
            INSERT INTO finance.payroll_settings (organization_id, base_currency, split_tax_method, nssa_reduces_taxable, updated_by)
            VALUES (:org_id, :base_currency, :split_tax_method, :nssa_reduces_taxable, :user_id)
            ON CONFLICT (organization_id) DO UPDATE SET
                base_currency = EXCLUDED.base_currency,
                split_tax_method = EXCLUDED.split_tax_method,
                nssa_reduces_taxable = EXCLUDED.nssa_reduces_taxable,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
        """),
        {
            "org_id": org_id,
            "base_currency": merged["base_currency"].upper(),
            "split_tax_method": merged["split_tax_method"],
            "nssa_reduces_taxable": bool(merged["nssa_reduces_taxable"]),
            "user_id": user_id,
        },
    )
    return await get_settings(db, org_id)


async def _optional_table(db: AsyncSession, **kwargs) -> Optional[RateTable]:
    try:
        return await resolve_rate_table(db, **kwargs)
    except NoRateTableError:
        return None


async def load_tables(db: AsyncSession, org_id: str, currency: str, as_at: date) -> CurrencyTables:
    """PAYE and employee NSSA are required (raise NoRateTableError); employer
    NSSA and AIDS levy are optional, as before - neither changes what the
    employee is paid... except AIDS levy, which is why a missing AIDS levy
    table is reported back on the run as a warning."""
    common = dict(org_id=org_id, currency=currency, as_at=as_at)
    return CurrencyTables(
        paye=await resolve_rate_table(db, tax_type="paye", **common),
        nssa_employee=await resolve_rate_table(db, tax_type="nssa_employee", **common),
        nssa_employer=await _optional_table(db, tax_type="nssa_employer", **common),
        aids_levy=await _optional_table(db, tax_type="aids_levy", **common),
    )


def month_of(d: date) -> date:
    return d.replace(day=1)


async def assert_period_open(db: AsyncSession, org_id: str, payment_date: date) -> None:
    row = (await db.execute(
        text("""
            SELECT status FROM finance.payroll_periods
            WHERE organization_id = :org_id AND period_month = :month
        """),
        {"org_id": org_id, "month": month_of(payment_date)},
    )).first()
    if row and row.status == "closed":
        raise PayrollServiceError(
            409,
            f"Payroll for {month_of(payment_date):%B %Y} is closed. Reopen the month before changing its runs.",
        )


async def list_periods(db: AsyncSession, org_id: str, year: int) -> list[dict[str, Any]]:
    rows = await db.execute(
        text("""
            WITH months AS (
                SELECT make_date(CAST(:year AS int), m, 1) AS period_month FROM generate_series(1, 12) AS m
            )
            SELECT m.period_month,
                   COALESCE(pp.status, 'open') AS status,
                   pp.closed_at, pp.closed_by, pp.reopened_at, pp.reopened_by, pp.reopen_reason,
                   (SELECT COUNT(*) FROM finance.payroll_runs r
                     WHERE r.organization_id = :org_id AND r.is_deleted = false
                       AND date_trunc('month', r.payment_date) = m.period_month) AS runs_total,
                   (SELECT COUNT(*) FROM finance.payroll_runs r
                     WHERE r.organization_id = :org_id AND r.is_deleted = false
                       AND r.status IN ('draft', 'approved')
                       AND date_trunc('month', r.payment_date) = m.period_month) AS runs_open
            FROM months m
            LEFT JOIN finance.payroll_periods pp
              ON pp.organization_id = :org_id AND pp.period_month = m.period_month
            ORDER BY m.period_month
        """),
        {"org_id": org_id, "year": year},
    )
    return [dict(r._mapping) for r in rows]


async def close_period(db: AsyncSession, org_id: str, user_id: Optional[str], period_month: date) -> dict[str, Any]:
    period_month = month_of(period_month)
    open_runs = (await db.execute(
        text("""
            SELECT run_number, status FROM finance.payroll_runs
            WHERE organization_id = :org_id AND is_deleted = false
              AND status IN ('draft', 'approved')
              AND payment_date >= :start AND payment_date < (CAST(:start AS date) + INTERVAL '1 month')
            ORDER BY run_number
        """),
        {"org_id": org_id, "start": period_month},
    )).all()
    if open_runs:
        listed = ", ".join(f"{r.run_number} ({r.status})" for r in open_runs)
        raise PayrollServiceError(409, f"Post or cancel these runs before closing {period_month:%B %Y}: {listed}.")
    await db.execute(
        text("""
            INSERT INTO finance.payroll_periods (organization_id, period_month, status, closed_by, closed_at)
            VALUES (:org_id, :month, 'closed', :user_id, NOW())
            ON CONFLICT (organization_id, period_month) DO UPDATE SET
                status = 'closed', closed_by = EXCLUDED.closed_by, closed_at = NOW(), updated_at = NOW()
        """),
        {"org_id": org_id, "month": period_month, "user_id": user_id},
    )
    return {"period_month": period_month.isoformat(), "status": "closed"}


async def reopen_period(db: AsyncSession, org_id: str, user_id: Optional[str], period_month: date, reason: str) -> dict[str, Any]:
    period_month = month_of(period_month)
    result = await db.execute(
        text("""
            UPDATE finance.payroll_periods
            SET status = 'open', reopened_by = :user_id, reopened_at = NOW(), reopen_reason = :reason, updated_at = NOW()
            WHERE organization_id = :org_id AND period_month = :month AND status = 'closed'
            RETURNING id
        """),
        {"org_id": org_id, "month": period_month, "user_id": user_id, "reason": reason},
    )
    if not result.first():
        raise PayrollServiceError(409, f"{period_month:%B %Y} is not closed.")
    return {"period_month": period_month.isoformat(), "status": "open"}


# ---------------------------------------------------------------------------
# Lines
# ---------------------------------------------------------------------------

async def _load_elements_by_code(db: AsyncSession, org_id: str) -> dict[str, dict[str, Any]]:
    rows = await db.execute(
        text("""
            SELECT id, code, name, element_type, calc_method, default_amount, is_taxable, is_nssa_insurable,
                   is_bonus, reduces_taxable, tax_credit_pct, is_loan, is_active, sort_order
            FROM finance.pay_elements
            WHERE organization_id = :org_id AND is_deleted = false
        """),
        {"org_id": org_id},
    )
    return {r.code: dict(r._mapping) for r in rows}


async def _load_recurring(
    db: AsyncSession, org_id: str, employee_ids: list[str], period_start: date, period_end: date
) -> dict[str, list[dict[str, Any]]]:
    rows = await db.execute(
        text("""
            SELECT epe.id AS employee_pay_element_id, epe.employee_id, epe.amount, epe.loan_balance,
                   pe.id AS pay_element_id, pe.code, pe.name, pe.element_type, pe.calc_method,
                   pe.is_taxable, pe.is_nssa_insurable, pe.is_bonus, pe.reduces_taxable,
                   pe.tax_credit_pct, pe.is_loan, pe.sort_order
            FROM finance.employee_pay_elements epe
            JOIN finance.pay_elements pe
              ON pe.id = epe.pay_element_id AND pe.organization_id = epe.organization_id
            WHERE epe.organization_id = :org_id
              AND epe.employee_id = ANY(CAST(:ids AS uuid[]))
              AND epe.is_active = true AND epe.is_deleted = false
              AND pe.is_active = true AND pe.is_deleted = false
              AND epe.effective_from <= :period_end
              AND (epe.effective_to IS NULL OR epe.effective_to >= :period_start)
            ORDER BY pe.sort_order, pe.code
        """),
        {"org_id": org_id, "ids": employee_ids, "period_start": period_start, "period_end": period_end},
    )
    by_employee: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        by_employee.setdefault(str(r.employee_id), []).append(dict(r._mapping))
    return by_employee


def _line_from_element(el: dict[str, Any], amount: Decimal, **extra) -> PayLine:
    return PayLine(
        kind=el["element_type"],
        code=el["code"],
        name=el["name"],
        amount=amount,
        is_taxable=bool(el["is_taxable"]) if el["element_type"] == "earning" else False,
        is_nssa_insurable=bool(el["is_nssa_insurable"]),
        is_bonus=bool(el["is_bonus"]),
        reduces_taxable=bool(el["reduces_taxable"]),
        tax_credit_pct=Decimal(str(el["tax_credit_pct"] or 0)),
        is_loan=bool(el["is_loan"]),
        sort_order=int(el.get("sort_order") or 100),
        pay_element_id=str(el["pay_element_id"]) if el.get("pay_element_id") else (str(el["id"]) if el.get("id") else None),
        **extra,
    )


def build_lines(
    *,
    profile: dict[str, Any],
    item: ItemInput,
    recurring: list[dict[str, Any]],
    elements_by_code: dict[str, dict[str, Any]],
    employee_label: str,
) -> list[PayLine]:
    basic, overtime = basic_and_overtime(
        pay_type=profile["pay_type"],
        base_rate=Decimal(str(profile["base_rate"])),
        overtime_rate=Decimal(str(profile.get("overtime_rate") or 0)),
        regular_hours=item.regular_hours,
        overtime_hours=item.overtime_hours,
    )

    def system_line(code: str, fallback_name: str, amount: Decimal, order: int, **extra) -> PayLine:
        el = elements_by_code.get(code)
        if el:
            return _line_from_element(el, amount, **extra)
        # Org created after migration 287 without its starter catalogue:
        # basic and overtime are still taxable, NSSA-insurable pay.
        return PayLine(kind="earning", code=code, name=fallback_name, amount=amount, is_taxable=True,
                       is_nssa_insurable=True, sort_order=order, **extra)

    lines: list[PayLine] = [
        system_line("BASIC", "Basic pay", basic, 10, quantity=item.regular_hours if profile["pay_type"] != "monthly_salary" else None,
                    rate=Decimal(str(profile["base_rate"]))),
    ]
    if overtime:
        lines.append(system_line("OT", "Overtime", overtime, 20, quantity=item.overtime_hours))

    for rec in recurring:
        if rec["element_type"] == "employer_contribution":
            raise PayrollServiceError(
                422, f"{rec['code']} is an employer-cost code assigned to {employee_label}; employer costs other "
                "than NSSA are not supported on runs yet. End that assignment and try again.")
        amount, quantity, rate = element_amount(
            calc_method=rec["calc_method"],
            amount=Decimal(str(rec["amount"])),
            basic=basic,
            regular_hours=item.regular_hours,
        )
        if rec["loan_balance"] is not None:
            amount = min(amount, money(Decimal(str(rec["loan_balance"]))))
        if amount <= 0:
            continue
        lines.append(_line_from_element(
            rec, amount, quantity=quantity, rate=rate,
            employee_pay_element_id=str(rec["employee_pay_element_id"]),
        ))

    for one_off in item.one_offs:
        code = one_off.code.strip().upper()
        el = elements_by_code.get(code)
        if not el or not el["is_active"]:
            raise PayrollServiceError(422, f"Unknown or inactive pay code '{code}' for {employee_label}.")
        if code in SYSTEM_CODES:
            raise PayrollServiceError(422, f"{code} comes from the pay profile and hours; it cannot be entered as a one-off.")
        if el["element_type"] == "employer_contribution":
            raise PayrollServiceError(422, f"{code} is an employer-cost code; employer costs other than NSSA are not supported on runs yet.")
        if one_off.amount <= 0:
            continue
        lines.append(_line_from_element({**el, "pay_element_id": el["id"]}, money(one_off.amount)))

    if item.other_deduction and item.other_deduction > 0:
        el = elements_by_code.get("OTHER")
        if el:
            lines.append(_line_from_element({**el, "pay_element_id": el["id"]}, money(item.other_deduction)))
        else:
            lines.append(PayLine(kind="deduction", code="OTHER", name="Other deduction",
                                 amount=money(item.other_deduction), sort_order=190))
    return lines


async def bonus_exempt_used(db: AsyncSession, org_id: str, employee_ids: list[str], tax_year: int) -> dict[str, Decimal]:
    """Tax-free bonus already given this tax year, counting every run that is
    not cancelled (drafts too, so two drafts can't both use the allowance)."""
    rows = await db.execute(
        text("""
            SELECT pi.employee_id, COALESCE(SUM(pi.bonus_exempt_amount), 0) AS used
            FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id AND pr.organization_id = pi.organization_id
            WHERE pi.organization_id = :org_id
              AND pi.employee_id = ANY(CAST(:ids AS uuid[]))
              AND pr.status <> 'cancelled' AND pr.is_deleted = false
              AND EXTRACT(YEAR FROM pr.payment_date)::int = CAST(:tax_year AS int)
            GROUP BY pi.employee_id
        """),
        {"org_id": org_id, "ids": employee_ids, "tax_year": tax_year},
    )
    return {str(r.employee_id): Decimal(str(r.used)) for r in rows}


async def assert_not_already_paid(
    db: AsyncSession, org_id: str, employee_ids: list[str], period_start: date, period_end: date
) -> None:
    rows = (await db.execute(
        text("""
            SELECT e.employee_name, pr.run_number, pr.status
            FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id AND pr.organization_id = pi.organization_id
            JOIN hr.employees e ON e.id = pi.employee_id
            WHERE pi.organization_id = :org_id
              AND pi.employee_id = ANY(CAST(:ids AS uuid[]))
              AND pr.status <> 'cancelled' AND pr.is_deleted = false
              AND pr.period_start <= :period_end AND pr.period_end >= :period_start
            ORDER BY e.employee_name
        """),
        {"org_id": org_id, "ids": employee_ids, "period_start": period_start, "period_end": period_end},
    )).all()
    if rows:
        listed = "; ".join(f"{r.employee_name} in {r.run_number} ({r.status})" for r in rows)
        raise PayrollServiceError(409, f"Already on a payroll run for an overlapping period: {listed}. Cancel that run first.")


async def _cash_account_currency(db: AsyncSession, org_id: str, account_id: str, label: str) -> str:
    row = (await db.execute(
        text("""
            SELECT currency FROM finance.cash_accounts
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        """),
        {"id": account_id, "org_id": org_id},
    )).first()
    if not row:
        raise PayrollServiceError(404, f"{label} not found.")
    return (row.currency or "USD").upper()


# ---------------------------------------------------------------------------
# Create a run
# ---------------------------------------------------------------------------

def _decimal_str(value: Optional[Decimal]) -> Optional[float]:
    return float(value) if value is not None else None


async def create_run(db: AsyncSession, *, org_id: str, user_id: Optional[str], run: RunInput) -> dict[str, Any]:
    """Computes and writes a draft run. Caller commits."""
    if run.period_end < run.period_start:
        raise PayrollServiceError(422, "period_end must be on or after period_start.")
    if not run.items:
        raise PayrollServiceError(422, "A payroll run needs at least one employee.")

    settings = await get_settings(db, org_id)
    base_currency = settings["base_currency"]
    method = settings["split_tax_method"]
    secondary_currency = run.secondary_currency.upper() if run.secondary_currency else None
    if secondary_currency == base_currency:
        raise PayrollServiceError(422, f"The second currency cannot be the base currency ({base_currency}).")
    if secondary_currency and (not run.exchange_rate or run.exchange_rate <= 0):
        raise PayrollServiceError(422, f"Enter the exchange rate ({secondary_currency} per 1 {base_currency}).")

    await assert_period_open(db, org_id, run.payment_date)

    employee_ids = [it.employee_id for it in run.items]
    if len(set(employee_ids)) != len(employee_ids):
        raise PayrollServiceError(422, "An employee appears twice on the run.")

    if run.cash_account_id:
        cur = await _cash_account_currency(db, org_id, run.cash_account_id, "Cash account")
        if cur != base_currency:
            raise PayrollServiceError(422, f"The pay-from account is in {cur}; payroll's base currency is {base_currency}.")

    profiles_rows = await db.execute(
        text("""
            SELECT ep.id AS employee_id, ep.employee_name,
                   pp.pay_type, pp.base_rate, pp.overtime_rate, pp.currency,
                   pp.secondary_currency, pp.secondary_share_pct
            FROM finance.employee_pay_profiles pp
            JOIN hr.employees ep ON ep.id = pp.employee_id
            WHERE pp.employee_id = ANY(CAST(:ids AS uuid[]))
              AND pp.organization_id = :org_id
              AND pp.is_active = true AND pp.is_deleted = false
        """),
        {"ids": employee_ids, "org_id": org_id},
    )
    profiles = {str(r.employee_id): dict(r._mapping) for r in profiles_rows}
    missing = [eid for eid in employee_ids if eid not in profiles]
    if missing:
        raise PayrollServiceError(422, f"No active pay profile found for employees: {missing}")

    for eid, p in profiles.items():
        if (p.get("currency") or base_currency).upper() != base_currency:
            raise PayrollServiceError(
                422,
                f"{p['employee_name']}'s pay profile is in {p['currency']}; profiles are kept in {base_currency} "
                "and any part paid in another currency is set as a split share.",
            )
        share = Decimal(str(p.get("secondary_share_pct") or 0))
        if share > 0:
            p_cur = (p.get("secondary_currency") or "").upper()
            if not secondary_currency:
                raise PayrollServiceError(
                    422, f"{p['employee_name']} is paid {share}% in {p_cur}: set the run's second currency and exchange rate."
                )
            if p_cur != secondary_currency:
                raise PayrollServiceError(
                    422, f"{p['employee_name']} is split into {p_cur} but this run's second currency is {secondary_currency}."
                )

    any_split = any(Decimal(str(p.get("secondary_share_pct") or 0)) > 0 for p in profiles.values())
    if any_split:
        if not run.secondary_cash_account_id:
            raise PayrollServiceError(422, f"Choose the {secondary_currency} account the second-currency pay comes from.")
        cur = await _cash_account_currency(db, org_id, run.secondary_cash_account_id, "Second-currency cash account")
        if cur != secondary_currency:
            raise PayrollServiceError(422, f"The second-currency account is in {cur}, not {secondary_currency}.")

    await assert_not_already_paid(db, org_id, employee_ids, run.period_start, run.period_end)

    try:
        base_tables = await load_tables(db, org_id, base_currency, run.payment_date)
        secondary_tables = None
        if any_split and method == "separate_tables":
            secondary_tables = await load_tables(db, org_id, secondary_currency, run.payment_date)
    except NoRateTableError as exc:
        raise PayrollServiceError(422, str(exc)) from exc
    bonus_table = await _optional_table(
        db, org_id=org_id, tax_type="bonus_exemption", currency=base_currency, as_at=run.payment_date
    )

    tax_year = run.payment_date.year
    elements_by_code = await _load_elements_by_code(db, org_id)
    recurring = await _load_recurring(db, org_id, employee_ids, run.period_start, run.period_end)
    bonus_used = await bonus_exempt_used(db, org_id, employee_ids, tax_year)

    results: list[tuple[ItemInput, dict[str, Any], ItemResult]] = []
    for item in run.items:
        profile = profiles[item.employee_id]
        label = profile["employee_name"] or item.employee_id
        lines = build_lines(
            profile=profile, item=item, recurring=recurring.get(item.employee_id, []),
            elements_by_code=elements_by_code, employee_label=label,
        )
        share = Decimal(str(profile.get("secondary_share_pct") or 0))
        try:
            result = compute_item(
                lines=lines,
                base_currency=base_currency,
                base_tables=base_tables,
                secondary_currency=secondary_currency if share > 0 else None,
                secondary_tables=secondary_tables,
                secondary_share_pct=share,
                exchange_rate=run.exchange_rate if share > 0 else None,
                method=method,
                bonus_exempt_remaining=bonus_exemption_remaining(bonus_table, bonus_used.get(item.employee_id, ZERO)),
                nssa_reduces_taxable=bool(settings["nssa_reduces_taxable"]),
                employee_label=label,
            )
        except PayrollComputationError as exc:
            raise PayrollServiceError(422, str(exc)) from exc
        results.append((item, profile, result))

    total_gross = money(sum((r.total_earnings for _, _, r in results), ZERO))
    total_deductions = money(sum((r.paye + r.aids_levy + r.nssa_employee + r.other_deductions for _, _, r in results), ZERO))
    total_net = money(sum((r.net_pay for _, _, r in results), ZERO))
    total_net_secondary = money(sum((r.net_pay_secondary for _, _, r in results), ZERO))

    run_row = (await db.execute(
        text("""
            INSERT INTO finance.payroll_runs (
                organization_id, run_number, period_start, period_end, payment_date, cash_account_id, status,
                gross_pay, total_deductions, net_pay, created_by,
                base_currency, secondary_currency, exchange_rate, secondary_cash_account_id,
                secondary_net_pay, split_tax_method, tax_year
            ) VALUES (
                :org_id,
                COALESCE(:run_number,
                    'PAY-' || TO_CHAR(CAST(:period_start AS date), 'YYYYMM') || '-' || LPAD(NEXTVAL('finance.payroll_run_seq')::TEXT, 3, '0')),
                :period_start, :period_end, :payment_date, :cash_account_id, 'draft',
                :gross, :deductions, :net, :user_id,
                :base_currency, :secondary_currency, :exchange_rate, :secondary_cash_account_id,
                :secondary_net, :split_tax_method, :tax_year
            )
            RETURNING id, run_number
        """),
        {
            "org_id": org_id,
            "run_number": run.run_number,
            "period_start": run.period_start,
            "period_end": run.period_end,
            "payment_date": run.payment_date,
            "cash_account_id": run.cash_account_id,
            "gross": float(total_gross),
            "deductions": float(total_deductions),
            "net": float(total_net),
            "user_id": user_id,
            "base_currency": base_currency,
            "secondary_currency": secondary_currency if any_split else None,
            "exchange_rate": _decimal_str(run.exchange_rate) if any_split else None,
            "secondary_cash_account_id": run.secondary_cash_account_id if any_split else None,
            "secondary_net": float(total_net_secondary),
            "split_tax_method": method if any_split else None,
            "tax_year": tax_year,
        },
    )).first()
    run_id = str(run_row.id)

    item_summaries = []
    warnings: list[str] = []
    if base_tables.aids_levy is None:
        warnings.append(f"No AIDS levy rate table for {base_currency}: AIDS levy was not deducted.")
    if any(r.bonus_amount > 0 for _, _, r in results) and bonus_table is None:
        warnings.append("No bonus_exemption rate table: bonuses were taxed in full.")

    for item, profile, r in results:
        item_id = (await db.execute(
            text("""
                INSERT INTO finance.payroll_items (
                    organization_id, payroll_run_id, employee_id, project_id, department_id,
                    regular_hours, overtime_hours, gross_pay,
                    tax_deduction, statutory_deduction, other_deduction, net_pay,
                    paye_amount, nssa_employee_amount, nssa_employer_amount, aids_levy_amount,
                    taxable_gross, rate_table_id,
                    total_earnings, nssa_insurable, bonus_amount, bonus_exempt_amount, pre_tax_deductions,
                    paye_before_credits, tax_credits_amount,
                    secondary_currency, secondary_share_pct, exchange_rate,
                    gross_secondary, paye_secondary, aids_levy_secondary,
                    nssa_employee_secondary, nssa_employer_secondary, net_pay_secondary,
                    calc_trace
                ) VALUES (
                    :org_id, :run_id, :employee_id, :project_id, :department_id,
                    :regular_hours, :overtime_hours, :gross_pay,
                    :tax_deduction, :statutory_deduction, :other_deduction, :net_pay,
                    :paye_amount, :nssa_employee_amount, :nssa_employer_amount, :aids_levy_amount,
                    :taxable_gross, :rate_table_id,
                    :total_earnings, :nssa_insurable, :bonus_amount, :bonus_exempt_amount, :pre_tax_deductions,
                    :paye_before_credits, :tax_credits_amount,
                    :secondary_currency, :secondary_share_pct, :exchange_rate,
                    :gross_secondary, :paye_secondary, :aids_levy_secondary,
                    :nssa_employee_secondary, :nssa_employer_secondary, :net_pay_secondary,
                    CAST(:calc_trace AS jsonb)
                )
                RETURNING id
            """),
            {
                "org_id": org_id,
                "run_id": run_id,
                "employee_id": item.employee_id,
                "project_id": item.project_id,
                "department_id": item.department_id,
                "regular_hours": float(item.regular_hours),
                "overtime_hours": float(item.overtime_hours),
                "gross_pay": float(r.total_earnings),
                # Legacy columns (payslip readers, GL bridge): tax = PAYE + AIDS
                # levy, statutory = employee NSSA, other = every non-statutory
                # deduction. net = gross - all three, which the GL bridge relies on.
                "tax_deduction": float(r.paye + r.aids_levy),
                "statutory_deduction": float(r.nssa_employee),
                "other_deduction": float(r.other_deductions),
                "net_pay": float(r.net_pay),
                "paye_amount": float(r.paye),
                "nssa_employee_amount": float(r.nssa_employee),
                "nssa_employer_amount": float(r.nssa_employer),
                "aids_levy_amount": float(r.aids_levy),
                "taxable_gross": float(r.taxable_income),
                "rate_table_id": r.paye_rate_table_id,
                "total_earnings": float(r.total_earnings),
                "nssa_insurable": float(r.nssa_insurable),
                "bonus_amount": float(r.bonus_amount),
                "bonus_exempt_amount": float(r.bonus_exempt),
                "pre_tax_deductions": float(r.pre_tax_deductions),
                "paye_before_credits": float(r.paye_before_credits),
                "tax_credits_amount": float(r.tax_credits),
                "secondary_currency": r.secondary_currency,
                "secondary_share_pct": float(r.secondary_share_pct),
                "exchange_rate": _decimal_str(r.exchange_rate),
                "gross_secondary": float(r.gross_secondary),
                "paye_secondary": float(r.paye_secondary),
                "aids_levy_secondary": float(r.aids_levy_secondary),
                "nssa_employee_secondary": float(r.nssa_employee_secondary),
                "nssa_employer_secondary": float(r.nssa_employer_secondary),
                "net_pay_secondary": float(r.net_pay_secondary),
                "calc_trace": json.dumps(r.trace),
            },
        )).scalar()

        line_rows = [
            {
                "org_id": org_id,
                "run_id": run_id,
                "item_id": str(item_id),
                "line_kind": kind,
                "code": ln.code,
                "name": ln.name,
                "pay_element_id": ln.pay_element_id,
                "employee_pay_element_id": ln.employee_pay_element_id,
                "quantity": _decimal_str(ln.quantity),
                "rate": _decimal_str(ln.rate),
                "amount": float(ln.amount),
                "is_taxable": ln.is_taxable,
                "is_nssa_insurable": ln.is_nssa_insurable,
                "reduces_taxable": ln.reduces_taxable,
                "sort_order": ln.sort_order,
            }
            for ln, kind in [*((ln, ln.kind) for ln in r.lines), *((ln, "statutory") for ln in r.statutory_lines)]
        ]
        if line_rows:
            await db.execute(
                text("""
                    INSERT INTO finance.payroll_item_lines (
                        organization_id, payroll_run_id, payroll_item_id, line_kind, code, name,
                        pay_element_id, employee_pay_element_id, quantity, rate, amount,
                        is_taxable, is_nssa_insurable, reduces_taxable, sort_order
                    ) VALUES (
                        :org_id, :run_id, :item_id, :line_kind, :code, :name,
                        :pay_element_id, :employee_pay_element_id, :quantity, :rate, :amount,
                        :is_taxable, :is_nssa_insurable, :reduces_taxable, :sort_order
                    )
                """),
                line_rows,
            )
        item_summaries.append({
            "employee_id": item.employee_id,
            "employee_name": profile["employee_name"],
            "gross": float(r.total_earnings),
            "paye": float(r.paye),
            "aids_levy": float(r.aids_levy),
            "nssa_employee": float(r.nssa_employee),
            "other_deductions": float(r.other_deductions),
            "net": float(r.net_pay),
            "net_secondary": float(r.net_pay_secondary),
        })

    return {
        "id": run_id,
        "run_number": run_row.run_number,
        "employee_count": len(run.items),
        "base_currency": base_currency,
        "secondary_currency": secondary_currency if any_split else None,
        "gross_pay": float(total_gross),
        "total_deductions": float(total_deductions),
        "net_pay": float(total_net),
        "secondary_net_pay": float(total_net_secondary),
        "items": item_summaries,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Posting
# ---------------------------------------------------------------------------

async def assert_loan_balances_cover(db: AsyncSession, org_id: str, run_id: str) -> None:
    """A loan instalment taken on a draft must still be covered by the loan's
    balance when the run is posted (another run may have posted in between).

    The assignments are locked first, so a run posting concurrently against
    the same loan waits here and then sees the reduced balance."""
    await db.execute(
        text("""
            SELECT epe.id
            FROM finance.employee_pay_elements epe
            WHERE epe.organization_id = :org_id
              AND epe.loan_balance IS NOT NULL
              AND epe.id IN (
                  SELECT employee_pay_element_id
                  FROM finance.payroll_item_lines
                  WHERE payroll_run_id = :run_id AND organization_id = :org_id
                    AND employee_pay_element_id IS NOT NULL AND line_kind = 'deduction'
              )
            ORDER BY epe.id
            FOR UPDATE OF epe
        """),
        {"run_id": run_id, "org_id": org_id},
    )
    rows = (await db.execute(
        text("""
            SELECT pe.code, e.employee_name, l.amount, epe.loan_balance
            FROM (
                SELECT employee_pay_element_id, SUM(amount) AS amount
                FROM finance.payroll_item_lines
                WHERE payroll_run_id = :run_id AND organization_id = :org_id
                  AND employee_pay_element_id IS NOT NULL AND line_kind = 'deduction'
                GROUP BY employee_pay_element_id
            ) l
            JOIN finance.employee_pay_elements epe ON epe.id = l.employee_pay_element_id
            JOIN finance.pay_elements pe ON pe.id = epe.pay_element_id
            JOIN hr.employees e ON e.id = epe.employee_id
            WHERE epe.loan_balance IS NOT NULL AND epe.loan_balance < l.amount
        """),
        {"run_id": run_id, "org_id": org_id},
    )).all()
    if rows:
        listed = "; ".join(f"{r.employee_name} {r.code}: instalment {r.amount}, balance now {r.loan_balance}" for r in rows)
        raise PayrollServiceError(409, f"Loan balances changed since this run was drafted ({listed}). Cancel and recreate the run.")


async def apply_loan_repayments(db: AsyncSession, org_id: str, run_id: str, payment_date: date) -> None:
    await db.execute(
        text("""
            UPDATE finance.employee_pay_elements epe
            SET loan_balance = epe.loan_balance - l.amount,
                is_active = CASE WHEN epe.loan_balance - l.amount <= 0 THEN false ELSE epe.is_active END,
                effective_to = CASE WHEN epe.loan_balance - l.amount <= 0 THEN CAST(:payment_date AS date) ELSE epe.effective_to END,
                updated_at = NOW()
            FROM (
                SELECT employee_pay_element_id, SUM(amount) AS amount
                FROM finance.payroll_item_lines
                WHERE payroll_run_id = :run_id AND organization_id = :org_id
                  AND employee_pay_element_id IS NOT NULL AND line_kind = 'deduction'
                GROUP BY employee_pay_element_id
            ) l
            WHERE epe.id = l.employee_pay_element_id
              AND epe.organization_id = :org_id
              AND epe.loan_balance IS NOT NULL
        """),
        {"run_id": run_id, "org_id": org_id, "payment_date": payment_date},
    )


def split_amount(total: Decimal, secondary: Decimal, exchange_rate: Optional[Decimal]) -> tuple[Decimal, Decimal]:
    """(base-currency part, second-currency part) of a base-currency total
    whose second-currency share is `secondary` (in that currency)."""
    if not secondary or not exchange_rate:
        return money(total), ZERO
    return money(total - secondary / exchange_rate), money(secondary)


async def cash_postings(db: AsyncSession, org_id: str, run_id: str) -> tuple[Decimal, Decimal]:
    """(base-currency cash out, second-currency cash out) for a run."""
    rows = await db.execute(
        text("""
            SELECT net_pay, net_pay_secondary, exchange_rate
            FROM finance.payroll_items WHERE payroll_run_id = :run_id AND organization_id = :org_id
        """),
        {"run_id": run_id, "org_id": org_id},
    )
    base_total = sec_total = ZERO
    for r in rows:
        base, sec = split_amount(
            Decimal(str(r.net_pay)),
            Decimal(str(r.net_pay_secondary or 0)),
            Decimal(str(r.exchange_rate)) if r.exchange_rate else None,
        )
        base_total += base
        sec_total += sec
    return money(base_total), money(sec_total)


PAYROLL_ITEM_STATUTORY_COLUMNS = """
    pi.id, pi.employee_id, pi.department_id, pi.taxable_gross, pi.rate_table_id, pi.exchange_rate,
    pi.paye_amount, pi.nssa_employee_amount, pi.nssa_employer_amount, pi.aids_levy_amount,
    pi.paye_secondary, pi.nssa_employee_secondary, pi.nssa_employer_secondary, pi.aids_levy_secondary,
    pr.payment_date, pr.base_currency, pr.secondary_currency
"""

_LIABILITIES = (
    ("zimra", "paye", "paye_amount", "paye_secondary"),
    ("zimra", "aids_levy", "aids_levy_amount", "aids_levy_secondary"),
    ("nssa", "nssa_employee", "nssa_employee_amount", "nssa_employee_secondary"),
    ("nssa", "nssa_employer", "nssa_employer_amount", "nssa_employer_secondary"),
)


async def accrue_payroll_item(db: AsyncSession, org_id: str, item: Any) -> int:
    """Accrues one payroll item's PAYE, AIDS levy and NSSA into the statutory
    liability ledger: one line per liability per currency. The second-currency
    share is owed in that currency, so it goes to that currency's liability.
    `item` is a row selected with PAYROLL_ITEM_STATUTORY_COLUMNS. Idempotent
    (accrue_liability_line upserts on the source item). Returns lines written."""
    from app.services.finance.statutory_accrual import accrue_liability_line

    fx = Decimal(str(item["exchange_rate"])) if item["exchange_rate"] else None
    base_currency = item["base_currency"] or "USD"
    common = {
        "db": db, "org_id": org_id, "as_at": item["payment_date"],
        "source_type": "payroll_item", "source_id": item["id"], "direction": "output",
        "department_id": item["department_id"], "employee_id": item["employee_id"],
        "taxable_base": float(item["taxable_gross"]) if item["taxable_gross"] is not None else None,
        "rate_table_id": item["rate_table_id"],
    }
    written = 0
    for authority, liability_type, total_col, secondary_col in _LIABILITIES:
        base_part, secondary_part = split_amount(
            Decimal(str(item[total_col] or 0)), Decimal(str(item[secondary_col] or 0)), fx
        )
        if base_part > 0:
            await accrue_liability_line(
                authority=authority, liability_type=liability_type, currency=base_currency,
                computed_amount=float(base_part), **common,
            )
            written += 1
        if secondary_part > 0 and item["secondary_currency"]:
            await accrue_liability_line(
                authority=authority, liability_type=liability_type, currency=item["secondary_currency"],
                computed_amount=float(secondary_part), **common,
            )
            written += 1
    return written


async def ytd(db: AsyncSession, org_id: str, year: int, employee_id: Optional[str] = None) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"org_id": org_id, "year": year}
    where = "y.organization_id = :org_id AND y.tax_year = :year"
    if employee_id:
        where += " AND y.employee_id = :employee_id"
        params["employee_id"] = employee_id
    rows = await db.execute(
        text(f"""
            SELECT y.*, e.employee_name, e.employee_number
            FROM finance.v_payroll_ytd y
            JOIN hr.employees e ON e.id = y.employee_id
            WHERE {where}
            ORDER BY e.employee_name
        """),
        params,
    )
    return [dict(r._mapping) for r in rows]
