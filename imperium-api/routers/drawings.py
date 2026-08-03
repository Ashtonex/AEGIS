"""
Drawing takeoff & change-control system.

Upload a construction drawing, get a draft bill-of-quantities via AI vision,
DXF/CAD parsing, or plain manual reference-viewer entry, then commit that
revision as the project's baseline once every checklist item is ticked off.
Committing a revision supersedes whatever was previously committed for that
drawing name - so "what changed and who signed off on it" is always a real,
queryable record instead of tribal knowledge.
"""

import logging
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.drawings.extraction import extract_from_dxf, extract_from_image_ai_vision
from core.database import get_db
from core.security import SUPERADMIN_ROLE, get_current_user, is_self_certification, require_permission

router = APIRouter()
logger = logging.getLogger(__name__)

DEFAULT_CHECKLIST_ITEMS = [
    "Extracted/entered measurements reviewed line-by-line by a Quantity Surveyor",
    "Changes compared against the previously committed revision (if any)",
    "Cost/margin impact of any change assessed",
    "Approved by an authorised reviewer",
]


async def _fetch_file_bytes(file_url: str) -> bytes:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(file_url)
        response.raise_for_status()
        return response.content


async def _run_extraction(source_mode: str, file_url: Optional[str], mime_type: Optional[str]) -> Dict[str, Any]:
    if source_mode == "manual_reference" or not file_url:
        return {"measurements": [], "confidence_pct": None, "notes": "Manual reference entry - no automated extraction requested."}

    try:
        file_bytes = await _fetch_file_bytes(file_url)
    except Exception as e:
        logger.warning(f"Failed to download drawing file for extraction: {e}")
        return {"measurements": [], "confidence_pct": 0, "notes": f"Could not download the file for extraction ({e}). Use manual reference entry instead."}

    if source_mode == "cad_dxf":
        return extract_from_dxf(file_bytes)
    if source_mode == "ai_vision":
        return await extract_from_image_ai_vision(file_bytes, mime_type or "image/png")
    return {"measurements": [], "confidence_pct": None, "notes": "Unknown source mode."}


@router.post("/")
async def create_drawing_revision(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Uploads/registers a drawing revision and runs its extraction mode.
    The result is always a DRAFT - nothing here becomes a real BOQ until a
    human reviews it and commits the revision."""
    drawing_name = str(payload.get("drawing_name") or "").strip()
    source_mode = str(payload.get("source_mode") or "")
    if not drawing_name:
        raise HTTPException(status_code=400, detail="drawing_name is required.")
    if source_mode not in ("ai_vision", "cad_dxf", "manual_reference"):
        raise HTTPException(status_code=400, detail="source_mode must be ai_vision, cad_dxf, or manual_reference.")

    extraction = await _run_extraction(source_mode, payload.get("file_url"), payload.get("mime_type"))
    extraction_status = (
        "not_configured" if extraction.get("not_configured")
        else "manual" if source_mode == "manual_reference"
        else "failed" if not extraction.get("measurements")
        else "extracted"
    )

    try:
        revision_id = (
            await db.execute(
                text("""
                    INSERT INTO takeoff.drawing_revisions (
                        organization_id, project_id, quotation_id, drawing_name, revision_label,
                        source_mode, file_url, file_name, mime_type,
                        extraction_status, extraction_confidence_pct, extraction_notes,
                        status, created_by
                    ) VALUES (
                        :org_id, :project_id, :quotation_id, :drawing_name, :revision_label,
                        :source_mode, :file_url, :file_name, :mime_type,
                        :extraction_status, :extraction_confidence_pct, :extraction_notes,
                        'draft', :created_by
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "project_id": payload.get("project_id"),
                    "quotation_id": payload.get("quotation_id"),
                    "drawing_name": drawing_name,
                    "revision_label": payload.get("revision_label") or "R1",
                    "source_mode": source_mode,
                    "file_url": payload.get("file_url"),
                    "file_name": payload.get("file_name"),
                    "mime_type": payload.get("mime_type"),
                    "extraction_status": extraction_status,
                    "extraction_confidence_pct": extraction.get("confidence_pct"),
                    "extraction_notes": extraction.get("notes"),
                    "created_by": user["sub"],
                },
            )
        ).scalar()

        for idx, measurement in enumerate(extraction.get("measurements") or []):
            await db.execute(
                text("""
                    INSERT INTO takeoff.drawing_measurements (
                        organization_id, drawing_revision_id, description, unit, quantity,
                        source, confidence_pct, sort_order, entered_by
                    ) VALUES (
                        :org_id, :revision_id, :description, :unit, :quantity,
                        :source, :confidence_pct, :sort_order, :entered_by
                    )
                """),
                {
                    "org_id": user["org_id"],
                    "revision_id": revision_id,
                    "description": measurement["description"],
                    "unit": measurement["unit"],
                    "quantity": measurement["quantity"],
                    "source": source_mode if source_mode != "manual_reference" else "manual",
                    "confidence_pct": measurement.get("confidence_pct"),
                    "sort_order": idx,
                    "entered_by": user["sub"],
                },
            )

        for idx, item_label in enumerate(DEFAULT_CHECKLIST_ITEMS):
            await db.execute(
                text("""
                    INSERT INTO takeoff.drawing_revision_checklist_items (
                        organization_id, drawing_revision_id, item_label, sort_order
                    ) VALUES (:org_id, :revision_id, :item_label, :sort_order)
                """),
                {"org_id": user["org_id"], "revision_id": revision_id, "item_label": item_label, "sort_order": idx},
            )

        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to create drawing revision for %s", drawing_name)
        raise HTTPException(status_code=500, detail="Failed to create the drawing revision.")

    return {
        "success": True,
        "data": {"id": str(revision_id), "extraction_status": extraction_status, "extraction_notes": extraction.get("notes")},
        "message": "Drawing revision created as a draft. Review the measurements and complete the checklist before committing.",
        "meta": {"user_id": user["user_id"]},
    }


@router.get("/")
async def list_drawing_revisions(
    project_id: Optional[str] = None,
    quotation_id: Optional[str] = None,
    drawing_name: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = """
        SELECT * FROM takeoff.drawing_revisions
        WHERE organization_id = :org_id AND is_deleted = false
    """
    params: Dict[str, Any] = {"org_id": user["org_id"]}
    if project_id:
        query += " AND project_id = :project_id"
        params["project_id"] = project_id
    if quotation_id:
        query += " AND quotation_id = :quotation_id"
        params["quotation_id"] = quotation_id
    if drawing_name:
        query += " AND drawing_name = :drawing_name"
        params["drawing_name"] = drawing_name
    query += " ORDER BY drawing_name, created_at DESC"

    result = await db.execute(text(query), params)
    items = [dict(row._mapping) for row in result]
    return {"success": True, "data": items, "message": "Drawing revisions retrieved.", "meta": {"total": len(items)}}


@router.get("/{revision_id}")
async def get_drawing_revision(
    revision_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    revision_row = (
        await db.execute(
            text("SELECT * FROM takeoff.drawing_revisions WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": revision_id, "org_id": user["org_id"]},
        )
    ).first()
    if not revision_row:
        raise HTTPException(status_code=404, detail="Drawing revision not found.")

    measurements = [
        dict(row._mapping)
        for row in await db.execute(
            text("""
                SELECT * FROM takeoff.drawing_measurements
                WHERE drawing_revision_id = :id AND organization_id = :org_id AND is_deleted = false
                ORDER BY sort_order
            """),
            {"id": revision_id, "org_id": user["org_id"]},
        )
    ]
    checklist = [
        dict(row._mapping)
        for row in await db.execute(
            text("""
                SELECT * FROM takeoff.drawing_revision_checklist_items
                WHERE drawing_revision_id = :id AND organization_id = :org_id
                ORDER BY sort_order
            """),
            {"id": revision_id, "org_id": user["org_id"]},
        )
    ]

    return {
        "success": True,
        "data": {**dict(revision_row._mapping), "measurements": measurements, "checklist": checklist},
        "message": "Drawing revision retrieved.",
        "meta": {},
    }


@router.put("/{revision_id}/measurements")
async def replace_drawing_measurements(
    revision_id: str,
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Replaces the full measurement row set for a DRAFT revision - a
    committed revision is a locked baseline; to change it, create a new
    revision instead (which gets its own fresh checklist)."""
    revision_row = (
        await db.execute(
            text("SELECT status FROM takeoff.drawing_revisions WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": revision_id, "org_id": user["org_id"]},
        )
    ).first()
    if not revision_row:
        raise HTTPException(status_code=404, detail="Drawing revision not found.")
    if revision_row._mapping["status"] != "draft":
        raise HTTPException(status_code=409, detail="Only a draft revision's measurements can be edited. Create a new revision to change a committed one.")

    rows: List[Dict[str, Any]] = payload.get("measurements") or []

    try:
        await db.execute(
            text("UPDATE takeoff.drawing_measurements SET is_deleted = true WHERE drawing_revision_id = :id AND organization_id = :org_id"),
            {"id": revision_id, "org_id": user["org_id"]},
        )
        for idx, row in enumerate(rows):
            await db.execute(
                text("""
                    INSERT INTO takeoff.drawing_measurements (
                        organization_id, drawing_revision_id, description, unit, quantity,
                        source, confidence_pct, sort_order, entered_by
                    ) VALUES (
                        :org_id, :revision_id, :description, :unit, :quantity,
                        :source, :confidence_pct, :sort_order, :entered_by
                    )
                """),
                {
                    "org_id": user["org_id"],
                    "revision_id": revision_id,
                    "description": row.get("description", "Item"),
                    "unit": row.get("unit", "unit"),
                    "quantity": row.get("quantity", 0),
                    "source": row.get("source", "manual"),
                    "confidence_pct": row.get("confidence_pct"),
                    "sort_order": idx,
                    "entered_by": user["sub"],
                },
            )
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to replace measurements for revision %s", revision_id)
        raise HTTPException(status_code=500, detail="Failed to save measurements.")

    return {"success": True, "data": {"id": revision_id, "count": len(rows)}, "message": "Measurements saved.", "meta": {}}


@router.post("/{revision_id}/checklist/{item_id}/check")
async def set_checklist_item(
    revision_id: str,
    item_id: str,
    payload: Dict[str, Any],
    user: dict = Depends(require_permission("takeoff.drawing.commit")),
    db: AsyncSession = Depends(get_db),
):
    """Every default checklist item here is a reviewer attestation ('reviewed
    by a QS', 'approved by an authorised reviewer'), not a doer attestation -
    so unlike a plain drawings.create permission, this requires the stronger
    takeoff.drawing.commit permission AND the person checking it off cannot
    be the same person who created the revision being reviewed."""
    checked = bool(payload.get("checked", True))

    if checked and user.get("role") != SUPERADMIN_ROLE:
        revision_row = (
            await db.execute(
                text("SELECT created_by FROM takeoff.drawing_revisions WHERE id = :id AND organization_id = :org_id"),
                {"id": revision_id, "org_id": user["org_id"]},
            )
        ).first()
        if revision_row and is_self_certification(user["sub"], revision_row._mapping["created_by"]):
            raise HTTPException(
                status_code=403,
                detail="You created this drawing revision and cannot also check off its own review checklist - get an independent reviewer.",
            )

    result = await db.execute(
        text("""
            UPDATE takeoff.drawing_revision_checklist_items
            SET is_checked = :checked,
                checked_by = CASE WHEN :checked THEN CAST(:user_id AS uuid) ELSE NULL END,
                checked_at = CASE WHEN :checked THEN NOW() ELSE NULL END
            WHERE id = :item_id AND drawing_revision_id = :revision_id AND organization_id = :org_id
            RETURNING id
        """),
        {"checked": checked, "user_id": user["sub"], "item_id": item_id, "revision_id": revision_id, "org_id": user["org_id"]},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Checklist item not found.")
    await db.commit()
    return {"success": True, "data": {"id": item_id, "is_checked": checked}, "message": "Checklist item updated.", "meta": {}}


@router.post("/{revision_id}/commit")
async def commit_drawing_revision(
    revision_id: str,
    user: dict = Depends(require_permission("takeoff.drawing.commit")),
    db: AsyncSession = Depends(get_db),
):
    """Commits a revision as the current baseline for its drawing name -
    but only once every checklist item is ticked off. This is the gate: a
    change to a drawing cannot silently become the new reference without
    someone explicitly signing off on every item."""
    revision_row = (
        await db.execute(
            text("SELECT drawing_name, status FROM takeoff.drawing_revisions WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": revision_id, "org_id": user["org_id"]},
        )
    ).first()
    if not revision_row:
        raise HTTPException(status_code=404, detail="Drawing revision not found.")
    revision = dict(revision_row._mapping)
    if revision["status"] != "draft":
        raise HTTPException(status_code=409, detail=f"Revision is already {revision['status']}, not draft.")

    unchecked_count = (
        await db.execute(
            text("""
                SELECT COUNT(*) FROM takeoff.drawing_revision_checklist_items
                WHERE drawing_revision_id = :id AND organization_id = :org_id AND is_checked = false
            """),
            {"id": revision_id, "org_id": user["org_id"]},
        )
    ).scalar()
    if unchecked_count > 0:
        raise HTTPException(status_code=409, detail=f"{unchecked_count} checklist item(s) must be checked off before this revision can be committed.")

    try:
        prior = (
            await db.execute(
                text("""
                    SELECT id FROM takeoff.drawing_revisions
                    WHERE organization_id = :org_id AND drawing_name = :drawing_name
                      AND status = 'committed' AND is_deleted = false
                """),
                {"org_id": user["org_id"], "drawing_name": revision["drawing_name"]},
            )
        ).first()

        await db.execute(
            text("""
                UPDATE takeoff.drawing_revisions
                SET status = 'committed', committed_by = :user_id, committed_at = NOW(),
                    supersedes_revision_id = :prior_id, updated_at = NOW()
                WHERE id = :id
            """),
            {"user_id": user["sub"], "prior_id": prior._mapping["id"] if prior else None, "id": revision_id},
        )
        if prior:
            await db.execute(
                text("UPDATE takeoff.drawing_revisions SET status = 'superseded', updated_at = NOW() WHERE id = :id"),
                {"id": prior._mapping["id"]},
            )
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to commit drawing revision %s", revision_id)
        raise HTTPException(status_code=500, detail="Failed to commit the drawing revision.")

    return {
        "success": True,
        "data": {"id": revision_id, "status": "committed"},
        "message": f"Revision committed as the current baseline for '{revision['drawing_name']}'.",
        "meta": {"user_id": user["user_id"]},
    }


@router.get("/{revision_id}/as-boq")
async def drawing_revision_as_boq(
    revision_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns a committed (or draft, for preview) revision's measurements
    shaped as BOQ line items ready to inject into the Quotation Builder.
    Rate is always 0 - a drawing gives quantities, not prices."""
    rows = await db.execute(
        text("""
            SELECT description, unit, quantity FROM takeoff.drawing_measurements
            WHERE drawing_revision_id = :id AND organization_id = :org_id AND is_deleted = false
            ORDER BY sort_order
        """),
        {"id": revision_id, "org_id": user["org_id"]},
    )
    items = [
        {"description": r._mapping["description"], "qty": float(r._mapping["quantity"]), "unit": r._mapping["unit"], "rate": 0}
        for r in rows
    ]
    return {"success": True, "data": {"items": items}, "message": "Drawing measurements formatted as BOQ line items.", "meta": {"total": len(items)}}


@router.delete("/{revision_id}")
async def delete_drawing_revision(
    revision_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            UPDATE takeoff.drawing_revisions
            SET is_deleted = true, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND status = 'draft'
            RETURNING id
        """),
        {"id": revision_id, "org_id": user["org_id"]},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Draft drawing revision not found (committed revisions cannot be deleted).")
    await db.commit()
    return {"success": True, "data": None, "message": "Drawing revision deleted.", "meta": {}}
