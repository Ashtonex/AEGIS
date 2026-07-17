import json
from datetime import date
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok

router = APIRouter()


class ReportGenerate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    report_type: str = Field(min_length=1, max_length=80)
    project_id: Optional[UUID] = None
    start_date: date
    end_date: date
    format: Literal["pdf", "excel"] = "pdf"

    @model_validator(mode="after")
    def validate_period(self):
        if self.end_date < self.start_date:
            raise ValueError("Report end_date must be on or after start_date.")
        return self


async def _scalar(db: AsyncSession, query: str, params: dict[str, Any]) -> Any:
    """Return None when an optional operational source is not migrated yet."""
    try:
        return (await db.execute(text(query), params)).scalar()
    except Exception:
        await db.rollback()
        return None


async def _report_evidence_snapshot(
    db: AsyncSession, org_id: str, payload: ReportGenerate
) -> dict[str, Any]:
    params = {
        "org_id": org_id,
        "project_id": str(payload.project_id) if payload.project_id else None,
        "start_date": payload.start_date,
        "end_date": payload.end_date,
    }
    snapshot = {
        "report_type": payload.report_type,
        "period": {
            "start_date": payload.start_date.isoformat(),
            "end_date": payload.end_date.isoformat(),
        },
        "project_id": str(payload.project_id) if payload.project_id else None,
        "sources": {
            "daily_site_reports": await _scalar(
                db,
                """
                SELECT COUNT(*) FROM projects.daily_site_reports
                WHERE organization_id=:org_id
                  AND (:project_id IS NULL OR project_id::text = :project_id)
                  AND report_date BETWEEN :start_date AND :end_date
                  AND is_deleted=false
            """,
                params,
            ),
            "daily_report_labour_lines": await _scalar(
                db,
                """
                SELECT COUNT(*) FROM projects.daily_report_labour l
                JOIN projects.daily_site_reports r ON r.id=l.report_id AND r.organization_id=l.organization_id
                WHERE l.organization_id=:org_id
                  AND (:project_id IS NULL OR r.project_id::text = :project_id)
                  AND r.report_date BETWEEN :start_date AND :end_date
            """,
                params,
            ),
            "daily_report_equipment_lines": await _scalar(
                db,
                """
                SELECT COUNT(*) FROM projects.daily_report_equipment e
                JOIN projects.daily_site_reports r ON r.id=e.report_id AND r.organization_id=e.organization_id
                WHERE e.organization_id=:org_id
                  AND (:project_id IS NULL OR r.project_id::text = :project_id)
                  AND r.report_date BETWEEN :start_date AND :end_date
            """,
                params,
            ),
            "daily_report_material_lines": await _scalar(
                db,
                """
                SELECT COUNT(*) FROM projects.daily_report_materials m
                JOIN projects.daily_site_reports r ON r.id=m.report_id AND r.organization_id=m.organization_id
                WHERE m.organization_id=:org_id
                  AND (:project_id IS NULL OR r.project_id::text = :project_id)
                  AND r.report_date BETWEEN :start_date AND :end_date
            """,
                params,
            ),
            "purchase_orders": await _scalar(
                db,
                """
                SELECT COUNT(*) FROM procurement.purchase_orders
                WHERE organization_id=:org_id
                  AND (:project_id IS NULL OR project_id::text = :project_id)
                  AND created_at::date BETWEEN :start_date AND :end_date
                  AND is_deleted=false
            """,
                params,
            ),
            "supplier_invoices": await _scalar(
                db,
                """
                SELECT COUNT(*) FROM procurement.supplier_invoices
                WHERE organization_id=:org_id
                  AND (:project_id IS NULL OR project_id::text = :project_id)
                  AND invoice_date BETWEEN :start_date AND :end_date
                  AND is_deleted=false
            """,
                params,
            ),
            "cost_transactions": await _scalar(
                db,
                """
                SELECT COUNT(*) FROM finance.cost_transactions
                WHERE organization_id=:org_id
                  AND (:project_id IS NULL OR project_id::text = :project_id)
                  AND transaction_date BETWEEN :start_date AND :end_date
            """,
                params,
            ),
        },
    }
    snapshot["source_status"] = (
        "partial"
        if any(value is None for value in snapshot["sources"].values())
        else "complete"
    )
    return snapshot


@router.get("/available")
async def get_available_reports(
    user: dict = Depends(require_permission("automated_reports.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List report templates available to compile.
    """
    templates = [
        {
            "id": "dsr",
            "name": "Daily Site Summary",
            "category": "site",
            "desc": "Detailed breakdown of labour, materials and fleet deployment.",
        },
        {
            "id": "financial",
            "name": "Monthly Project Margin & EAC",
            "category": "finance",
            "desc": "Authoritative project cost vs budget variations.",
        },
        {
            "id": "plant-profit",
            "name": "Plant & Fleet Profitability",
            "category": "fleet",
            "desc": "Equipment operating costs, fuel consumption and profit.",
        },
        {
            "id": "workforce-prod",
            "name": "Workforce Attendance & Timesheets",
            "category": "workforce",
            "desc": "Labour deployment hours, overtime and cost codes.",
        },
        {
            "id": "compliance-gate",
            "name": "Statutory Compliance Audit Log",
            "category": "compliance",
            "desc": "Licence expiries, obligational filings and CAPA status.",
        },
    ]
    return ok(templates, "Available templates listed.")


@router.get("/scheduled")
async def get_scheduled_reports(
    user: dict = Depends(require_permission("automated_reports.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List cron scheduled automated reports.
    """
    result = await db.execute(
        text("""
        SELECT id, report_name, report_type, schedule_cron, created_at, updated_at
        FROM executive.automated_reports
        WHERE organization_id=:org_id AND is_deleted=false AND schedule_cron IS NOT NULL
        ORDER BY updated_at DESC
    """),
        {"org_id": user["org_id"]},
    )
    schedules = [dict(row._mapping) for row in result]
    return ok(schedules, "Scheduled report queues listed.")


@router.get("/recent")
async def get_recent_runs(
    limit: int = 50,
    user: dict = Depends(require_permission("automated_reports.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List historically compiled report outputs.
    """
    result = await db.execute(
        text("""
        SELECT * FROM executive.automated_reports
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT :limit
    """),
        {"org_id": user["org_id"], "limit": limit},
    )
    rows = [dict(row._mapping) for row in result]

    # Format database rows for the frontend expectation
    runs = []
    for r in rows:
        runs.append(
            {
                "id": r["id"],
                "report_name": r.get("report_name") or "Operational Report",
                "format": r.get("format") or "pdf",
                "project_name": r.get("project_name") or "All Projects",
                "created_at": r["created_at"],
                "status": r.get("status") or "completed",
                "file_path": r.get("file_path"),
                "evidence_snapshot": r.get("evidence_snapshot") or {},
                "source_status": (r.get("evidence_snapshot") or {}).get("source_status")
                if isinstance(r.get("evidence_snapshot"), dict)
                else None,
            }
        )

    return ok(runs, "Recent report runs listed.")


@router.post("/generate", status_code=status.HTTP_201_CREATED)
async def compile_report(
    payload: ReportGenerate,
    user: dict = Depends(require_permission("automated_reports.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Enqueue/Compile a new report run.
    """
    try:
        evidence_snapshot = await _report_evidence_snapshot(db, user["org_id"], payload)
        project_name = None
        if payload.project_id:
            project_name = await _scalar(
                db,
                """
                SELECT name FROM projects.projects
                WHERE id=:project_id AND organization_id=:org_id AND is_deleted=false
            """,
                {"project_id": payload.project_id, "org_id": user["org_id"]},
            )
            if project_name is None:
                raise HTTPException(status_code=404, detail="Project not found.")

        report_id = (
            await db.execute(
                text("""
            INSERT INTO executive.automated_reports (
                organization_id, created_by, report_type, report_name, format, status,
                project_id, project_name, start_date, end_date, evidence_snapshot, is_deleted
            ) VALUES (
                :org_id, :user_id, :report_type, :report_name, :format, 'completed',
                :project_id, :project_name, :start_date, :end_date, CAST(:evidence_snapshot AS jsonb), false
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "user_id": user["user_id"],
                    "report_type": payload.report_type,
                    "report_name": f"{payload.report_type.upper()} Report ({payload.start_date.isoformat()} to {payload.end_date.isoformat()})",
                    "format": payload.format,
                    "project_id": payload.project_id,
                    "project_name": project_name,
                    "start_date": payload.start_date,
                    "end_date": payload.end_date,
                    "evidence_snapshot": json.dumps(evidence_snapshot),
                },
            )
        ).scalar()
        await db.commit()
        return ok(
            {"id": str(report_id), "evidence_snapshot": evidence_snapshot},
            "Report generated successfully.",
        )
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{report_id}/approve")
async def publish_report(
    report_id: UUID,
    user: dict = Depends(require_permission("automated_reports.approve")),
    db: AsyncSession = Depends(get_db),
):
    """
    Approve report run and publish for distribution.
    """
    result = await db.execute(
        text("""
        UPDATE executive.automated_reports
        SET status = 'published', approved_by = :user_id, published_at = NOW(), updated_at = NOW()
        WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        RETURNING id
    """),
        {"id": report_id, "org_id": user["org_id"], "user_id": user["user_id"]},
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Report run not found.")
    await db.commit()
    return ok({"id": str(report_id)}, "Report published successfully.")
