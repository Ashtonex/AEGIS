import json
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import get_current_user, require_permission
from app.shared.pagination import ok
from app.services.hr.recruitment_assessments import (
    ASSESSMENTS,
    DIMENSIONS,
    AssessmentImportError,
    parse_forms_export,
)

MAX_ASSESSMENT_EXPORT_BYTES = 5 * 1024 * 1024

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
    leave_window_start = today - timedelta(days=30)
    leave_window_end = today + timedelta(days=90)
    params = {
        "org_id": org_id,
        "today": today,
        "expiry_window": expiry_window,
        "leave_window_start": leave_window_start,
        "leave_window_end": leave_window_end,
    }

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
          AND lr.start_date <= :leave_window_end AND lr.end_date >= :leave_window_start
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


@router.get("/assessments")
async def list_recruitment_assessments(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("hr.operations.read")),
):
    """Scored Microsoft Forms assessments, one row per submission, best first per role."""
    data = await rows(
        db,
        """
        SELECT ra.id, ra.candidate_id, ra.assessment_code, ra.role_applied_for, ra.candidate_name,
               ra.email, ra.phone, ra.submitted_at, ra.objective_score, ra.objective_max,
               ra.dimension_scores, ra.overall_score, ra.unanswered_count, ra.verdict, ra.created_at,
               rc.stage
        FROM hr.recruitment_assessments ra
        JOIN hr.recruitment_candidates rc ON rc.id = ra.candidate_id AND rc.organization_id = ra.organization_id
        WHERE ra.organization_id = :org_id AND ra.is_deleted = false AND rc.is_deleted = false
        ORDER BY ra.role_applied_for, ra.overall_score DESC, ra.submitted_at
        """,
        {"org_id": user["org_id"]},
    )
    catalog = [
        {"code": a.code, "title": a.title, "role": a.role, "minutes": a.minutes,
         "sections": [s.name for s in a.sections] or list(DIMENSIONS)}
        for a in ASSESSMENTS.values()
    ]
    return ok({"assessments": data, "catalog": catalog, "dimensions": list(DIMENSIONS)}, "Recruitment assessments loaded.")


@router.post("/assessments/import")
async def import_recruitment_assessments(
    file: UploadFile = File(...),
    assessment_code: str = Form(...),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("hr.operations.create")),
):
    """Score a Microsoft Forms 'Open in Excel' export and file each response
    against a recruitment candidate (matched by email, else created)."""
    definition = ASSESSMENTS.get(assessment_code)
    if definition is None:
        raise HTTPException(status_code=422, detail=f"Unknown assessment '{assessment_code}'.")
    content = await file.read()
    if len(content) > MAX_ASSESSMENT_EXPORT_BYTES:
        raise HTTPException(status_code=413, detail="The export is larger than 5 MB.")
    try:
        responses = parse_forms_export(assessment_code, content)
    except AssessmentImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    org_id = user["org_id"]
    user_id = user.get("user_id")
    results = []
    created_candidates = updated_candidates = new_assessments = rescored = 0

    for resp in responses:
        existing = (await db.execute(
            text("""
                SELECT id, candidate_id FROM hr.recruitment_assessments
                WHERE organization_id = :org_id AND assessment_code = :code AND response_ref = :ref
            """),
            {"org_id": org_id, "code": assessment_code, "ref": resp.response_ref},
        )).first()

        candidate_id = existing.candidate_id if existing else None
        if candidate_id is None:
            match = None
            if resp.email:
                match = (await db.execute(
                    text("""
                        SELECT id FROM hr.recruitment_candidates
                        WHERE organization_id = :org_id AND is_deleted = false AND lower(email) = :email
                        ORDER BY created_at LIMIT 1
                    """),
                    {"org_id": org_id, "email": resp.email},
                )).first()
            if match is None:
                match = (await db.execute(
                    text("""
                        SELECT id FROM hr.recruitment_candidates
                        WHERE organization_id = :org_id AND is_deleted = false
                          AND lower(candidate_name) = lower(:name) AND role_applied_for = :role
                        ORDER BY created_at LIMIT 1
                    """),
                    {"org_id": org_id, "name": resp.candidate_name, "role": definition.role},
                )).first()
            if match is not None:
                candidate_id = match.id
                await db.execute(
                    text("""
                        UPDATE hr.recruitment_candidates
                        SET email = COALESCE(email, :email), phone = COALESCE(phone, :phone),
                            stage = CASE WHEN stage = 'applied' THEN 'screening' ELSE stage END,
                            updated_at = NOW()
                        WHERE id = :id AND organization_id = :org_id
                    """),
                    {"email": resp.email, "phone": resp.phone, "id": candidate_id, "org_id": org_id},
                )
                updated_candidates += 1
            else:
                candidate_id = (await db.execute(
                    text("""
                        INSERT INTO hr.recruitment_candidates
                            (organization_id, candidate_name, role_applied_for, stage, source,
                             email, phone, notes, created_by)
                        VALUES (:org_id, :name, :role, 'screening', 'Microsoft Forms assessment',
                                :email, :phone, :notes, :user_id)
                        RETURNING id
                    """),
                    {
                        "org_id": org_id, "name": resp.candidate_name, "role": definition.role,
                        "email": resp.email, "phone": resp.phone,
                        "notes": f"Created from {definition.title} import.", "user_id": user_id,
                    },
                )).scalar_one()
                created_candidates += 1

        params = {
            "org_id": org_id, "candidate_id": candidate_id, "code": assessment_code,
            "role": definition.role, "ref": resp.response_ref, "name": resp.candidate_name,
            "email": resp.email, "phone": resp.phone, "submitted_at": resp.submitted_at,
            "answers": json.dumps(resp.answers), "points": json.dumps(resp.question_points),
            "objective": resp.objective_score, "objective_max": resp.objective_max,
            "dimensions": json.dumps(resp.dimension_scores), "overall": resp.overall_score,
            "unanswered": resp.unanswered_count, "verdict": resp.verdict, "file_name": (file.filename or "")[:255] or None,
            "user_id": user_id,
        }
        if existing:
            await db.execute(
                text("""
                    UPDATE hr.recruitment_assessments
                    SET answers = CAST(:answers AS jsonb), question_points = CAST(:points AS jsonb),
                        objective_score = :objective, objective_max = :objective_max,
                        dimension_scores = CAST(:dimensions AS jsonb), overall_score = :overall,
                        unanswered_count = :unanswered, verdict = :verdict, source_file_name = :file_name,
                        imported_by = :user_id, is_deleted = false, updated_at = NOW()
                    WHERE id = :id
                """),
                {**{k: params[k] for k in ("answers", "points", "objective", "objective_max", "dimensions",
                                           "overall", "unanswered", "verdict", "file_name", "user_id")}, "id": existing.id},
            )
            rescored += 1
        else:
            await db.execute(
                text("""
                    INSERT INTO hr.recruitment_assessments
                        (organization_id, candidate_id, assessment_code, role_applied_for, response_ref,
                         candidate_name, email, phone, submitted_at, answers, question_points,
                         objective_score, objective_max, dimension_scores, overall_score,
                         unanswered_count, verdict, source_file_name, imported_by)
                    VALUES (:org_id, :candidate_id, :code, :role, :ref, :name, :email, :phone, :submitted_at,
                            CAST(:answers AS jsonb), CAST(:points AS jsonb), :objective, :objective_max,
                            CAST(:dimensions AS jsonb), :overall, :unanswered, :verdict, :file_name, :user_id)
                """),
                params,
            )
            new_assessments += 1
        results.append({
            "candidate_name": resp.candidate_name,
            "email": resp.email,
            "overall_score": resp.overall_score,
            "objective_score": resp.objective_score,
            "dimension_scores": resp.dimension_scores,
            "verdict": resp.verdict,
            "warnings": resp.warnings,
        })

    await db.commit()
    return ok(
        {
            "assessment": definition.title,
            "responses": len(responses),
            "new_assessments": new_assessments,
            "rescored": rescored,
            "candidates_created": created_candidates,
            "candidates_matched": updated_candidates,
            "results": results,
        },
        f"Scored {len(responses)} response(s) from {definition.title}.",
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
