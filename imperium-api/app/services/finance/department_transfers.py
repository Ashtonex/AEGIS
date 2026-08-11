"""
Internal department-transfer posting service.

The single place that writes to finance.department_transfers /
finance.department_transfer_legs, shared by fleet.py (internal plant hire)
and crm.py (Commercial-sourced referral credit) so both scenarios post
through one consistent, idempotent mechanism instead of two divergent
hand-rolled INSERTs.

A transfer is a header row plus two legs: a 'charge' leg on the paying
department and a 'credit' leg on the receiving department, always equal in
amount. Either department may be NULL - an unattributed transfer still
posts and stays visible (matching migration 077's "nothing silently
disappears" philosophy) rather than being skipped.
"""

import json
from datetime import date
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def post_department_transfer(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: Optional[str],
    transfer_type: str,
    transfer_date: date,
    from_department_id: Optional[UUID],
    to_department_id: Optional[UUID],
    amount: float,
    description: Optional[str] = None,
    source_type: Optional[str] = None,
    source_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    cost_category: Optional[str] = None,
    basis: Optional[dict[str, Any]] = None,
) -> Optional[UUID]:
    """Posts a balanced internal transfer. Returns the transfer id, or None
    if the call was a no-op (zero/negative amount, or the two departments
    are the same - a department cannot transfer to itself)."""
    if amount is None or amount <= 0:
        return None
    if from_department_id is not None and from_department_id == to_department_id:
        return None

    existing_id = None
    if source_id is not None:
        existing = await db.execute(
            text("""
                SELECT id FROM finance.department_transfers
                WHERE organization_id = :org_id AND source_type = :source_type
                  AND source_id = :source_id AND transfer_type = :transfer_type
                  AND status <> 'reversed'
            """),
            {"org_id": org_id, "source_type": source_type, "source_id": source_id, "transfer_type": transfer_type},
        )
        row = existing.first()
        existing_id = row.id if row else None

    seq_val = (await db.execute(text("SELECT NEXTVAL('finance.department_transfer_seq')"))).scalar()
    transfer_number = f"TRF-{transfer_date.strftime('%Y%m')}-{seq_val:03d}"

    if existing_id:
        transfer_id = existing_id
        await db.execute(
            text("""
                UPDATE finance.department_transfers
                SET transfer_date = :transfer_date, from_department_id = :from_dept,
                    to_department_id = :to_dept, amount = :amount, project_id = :project_id,
                    description = :description, basis = CAST(:basis AS jsonb),
                    posted_by = :user_id, posted_at = NOW()
                WHERE id = :id
            """),
            {
                "id": transfer_id,
                "transfer_date": transfer_date,
                "from_dept": from_department_id,
                "to_dept": to_department_id,
                "amount": amount,
                "project_id": project_id,
                "description": description,
                "basis": json.dumps(basis) if basis else None,
                "user_id": user_id,
            },
        )
        await db.execute(text("DELETE FROM finance.department_transfer_legs WHERE transfer_id = :id"), {"id": transfer_id})
    else:
        result = await db.execute(
            text("""
                INSERT INTO finance.department_transfers (
                    organization_id, transfer_number, transfer_type, transfer_date,
                    from_department_id, to_department_id, amount, project_id,
                    description, source_type, source_id, basis, status, posted_by, posted_at, created_by
                ) VALUES (
                    :org_id, :transfer_number, :transfer_type, :transfer_date,
                    :from_dept, :to_dept, :amount, :project_id,
                    :description, :source_type, :source_id, CAST(:basis AS jsonb), 'posted', :user_id, NOW(), :user_id
                ) RETURNING id
            """),
            {
                "org_id": org_id,
                "transfer_number": transfer_number,
                "transfer_type": transfer_type,
                "transfer_date": transfer_date,
                "from_dept": from_department_id,
                "to_dept": to_department_id,
                "amount": amount,
                "project_id": project_id,
                "description": description,
                "source_type": source_type,
                "source_id": source_id,
                "basis": json.dumps(basis) if basis else None,
                "user_id": user_id,
            },
        )
        transfer_id = result.scalar()

    # Charge leg always posts even when from_department_id is NULL - an
    # "unattributed" charge stays visible rather than being dropped.
    await db.execute(
        text("""
            INSERT INTO finance.department_transfer_legs (
                organization_id, transfer_id, department_id, leg_type, amount,
                project_id, cost_category, transfer_date
            ) VALUES (:org_id, :transfer_id, :dept_id, 'charge', :amount, :project_id, :cost_category, :transfer_date)
        """),
        {
            "org_id": org_id, "transfer_id": transfer_id, "dept_id": from_department_id,
            "amount": amount, "project_id": project_id, "cost_category": cost_category,
            "transfer_date": transfer_date,
        },
    )
    await db.execute(
        text("""
            INSERT INTO finance.department_transfer_legs (
                organization_id, transfer_id, department_id, leg_type, amount,
                project_id, cost_category, transfer_date
            ) VALUES (:org_id, :transfer_id, :dept_id, 'credit', :amount, :project_id, :cost_category, :transfer_date)
        """),
        {
            "org_id": org_id, "transfer_id": transfer_id, "dept_id": to_department_id,
            "amount": amount, "project_id": project_id, "cost_category": cost_category,
            "transfer_date": transfer_date,
        },
    )

    return transfer_id
