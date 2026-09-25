"""Guardrailed hard-delete for projects.projects.

projects.projects has 43 foreign keys pointing at it outside its own
CASCADE-owned sub-tables (sites, milestones, risks, changes, checks,
profile - those already cascade-delete at the database level, plus
compliance.deployment_requirements/finance.ccb_monitor_findings/
finance.project_forecasts). Most of those 43 already default to
NO ACTION/RESTRICT, so Postgres itself would refuse a bare DELETE if any
row remains - but a raw ForeignKeyViolation is a bad user-facing error.
find_project_blockers runs the same check up front so the caller can
report exactly what's linked and fall back to the existing soft-delete/
archive path instead of a confusing 500.

A project with none of these linked is treated as never having had real
activity (e.g. a still-dormant internal/production project like an
Internal Capital Project awaiting funding), so hard_delete_project wipes
it and its task stack outright rather than soft-deleting.
"""

from uuid import UUID
from typing import TypedDict

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# (schema.table, fk_column) for every non-CASCADE FK targeting projects.projects.
# Table/column names are fixed and hardcoded here, never user input.
PROJECT_LINKED_TABLES: list[tuple[str, str]] = [
    ("compliance.deployment_gate_checks", "project_id"),
    ("finance.boq_line_items", "project_id"),
    ("finance.commitments", "project_id"),
    ("finance.cost_transactions", "project_id"),
    ("finance.final_accounts", "project_id"),
    ("finance.progress_claims", "project_id"),
    ("finance.project_budgets", "project_id"),
    ("finance.receipt_allocations", "project_id"),
    ("finance.retention_ledger", "project_id"),
    ("finance.variations", "project_id"),
    ("hr.project_allocations", "project_id"),
    ("hr.timesheets", "project_id"),
    ("procurement.stock_ledger", "project_id"),
    ("projects.daily_site_reports", "project_id"),
    ("core.approval_instances", "project_id"),
    ("core.document_links", "project_id"),
    ("core.domain_events", "project_id"),
    ("crm.communication_events", "project_id"),
    ("crm.contacts", "project_id"),
    ("crm.opportunities", "project_id"),
    ("crm.support_tickets", "project_id"),
    ("crm.tenders", "project_id"),
    ("finance.bank_line_allocations", "project_id"),
    ("finance.bank_statement_lines", "project_id"),
    ("finance.budgets", "project_id"),
    ("finance.cashbook_transactions", "project_id"),
    ("finance.client_payment_requests", "project_id"),
    ("finance.department_transfer_legs", "project_id"),
    ("finance.department_transfers", "project_id"),
    ("finance.journal_lines", "project_id"),
    ("finance.payroll_items", "project_id"),
    ("finance.quotations", "project_id"),
    ("finance.statutory_liability_lines", "project_id"),
    ("finance.supplier_payment_items", "project_id"),
    ("finance.vendor_payment_requests", "project_id"),
    ("fleet.fleet", "current_project_id"),
    ("fleet.fleet_assignments", "project_id"),
    ("fleet.fuel_transactions", "project_id"),
    ("fleet.maintenance_work_orders", "project_id"),
    ("fleet.utilization_logs", "project_id"),
    ("hr.attendance_records", "project_id"),
    ("procurement.goods_received_notes", "project_id"),
    ("procurement.material_requests", "project_id"),
    ("procurement.purchase_orders", "project_id"),
    ("procurement.purchase_requisitions", "project_id"),
    ("procurement.rfqs", "project_id"),
    ("procurement.stores", "project_id"),
    ("procurement.supplier_invoices", "project_id"),
    ("projects.site_operations", "project_id"),
    ("takeoff.drawing_revisions", "project_id"),
]


class ProjectBlocker(TypedDict):
    table: str
    count: int


async def find_project_blockers(db: AsyncSession, project_id: UUID | str) -> list[ProjectBlocker]:
    """Returns every linked table that still has a row for this project.
    Empty list means the project has no real activity anywhere and is safe
    to hard-delete."""
    union_sql = " UNION ALL ".join(
        f"SELECT '{table}' AS tbl, count(*) AS cnt FROM {table} WHERE {column} = :project_id"  # nosec B608 - table/column drawn from the fixed PROJECT_LINKED_TABLES list above, never user input
        for table, column in PROJECT_LINKED_TABLES
    )
    result = await db.execute(text(union_sql), {"project_id": project_id})
    return [{"table": row.tbl, "count": row.cnt} for row in result if row.cnt > 0]


async def money_attached(db: AsyncSession, project_id: UUID | str) -> dict:
    """What money is tied to this project - shown before a delete so nobody
    archives a project without realising its bank lines, claims, costs and
    ledger entries will drop out of the Finance dashboard and project lists.
    (Archiving never deletes them: they stay in the bank records and the
    general ledger, just attached to a project nobody can see.)"""
    row = (await db.execute(
        text("""
            SELECT
              (SELECT count(*) FROM finance.bank_statement_lines WHERE project_id = :p) AS bank_lines,
              (SELECT COALESCE(sum(amount) FILTER (WHERE amount > 0), 0) FROM finance.bank_statement_lines WHERE project_id = :p) AS bank_in,
              (SELECT COALESCE(-sum(amount) FILTER (WHERE amount < 0), 0) FROM finance.bank_statement_lines WHERE project_id = :p) AS bank_out,
              (SELECT count(*) FROM finance.bank_line_allocations WHERE project_id = :p) AS split_parts,
              (SELECT COALESCE(sum(amount), 0) FROM finance.bank_line_allocations WHERE project_id = :p) AS split_amount,
              (SELECT count(*) FROM finance.progress_claims WHERE project_id = :p AND NOT is_deleted) AS claims,
              (SELECT COALESCE(sum(net_claim_amount) FILTER (WHERE status = 'paid'), 0)
                 FROM finance.progress_claims WHERE project_id = :p AND NOT is_deleted) AS collected,
              (SELECT count(*) FROM finance.cost_transactions WHERE project_id = :p) AS cost_entries,
              (SELECT COALESCE(sum(amount), 0) FROM finance.cost_transactions WHERE project_id = :p) AS actual_cost,
              (SELECT count(*) FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.id = jl.journal_entry_id
                 WHERE jl.project_id = :p AND je.status = 'posted'
                   -- a journal and its reversal cancel out: not money on the project
                   AND je.reversed_by_journal_id IS NULL AND je.journal_type <> 'reversal') AS ledger_lines,
              (SELECT COALESCE(sum(current_balance), 0) FROM finance.cash_accounts
                 WHERE project_id = :p AND is_petty_cash AND NOT is_deleted) AS petty_cash
        """),
        {"p": project_id},
    )).mappings().one()
    money = {k: (float(v) if not isinstance(v, int) else v) for k, v in row.items()}
    money["has_money"] = any(money[k] for k in ("bank_lines", "split_parts", "claims", "cost_entries", "ledger_lines", "petty_cash"))
    return money


async def hard_delete_project(db: AsyncSession, *, org_id: str, project_id: UUID | str) -> None:
    """Permanently wipes a project with no linked activity: its task stack
    (crm.tasks is polymorphically linked, no FK, so not covered by the
    CASCADE constraints) and the project row itself - whose own CASCADE FKs
    take care of sites/milestones/risks/changes/checks/profile and the
    compliance/finance forecast rows that own-cascade from it."""
    await db.execute(
        text("DELETE FROM crm.tasks WHERE organization_id = :org_id AND entity_type = 'project' AND entity_id = :project_id"),
        {"org_id": org_id, "project_id": project_id},
    )
    await db.execute(
        text("DELETE FROM projects.projects WHERE id = :project_id AND organization_id = :org_id"),
        {"project_id": project_id, "org_id": org_id},
    )
    await db.commit()
