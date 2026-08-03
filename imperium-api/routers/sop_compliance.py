"""
SOP (Standard Operating Procedure) checklist enforcement.

Generalizes the drawing-revision checklist pattern into a reusable system:
named templates ("Preliminary Client Meeting", "Site Visit", "Pre-Award
Commercial Review") get instantiated against a quotation or project, each
item can require evidence (a note or an uploaded file) and/or an
independent reviewer, and a template flagged blocks_quotation_win must have
a COMPLETE instance before that quotation can be marked won
(see get_missing_required_sops, called from routers/quotations.py).

The segregation-of-duties rule: an item flagged requires_independent_
reviewer cannot be completed by the same person who started the checklist
instance - self-certifying your own sign-off defeats the entire point of
having one. This is enforced here, not just in the UI.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import get_current_user, is_self_certification, require_permission, user_has_permission

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/templates")
async def list_sop_templates(
    applies_to: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = "SELECT * FROM compliance.sop_templates WHERE organization_id = :org_id AND is_deleted = false AND is_active = true"
    params: Dict[str, Any] = {"org_id": user["org_id"]}
    if applies_to:
        query += " AND applies_to = :applies_to"
        params["applies_to"] = applies_to
    query += " ORDER BY name"

    templates = [dict(row._mapping) for row in await db.execute(text(query), params)]
    for tmpl in templates:
        items = await db.execute(
            text("SELECT * FROM compliance.sop_template_items WHERE template_id = :id ORDER BY sort_order"),
            {"id": tmpl["id"]},
        )
        tmpl["items"] = [dict(r._mapping) for r in items]

    return {"success": True, "data": templates, "message": "SOP templates retrieved.", "meta": {"total": len(templates)}}


@router.post("/templates")
async def create_sop_template(
    payload: Dict[str, Any],
    user: dict = Depends(require_permission("sop_compliance.manage")),
    db: AsyncSession = Depends(get_db),
):
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required.")

    try:
        template_id = (
            await db.execute(
                text("""
                    INSERT INTO compliance.sop_templates (
                        organization_id, name, description, applies_to, blocks_quotation_win, created_by
                    ) VALUES (:org_id, :name, :description, :applies_to, :blocks_quotation_win, :created_by)
                    RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "name": name,
                    "description": payload.get("description"),
                    "applies_to": payload.get("applies_to", "quotation"),
                    "blocks_quotation_win": bool(payload.get("blocks_quotation_win", False)),
                    "created_by": user["sub"],
                },
            )
        ).scalar()

        for idx, item in enumerate(payload.get("items") or []):
            await db.execute(
                text("""
                    INSERT INTO compliance.sop_template_items (
                        organization_id, template_id, item_label, requires_evidence,
                        requires_independent_reviewer, sort_order
                    ) VALUES (:org_id, :template_id, :item_label, :requires_evidence, :requires_reviewer, :sort_order)
                """),
                {
                    "org_id": user["org_id"],
                    "template_id": template_id,
                    "item_label": item.get("item_label", "Item"),
                    "requires_evidence": bool(item.get("requires_evidence", False)),
                    "requires_reviewer": bool(item.get("requires_independent_reviewer", False)),
                    "sort_order": idx,
                },
            )
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to create SOP template %s", name)
        raise HTTPException(status_code=500, detail="Failed to create the SOP template.")

    return {"success": True, "data": {"id": str(template_id)}, "message": "SOP template created.", "meta": {}}


async def _instances_with_items(db: AsyncSession, org_id: str, subject_type: str, subject_id: str) -> List[Dict[str, Any]]:
    instances = [
        dict(row._mapping)
        for row in await db.execute(
            text("""
                SELECT si.*, st.name AS template_name, st.blocks_quotation_win
                FROM compliance.sop_instances si
                JOIN compliance.sop_templates st ON st.id = si.template_id
                WHERE si.organization_id = :org_id AND si.subject_type = :subject_type
                  AND si.subject_id = :subject_id AND si.is_deleted = false
                ORDER BY si.created_at
            """),
            {"org_id": org_id, "subject_type": subject_type, "subject_id": subject_id},
        )
    ]
    for inst in instances:
        items = await db.execute(
            text("SELECT * FROM compliance.sop_instance_items WHERE instance_id = :id ORDER BY sort_order"),
            {"id": inst["id"]},
        )
        inst["items"] = [dict(r._mapping) for r in items]
    return instances


@router.get("/instances")
async def list_sop_instances(
    subject_type: str,
    subject_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    instances = await _instances_with_items(db, user["org_id"], subject_type, subject_id)
    return {"success": True, "data": instances, "message": "SOP instances retrieved.", "meta": {"total": len(instances)}}


@router.post("/instances")
async def start_sop_instance(
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Starts a checklist instance for a subject from a template, copying
    the template's items in as fresh, uncompleted instance items."""
    template_id = payload.get("template_id")
    subject_type = payload.get("subject_type")
    subject_id = payload.get("subject_id")
    if not (template_id and subject_type and subject_id):
        raise HTTPException(status_code=400, detail="template_id, subject_type, and subject_id are required.")

    template_row = (
        await db.execute(
            text("SELECT * FROM compliance.sop_templates WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": template_id, "org_id": user["org_id"]},
        )
    ).first()
    if not template_row:
        raise HTTPException(status_code=404, detail="SOP template not found.")

    template_items = [
        dict(r._mapping)
        for r in await db.execute(
            text("SELECT * FROM compliance.sop_template_items WHERE template_id = :id ORDER BY sort_order"),
            {"id": template_id},
        )
    ]

    try:
        instance_id = (
            await db.execute(
                text("""
                    INSERT INTO compliance.sop_instances (
                        organization_id, template_id, subject_type, subject_id, created_by
                    ) VALUES (:org_id, :template_id, :subject_type, :subject_id, :created_by)
                    RETURNING id
                """),
                {
                    "org_id": user["org_id"], "template_id": template_id, "subject_type": subject_type,
                    "subject_id": subject_id, "created_by": user["sub"],
                },
            )
        ).scalar()

        for item in template_items:
            await db.execute(
                text("""
                    INSERT INTO compliance.sop_instance_items (
                        organization_id, instance_id, item_label, requires_evidence,
                        requires_independent_reviewer, sort_order
                    ) VALUES (:org_id, :instance_id, :item_label, :requires_evidence, :requires_reviewer, :sort_order)
                """),
                {
                    "org_id": user["org_id"], "instance_id": instance_id, "item_label": item["item_label"],
                    "requires_evidence": item["requires_evidence"], "requires_reviewer": item["requires_independent_reviewer"],
                    "sort_order": item["sort_order"],
                },
            )
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to start SOP instance for template %s", template_id)
        raise HTTPException(status_code=500, detail="Failed to start the SOP checklist.")

    return {"success": True, "data": {"id": str(instance_id)}, "message": f"'{template_row._mapping['name']}' checklist started.", "meta": {}}


@router.post("/instances/{instance_id}/items/{item_id}/complete")
async def complete_sop_item(
    instance_id: str,
    item_id: str,
    payload: Dict[str, Any],
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Marks a checklist item done (or reopens it). Enforces evidence and
    segregation-of-duties requirements server-side - this is the actual
    control, not just a UI affordance."""
    checked = bool(payload.get("checked", True))

    instance_row = (
        await db.execute(
            text("SELECT * FROM compliance.sop_instances WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": instance_id, "org_id": user["org_id"]},
        )
    ).first()
    if not instance_row:
        raise HTTPException(status_code=404, detail="SOP instance not found.")
    instance = dict(instance_row._mapping)

    item_row = (
        await db.execute(
            text("SELECT * FROM compliance.sop_instance_items WHERE id = :id AND instance_id = :instance_id AND organization_id = :org_id"),
            {"id": item_id, "instance_id": instance_id, "org_id": user["org_id"]},
        )
    ).first()
    if not item_row:
        raise HTTPException(status_code=404, detail="Checklist item not found.")
    item = dict(item_row._mapping)

    evidence_url = payload.get("evidence_url")
    evidence_note = payload.get("evidence_note")

    if checked:
        if item["requires_evidence"] and not (evidence_url or evidence_note):
            raise HTTPException(status_code=400, detail="This item requires evidence (a file or a note) before it can be checked off.")

        if item["requires_independent_reviewer"]:
            if not await user_has_permission(db, user, "sop_compliance.review"):
                raise HTTPException(status_code=403, detail="Missing required permission: sop_compliance.review")
            if is_self_certification(user["sub"], instance["created_by"]):
                raise HTTPException(
                    status_code=403,
                    detail="This item requires an independent reviewer - the person who started this checklist cannot also sign off on it.",
                )

    try:
        await db.execute(
            text("""
                UPDATE compliance.sop_instance_items
                SET is_checked = :checked,
                    checked_by = CASE WHEN :checked THEN CAST(:user_id AS uuid) ELSE NULL END,
                    checked_at = CASE WHEN :checked THEN NOW() ELSE NULL END,
                    evidence_url = CASE WHEN :checked THEN :evidence_url ELSE NULL END,
                    evidence_note = CASE WHEN :checked THEN :evidence_note ELSE NULL END
                WHERE id = :item_id
            """),
            {
                "checked": checked, "user_id": user["sub"], "evidence_url": evidence_url,
                "evidence_note": evidence_note, "item_id": item_id,
            },
        )

        remaining_unchecked = (
            await db.execute(
                text("SELECT COUNT(*) FROM compliance.sop_instance_items WHERE instance_id = :id AND is_checked = false"),
                {"id": instance_id},
            )
        ).scalar()
        new_status = "complete" if remaining_unchecked == 0 else "in_progress"
        completed_at = datetime.now(timezone.utc) if new_status == "complete" else None
        await db.execute(
            text("""
                UPDATE compliance.sop_instances
                SET status = :status, completed_at = :completed_at, updated_at = NOW()
                WHERE id = :id
            """),
            {"status": new_status, "completed_at": completed_at, "id": instance_id},
        )
        await db.commit()
    except HTTPException:
        raise
    except Exception:
        await db.rollback()
        logger.exception("Failed to update SOP checklist item %s", item_id)
        raise HTTPException(status_code=500, detail="Failed to update the checklist item.")

    return {"success": True, "data": {"id": item_id, "is_checked": checked, "instance_status": new_status}, "message": "Checklist item updated.", "meta": {}}


async def get_missing_required_sops(db: AsyncSession, org_id: str, quotation_id: str) -> List[str]:
    """Returns the names of every blocks_quotation_win template that does
    NOT have a complete instance for this quotation. An empty list means
    the quotation is clear to be marked won. Imported by routers/quotations.py."""
    rows = await db.execute(
        text("""
            SELECT st.name
            FROM compliance.sop_templates st
            WHERE st.organization_id = :org_id AND st.is_deleted = false AND st.is_active = true
              AND st.blocks_quotation_win = true
              AND NOT EXISTS (
                  SELECT 1 FROM compliance.sop_instances si
                  WHERE si.template_id = st.id AND si.organization_id = :org_id
                    AND si.subject_type = 'quotation' AND si.subject_id = :quotation_id
                    AND si.status = 'complete' AND si.is_deleted = false
              )
            ORDER BY st.name
        """),
        {"org_id": org_id, "quotation_id": quotation_id},
    )
    return [r[0] for r in rows]


@router.get("/quotations/{quotation_id}/readiness")
async def get_quotation_sop_readiness(
    quotation_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Convenience endpoint for the frontend: what's required, what's done,
    what's still missing before this quotation can be marked won."""
    instances = await _instances_with_items(db, user["org_id"], "quotation", quotation_id)
    missing = await get_missing_required_sops(db, user["org_id"], quotation_id)
    return {
        "success": True,
        "data": {"instances": instances, "missing_required_templates": missing, "ready_to_win": len(missing) == 0},
        "message": "SOP readiness retrieved.",
        "meta": {},
    }
