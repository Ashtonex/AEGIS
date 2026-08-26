from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import get_current_user, require_permission
from app.shared.pagination import ok

router = APIRouter()


async def rows(db: AsyncSession, sql: str, params: dict) -> list[dict]:
    result = await db.execute(text(sql), params)
    return [dict(row._mapping) for row in result]


@router.get("/summary")
async def hr_operations_summary(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("hr.operations.read")),
):
    org_id = user["org_id"]
    today = date.today()
    expiry_window = today + timedelta(days=45)
    params = {"org_id": org_id, "today": today, "expiry_window": expiry_window}

    candidates = await rows(
        db,
        """
        SELECT rc.*, p.name AS project_name
        FROM hr.recruitment_candidates rc
        LEFT JOIN projects.projects p ON p.id = rc.project_id AND p.organization_id = rc.organization_id
        WHERE rc.organization_id = :org_id AND rc.is_deleted = false
        ORDER BY rc.created_at DESC
        LIMIT 100
        """,
        params,
    )
    onboarding = await rows(
        db,
        """
        SELECT ot.*, e.employee_name, rc.candidate_name
        FROM hr.onboarding_tasks ot
        LEFT JOIN hr.employees e ON e.id = ot.employee_id AND e.organization_id = ot.organization_id
        LEFT JOIN hr.recruitment_candidates rc ON rc.id = ot.candidate_id AND rc.organization_id = ot.organization_id
        WHERE ot.organization_id = :org_id AND ot.is_deleted = false
        ORDER BY ot.due_date NULLS LAST, ot.created_at DESC
        LIMIT 100
        """,
        params,
    )
    documents = await rows(
        db,
        """
        SELECT d.*, e.employee_name
        FROM hr.employee_documents d
        JOIN hr.employees e ON e.id = d.employee_id AND e.organization_id = d.organization_id
        WHERE d.organization_id = :org_id AND d.is_deleted = false
          AND (d.status IN ('missing', 'expired', 'expiring') OR d.expires_on <= :expiry_window)
        ORDER BY d.expires_on NULLS FIRST, d.created_at DESC
        LIMIT 100
        """,
        params,
    )
    medicals = await rows(
        db,
        """
        SELECT m.*, e.employee_name
        FROM hr.employee_medicals m
        JOIN hr.employees e ON e.id = m.employee_id AND e.organization_id = m.organization_id
        WHERE m.organization_id = :org_id AND m.is_deleted = false
          AND (m.status IN ('due', 'expired', 'failed') OR m.expires_on <= :expiry_window)
        ORDER BY m.expires_on NULLS FIRST, m.created_at DESC
        LIMIT 100
        """,
        params,
    )
    certifications = await rows(
        db,
        """
        SELECT c.*, e.employee_name
        FROM hr.employee_certifications c
        JOIN hr.employees e ON e.id = c.employee_id AND e.organization_id = c.organization_id
        WHERE c.organization_id = :org_id AND c.is_deleted = false
          AND (c.verification_status IN ('pending', 'expired', 'rejected') OR c.expires_on <= :expiry_window)
        ORDER BY c.expires_on NULLS FIRST, c.created_at DESC
        LIMIT 100
        """,
        params,
    )
    performance = await rows(
        db,
        """
        SELECT pr.*, e.employee_name
        FROM hr.employee_performance_reviews pr
        JOIN hr.employees e ON e.id = pr.employee_id AND e.organization_id = pr.organization_id
        WHERE pr.organization_id = :org_id AND pr.is_deleted = false
        ORDER BY pr.next_review_date NULLS FIRST, pr.created_at DESC
        LIMIT 100
        """,
        params,
    )
    discipline = await rows(
        db,
        """
        SELECT dr.*, e.employee_name
        FROM hr.employee_disciplinary_records dr
        JOIN hr.employees e ON e.id = dr.employee_id AND e.organization_id = dr.organization_id
        WHERE dr.organization_id = :org_id AND dr.is_deleted = false
        ORDER BY dr.incident_date DESC
        LIMIT 100
        """,
        params,
    )
    assets = await rows(
        db,
        """
        SELECT aa.*, e.employee_name
        FROM hr.employee_asset_assignments aa
        JOIN hr.employees e ON e.id = aa.employee_id AND e.organization_id = aa.organization_id
        WHERE aa.organization_id = :org_id AND aa.is_deleted = false
        ORDER BY aa.status, aa.due_back_on NULLS LAST, aa.issued_on DESC
        LIMIT 150
        """,
        params,
    )
    training = await rows(
        db,
        """
        SELECT
            tr.id, tr.role_name, tr.training_name, tr.mandatory, p.name AS project_name,
            COUNT(e.id) FILTER (WHERE e.is_deleted = false AND lower(COALESCE(e.job_title, '')) = lower(tr.role_name)) AS employees_in_role,
            COUNT(rec.id) FILTER (WHERE rec.status = 'completed' AND (rec.expires_on IS NULL OR rec.expires_on >= :today)) AS current_records
        FROM hr.training_requirements tr
        LEFT JOIN projects.projects p ON p.id = tr.project_id AND p.organization_id = tr.organization_id
        LEFT JOIN hr.employees e ON e.organization_id = tr.organization_id AND lower(COALESCE(e.job_title, '')) = lower(tr.role_name)
        LEFT JOIN hr.training_records rec ON rec.requirement_id = tr.id AND rec.organization_id = tr.organization_id AND rec.is_deleted = false
        WHERE tr.organization_id = :org_id AND tr.is_deleted = false
        GROUP BY tr.id, p.name
        ORDER BY tr.role_name, tr.training_name
        LIMIT 150
        """,
        params,
    )
    org_chart = await rows(
        db,
        """
        SELECT rl.*, e.employee_name, e.job_title, m.employee_name AS manager_name, m.job_title AS manager_job_title
        FROM hr.reporting_lines rl
        JOIN hr.employees e ON e.id = rl.employee_id AND e.organization_id = rl.organization_id
        LEFT JOIN hr.employees m ON m.id = rl.manager_employee_id AND m.organization_id = rl.organization_id
        WHERE rl.organization_id = :org_id AND rl.is_deleted = false
          AND (rl.effective_to IS NULL OR rl.effective_to >= :today)
        ORDER BY m.employee_name NULLS FIRST, e.employee_name
        LIMIT 250
        """,
        params,
    )
    workforce_plans = await rows(
        db,
        """
        SELECT wp.*, p.name AS project_name,
               COALESCE(a.assigned_count, 0) AS assigned_count,
               GREATEST(wp.required_headcount - COALESCE(a.assigned_count, 0), 0) AS shortfall
        FROM hr.workforce_plans wp
        LEFT JOIN projects.projects p ON p.id = wp.project_id AND p.organization_id = wp.organization_id
        LEFT JOIN LATERAL (
            SELECT COUNT(*) AS assigned_count
            FROM hr.project_allocations pa
            JOIN hr.employees e ON e.id = pa.employee_id AND e.organization_id = pa.organization_id
            WHERE pa.organization_id = wp.organization_id
              AND pa.project_id IS NOT DISTINCT FROM wp.project_id
              AND pa.is_deleted = false
              AND pa.status IN ('planned', 'active')
              AND lower(COALESCE(pa.role_on_project, e.job_title, '')) = lower(wp.role_name)
        ) a ON true
        WHERE wp.organization_id = :org_id AND wp.is_deleted = false
        ORDER BY shortfall DESC, wp.planned_start NULLS LAST
        LIMIT 150
        """,
        params,
    )
    payroll_adjustments = await rows(
        db,
        """
        SELECT pa.*, e.employee_name
        FROM hr.payroll_adjustments pa
        JOIN hr.employees e ON e.id = pa.employee_id AND e.organization_id = pa.organization_id
        WHERE pa.organization_id = :org_id AND pa.is_deleted = false
        ORDER BY pa.status, pa.effective_from DESC
        LIMIT 150
        """,
        params,
    )
    leave_calendar = await rows(
        db,
        """
        SELECT lr.id, lr.leave_type, lr.start_date, lr.end_date, lr.days_requested, lr.status,
               lr.calendar_status, COALESCE(lr.calendar_title, e.employee_name || ' - ' || lr.leave_type) AS title,
               e.employee_name
        FROM hr.leave_requests lr
        JOIN hr.employees e ON e.id = lr.employee_id AND e.organization_id = lr.organization_id
        WHERE lr.organization_id = :org_id AND lr.is_deleted = false
          AND lr.start_date <= (:today + INTERVAL '90 days') AND lr.end_date >= (:today - INTERVAL '30 days')
        ORDER BY lr.start_date, e.employee_name
        """,
        params,
    )

    metrics = {
        "open_candidates": sum(1 for item in candidates if item.get("stage") not in ("hired", "rejected", "withdrawn")),
        "open_onboarding": sum(1 for item in onboarding if item.get("status") not in ("done", "cancelled")),
        "document_alerts": len(documents),
        "medical_alerts": len(medicals),
        "certification_alerts": len(certifications),
        "open_discipline": sum(1 for item in discipline if item.get("status") not in ("resolved", "closed")),
        "issued_assets": sum(1 for item in assets if item.get("status") == "issued"),
        "workforce_shortfalls": sum(1 for item in workforce_plans if (item.get("shortfall") or 0) > 0),
        "active_payroll_adjustments": sum(1 for item in payroll_adjustments if item.get("status") == "active"),
        "pending_leave": sum(1 for item in leave_calendar if item.get("status") == "pending"),
    }

    return ok(
        {
            "metrics": metrics,
            "recruitment": candidates,
            "onboarding": onboarding,
            "documents": documents,
            "medicals": medicals,
            "certifications": certifications,
            "performance": performance,
            "discipline": discipline,
            "assets": assets,
            "training": training,
            "org_chart": org_chart,
            "workforce_plans": workforce_plans,
            "payroll_adjustments": payroll_adjustments,
            "leave_calendar": leave_calendar,
        },
        "HR operating summary loaded.",
    )


@router.get("/leave-calendar")
async def leave_calendar(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("hr.leave.read")),
):
    start = date_from or (date.today() - timedelta(days=30))
    end = date_to or (date.today() + timedelta(days=90))
    data = await rows(
        db,
        """
        SELECT lr.id, lr.leave_type, lr.start_date, lr.end_date, lr.days_requested, lr.status,
               lr.calendar_status, COALESCE(lr.calendar_title, e.employee_name || ' - ' || lr.leave_type) AS title,
               e.employee_name, e.department
        FROM hr.leave_requests lr
        JOIN hr.employees e ON e.id = lr.employee_id AND e.organization_id = lr.organization_id
        WHERE lr.organization_id = :org_id AND lr.is_deleted = false
          AND lr.start_date <= :date_to AND lr.end_date >= :date_from
        ORDER BY lr.start_date, e.employee_name
        """,
        {"org_id": user["org_id"], "date_from": start, "date_to": end},
    )
    return ok(data, "Leave calendar loaded.")
