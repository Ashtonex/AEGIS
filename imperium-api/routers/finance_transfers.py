from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok, page_offset, paginated
from app.services.finance.department_transfers import post_department_transfer

router = APIRouter()


class TransferCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    transfer_type: str = Field(min_length=1, max_length=40)
    transfer_date: date
    from_department_id: Optional[UUID] = None
    to_department_id: Optional[UUID] = None
    amount: float = Field(gt=0)
    description: Optional[str] = None
    project_id: Optional[UUID] = None
    cost_category: Optional[str] = Field(default=None, max_length=40)


class TransferRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    rule_code: str = Field(min_length=1, max_length=60)
    transfer_type: str = Field(min_length=1, max_length=40)
    from_department_id: Optional[UUID] = None
    to_department_id: Optional[UUID] = None
    basis: str = Field(min_length=1, max_length=30)
    rate: Optional[float] = None
    fixed_amount: Optional[float] = None
    trigger_event: str = Field(min_length=1, max_length=40)
    effective_from: date
    effective_to: Optional[date] = None
    is_active: bool = True


class TransferRuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    rate: Optional[float] = None
    fixed_amount: Optional[float] = None
    effective_to: Optional[date] = None
    is_active: Optional[bool] = None


@router.get("/")
async def list_transfers(
    department_id: Optional[UUID] = None,
    transfer_type: Optional[str] = None,
    project_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(require_permission("finance.transfer.read")),
    db: AsyncSession = Depends(get_db),
):
    """List internal department transfers, optionally filtered by
    department (either side), type, project, status or date range."""
    limit, offset = page_offset(page, page_size)
    filters = ["t.organization_id = :org_id", "t.is_deleted = false"]
    params: dict = {"org_id": user["org_id"], "limit": limit, "offset": offset}

    if department_id:
        filters.append("(t.from_department_id = :department_id OR t.to_department_id = :department_id)")
        params["department_id"] = department_id
    if transfer_type:
        filters.append("t.transfer_type = :transfer_type")
        params["transfer_type"] = transfer_type
    if project_id:
        filters.append("t.project_id = :project_id")
        params["project_id"] = project_id
    if status_filter:
        filters.append("t.status = :status")
        params["status"] = status_filter
    if date_from:
        filters.append("t.transfer_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("t.transfer_date <= :date_to")
        params["date_to"] = date_to

    where = " AND ".join(filters)
    count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}

    total = (await db.execute(text(f"SELECT COUNT(*) FROM finance.department_transfers t WHERE {where}"), count_params)).scalar() or 0

    rows = await db.execute(
        text(f"""
            SELECT t.*, fd.name AS from_department_name, td.name AS to_department_name, p.name AS project_name
            FROM finance.department_transfers t
            LEFT JOIN finance.departments fd ON fd.id = t.from_department_id
            LEFT JOIN finance.departments td ON td.id = t.to_department_id
            LEFT JOIN projects.projects p ON p.id = t.project_id
            WHERE {where}
            ORDER BY t.transfer_date DESC, t.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = [dict(r._mapping) for r in rows]
    return paginated(items, total=total, page=page, page_size=page_size, message="Department transfers listed.")


@router.get("/summary")
async def transfer_summary(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    user: dict = Depends(require_permission("finance.transfer.read")),
    db: AsyncSession = Depends(get_db),
):
    """Per-department transfers in / out / net for a period."""
    filters = ["l.organization_id = :org_id", "t.status = 'posted'"]
    params: dict = {"org_id": user["org_id"]}
    if date_from:
        filters.append("l.transfer_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("l.transfer_date <= :date_to")
        params["date_to"] = date_to
    where = " AND ".join(filters)

    rows = await db.execute(
        text(f"""
            SELECT
                d.id AS department_id, d.name AS department_name,
                COALESCE(SUM(l.amount) FILTER (WHERE l.leg_type = 'credit'), 0) AS transfers_in,
                COALESCE(SUM(l.amount) FILTER (WHERE l.leg_type = 'charge'), 0) AS transfers_out
            FROM finance.departments d
            LEFT JOIN finance.department_transfer_legs l
                ON l.department_id = d.id
                AND l.transfer_id IN (SELECT id FROM finance.department_transfers t WHERE {where})
            WHERE d.organization_id = :org_id AND d.is_deleted = false
            GROUP BY d.id, d.name
            ORDER BY d.name
        """),
        params,
    )
    items = []
    for r in rows:
        row = dict(r._mapping)
        row["net"] = float(row["transfers_in"]) - float(row["transfers_out"])
        items.append(row)
    return ok(items, "Transfer summary retrieved.")


@router.get("/rules")
async def list_transfer_rules(
    user: dict = Depends(require_permission("finance.transfer.rule.manage")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            SELECT r.*, fd.name AS from_department_name, td.name AS to_department_name
            FROM finance.department_transfer_rules r
            LEFT JOIN finance.departments fd ON fd.id = r.from_department_id
            LEFT JOIN finance.departments td ON td.id = r.to_department_id
            WHERE r.organization_id = :org_id AND r.is_deleted = false
            ORDER BY r.created_at DESC
        """),
        {"org_id": user["org_id"]},
    )
    return ok([dict(r._mapping) for r in result], "Transfer rules listed.")


@router.post("/rules", status_code=status.HTTP_201_CREATED)
async def create_transfer_rule(
    payload: TransferRuleCreate,
    user: dict = Depends(require_permission("finance.transfer.rule.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        rule_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.department_transfer_rules (
                        organization_id, rule_code, transfer_type, from_department_id, to_department_id,
                        basis, rate, fixed_amount, trigger_event, effective_from, effective_to, is_active, created_by
                    ) VALUES (
                        :org_id, :rule_code, :transfer_type, :from_dept, :to_dept,
                        :basis, :rate, :fixed_amount, :trigger_event, :effective_from, :effective_to, :is_active, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "rule_code": payload.rule_code,
                    "transfer_type": payload.transfer_type,
                    "from_dept": payload.from_department_id,
                    "to_dept": payload.to_department_id,
                    "basis": payload.basis,
                    "rate": payload.rate,
                    "fixed_amount": payload.fixed_amount,
                    "trigger_event": payload.trigger_event,
                    "effective_from": payload.effective_from,
                    "effective_to": payload.effective_to,
                    "is_active": payload.is_active,
                    "user_id": user["sub"],
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(rule_id)}, "Transfer rule created.")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Rule code already exists or is invalid.") from exc


@router.patch("/rules/{rule_id}")
async def update_transfer_rule(
    rule_id: UUID,
    payload: TransferRuleUpdate,
    user: dict = Depends(require_permission("finance.transfer.rule.manage")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return ok({"id": str(rule_id)}, "No fields to update.")
    set_clause = ", ".join(f"{k} = :{k}" for k in values)
    result = await db.execute(
        text(f"""
            UPDATE finance.department_transfer_rules
            SET {set_clause}, updated_at = NOW()
            WHERE id = :rule_id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {**values, "rule_id": rule_id, "org_id": user["org_id"]},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Transfer rule not found.")
    await db.commit()
    return ok({"id": str(rule_id)}, "Transfer rule updated.")


@router.get("/{transfer_id}")
async def get_transfer(
    transfer_id: UUID,
    user: dict = Depends(require_permission("finance.transfer.read")),
    db: AsyncSession = Depends(get_db),
):
    header = await db.execute(
        text("""
            SELECT t.*, fd.name AS from_department_name, td.name AS to_department_name
            FROM finance.department_transfers t
            LEFT JOIN finance.departments fd ON fd.id = t.from_department_id
            LEFT JOIN finance.departments td ON td.id = t.to_department_id
            WHERE t.id = :id AND t.organization_id = :org_id AND t.is_deleted = false
        """),
        {"id": transfer_id, "org_id": user["org_id"]},
    )
    row = header.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Transfer not found.")

    legs = await db.execute(
        text("""
            SELECT l.*, d.name AS department_name
            FROM finance.department_transfer_legs l
            LEFT JOIN finance.departments d ON d.id = l.department_id
            WHERE l.transfer_id = :id
        """),
        {"id": transfer_id},
    )
    return ok({"transfer": dict(row), "legs": [dict(r._mapping) for r in legs]}, "Transfer retrieved.")


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_transfer(
    payload: TransferCreate,
    user: dict = Depends(require_permission("finance.transfer.create")),
    db: AsyncSession = Depends(get_db),
):
    """The manual 'make an internal transfer' action."""
    transfer_id = await post_department_transfer(
        db,
        org_id=user["org_id"],
        user_id=user["sub"],
        transfer_type=payload.transfer_type,
        transfer_date=payload.transfer_date,
        from_department_id=payload.from_department_id,
        to_department_id=payload.to_department_id,
        amount=payload.amount,
        description=payload.description,
        source_type="manual",
        source_id=None,
        project_id=payload.project_id,
        cost_category=payload.cost_category,
    )
    if not transfer_id:
        raise HTTPException(status_code=422, detail="Transfer amount must be positive and departments must differ.")
    await db.commit()
    return ok({"id": str(transfer_id)}, "Internal transfer posted.")


@router.post("/{transfer_id}/reverse")
async def reverse_transfer(
    transfer_id: UUID,
    user: dict = Depends(require_permission("finance.transfer.reverse")),
    db: AsyncSession = Depends(get_db),
):
    original = await db.execute(
        text("""
            SELECT * FROM finance.department_transfers
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false AND status = 'posted'
        """),
        {"id": transfer_id, "org_id": user["org_id"]},
    )
    original = original.mappings().first()
    if not original:
        raise HTTPException(status_code=404, detail="Posted transfer not found.")

    reversal_id = await post_department_transfer(
        db,
        org_id=user["org_id"],
        user_id=user["sub"],
        transfer_type=original["transfer_type"],
        transfer_date=date.today(),
        from_department_id=original["to_department_id"],
        to_department_id=original["from_department_id"],
        amount=float(original["amount"]),
        description=f"Reversal of {original['transfer_number']}",
        source_type="department_transfer_reversal",
        source_id=transfer_id,
        project_id=original["project_id"],
    )
    if not reversal_id:
        raise HTTPException(status_code=422, detail="Cannot reverse this transfer.")

    await db.execute(
        text("UPDATE finance.department_transfers SET reversal_of_id = :orig_id WHERE id = :id"),
        {"orig_id": transfer_id, "id": reversal_id},
    )
    await db.execute(
        text("UPDATE finance.department_transfers SET status = 'reversed' WHERE id = :id"),
        {"id": transfer_id},
    )
    await db.commit()
    return ok({"id": str(reversal_id)}, "Transfer reversed.")
