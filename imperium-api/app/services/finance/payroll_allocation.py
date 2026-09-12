"""
Payroll item allocations — the multi-project percentage split for a single
employee's pay within a payroll run (finance.payroll_item_allocations,
migration 202).

finance.payroll_items carries exactly one nullable project_id/department_id
per row. This module lets Finance optionally split that one item's gross/net
pay across several projects (and/or HQ) by percentage, without changing the
payroll_items schema itself. An item with zero allocation rows is unaffected
- the GL bridge (gl_bridge.propose_journal_for_payroll_run) falls back to the
item's own project_id/department_id at 100% when no allocations exist.

Allocations are only editable while the parent run is 'draft' or 'approved'.
Once a run is 'posted', its GL journal has already captured whatever split
existed at that moment - changing allocations afterward would silently
invalidate a proposed/approved journal, so this is blocked (same principle
as Phase 1 period locking and Phase 5A budget freezing: corrections after
the fact happen via a new event, never a silent edit).
"""

from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.general_ledger import GeneralLedgerError

_LOCKED_STATUSES = ("posted", "cancelled")


async def _load_item_with_run(db: AsyncSession, org_id: str, payroll_item_id: UUID) -> dict:
    row = await db.execute(
        text("""
            SELECT pi.id, pi.gross_pay, pi.net_pay, pi.project_id, pi.department_id,
                   pr.id AS payroll_run_id, pr.status AS run_status
            FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id
            WHERE pi.id = :id AND pi.organization_id = :org_id
        """),
        {"id": payroll_item_id, "org_id": org_id},
    )
    item = row.mappings().first()
    if not item:
        raise GeneralLedgerError("Payroll item not found.", status_code=404)
    return dict(item)


async def get_allocations(db: AsyncSession, *, org_id: str, payroll_item_id: UUID) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT a.*, p.name AS project_name, d.name AS department_name
            FROM finance.payroll_item_allocations a
            LEFT JOIN projects.projects p ON p.id = a.project_id
            LEFT JOIN finance.departments d ON d.id = a.department_id
            WHERE a.organization_id = :org_id AND a.payroll_item_id = :item_id
            ORDER BY a.created_at
        """),
        {"org_id": org_id, "item_id": payroll_item_id},
    )
    return [dict(r._mapping) for r in rows]


async def list_run_allocations(db: AsyncSession, *, org_id: str, payroll_run_id: UUID) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT a.*, p.name AS project_name, d.name AS department_name
            FROM finance.payroll_item_allocations a
            JOIN finance.payroll_items pi ON pi.id = a.payroll_item_id
            LEFT JOIN projects.projects p ON p.id = a.project_id
            LEFT JOIN finance.departments d ON d.id = a.department_id
            WHERE a.organization_id = :org_id AND pi.payroll_run_id = :run_id
            ORDER BY a.payroll_item_id, a.created_at
        """),
        {"org_id": org_id, "run_id": payroll_run_id},
    )
    return [dict(r._mapping) for r in rows]


async def replace_allocations(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: str,
    payroll_item_id: UUID,
    allocations: list[dict],
) -> list[dict]:
    """allocations: list of {project_id, department_id, allocation_pct}."""
    item = await _load_item_with_run(db, org_id, payroll_item_id)
    if item["run_status"] in _LOCKED_STATUSES:
        raise GeneralLedgerError(
            f"Cannot change allocations on a payroll item whose run is '{item['run_status']}'.",
            status_code=409,
        )

    if not allocations:
        raise GeneralLedgerError("At least one allocation row is required.")

    total_pct = sum(Decimal(str(a["allocation_pct"])) for a in allocations)
    if abs(total_pct - Decimal("100")) > Decimal("0.01"):
        raise GeneralLedgerError(f"Allocation percentages must sum to 100 - got {total_pct}.")

    gross = Decimal(str(item["gross_pay"] or 0))
    net = Decimal(str(item["net_pay"] or 0))

    await db.execute(
        text("DELETE FROM finance.payroll_item_allocations WHERE organization_id = :org_id AND payroll_item_id = :item_id"),
        {"org_id": org_id, "item_id": payroll_item_id},
    )

    for alloc in allocations:
        pct = Decimal(str(alloc["allocation_pct"]))
        await db.execute(
            text("""
                INSERT INTO finance.payroll_item_allocations (
                    organization_id, payroll_item_id, project_id, department_id,
                    allocation_pct, allocated_gross, allocated_net, created_by
                ) VALUES (
                    :org_id, :item_id, :project_id, :department_id,
                    :pct, :allocated_gross, :allocated_net, :user_id
                )
            """),
            {
                "org_id": org_id,
                "item_id": payroll_item_id,
                "project_id": str(alloc["project_id"]) if alloc.get("project_id") else None,
                "department_id": str(alloc["department_id"]) if alloc.get("department_id") else None,
                "pct": pct,
                "allocated_gross": float((gross * pct / Decimal("100")).quantize(Decimal("0.01"))),
                "allocated_net": float((net * pct / Decimal("100")).quantize(Decimal("0.01"))),
                "user_id": user_id,
            },
        )

    return await get_allocations(db, org_id=org_id, payroll_item_id=payroll_item_id)
