"""Tender intake workflow: initial review -> QS verification -> QS preparation.

Every tender that enters AEGIS (e-GP import, automatic or manual, or a tender
typed in on the board) runs through:

    captured
      -> pending_tender_review      Ekow / Marvellous (shared queue, one primary)
      -> pending_qs_verification    Tagu / Gamuchirai (round robin by default)
           -> returned_for_correction -> (reviewer resubmits) -> pending_qs_verification
      -> qs_preparation             site visit / BOQ / clarification tasks; stage -> Bid Prep

The state lives in crm.tenders.review_workflow_status. The gate between review
and QS is enforced here, not in the UI: every required checklist item must be
done or not-applicable-with-a-reason, the facts each item confirms must
actually be recorded, and the reviewer must explicitly confirm. Review and QS
tasks are crm.tasks rows tagged generation_rule = 'tender_workflow_gate'; the
generic task screen refuses to complete them (routers/crm_tasks.py) so the
gate can't be skipped by ticking a task. QS preparation tasks carry the same
tag (so they list and reassign with the tender) but are ordinary work the QS
completes from the task screen - nothing in the workflow closes them.

Every function writes in the caller's transaction and never commits.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.tenders.egp.parser import HARARE
from app.shared.events import emit_event, emit_notification

CAPTURED = "captured"
PENDING_REVIEW = "pending_tender_review"
PENDING_QS = "pending_qs_verification"
RETURNED = "returned_for_correction"
QS_PREPARATION = "qs_preparation"
STATUS_LABELS = {
    CAPTURED: "Tender Captured",
    PENDING_REVIEW: "Pending Tender Review",
    PENDING_QS: "Pending QS Verification",
    RETURNED: "Returned for Correction",
    QS_PREPARATION: "QS Preparation",
}
REVIEW_OPEN = (PENDING_REVIEW, RETURNED)
GATE_RULE = "tender_workflow_gate"
# Tagged GATE_RULE but not a gate: completed by the QS on the task screen.
PREPARATION_EVENT = "tender_qs_preparation"
TENDER_URL = "/dashboard/crm/tenders/{id}"

# (key, label, guidance). All required; any can be marked not applicable
# with a reason.
REVIEW_ITEMS: list[tuple[str, str, str]] = [
    ("source_verified", "Open the original notice on e-GP (or its source) and verify the captured details",
     "Title, reference, procuring entity, category and description match the official notice."),
    ("documents_obtained", "Obtain every supporting document",
     "Bidding document, BOQ, specifications, drawings and every addendum listed on the source."),
    ("documents_uploaded", "Upload any missing document to this tender",
     "AEGIS downloads what e-GP lists; anything it could not download, or that came from elsewhere, is uploaded here."),
    ("documents_verified", "Check every attached file opens, is readable, correctly named and on the right tender",
     "Scanned PDFs count as readable if you can read them - say so in the notes."),
    ("deadline_verified", "Verify the submission deadline and submission requirements",
     "Closing date and time, where/how bids are submitted, copies and format."),
    ("site_visit_confirmed", "Confirm site visit / briefing requirements",
     "Record whether attendance is compulsory, the date, time and venue. The e-GP schedule can say 'Not Required' while "
     "the bidding document demands a compulsory site visit - read the document."),
    ("bid_bond_confirmed", "Confirm the bid bond / bid security requirement",
     "Amount, currency, form (bank guarantee, cash to PRAZ, bid-securing declaration, none) and validity."),
    ("discrepancies_recorded", "Record discrepancies, outstanding items and review notes",
     "Anything that disagrees between the notice, the schedule and the documents, and anything still missing."),
]
ITEM_LABELS = {key: label for key, label, _ in REVIEW_ITEMS}


def _j(value: Any) -> str:
    return json.dumps(value, default=str)


def _uid(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    return user.get("user_id") or user.get("sub")


async def _rows(db: AsyncSession, sql: str, params: dict) -> list[dict]:
    return [dict(r) for r in (await db.execute(text(sql), params)).mappings().all()]


async def _row(db: AsyncSession, sql: str, params: dict) -> Optional[dict]:
    row = (await db.execute(text(sql), params)).mappings().first()
    return dict(row) if row else None


# ----------------------------------------------------------------------------
# Settings
# ----------------------------------------------------------------------------

async def get_settings(db: AsyncSession, org_id: str, *, lock: bool = False) -> dict:
    await db.execute(
        text("INSERT INTO crm.tender_automation_settings (organization_id) VALUES (:org_id) ON CONFLICT (organization_id) DO NOTHING"),
        {"org_id": org_id},
    )
    row = await _row(db, f"SELECT * FROM crm.tender_automation_settings WHERE organization_id = :org_id{' FOR UPDATE' if lock else ''}",
                     {"org_id": org_id})
    assert row is not None
    return row


def _id_list(value: Any) -> list[str]:
    out: list[str] = []
    for item in value or []:
        raw = item.get("user_id") if isinstance(item, dict) else item
        try:
            out.append(str(UUID(str(raw))))
        except (TypeError, ValueError):
            continue
    return out


async def active_users(db: AsyncSession, org_id: str, user_ids: Iterable[str]) -> list[dict]:
    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return []
    rows = await _rows(
        db,
        """
        SELECT id, full_name, email FROM core.users
        WHERE organization_id = :org_id AND is_deleted = false AND is_active
          AND id = ANY(CAST(:ids AS uuid[]))
        """,
        {"org_id": org_id, "ids": ids},
    )
    by_id = {str(r["id"]): r for r in rows}
    return [by_id[i] for i in ids if i in by_id]


# ----------------------------------------------------------------------------
# Audit trail
# ----------------------------------------------------------------------------

async def record_event(db: AsyncSession, *, org_id: str, tender_id: str, action: str, actor: Optional[str],
                       from_status: Optional[str] = None, to_status: Optional[str] = None, note: Optional[str] = None,
                       data: Optional[dict] = None, round_no: Optional[int] = None) -> None:
    await db.execute(
        text("""
            INSERT INTO crm.tender_workflow_events (organization_id, tender_id, action, from_status, to_status,
                actor_user_id, automated, round, note, data)
            VALUES (:org_id, :tender_id, :action, :from_status, :to_status, :actor, :automated, :round, :note, CAST(:data AS jsonb))
        """),
        {"org_id": org_id, "tender_id": tender_id, "action": action, "from_status": from_status, "to_status": to_status,
         "actor": actor, "automated": actor is None, "round": round_no, "note": (note or None) and note[:4000],
         "data": _j(data or {})},
    )
    if from_status != to_status and to_status:
        await emit_event(db, user={"org_id": org_id, "user_id": actor}, event_type=f"tender.workflow.{to_status}.v1",
                         aggregate_type="tender", aggregate_id=tender_id,
                         event_data={"from": from_status, "to": to_status, "action": action, **(data or {})},
                         idempotency_suffix=f"{action}:{datetime.now(timezone.utc).isoformat()}")


# ----------------------------------------------------------------------------
# Tasks
# ----------------------------------------------------------------------------

async def _upsert_task(db: AsyncSession, *, org_id: str, tender_id: str, dedupe: str, title: str, description: str,
                       assignee: Optional[str], due: Optional[date], priority: str, source_event: str,
                       criticality: str = "high", actor: Optional[str] = None) -> Optional[str]:
    row = (await db.execute(
        text("""
            INSERT INTO crm.tasks (
                organization_id, title, description, entity_type, entity_id, assigned_to_user_id, due_date, status,
                priority, created_by, primary_entity_type, primary_entity_id, source_event, expected_outcome,
                deduplication_key, generation_rule, gate_effect, criticality, auto_assigned_at
            ) VALUES (
                :org_id, :title, :description, 'tender', :tender_id, :assignee, :due, 'not_started',
                :priority, :actor, 'tender', :tender_id, :source_event, :outcome,
                :dedupe, :rule, 'blocking', :criticality, CASE WHEN CAST(:assignee AS uuid) IS NULL THEN NULL ELSE NOW() END
            )
            ON CONFLICT (organization_id, deduplication_key)
                WHERE is_deleted = false AND status NOT IN ('cancelled', 'superseded')
            DO NOTHING
            RETURNING id
        """),
        {"org_id": org_id, "title": title[:255], "outcome": title, "description": description, "tender_id": tender_id,
         "assignee": assignee, "due": due, "priority": priority, "actor": actor, "source_event": source_event, "dedupe": dedupe,
         "rule": GATE_RULE, "criticality": criticality},
    )).first()
    return str(row[0]) if row else None


async def _close_tasks(db: AsyncSession, *, org_id: str, tender_id: str, source_events: tuple[str, ...], actor: Optional[str],
                       status: str, evidence: str, reason: Optional[str] = None) -> int:
    result = await db.execute(
        text("""
            UPDATE crm.tasks
            SET status = :status,
                completed_at = CASE WHEN :done THEN NOW() ELSE completed_at END,
                verified_by_user_id = CASE WHEN :done THEN CAST(:actor AS uuid) ELSE verified_by_user_id END,
                verified_at = CASE WHEN :done THEN NOW() ELSE verified_at END,
                evidence_ref = :evidence,
                evidence_status = CASE WHEN :done THEN 'accepted' ELSE evidence_status END,
                review_status = CASE WHEN :done THEN 'accepted' ELSE review_status END,
                contribution_percent = CASE WHEN :done THEN weight ELSE contribution_percent END,
                cancellation_reason = CASE WHEN :cancelled THEN :reason ELSE cancellation_reason END,
                updated_at = NOW()
            WHERE organization_id = :org_id AND entity_type = 'tender' AND entity_id = :tender_id
              AND generation_rule = :rule AND source_event = ANY(CAST(:events AS text[]))
              AND is_deleted = false AND status NOT IN ('completed', 'cancelled', 'superseded', 'not_applicable')
        """),
        {"status": status, "done": status == "completed", "cancelled": status == "cancelled", "actor": actor,
         "evidence": evidence[:500], "reason": reason, "org_id": org_id,
         "tender_id": tender_id, "rule": GATE_RULE, "events": list(source_events)},
    )
    return result.rowcount or 0


def _review_due(settings: dict, deadline: Optional[datetime]) -> date:
    today = datetime.now(HARARE).date()
    due = today + timedelta(days=int(settings.get("review_due_days") or 1))
    if deadline:
        latest = (deadline.astimezone(HARARE) - timedelta(days=2)).date()
        due = max(today, min(due, latest))
    return due


# ----------------------------------------------------------------------------
# Start: captured -> pending_tender_review
# ----------------------------------------------------------------------------

async def load_tender(db: AsyncSession, org_id: str, tender_id: str, *, lock: bool = False) -> dict:
    try:
        UUID(str(tender_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Tender not found.")
    row = await _row(
        db,
        f"SELECT * FROM crm.tenders WHERE id = :id AND organization_id = :org_id AND is_deleted = false{' FOR UPDATE' if lock else ''}",
        {"id": str(tender_id), "org_id": org_id},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tender not found.")
    return row


async def _ensure_review_items(db: AsyncSession, org_id: str, tender_id: str) -> None:
    for order, (key, label, guidance) in enumerate(REVIEW_ITEMS, start=1):
        await db.execute(
            text("""
                INSERT INTO crm.tender_review_items (organization_id, tender_id, item_key, label, guidance, sort_order)
                VALUES (:org_id, :tender_id, :key, :label, :guidance, :order)
                ON CONFLICT (tender_id, item_key) DO NOTHING
            """),
            {"org_id": org_id, "tender_id": tender_id, "key": key, "label": label, "guidance": guidance, "order": order},
        )


async def start_workflow(db: AsyncSession, *, org_id: str, tender_id: str, actor: Optional[str], origin: str) -> dict:
    """Idempotent: a tender already past Captured is left as it is. A tender
    waiting in Captured (no reviewers were configured) resumes here.
    Returns {"status", "primary", "support", "blocked"}."""
    tender = await load_tender(db, org_id, tender_id, lock=True)
    if tender["review_workflow_status"] not in (None, CAPTURED):
        return {"status": tender["review_workflow_status"], "already_started": True}
    settings = await get_settings(db, org_id, lock=True)
    if tender["review_workflow_status"] is None:
        await db.execute(text("UPDATE crm.tenders SET review_workflow_status = :s, updated_at = NOW() WHERE id = :id"),
                         {"s": CAPTURED, "id": tender_id})
        await record_event(db, org_id=org_id, tender_id=tender_id, action="captured", actor=actor, from_status=None,
                           to_status=CAPTURED, data={"origin": origin})
    await _ensure_review_items(db, org_id, tender_id)

    reviewers = await active_users(db, org_id, _id_list(settings["review_user_ids"]))
    if not reviewers:
        await record_event(db, org_id=org_id, tender_id=tender_id, action="blocked_no_reviewers", actor=None,
                           from_status=CAPTURED, to_status=CAPTURED,
                           note="No active initial reviewers are configured - the tender waits in Captured.")
        return {"status": CAPTURED, "blocked": "no_reviewers", "primary": None, "support": []}

    cursor = int(settings["review_cursor"] or 0)
    primary = reviewers[cursor % len(reviewers)]
    support = [r for r in reviewers if r["id"] != primary["id"]]
    await db.execute(text("UPDATE crm.tender_automation_settings SET review_cursor = :c WHERE organization_id = :org_id"),
                     {"c": cursor + 1, "org_id": org_id})
    await db.execute(
        text("""
            UPDATE crm.tenders
            SET review_workflow_status = :status, review_round = 1, review_primary_user_id = :primary,
                review_support_user_ids = CAST(:support AS jsonb), review_started_at = NOW(), updated_at = NOW()
            WHERE id = :id
        """),
        {"status": PENDING_REVIEW, "primary": primary["id"], "support": _j([str(s["id"]) for s in support]), "id": tender_id},
    )
    name = tender["tender_name"] or "tender"
    due = _review_due(settings, tender["submission_deadline"])
    steps = "\n".join(f"{i}. {label}" for i, (_, label, _) in enumerate(REVIEW_ITEMS, start=1))
    description = (f"Initial review of '{name}'. Work the checklist on the tender record and submit it to QS from there "
                   f"(this task completes automatically).\n\n{steps}")
    await _upsert_task(db, org_id=org_id, tender_id=tender_id, dedupe=f"TENDER_WF:{tender_id}:review:1:{primary['id']}",
                       title=f"Tender review (primary): {name}", description=description, assignee=str(primary["id"]),
                       due=due, priority="high", source_event="tender_intake_review", actor=actor)
    for person in support:
        await _upsert_task(db, org_id=org_id, tender_id=tender_id, dedupe=f"TENDER_WF:{tender_id}:review:1:{person['id']}",
                           title=f"Tender review (support): {name}",
                           description=f"Support {primary['full_name']} (primary reviewer) on '{name}'. " + description,
                           assignee=str(person["id"]), due=due, priority="normal", source_event="tender_intake_review",
                           criticality="medium", actor=actor)
    for person, role in [(primary, "primary reviewer"), *[(s, "supporting reviewer") for s in support]]:
        await emit_notification(db, org_id=org_id, user_id=str(person["id"]), title="New tender to review",
                                message=f"You are the {role} for '{name}'. Verify it on the source, attach every document "
                                        f"and confirm site visit and bid bond details.",
                                notification_type="tender", priority="high", action_url=TENDER_URL.format(id=tender_id),
                                metadata={"tender_id": tender_id, "workflow": PENDING_REVIEW})
    await record_event(db, org_id=org_id, tender_id=tender_id, action="review_assigned", actor=actor,
                       from_status=CAPTURED, to_status=PENDING_REVIEW, round_no=1,
                       data={"primary_user_id": str(primary["id"]), "primary_name": primary["full_name"],
                             "support_user_ids": [str(s["id"]) for s in support], "due_date": due.isoformat()})
    return {"status": PENDING_REVIEW, "primary": primary, "support": support, "blocked": None}


async def resume_captured(db: AsyncSession, org_id: str, *, actor: Optional[str]) -> int:
    """Start review on every tender left waiting in Captured (saved while no
    reviewers were configured). Returns how many moved to review."""
    ids = (await db.execute(
        text("""SELECT id FROM crm.tenders WHERE organization_id = :org_id AND is_deleted = false
                  AND review_workflow_status = :s ORDER BY created_at"""),
        {"org_id": org_id, "s": CAPTURED},
    )).scalars().all()
    started = 0
    for tender_id in ids:
        result = await start_workflow(db, org_id=org_id, tender_id=str(tender_id), actor=actor, origin="reviewers_configured")
        started += result["status"] == PENDING_REVIEW
    return started


# ----------------------------------------------------------------------------
# Permissions on a tender
# ----------------------------------------------------------------------------

async def _reviewer_ids(db: AsyncSession, org_id: str, tender: dict) -> set[str]:
    ids = {str(tender["review_primary_user_id"])} if tender["review_primary_user_id"] else set()
    ids |= set(_id_list(tender["review_support_user_ids"]))
    ids |= set(_id_list((await get_settings(db, org_id))["review_user_ids"]))
    return ids


async def ensure_can_review(db: AsyncSession, user: dict, tender: dict, *, is_admin: bool) -> None:
    if is_admin:
        return
    if _uid(user) not in await _reviewer_ids(db, user["org_id"], tender):
        raise HTTPException(status_code=403, detail="Only the assigned initial reviewers (or a tender workflow admin) can do this.")


async def ensure_can_qs(db: AsyncSession, user: dict, tender: dict, *, is_admin: bool) -> None:
    if is_admin:
        return
    if tender["qs_assigned_user_id"] and _uid(user) == str(tender["qs_assigned_user_id"]):
        return
    raise HTTPException(status_code=403, detail="Only the QS assigned to this tender (or a tender workflow admin) can do this.")


# ----------------------------------------------------------------------------
# Review: checklist items and recorded facts
# ----------------------------------------------------------------------------

async def update_item(db: AsyncSession, user: dict, tender_id: str, item_key: str, *, status: Optional[str],
                      not_applicable_reason: Optional[str], notes: Optional[str], is_admin: bool) -> dict:
    org_id = user["org_id"]
    tender = await load_tender(db, org_id, tender_id, lock=True)
    if tender["review_workflow_status"] not in REVIEW_OPEN:
        raise HTTPException(status_code=409, detail="The checklist can only be changed while the tender is in initial review.")
    await ensure_can_review(db, user, tender, is_admin=is_admin)
    item = await _row(db, "SELECT * FROM crm.tender_review_items WHERE tender_id = :tid AND item_key = :key FOR UPDATE",
                      {"tid": tender_id, "key": item_key})
    if not item:
        raise HTTPException(status_code=404, detail="Checklist item not found.")
    sets = ["updated_at = NOW()"]
    params: dict[str, Any] = {"id": item["id"]}
    if status is not None:
        if status not in ("pending", "done", "not_applicable"):
            raise HTTPException(status_code=422, detail="Status must be pending, done or not_applicable.")
        reason = (not_applicable_reason or "").strip()
        if status == "not_applicable" and len(reason) < 3:
            raise HTTPException(status_code=422, detail="Give the reason this does not apply.")
        sets += ["status = :status", "not_applicable_reason = :reason", "completed_by = :completed_by",
                 "completed_at = CASE WHEN :reopened THEN NULL ELSE NOW() END"]
        params.update({"status": status, "reason": reason if status == "not_applicable" else None,
                       "completed_by": None if status == "pending" else _uid(user), "reopened": status == "pending"})
    if notes is not None:
        sets.append("notes = :notes")
        params["notes"] = notes.strip()[:4000] or None
    await db.execute(text(f"UPDATE crm.tender_review_items SET {', '.join(sets)} WHERE id = :id"), params)  # nosec B608 - fixed clauses
    await record_event(db, org_id=org_id, tender_id=tender_id, action="review_item_updated", actor=_uid(user),
                       from_status=tender["review_workflow_status"], to_status=tender["review_workflow_status"],
                       round_no=tender["review_round"],
                       data={"item": item_key, "status": status or item["status"], "reason": params.get("reason"),
                             "notes_changed": notes is not None})
    return await _row(db, "SELECT * FROM crm.tender_review_items WHERE id = :id", {"id": item["id"]}) or {}


DETAIL_COLUMNS = {
    "submission_deadline": "timestamp", "submission_instructions": "text", "clarification_deadline": "timestamp",
    "site_visit_status": "site_status", "site_visit_at": "timestamp", "site_visit_location": "text",
    "site_visit_details": "text", "bond_amount": "amount", "bid_security_currency": "currency",
    "bid_security_form": "text", "bid_security_validity": "text", "outstanding_notes": "text",
}


def _coerce_detail(key: str, value: Any) -> Any:
    kind = DETAIL_COLUMNS[key]
    if value in (None, ""):
        return 0 if kind == "amount" else None
    if kind == "timestamp":
        try:
            parsed = datetime.fromisoformat(str(value))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"{key.replace('_', ' ')} must be a date-time, e.g. 2026-11-04T10:00.")
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=HARARE)
    if kind == "amount":
        try:
            amount = float(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Bid bond amount must be a number.")
        if amount < 0:
            raise HTTPException(status_code=422, detail="Bid bond amount cannot be negative.")
        return amount
    if kind == "currency":
        code = str(value).strip().upper()
        if not code.isalpha() or not 3 <= len(code) <= 4:
            raise HTTPException(status_code=422, detail="Currency must be a code such as USD or ZWG.")
        return code
    if kind == "site_status":
        if value not in ("required", "optional", "not_required", "unknown"):
            raise HTTPException(status_code=422, detail="Site visit status must be required, optional, not_required or unknown.")
        return value
    return str(value).strip()[:4000] or None


async def update_details(db: AsyncSession, user: dict, tender_id: str, changes: dict, *, is_admin: bool) -> dict:
    """The facts the review confirms. Old and new values go to the audit trail."""
    org_id = user["org_id"]
    tender = await load_tender(db, org_id, tender_id, lock=True)
    status = tender["review_workflow_status"]
    if status in (PENDING_QS, QS_PREPARATION):
        await ensure_can_qs(db, user, tender, is_admin=is_admin)
    elif status in REVIEW_OPEN or status in (None, CAPTURED):
        await ensure_can_review(db, user, tender, is_admin=is_admin)
    unknown = set(changes) - set(DETAIL_COLUMNS)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Cannot edit: {', '.join(sorted(unknown))}.")
    values = {key: _coerce_detail(key, value) for key, value in changes.items()}
    if not values:
        return tender
    diff = {}
    for key, value in values.items():
        old = tender.get(key)
        if str(old) != str(value):
            diff[key] = {"old": old, "new": value}
    if not diff:
        return tender
    sets = [f"{key} = :{key}" for key in diff]
    if "site_visit_at" in diff or "site_visit_status" in diff or "site_visit_location" in diff:
        sets.append("site_visit_source = 'reviewer'")
    if "site_visit_status" in diff:
        sets.append("site_visit_mandatory = :site_visit_required")
    if {"bond_amount", "bid_security_currency", "bid_security_form", "bid_security_validity"} & set(diff):
        sets.append("bid_security_source = 'reviewer'")
    params = {key: values[key] for key in diff}
    params.update({"id": tender_id, "site_visit_required": values.get("site_visit_status") == "required"})
    await db.execute(text(f"UPDATE crm.tenders SET {', '.join(sets)}, updated_at = NOW() WHERE id = :id"), params)  # nosec B608 - keys from DETAIL_COLUMNS
    await record_event(db, org_id=org_id, tender_id=tender_id, action="details_updated", actor=_uid(user),
                       from_status=status, to_status=status, round_no=tender["review_round"], data={"changes": diff})
    return await load_tender(db, org_id, tender_id)


async def linked_documents(db: AsyncSession, org_id: str, tender_id: str) -> list[dict]:
    return await _rows(
        db,
        """
        SELECT DISTINCT ON (d.id) d.id, d.title, d.file_name, d.file_size_bytes, d.created_at, d.file_attachment_id,
               fa.extraction_status, fa.mime_type, u.full_name AS uploaded_by_name
        FROM core.documents d
        LEFT JOIN core.file_attachments fa ON fa.id = d.file_attachment_id
        LEFT JOIN core.users u ON u.id = d.created_by
        WHERE d.organization_id = :org_id AND d.is_deleted = false
          AND (d.tender_id = :tid OR EXISTS (
                SELECT 1 FROM core.document_links l
                WHERE l.document_id = d.id AND l.entity_type = 'tender' AND l.entity_id = :tid))
        ORDER BY d.id, d.created_at
        """,
        {"org_id": org_id, "tid": tender_id},
    )


def gate_problems(tender: dict, items: list[dict], documents: list[dict]) -> list[str]:
    """Everything that stops the review going to QS. Empty list = may submit."""
    problems: list[str] = []
    by_key = {item["item_key"]: item for item in items}
    for key, label, _ in REVIEW_ITEMS:
        item = by_key.get(key)
        if not item or item["status"] == "pending":
            problems.append(f"Checklist not complete: {label}.")
        elif item["status"] == "not_applicable" and len((item["not_applicable_reason"] or "").strip()) < 3:
            problems.append(f"Give a reason for marking '{label}' not applicable.")

    def done(key: str) -> bool:
        return (by_key.get(key) or {}).get("status") == "done"

    if (done("documents_verified") or done("documents_uploaded")) and not documents:
        problems.append("No documents are attached to this tender - attach them, or mark the document items not applicable with a reason.")
    if done("deadline_verified") and not tender["submission_deadline"]:
        problems.append("Record the verified submission deadline before marking it verified.")
    if done("site_visit_confirmed"):
        if tender["site_visit_status"] not in ("required", "optional", "not_required"):
            problems.append("Record whether a site visit / briefing is required, optional or not required.")
        elif tender["site_visit_status"] in ("required", "optional") and not tender["site_visit_at"]:
            problems.append("Record the site visit / briefing date and time.")
    if done("bid_bond_confirmed") and not (tender["bid_security_form"] or "").strip():
        problems.append("Record the bid bond form (e.g. bank guarantee, cash to PRAZ, bid-securing declaration, none required).")
    return problems


async def _pick_qs(db: AsyncSession, org_id: str, settings: dict) -> Optional[dict]:
    pool = await active_users(db, org_id, _id_list(settings["qs_user_ids"]))
    rule = settings["qs_assignment_rule"]
    if rule == "fixed" and settings["qs_fixed_user_id"]:
        fixed = await active_users(db, org_id, [str(settings["qs_fixed_user_id"])])
        if fixed:
            return fixed[0]
    if not pool:
        return None
    if rule == "least_loaded":
        loads = await _rows(
            db,
            """
            SELECT qs_assigned_user_id AS id, count(*) AS n FROM crm.tenders
            WHERE organization_id = :org_id AND is_deleted = false
              AND review_workflow_status IN ('pending_qs_verification', 'returned_for_correction', 'qs_preparation')
              AND qs_assigned_user_id = ANY(CAST(:ids AS uuid[]))
            GROUP BY qs_assigned_user_id
            """,
            {"org_id": org_id, "ids": [str(p["id"]) for p in pool]},
        )
        load = {str(r["id"]): int(r["n"]) for r in loads}
        return min(pool, key=lambda p: (load.get(str(p["id"]), 0), pool.index(p)))
    cursor = int(settings["qs_cursor"] or 0)
    await db.execute(text("UPDATE crm.tender_automation_settings SET qs_cursor = :c WHERE organization_id = :org_id"),
                     {"c": cursor + 1, "org_id": org_id})
    return pool[cursor % len(pool)]


async def submit_review(db: AsyncSession, user: dict, tender_id: str, *, confirm: bool, note: Optional[str],
                        is_admin: bool) -> dict:
    org_id = user["org_id"]
    actor = _uid(user)
    tender = await load_tender(db, org_id, tender_id, lock=True)
    status = tender["review_workflow_status"]
    if status not in REVIEW_OPEN:
        raise HTTPException(status_code=409, detail=f"The review can only be submitted from initial review (now: {STATUS_LABELS.get(status, status or 'not started')}).")
    await ensure_can_review(db, user, tender, is_admin=is_admin)
    items = await _rows(db, "SELECT * FROM crm.tender_review_items WHERE tender_id = :tid ORDER BY sort_order", {"tid": tender_id})
    documents = await linked_documents(db, org_id, tender_id)
    problems = gate_problems(tender, items, documents)
    if not confirm:
        problems.append("Confirm that you checked the information against the source and the documents.")
    if problems:
        raise HTTPException(status_code=422, detail={"message": "The review is not complete yet.", "problems": problems})

    settings = await get_settings(db, org_id, lock=True)
    qs = None
    if tender["qs_assigned_user_id"]:
        kept = await active_users(db, org_id, [str(tender["qs_assigned_user_id"])])
        qs = kept[0] if kept else None
    resubmission = status == RETURNED
    if not qs:
        qs = await _pick_qs(db, org_id, settings)
    await db.execute(
        text("""
            UPDATE crm.tenders
            SET review_workflow_status = :status, review_submitted_by = :actor, review_submitted_at = NOW(),
                review_confirmation_note = :note, qs_assigned_user_id = :qs,
                qs_assigned_at = CASE WHEN CAST(:qs AS uuid) IS DISTINCT FROM qs_assigned_user_id THEN NOW() ELSE qs_assigned_at END,
                updated_at = NOW()
            WHERE id = :id
        """),
        {"status": PENDING_QS, "actor": actor, "note": (note or "").strip()[:4000] or None,
         "qs": str(qs["id"]) if qs else None, "id": tender_id},
    )
    closed = await _close_tasks(db, org_id=org_id, tender_id=tender_id,
                                source_events=("tender_intake_review", "tender_review_correction"), actor=actor,
                                status="completed", evidence=f"Review submitted to QS (round {tender['review_round']}).")
    name = tender["tender_name"] or "tender"
    data = {"round": tender["review_round"], "resubmission": resubmission, "tasks_completed": closed,
            "qs_user_id": str(qs["id"]) if qs else None, "qs_name": qs["full_name"] if qs else None,
            "qs_rule": settings["qs_assignment_rule"]}
    await record_event(db, org_id=org_id, tender_id=tender_id, action="review_submitted", actor=actor,
                       from_status=status, to_status=PENDING_QS, note=note, round_no=tender["review_round"], data=data)
    if not qs:
        await record_event(db, org_id=org_id, tender_id=tender_id, action="blocked_no_qs", actor=None,
                           from_status=PENDING_QS, to_status=PENDING_QS,
                           note="No active QS is configured - a workflow admin must assign one.")
        return {"status": PENDING_QS, "qs": None, "blocked": "no_qs"}
    await _upsert_task(db, org_id=org_id, tender_id=tender_id,
                       dedupe=f"TENDER_WF:{tender_id}:qs_verify:{tender['review_round']}",
                       title=f"QS verification{' (resubmitted)' if resubmission else ''}: {name}",
                       description=(f"Verify the initial review of '{name}': tender details, every attached document, the "
                                    "deadline, site visit and bid bond. Verify or return it for correction from the tender record."),
                       assignee=str(qs["id"]), due=datetime.now(HARARE).date() + timedelta(days=1), priority="high",
                       source_event="tender_qs_verification", actor=actor)
    await emit_notification(db, org_id=org_id, user_id=str(qs["id"]),
                            title="Tender ready for QS verification" + (" (resubmitted)" if resubmission else ""),
                            message=f"'{name}' passed initial review and is assigned to you. Verify the reviewer's work first.",
                            notification_type="tender", priority="high", action_url=TENDER_URL.format(id=tender_id),
                            metadata={"tender_id": tender_id, "workflow": PENDING_QS})
    await record_event(db, org_id=org_id, tender_id=tender_id, action="qs_assigned", actor=None,
                       from_status=PENDING_QS, to_status=PENDING_QS, round_no=tender["review_round"], data=data)
    return {"status": PENDING_QS, "qs": qs, "blocked": None}


# ----------------------------------------------------------------------------
# QS: verify or return for correction
# ----------------------------------------------------------------------------

async def qs_decision(db: AsyncSession, user: dict, tender_id: str, *, decision: str, notes: Optional[str],
                      reopen_items: list[str], is_admin: bool) -> dict:
    org_id = user["org_id"]
    actor = _uid(user)
    tender = await load_tender(db, org_id, tender_id, lock=True)
    if tender["review_workflow_status"] != PENDING_QS:
        raise HTTPException(status_code=409, detail="Only a tender pending QS verification can be verified or returned.")
    await ensure_can_qs(db, user, tender, is_admin=is_admin)
    name = tender["tender_name"] or "tender"
    notes = (notes or "").strip()
    round_no = int(tender["review_round"] or 1)

    if decision == "return":
        if len(notes) < 10:
            raise HTTPException(status_code=422, detail="Explain what must be corrected (at least a sentence).")
        bad = [key for key in reopen_items if key not in ITEM_LABELS]
        if bad:
            raise HTTPException(status_code=422, detail=f"Unknown checklist items: {', '.join(bad)}.")
        if reopen_items:
            await db.execute(
                text("""
                    UPDATE crm.tender_review_items
                    SET status = 'pending', completed_by = NULL, completed_at = NULL, not_applicable_reason = NULL,
                        reopened_count = reopened_count + 1, reopened_note = :note, updated_at = NOW()
                    WHERE tender_id = :tid AND item_key = ANY(CAST(:keys AS text[]))
                """),
                {"tid": tender_id, "keys": reopen_items, "note": notes[:2000]},
            )
        new_round = round_no + 1
        await db.execute(
            text("UPDATE crm.tenders SET review_workflow_status = :s, review_round = :r, updated_at = NOW() WHERE id = :id"),
            {"s": RETURNED, "r": new_round, "id": tender_id},
        )
        await _close_tasks(db, org_id=org_id, tender_id=tender_id, source_events=("tender_qs_verification",), actor=actor,
                           status="completed", evidence=f"Returned to initial review for correction (round {round_no}).")
        primary = str(tender["review_primary_user_id"]) if tender["review_primary_user_id"] else None
        if primary:
            reopened = ", ".join(ITEM_LABELS[k] for k in reopen_items) or "none reopened - see notes"
            await _upsert_task(db, org_id=org_id, tender_id=tender_id,
                               dedupe=f"TENDER_WF:{tender_id}:correction:{new_round}",
                               title=f"Correct tender review: {name}",
                               description=f"QS returned '{name}' for correction:\n{notes}\n\nReopened items: {reopened}.\n"
                                           "Fix it on the tender record and resubmit to QS.",
                               assignee=primary, due=datetime.now(HARARE).date() + timedelta(days=1), priority="urgent",
                               source_event="tender_review_correction", actor=actor)
        for person in {p for p in [primary, *_id_list(tender["review_support_user_ids"])] if p}:
            await emit_notification(db, org_id=org_id, user_id=person, title="Tender returned for correction",
                                    message=f"QS returned '{name}': {notes[:300]}", notification_type="tender",
                                    priority="high", action_url=TENDER_URL.format(id=tender_id),
                                    metadata={"tender_id": tender_id, "workflow": RETURNED})
        await record_event(db, org_id=org_id, tender_id=tender_id, action="returned_for_correction", actor=actor,
                           from_status=PENDING_QS, to_status=RETURNED, note=notes, round_no=new_round,
                           data={"reopened_items": reopen_items})
        return {"status": RETURNED, "round": new_round}

    if decision != "verified":
        raise HTTPException(status_code=422, detail="Decision must be verified or return.")
    await db.execute(
        text("""
            UPDATE crm.tenders
            SET review_workflow_status = :s, qs_verified_by = :actor, qs_verified_at = NOW(),
                stage = CASE WHEN stage = 'Tender Identified' THEN 'Bid Prep' ELSE stage END, updated_at = NOW()
            WHERE id = :id
        """),
        {"s": QS_PREPARATION, "actor": actor, "id": tender_id},
    )
    await _close_tasks(db, org_id=org_id, tender_id=tender_id, source_events=("tender_qs_verification",), actor=actor,
                       status="completed", evidence="QS verified the initial review.")
    tasks = await _create_preparation_tasks(db, org_id=org_id, tender=tender, actor=actor, notes=notes)
    await record_event(db, org_id=org_id, tender_id=tender_id, action="qs_verified", actor=actor,
                       from_status=PENDING_QS, to_status=QS_PREPARATION, note=notes or None, round_no=round_no,
                       data={"preparation_tasks": tasks,
                             "stage_moved_to_bid_prep": tender["stage"] == "Tender Identified"})
    return {"status": QS_PREPARATION, "tasks": tasks}


async def _create_preparation_tasks(db: AsyncSession, *, org_id: str, tender: dict, actor: Optional[str],
                                    notes: str) -> list[str]:
    tender_id = str(tender["id"])
    qs = str(tender["qs_assigned_user_id"]) if tender["qs_assigned_user_id"] else actor
    name = tender["tender_name"] or "tender"
    today = datetime.now(HARARE).date()
    deadline = tender["submission_deadline"]
    deadline_day = deadline.astimezone(HARARE).date() if deadline else None
    created: list[str] = []
    visit_at = tender["site_visit_at"]
    if tender["site_visit_status"] in ("required", "optional") and visit_at and visit_at > datetime.now(timezone.utc):
        visit_day = visit_at.astimezone(HARARE)
        where = f" at {tender['site_visit_location']}" if tender["site_visit_location"] else ""
        task = await _upsert_task(
            db, org_id=org_id, tender_id=tender_id, dedupe=f"TENDER_WF:{tender_id}:qs_prep:site_visit",
            title=f"Prepare for and attend the site visit: {name}",
            description=(f"{'Compulsory' if tender['site_visit_status'] == 'required' else 'Optional'} site visit / briefing on "
                         f"{visit_day:%d %b %Y %H:%M}{where}. Bring what the bidding document asks for and collect the "
                         f"attendance certificate.\n{tender['site_visit_details'] or ''}"),
            assignee=qs, due=max(today, visit_day.date() - timedelta(days=1)), priority="urgent",
            source_event=PREPARATION_EVENT, actor=actor)
        if task:
            created.append(task)
    boq_due = max(today, deadline_day - timedelta(days=3)) if deadline_day else today + timedelta(days=5)
    task = await _upsert_task(
        db, org_id=org_id, tender_id=tender_id, dedupe=f"TENDER_WF:{tender_id}:qs_prep:boq",
        title=f"Prepare, review and price the BOQ: {name}",
        description="Take the BOQ from the attached bidding documents, take off and price it, and get it reviewed before the deadline.",
        assignee=qs, due=boq_due, priority="high", source_event=PREPARATION_EVENT, actor=actor)
    if task:
        created.append(task)
    outstanding = (tender["outstanding_notes"] or "").strip()
    if outstanding or notes:
        clarification_due = tender["clarification_deadline"].astimezone(HARARE).date() if tender["clarification_deadline"] else boq_due
        task = await _upsert_task(
            db, org_id=org_id, tender_id=tender_id, dedupe=f"TENDER_WF:{tender_id}:qs_prep:clarifications",
            title=f"Follow up missing technical information / clarifications: {name}",
            description=("Outstanding from review:\n" + (outstanding or "-") + (f"\n\nQS notes:\n{notes}" if notes else "")
                         + "\nSend clarification requests before the clarification deadline."),
            assignee=qs, due=max(today, clarification_due), priority="high", source_event=PREPARATION_EVENT,
            actor=actor)
        if task:
            created.append(task)
    return created


# ----------------------------------------------------------------------------
# Admin: reassign
# ----------------------------------------------------------------------------

async def reassign(db: AsyncSession, user: dict, tender_id: str, *, role: str, user_id: str) -> dict:
    org_id = user["org_id"]
    tender = await load_tender(db, org_id, tender_id, lock=True)
    people = await active_users(db, org_id, [user_id])
    if not people:
        raise HTTPException(status_code=404, detail="That person is not an active user.")
    person = people[0]
    if role == "primary_reviewer":
        if tender["review_workflow_status"] not in REVIEW_OPEN:
            raise HTTPException(status_code=409, detail="The primary reviewer can only change during initial review.")
        column, events = "review_primary_user_id", ("tender_intake_review", "tender_review_correction")
    elif role == "qs":
        if tender["review_workflow_status"] not in (PENDING_QS, RETURNED, QS_PREPARATION):
            raise HTTPException(status_code=409, detail="A QS is only assigned once the review has been submitted.")
        column, events = "qs_assigned_user_id", ("tender_qs_verification", PREPARATION_EVENT)
    else:
        raise HTTPException(status_code=422, detail="Role must be primary_reviewer or qs.")
    old = str(tender[column]) if tender[column] else None
    await db.execute(text(f"UPDATE crm.tenders SET {column} = :uid{', qs_assigned_at = NOW()' if role == 'qs' else ''}, updated_at = NOW() WHERE id = :id"),  # nosec B608 - fixed columns
                     {"uid": user_id, "id": tender_id})
    if role == "primary_reviewer":
        # The primary's open review task follows the role; a supporting
        # reviewer keeps their own task.
        await db.execute(
            text("""
                UPDATE crm.tasks SET assigned_to_user_id = :uid, updated_at = NOW()
                WHERE organization_id = :org_id AND entity_type = 'tender' AND entity_id = :tid AND generation_rule = :rule
                  AND source_event = ANY(CAST(:events AS text[])) AND assigned_to_user_id = CAST(:old AS uuid)
                  AND status NOT IN ('completed', 'cancelled', 'superseded') AND is_deleted = false
            """),
            {"uid": user_id, "org_id": org_id, "tid": tender_id, "rule": GATE_RULE, "events": list(events), "old": old},
        )
    else:
        await db.execute(
            text("""
                UPDATE crm.tasks SET assigned_to_user_id = :uid, updated_at = NOW()
                WHERE organization_id = :org_id AND entity_type = 'tender' AND entity_id = :tid AND generation_rule = :rule
                  AND source_event = ANY(CAST(:events AS text[]))
                  AND status NOT IN ('completed', 'cancelled', 'superseded') AND is_deleted = false
            """),
            {"uid": user_id, "org_id": org_id, "tid": tender_id, "rule": GATE_RULE, "events": list(events)},
        )
    await emit_notification(db, org_id=org_id, user_id=user_id, title="Tender assigned to you",
                            message=f"You are now the {'primary reviewer' if role == 'primary_reviewer' else 'QS'} for '{tender['tender_name']}'.",
                            notification_type="tender", priority="high", action_url=TENDER_URL.format(id=tender_id),
                            metadata={"tender_id": tender_id})
    await record_event(db, org_id=org_id, tender_id=tender_id, action=f"reassigned_{role}", actor=_uid(user),
                       from_status=tender["review_workflow_status"], to_status=tender["review_workflow_status"],
                       data={"from_user_id": old, "to_user_id": user_id, "to_name": person["full_name"]})
    return {"role": role, "user_id": user_id}


# ----------------------------------------------------------------------------
# Guards for the generic tender endpoints (routers/tender_bids.py)
# ----------------------------------------------------------------------------

# Only this module writes these - never a generic create/update payload.
WORKFLOW_MANAGED_COLUMNS = frozenset({
    "review_workflow_status", "review_round", "review_primary_user_id", "review_support_user_ids",
    "review_started_at", "review_submitted_by", "review_submitted_at", "review_confirmation_note",
    "qs_assigned_user_id", "qs_assigned_at", "qs_verified_by", "qs_verified_at", "source_material_status",
    "site_visit_source", "bid_security_source",
})
PRE_QS_STATUSES = (CAPTURED, PENDING_REVIEW, RETURNED, PENDING_QS)
PREPARATION_STAGES = ("Bid Prep", "Submitted", "Adjudication")


def reject_managed_columns(keys: Iterable[str]) -> None:
    managed = sorted(set(keys) & WORKFLOW_MANAGED_COLUMNS)
    if managed:
        raise HTTPException(status_code=400, detail=f"{', '.join(managed)} are managed by the tender review workflow - "
                                                    "use the review and QS actions on the tender record.")


def person_entered_source_columns(keys: Iterable[str]) -> dict[str, str]:
    """A person editing the site visit or bid bond directly: tag the value as
    theirs so a later e-GP collection never overwrites it."""
    keys = set(keys)
    tags: dict[str, str] = {}
    if keys & {"site_visit_at", "site_visit_mandatory", "site_visit_status", "site_visit_location"}:
        tags["site_visit_source"] = "reviewer"
    if keys & {"bond_amount", "bid_security_currency", "bid_security_form", "bid_security_validity"}:
        tags["bid_security_source"] = "reviewer"
    return tags


def ensure_stage_allowed(workflow_status: Optional[str], next_stage: Optional[str]) -> None:
    if workflow_status in PRE_QS_STATUSES and next_stage in PREPARATION_STAGES:
        raise HTTPException(status_code=409, detail=(
            f"This tender is still in {STATUS_LABELS[workflow_status]}. It moves to Bid Prep when the QS verifies the "
            "initial review - finish the review and QS verification first."))
