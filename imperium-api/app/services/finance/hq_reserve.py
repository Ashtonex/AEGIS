"""
HQ office reserve funded from project receipts (migration 291).

Each project pays a percentage of its client receipts into a reserve for
head-office purchases: a company default rate, which a project can override
(0 exempts it). Contributions are worked out per project and month from the
posted general ledger and kept in finance.hq_reserve_contributions.

A contribution is an internal charge, not a cash movement:
    Dr 5970 HQ Overhead Contribution          (on the project)
    Cr 6990 HQ Overhead Recovered from Projects
plus a project cost row (cost type 'overhead') so project budget vs actual
shows it. Company profit is unchanged.

Client receipts = credits to 4100 revenue or 1100 receivable on a project,
from bank statement lines, project money entries and bank-line splits (and
their reversals). Invoicing a claim is not a receipt.

sync() is idempotent: it changes only the months whose receipts or rate
moved, reversing the old journal and posting the new one. A month before the
current month keeps the rate it was first worked out with, so a rate change
applies from the current month on. A month whose accounting period is closed
is left as it is and reported (blocked_reason). bank_books.sync and project
money entries call safe_sync() so contributions follow receipts on their own.

The reserve is spent by office expense vouchers (project_entries, no project)
dated on or after the reserve's start date.
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import bank_books
from app.services.finance.general_ledger import GeneralLedgerError

logger = logging.getLogger(__name__)

SOURCE = "hq_reserve_contribution"
CONTRIBUTION, RECOVERED = "5970", "6990"
RECEIPT_ACCOUNTS = (bank_books.REVENUE, bank_books.RECEIVABLE)
RECEIPT_SOURCES = ("bank_statement_line", "project_money_entry", "bank_line_allocation")
CENT = Decimal("0.01")


def _d(value: Any) -> Decimal:
    return Decimal(str(value or 0))


def contribution_amount(receipts: Any, rate_pct: Any) -> Decimal:
    """Share of a month's receipts; nothing when the month nets to a refund."""
    amount = (_d(receipts) * _d(rate_pct) / Decimal(100)).quantize(CENT, rounding=ROUND_HALF_UP)
    return max(amount, Decimal("0"))


def _month(on: date) -> date:
    return on.replace(day=1)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

async def get_settings(db: AsyncSession, org_id: str) -> dict:
    row = (await db.execute(
        text("""SELECT is_active, default_rate_pct, starts_on, updated_at
                FROM finance.hq_reserve_settings WHERE organization_id = :org_id"""),
        {"org_id": org_id},
    )).mappings().first()
    if row:
        settings = dict(row)
    else:
        settings = {"is_active": False, "default_rate_pct": Decimal("0"), "starts_on": _month(date.today()),
                    "updated_at": None}
    settings["project_rates"] = [dict(r) for r in (await db.execute(
        text("""
            SELECT r.project_id, p.name AS project_name, r.rate_pct, r.note
            FROM finance.hq_reserve_project_rates r
            JOIN projects.projects p ON p.id = r.project_id
            WHERE r.organization_id = :org_id
            ORDER BY p.name
        """),
        {"org_id": org_id},
    )).mappings().all()]
    return settings


async def save_settings(db: AsyncSession, *, org_id: str, user_id: str, is_active: bool, default_rate_pct: Decimal,
                        starts_on: date, project_rates: list[dict], today: Optional[date] = None) -> dict:
    """Store the policy and the per-project overrides (the list replaces the
    previous overrides), then bring contributions in line with it."""
    seen: set[str] = set()
    for r in project_rates:
        key = str(r["project_id"])
        if key in seen:
            raise GeneralLedgerError("A project is listed twice in the overrides.", status_code=422)
        seen.add(key)
    if seen:
        found = (await db.execute(
            text("""SELECT count(*) FROM projects.projects
                    WHERE organization_id = :org_id AND id = ANY(:ids) AND is_deleted = false"""),
            {"org_id": org_id, "ids": [UUID(k) for k in seen]},
        )).scalar()
        if found != len(seen):
            raise GeneralLedgerError("An override names a project that was not found.", status_code=404)

    await db.execute(
        text("""
            INSERT INTO finance.hq_reserve_settings (organization_id, is_active, default_rate_pct, starts_on, updated_by)
            VALUES (:org_id, :active, :rate, :starts_on, :user_id)
            ON CONFLICT (organization_id) DO UPDATE
            SET is_active = EXCLUDED.is_active, default_rate_pct = EXCLUDED.default_rate_pct,
                starts_on = EXCLUDED.starts_on, updated_by = EXCLUDED.updated_by, updated_at = NOW()
        """),
        {"org_id": org_id, "active": is_active, "rate": default_rate_pct, "starts_on": starts_on, "user_id": user_id},
    )
    await db.execute(
        text("DELETE FROM finance.hq_reserve_project_rates WHERE organization_id = :org_id AND NOT (project_id = ANY(:ids))"),
        {"org_id": org_id, "ids": [UUID(k) for k in seen]},
    )
    for r in project_rates:
        await db.execute(
            text("""
                INSERT INTO finance.hq_reserve_project_rates (organization_id, project_id, rate_pct, note, updated_by)
                VALUES (:org_id, :project_id, :rate, :note, :user_id)
                ON CONFLICT (organization_id, project_id) DO UPDATE
                SET rate_pct = EXCLUDED.rate_pct, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()
            """),
            {"org_id": org_id, "project_id": r["project_id"], "rate": r["rate_pct"], "note": r.get("note"),
             "user_id": user_id},
        )
    return await sync(db, org_id=org_id, user_id=user_id, today=today)


# ---------------------------------------------------------------------------
# Contributions
# ---------------------------------------------------------------------------

async def project_receipts(db: AsyncSession, org_id: str, starts_on: date) -> dict[tuple[UUID, date], dict]:
    """Client receipts per (project, month) from the posted GL."""
    rows = await db.execute(
        text("""
            SELECT jl.project_id, date_trunc('month', je.entry_date)::date AS month,
                   sum(jl.credit_amount - jl.debit_amount) AS receipts, max(je.entry_date) AS last_date
            FROM finance.journal_entries je
            JOIN finance.journal_lines jl ON jl.journal_entry_id = je.id
            JOIN finance.chart_of_accounts a ON a.id = jl.account_id
            LEFT JOIN finance.journal_entries orig ON orig.id = je.reverses_journal_id
            WHERE je.organization_id = :org_id AND je.status = 'posted'
              AND COALESCE(orig.source_type, je.source_type) = ANY(:sources)
              AND a.account_code = ANY(:accounts) AND jl.project_id IS NOT NULL
              AND je.entry_date >= :starts_on
            GROUP BY 1, 2
        """),
        {"org_id": org_id, "sources": list(RECEIPT_SOURCES), "accounts": list(RECEIPT_ACCOUNTS), "starts_on": starts_on},
    )
    return {(r["project_id"], r["month"]): {"receipts": _d(r["receipts"]), "last_date": r["last_date"]}
            for r in rows.mappings().all()}


async def _tear_down(db: AsyncSession, org_id: str, user_id: str, row: dict, periods: dict) -> None:
    if row["gl_journal_id"]:
        await bank_books._reverse_journal(db, org_id=org_id, user_id=user_id, journal_id=row["gl_journal_id"],
                                          reason="HQ reserve contribution recalculated", periods=periods)
    await db.execute(text("DELETE FROM finance.cost_transactions WHERE source_type = :st AND source_id = :id"),
                     {"st": SOURCE, "id": row["id"]})


async def _post(db: AsyncSession, org_id: str, user_id: str, row_id: UUID, project_id: UUID, project_name: str,
                month: date, amount: Decimal, rate: Decimal, on: date, accounts: dict, periods: dict) -> UUID:
    detail = f"HQ office reserve {month:%b %Y}: {rate.normalize():f}% of {project_name} client receipts"
    lines = bank_books._resolve([
        {"code": CONTRIBUTION, "debit_amount": amount, "project_id": project_id, "description": detail},
        {"code": RECOVERED, "credit_amount": amount, "description": detail},
    ], accounts)
    journal_id = await bank_books._post_journal(
        db, org_id=org_id, user_id=user_id, entry_date=on, description=detail, lines=lines,
        source_type=SOURCE, source_id=row_id, periods=periods,
    )
    await db.execute(
        text("""
            INSERT INTO finance.cost_transactions (
                organization_id, project_id, source_type, source_id, cost_category, description,
                quantity, unit_cost, amount, transaction_date, status, posted_by, evidence_quality
            ) VALUES (:org_id, :project_id, :st, :id, 'overhead', :description, 1, :amount, :amount, :on, 'posted',
                      :user_id, 'B')
        """),
        {"org_id": org_id, "project_id": project_id, "st": SOURCE, "id": row_id, "description": detail[:500],
         "amount": amount, "on": on, "user_id": user_id},
    )
    return journal_id


async def _period_open(db: AsyncSession, org_id: str, on: date, periods: dict) -> Optional[str]:
    try:
        await bank_books._period_id(db, org_id, on, periods)
        return None
    except GeneralLedgerError as exc:
        return str(exc)


async def sync(db: AsyncSession, *, org_id: str, user_id: str, today: Optional[date] = None) -> dict:
    """Bring every project's monthly contribution in line with its receipts."""
    counts = {"posted": 0, "reversed": 0, "unchanged": 0, "blocked": 0}
    settings = await get_settings(db, org_id)
    if not settings["is_active"]:
        return counts
    this_month = _month(today or date.today())
    default_rate = _d(settings["default_rate_pct"])
    overrides = {r["project_id"]: _d(r["rate_pct"]) for r in settings["project_rates"]}
    receipts = await project_receipts(db, org_id, settings["starts_on"])
    existing = {(r["project_id"], r["month"]): dict(r) for r in (await db.execute(
        text("SELECT * FROM finance.hq_reserve_contributions WHERE organization_id = :org_id"), {"org_id": org_id},
    )).mappings().all()}
    keys = set(receipts) | set(existing)
    if not keys:
        return counts
    names = {r["id"]: r["name"] for r in (await db.execute(
        text("SELECT id, name FROM projects.projects WHERE id = ANY(:ids)"),
        {"ids": list({k[0] for k in keys})},
    )).mappings().all()}
    accounts = await bank_books._account_ids(db, org_id)
    periods: dict = {}

    for project_id, month in sorted(keys, key=lambda k: (k[1], str(k[0]))):
        got = receipts.get((project_id, month), {"receipts": Decimal("0"), "last_date": None})
        row = existing.get((project_id, month))
        if row and month < this_month:
            rate = _d(row["rate_pct"])
        else:
            rate = overrides.get(project_id, default_rate)
        amount = contribution_amount(got["receipts"], rate)
        posted_ok = amount == 0 or (row and row["gl_journal_id"])
        if row and _d(row["amount"]) == amount and _d(row["rate_pct"]) == rate and posted_ok:
            if _d(row["receipts"]) != got["receipts"] or row["blocked_reason"]:
                await db.execute(
                    text("""UPDATE finance.hq_reserve_contributions SET receipts = :r, blocked_reason = NULL,
                            updated_at = NOW() WHERE id = :id"""),
                    {"id": row["id"], "r": got["receipts"]},
                )
            counts["unchanged"] += 1
            continue
        if not row and amount == 0:
            if got["receipts"] != 0:
                # remember the rate (e.g. 0% while exempt) so a later rate
                # rise does not reach back into this month
                await db.execute(
                    text("""
                        INSERT INTO finance.hq_reserve_contributions
                            (organization_id, project_id, month, receipts, rate_pct, amount)
                        VALUES (:org_id, :p, :m, :r, :rate, 0)
                    """),
                    {"org_id": org_id, "p": project_id, "m": month, "r": got["receipts"], "rate": rate},
                )
                counts["unchanged"] += 1
            continue

        on = got["last_date"] or (row["entry_date"] if row else None)
        blocked = None
        if row and row["gl_journal_id"] and row["entry_date"]:
            blocked = await _period_open(db, org_id, row["entry_date"], periods)
        if not blocked and amount > 0:
            blocked = await _period_open(db, org_id, on, periods)
        if blocked:
            if row:
                await db.execute(
                    text("UPDATE finance.hq_reserve_contributions SET blocked_reason = :b, updated_at = NOW() WHERE id = :id"),
                    {"id": row["id"], "b": blocked[:500]},
                )
            else:
                await db.execute(
                    text("""
                        INSERT INTO finance.hq_reserve_contributions
                            (organization_id, project_id, month, receipts, rate_pct, amount, blocked_reason)
                        VALUES (:org_id, :p, :m, :r, :rate, 0, :b)
                    """),
                    {"org_id": org_id, "p": project_id, "m": month, "r": got["receipts"], "rate": rate, "b": blocked[:500]},
                )
            counts["blocked"] += 1
            continue

        if row:
            if row["gl_journal_id"]:
                counts["reversed"] += 1
            await _tear_down(db, org_id, user_id, row, periods)
            row_id = row["id"]
        else:
            row_id = (await db.execute(
                text("""
                    INSERT INTO finance.hq_reserve_contributions (organization_id, project_id, month, receipts, rate_pct, amount)
                    VALUES (:org_id, :p, :m, :r, :rate, 0) RETURNING id
                """),
                {"org_id": org_id, "p": project_id, "m": month, "r": got["receipts"], "rate": rate},
            )).scalar()
        journal_id = None
        if amount > 0:
            journal_id = await _post(db, org_id, user_id, row_id, project_id, names.get(project_id, "project"), month,
                                     amount, rate, on, accounts, periods)
            counts["posted"] += 1
        await db.execute(
            text("""
                UPDATE finance.hq_reserve_contributions
                SET receipts = :r, rate_pct = :rate, amount = :amount, entry_date = :on, gl_journal_id = :j,
                    blocked_reason = NULL, updated_at = NOW()
                WHERE id = :id
            """),
            {"id": row_id, "r": got["receipts"], "rate": rate, "amount": amount,
             "on": on if amount > 0 else None, "j": journal_id},
        )
    return counts


async def safe_sync(db: AsyncSession, *, org_id: str, user_id: str) -> Optional[dict]:
    """sync() for callers whose own work must not fail because of the reserve
    (bank imports, money entries): runs in a savepoint, logs and moves on."""
    try:
        async with db.begin_nested():
            return await sync(db, org_id=org_id, user_id=user_id)
    except Exception:  # noqa: BLE001 - the caller's books are already right; the reserve catches up on the next sync
        logger.exception("HQ reserve sync failed for org %s", org_id)
        return None


# ---------------------------------------------------------------------------
# What the reserve holds
# ---------------------------------------------------------------------------

async def overview(db: AsyncSession, *, org_id: str) -> dict:
    settings = await get_settings(db, org_id)
    starts_on = settings["starts_on"]
    contributions = [dict(r) for r in (await db.execute(
        text("""
            SELECT c.id, c.project_id, p.name AS project_name, c.month, c.receipts, c.rate_pct, c.amount,
                   c.entry_date, c.gl_journal_id, c.blocked_reason
            FROM finance.hq_reserve_contributions c
            JOIN projects.projects p ON p.id = c.project_id
            WHERE c.organization_id = :org_id
            ORDER BY c.month DESC, p.name
        """),
        {"org_id": org_id},
    )).mappings().all()]
    spent_by_month = {r["month"]: _d(r["amount"]) for r in (await db.execute(
        text("""
            SELECT date_trunc('month', entry_date)::date AS month, sum(amount) AS amount
            FROM finance.project_money_entries
            WHERE organization_id = :org_id AND project_id IS NULL AND NOT is_void AND direction = 'out'
              AND entry_date >= :starts_on
            GROUP BY 1
        """),
        {"org_id": org_id, "starts_on": starts_on},
    )).mappings().all()}

    by_project: dict[UUID, dict] = {}
    by_month: dict[date, dict] = {}
    for c in contributions:
        if not _d(c["amount"]) and not c["blocked_reason"]:
            continue   # a month that only records its rate (e.g. an exempt project)
        p = by_project.setdefault(c["project_id"], {"project_id": c["project_id"], "project_name": c["project_name"],
                                                    "receipts": Decimal("0"), "contributed": Decimal("0")})
        p["receipts"] += _d(c["receipts"])
        p["contributed"] += _d(c["amount"])
        m = by_month.setdefault(c["month"], {"month": c["month"], "receipts": Decimal("0"), "contributed": Decimal("0"),
                                             "spent": Decimal("0")})
        m["receipts"] += _d(c["receipts"])
        m["contributed"] += _d(c["amount"])
    for month, spent in spent_by_month.items():
        by_month.setdefault(month, {"month": month, "receipts": Decimal("0"), "contributed": Decimal("0"),
                                    "spent": Decimal("0")})["spent"] = spent

    contributed = sum((_d(c["amount"]) for c in contributions), Decimal("0"))
    spent = sum(spent_by_month.values(), Decimal("0"))
    return {
        "settings": settings,
        "totals": {"contributed": contributed, "spent": spent, "available": contributed - spent,
                   "blocked": sum(1 for c in contributions if c["blocked_reason"])},
        "by_project": sorted(by_project.values(), key=lambda p: -p["contributed"]),
        "by_month": sorted(by_month.values(), key=lambda m: m["month"], reverse=True),
        "contributions": contributions[:500],
    }
