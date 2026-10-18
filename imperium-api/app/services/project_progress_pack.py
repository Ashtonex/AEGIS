"""
Controlled Drawings, Progress Photo Diary, and Consolidated Client Progress Pack Service
Delivers verified executive commercial-control and operations progress pack compiling:
- Schedule CPM & Critical Path status
- Quality concrete pour cards & mobile snag sign-offs
- Plant allocation, utilization rate & fuel burn rate
- Subcontractor packages, certified valuations & retention ledger
- Contractual delay events, notice compliance & EOT determinations
- Controlled drawing register & site photo diary
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional, Dict, Any, List
from uuid import UUID
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException
import json

from app.services.project_plant import get_project_plant_analytics
from app.services.project_delays_eot import list_project_delays, list_project_eot_claims


# ---------------------------------------------------------------------------
# Controlled Drawings
# ---------------------------------------------------------------------------

async def list_project_drawings(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
) -> List[Dict[str, Any]]:
    rows = (
        await db.execute(
            text("""
                SELECT 
                    d.id,
                    d.drawing_number,
                    d.title,
                    d.discipline,
                    d.current_revision,
                    d.ifc_status,
                    d.date_received,
                    d.file_url,
                    d.superseded_history,
                    d.distribution_list,
                    d.created_at,
                    u.full_name AS created_by_name
                FROM projects.controlled_drawings d
                LEFT JOIN core.users u ON u.id = d.created_by
                WHERE d.project_id = CAST(:project_id AS uuid)
                  AND d.organization_id = CAST(:org_id AS uuid)
                  AND d.is_deleted = false
                ORDER BY d.drawing_number ASC
            """),
            {"project_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    results = []
    for r in rows:
        item = dict(r)
        item["id"] = str(item["id"])
        item["date_received"] = item["date_received"].isoformat() if item["date_received"] else None
        item["created_at"] = item["created_at"].isoformat() if item["created_at"] else None
        results.append(item)
    return results


async def record_controlled_drawing(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
    user_id: UUID,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    drawing_num = payload["drawing_number"].strip()
    received_date = payload.get("date_received") or date.today()
    if isinstance(received_date, str):
        received_date = date.fromisoformat(received_date)

    # Check if exists
    existing = (
        await db.execute(
            text("""
                SELECT id, current_revision, date_received, file_url, superseded_history
                FROM projects.controlled_drawings
                WHERE project_id = CAST(:p_id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND drawing_number = :num
                  AND is_deleted = false
            """),
            {"p_id": str(project_id), "org_id": str(org_id), "num": drawing_num},
        )
    ).first()

    if existing:
        # Drawing revision update: archive old revision to superseded_history
        old_id, old_rev, old_date, old_url, history = existing
        history_list = list(history) if history else []
        history_list.append({
            "revision": old_rev,
            "superseded_date": date.today().isoformat(),
            "date_received": old_date.isoformat() if old_date else None,
            "file_url": old_url,
        })

        await db.execute(
            text("""
                UPDATE projects.controlled_drawings SET
                    title = :title,
                    discipline = :discipline,
                    current_revision = :revision,
                    ifc_status = :ifc_status,
                    date_received = :date_received,
                    file_url = COALESCE(:file_url, file_url),
                    superseded_history = CAST(:history AS jsonb),
                    updated_at = NOW()
                WHERE id = CAST(:id AS uuid)
            """),
            {
                "id": str(old_id),
                "title": payload["title"],
                "discipline": payload["discipline"],
                "revision": payload.get("current_revision", "Rev B"),
                "ifc_status": payload.get("ifc_status", "issued_for_construction"),
                "date_received": received_date,
                "file_url": payload.get("file_url"),
                "history": json.dumps(history_list),
            },
        )
        await db.commit()
        return {"id": str(old_id), "action": "revised", "superseded_revisions": len(history_list)}

    # New drawing insert
    row = (
        await db.execute(
            text("""
                INSERT INTO projects.controlled_drawings (
                    organization_id,
                    project_id,
                    drawing_number,
                    title,
                    discipline,
                    current_revision,
                    ifc_status,
                    date_received,
                    file_url,
                    created_by
                ) VALUES (
                    CAST(:org_id AS uuid),
                    CAST(:project_id AS uuid),
                    :drawing_number,
                    :title,
                    :discipline,
                    :current_revision,
                    :ifc_status,
                    :date_received,
                    :file_url,
                    CAST(:user_id AS uuid)
                )
                RETURNING id
            """),
            {
                "org_id": str(org_id),
                "project_id": str(project_id),
                "drawing_number": drawing_num,
                "title": payload["title"],
                "discipline": payload["discipline"],
                "current_revision": payload.get("current_revision", "Rev A"),
                "ifc_status": payload.get("ifc_status", "issued_for_construction"),
                "date_received": received_date,
                "file_url": payload.get("file_url"),
                "user_id": str(user_id),
            },
        )
    ).first()

    await db.commit()
    return {"id": str(row[0]), "action": "created", "superseded_revisions": 0}


# ---------------------------------------------------------------------------
# Progress Photo Diary
# ---------------------------------------------------------------------------

async def list_project_photos(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
) -> List[Dict[str, Any]]:
    rows = (
        await db.execute(
            text("""
                SELECT 
                    p.id,
                    p.photo_url,
                    p.caption,
                    p.element_tag,
                    p.captured_date,
                    p.weather_condition,
                    p.gps_lat,
                    p.gps_lng,
                    p.created_at,
                    u.full_name AS uploaded_by_name
                FROM projects.progress_photo_diary p
                LEFT JOIN core.users u ON u.id = p.uploaded_by
                WHERE p.project_id = CAST(:project_id AS uuid)
                  AND p.organization_id = CAST(:org_id AS uuid)
                  AND p.is_deleted = false
                ORDER BY p.captured_date DESC, p.created_at DESC
                LIMIT 60
            """),
            {"project_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    results = []
    for r in rows:
        item = dict(r)
        item["id"] = str(item["id"])
        item["captured_date"] = item["captured_date"].isoformat() if item["captured_date"] else None
        item["created_at"] = item["created_at"].isoformat() if item["created_at"] else None
        item["gps_lat"] = float(item["gps_lat"]) if item["gps_lat"] is not None else None
        item["gps_lng"] = float(item["gps_lng"]) if item["gps_lng"] is not None else None
        results.append(item)
    return results


async def record_progress_photo(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
    user_id: UUID,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    cap_date = payload.get("captured_date") or date.today()
    if isinstance(cap_date, str):
        cap_date = date.fromisoformat(cap_date)

    row = (
        await db.execute(
            text("""
                INSERT INTO projects.progress_photo_diary (
                    organization_id,
                    project_id,
                    photo_url,
                    caption,
                    element_tag,
                    captured_date,
                    weather_condition,
                    gps_lat,
                    gps_lng,
                    uploaded_by
                ) VALUES (
                    CAST(:org_id AS uuid),
                    CAST(:project_id AS uuid),
                    :photo_url,
                    :caption,
                    :element_tag,
                    :captured_date,
                    :weather_condition,
                    :gps_lat,
                    :gps_lng,
                    CAST(:user_id AS uuid)
                )
                RETURNING id
            """),
            {
                "org_id": str(org_id),
                "project_id": str(project_id),
                "photo_url": payload["photo_url"],
                "caption": payload["caption"],
                "element_tag": payload.get("element_tag", "General Site"),
                "captured_date": cap_date,
                "weather_condition": payload.get("weather_condition", "clear_sunny"),
                "gps_lat": payload.get("gps_lat"),
                "gps_lng": payload.get("gps_lng"),
                "user_id": str(user_id),
            },
        )
    ).first()

    await db.commit()
    return {"id": str(row[0]), "message": "Progress photo diary entry saved."}


# ---------------------------------------------------------------------------
# Consolidated Progress Pack Generation
# ---------------------------------------------------------------------------

async def generate_project_progress_pack(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
) -> Dict[str, Any]:
    """
    Compiles a comprehensive client & executive progress pack
    integrating all 7 verified capabilities.
    """
    # 1. Project Master
    proj = (
        await db.execute(
            text("""
                SELECT 
                    p.id,
                    p.name,
                    p.project_code AS code,
                    p.status,
                    COALESCE(p.contract_value, 0) AS contract_value,
                    p.start_date,
                    p.planned_completion_date AS target_completion_date,
                    p.client_name,
                    u.full_name AS project_manager_name
                FROM projects.projects p
                LEFT JOIN core.users u ON u.id = p.created_by
                WHERE p.id = CAST(:p_id AS uuid) AND p.organization_id = CAST(:org_id AS uuid)
            """),
            {"p_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().first()

    if not proj:
        raise HTTPException(status_code=404, detail="Project not found.")

    # 2. Schedule CPM & Milestones Summary
    milestones_raw = (
        await db.execute(
            text("""
                SELECT 
                    id,
                    name,
                    COALESCE(forecast_date, baseline_date) AS target_date,
                    status,
                    COALESCE(is_critical, false) AS is_critical,
                    COALESCE(total_float, 0) AS total_float
                FROM projects.project_milestones
                WHERE project_id = CAST(:p_id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND is_deleted = false
                ORDER BY COALESCE(forecast_date, baseline_date) NULLS LAST, created_at ASC
            """),
            {"p_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    total_milestones = len(milestones_raw)
    completed_milestones = sum(1 for m in milestones_raw if m["status"] == "completed")
    schedule_progress_pct = round((completed_milestones / total_milestones) * 100) if total_milestones > 0 else 0
    critical_milestones_count = sum(1 for m in milestones_raw if m["is_critical"])

    # 3. Quality & Pour Cards
    pour_cards_raw = (
        await db.execute(
            text("""
                SELECT 
                    status,
                    cubes_sampled_count,
                    test_result_verdict,
                    actual_volume_m3
                FROM projects.concrete_pour_cards
                WHERE project_id = CAST(:p_id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND is_deleted = false
            """),
            {"p_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    total_pours = len(pour_cards_raw)
    compliant_pours = sum(1 for p in pour_cards_raw if p["status"] == "compliant" or p["test_result_verdict"] == "pass")
    total_concrete_volume = sum(float(p["actual_volume_m3"] or 0) for p in pour_cards_raw)

    snags_raw = (
        await db.execute(
            text("""
                SELECT status FROM projects.site_snags
                WHERE project_id = CAST(:p_id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND is_deleted = false
            """),
            {"p_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    total_snags = len(snags_raw)
    closed_snags = sum(1 for s in snags_raw if s["status"] in ("closed", "signed_off"))
    open_snags = total_snags - closed_snags

    # 4. Plant Analytics
    plant_data = await get_project_plant_analytics(db, project_id, org_id)

    # 5. Subcontractor Commercials
    subcon_packages_raw = (
        await db.execute(
            text("""
                SELECT 
                    sp.id,
                    sp.package_number,
                    sp.title,
                    sp.award_value,
                    COALESCE(SUM(sc.certified_gross_amount), 0) AS total_certified,
                    COALESCE(SUM(sc.retention_deducted), 0) AS total_retention,
                    COALESCE(SUM(sc.net_payable_amount), 0) AS total_paid
                FROM projects.subcontract_packages sp
                LEFT JOIN projects.subcontractor_certificates sc 
                       ON sc.package_id = sp.id AND sc.is_deleted = false
                WHERE sp.project_id = CAST(:p_id AS uuid)
                  AND sp.organization_id = CAST(:org_id AS uuid)
                  AND sp.is_deleted = false
                GROUP BY sp.id, sp.package_number, sp.title, sp.award_value
            """),
            {"p_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    total_subcon_committed = sum(float(p["award_value"] or 0) for p in subcon_packages_raw)
    total_subcon_certified = sum(float(p["total_certified"] or 0) for p in subcon_packages_raw)
    total_subcon_retention = sum(float(p["total_retention"] or 0) for p in subcon_packages_raw)

    # 6. Contractual Delays & EOT
    delays_list = await list_project_delays(db, project_id, org_id)
    eot_list = await list_project_eot_claims(db, project_id, org_id)

    total_delays = len(delays_list)
    time_barred_delays = sum(1 for d in delays_list if d["is_time_barred"])
    eot_days_requested = sum(c["days_requested"] for c in eot_list)
    eot_days_granted = sum(c["days_granted"] for c in eot_list)
    prolongation_claimed = sum(c["prolongation_cost_claimed"] for c in eot_list)
    prolongation_approved = sum(c["prolongation_cost_approved"] for c in eot_list)

    # 7. Controlled Drawings & Photos
    drawings = await list_project_drawings(db, project_id, org_id)
    photos = await list_project_photos(db, project_id, org_id)

    ifc_drawings_count = sum(1 for d in drawings if d["ifc_status"] == "issued_for_construction")

    # Revised Contractual Completion Date
    baseline_date = proj["target_completion_date"]
    revised_date = None
    if baseline_date:
        from datetime import timedelta
        revised_date = (baseline_date + timedelta(days=eot_days_granted)).isoformat()

    return {
        "report_generated_at": datetime.now(timezone.utc).isoformat(),
        "project": {
            "id": str(proj["id"]),
            "name": proj["name"],
            "code": proj["code"],
            "status": proj["status"],
            "client_name": proj["client_name"],
            "project_manager_name": proj["project_manager_name"],
            "contract_value": float(proj["contract_value"]),
            "start_date": proj["start_date"].isoformat() if proj["start_date"] else None,
            "target_completion_date": baseline_date.isoformat() if baseline_date else None,
            "revised_contractual_completion_date": revised_date,
        },
        "executive_summary": {
            "schedule_progress_pct": schedule_progress_pct,
            "total_milestones": total_milestones,
            "completed_milestones": completed_milestones,
            "critical_path_milestones": critical_milestones_count,
            "pour_cards_total": total_pours,
            "pour_cards_compliant": compliant_pours,
            "total_concrete_volume_m3": round(total_concrete_volume, 1),
            "snags_open": open_snags,
            "snags_closed": closed_snags,
            "plant_total_deployed": plant_data["kpis"]["total_assigned_assets"],
            "plant_utilization_rate": plant_data["kpis"]["overall_utilization_rate"],
            "fuel_consumed_litres": plant_data["kpis"]["total_fuel_consumed_litres"],
            "subcontract_committed": total_subcon_committed,
            "subcontract_certified": total_subcon_certified,
            "subcontract_retention_held": total_subcon_retention,
            "delays_notified": total_delays,
            "delays_time_barred": time_barred_delays,
            "eot_days_requested": eot_days_requested,
            "eot_days_granted": eot_days_granted,
            "prolongation_claimed": prolongation_claimed,
            "prolongation_approved": prolongation_approved,
            "drawings_total": len(drawings),
            "drawings_ifc": ifc_drawings_count,
            "progress_photos_count": len(photos),
        },
        "plant_metrics": plant_data["kpis"],
        "milestones": [
            {
                "id": str(m["id"]),
                "name": m["name"],
                "target_date": m["target_date"].isoformat() if m["target_date"] else None,
                "status": m["status"],
                "is_critical": m["is_critical"],
                "total_float": float(m["total_float"]),
            }
            for m in milestones_raw[:15]
        ],
        "drawings": drawings[:20],
        "delays": delays_list[:10],
        "eot_claims": eot_list[:10],
        "recent_photos": photos[:12],
    }
