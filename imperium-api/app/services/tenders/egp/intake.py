"""Review, import, recheck and change handling for staged e-GP notices.

Import creates (or links) the canonical crm.tenders row and, in the same
transaction, its published-requirement checklist, SNC's internal checklist
and internal tasks. Every insert is keyed so that a retry, a double click or
two reviewers importing together land on the same rows:

  tender        unique (organization_id, source_key, source_notice_id)
  requirements  unique (organization_id, tender_id, dedupe_key)
  tasks         crm.tasks deduplication_key  EGP_INTAKE:{tender}:{code}

Source refresh never writes user-maintained tender fields (budget, owner,
stage, notes, bid decision). Changes found on recheck are stored as pending
crm.tender_source_changes and only touch the tender when a person applies
them - and even then a field the user has already edited is left alone.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import PurePosixPath
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.tenders.egp import portal
from app.services.tenders.egp.discovery import (
    _candidate_documents,
    _row,
    _rows,
    ClientFactory,
    _client_factory,
    ensure_default_profile,
    ensure_source,
    fetch_detail_page,
    load_credentials,
    profile_dict,
    save_candidate_version,
)
from app.services.tenders.egp.matching import assess_readiness, effective_fields, score_candidate
from app.services.tenders.egp.parser import HARARE, SOURCE_TIMEZONE
from app.services.tenders.pipeline import on_tender_entered
from app.services.tenders.workflow import get_settings as get_workflow_settings
from app.shared.events import emit_event, emit_notification
from core.logging import logger

EDITABLE_FIELDS = {
    "title", "official_reference", "procuring_entity", "project_location", "procurement_method", "description",
    "closing_at", "site_visit", "clarification_deadline", "bid_security", "required_bid_documents",
    "estimated_value", "official_contact",
}
ALLOWED_DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".png", ".jpg", ".jpeg"}
MAX_DOCUMENT_BYTES = 30 * 1024 * 1024
TENDER_URL = "/dashboard/crm/tenders/{id}"


def _j(value: Any) -> str:
    return json.dumps(value, default=str)


def _uid(user: dict) -> Optional[str]:
    return user.get("user_id") or user.get("sub")


def _value(fields: dict, key: str) -> Any:
    item = fields.get(key)
    return item.get("value") if isinstance(item, dict) else None


def _clip(value: Optional[str], length: int) -> Optional[str]:
    if value is None:
        return None
    value = str(value).strip()
    return value[:length] if value else None


async def _require_user_in_org(db: AsyncSession, org_id: str, user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None
    try:
        UUID(str(user_id))
    except ValueError:
        raise HTTPException(status_code=422, detail="Responsible person is not a valid user id.")
    found = (await db.execute(
        text("SELECT 1 FROM core.users WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": str(user_id), "org_id": org_id},
    )).first()
    if not found:
        raise HTTPException(status_code=404, detail="Responsible person not found in this organisation.")
    return str(user_id)


async def load_candidate(db: AsyncSession, org_id: str, candidate_id: str, *, lock: bool = False) -> dict:
    try:
        UUID(str(candidate_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Candidate not found.")
    row = await _row(
        db,
        f"SELECT * FROM crm.tender_candidates WHERE id = :id AND organization_id = :org_id{' FOR UPDATE' if lock else ''}",
        {"id": str(candidate_id), "org_id": org_id},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Candidate not found.")
    return row


# ----------------------------------------------------------------------------
# Review: corrections, owner, review date, reject / defer
# ----------------------------------------------------------------------------

def normalise_correction(key: str, value: Any) -> Any:
    if key not in EDITABLE_FIELDS:
        raise HTTPException(status_code=422, detail=f"'{key}' cannot be corrected here.")
    if key == "closing_at":
        if value in (None, ""):
            return None
        try:
            parsed = datetime.fromisoformat(str(value))
        except ValueError:
            raise HTTPException(status_code=422, detail="Closing date/time must be an ISO date-time, e.g. 2026-11-04T10:00.")
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=HARARE)
        return {"at": parsed.isoformat(), "date": parsed.date().isoformat(), "time_specified": True, "timezone": SOURCE_TIMEZONE}
    if value is None:
        return None
    text_value = str(value).strip()
    if len(text_value) > 4000:
        raise HTTPException(status_code=422, detail=f"'{key}' is too long.")
    return text_value or None


async def rescore(db: AsyncSession, org_id: str, candidate: dict) -> dict:
    profile = await ensure_default_profile(db, org_id, None)
    credentials = await load_credentials(db, org_id)
    effective = effective_fields(candidate["fields"] or {}, candidate["corrections"] or {})
    scored = score_candidate(effective, profile_dict(profile), credentials=credentials)
    documents = await _candidate_documents(db, candidate["id"])
    readiness, gaps = assess_readiness(detail_status=candidate["detail_status"], conflicts=candidate["conflicts"] or [],
                                       missing_evidence=scored["missing_evidence"], documents=documents)
    await db.execute(
        text("""
            UPDATE crm.tender_candidates
            SET relevance_score = :score, relevance_band = :band, match_reasons = CAST(:reasons AS jsonb),
                missing_evidence = CAST(:missing AS jsonb), readiness = :readiness, updated_at = NOW()
            WHERE id = :id
        """),
        {"score": scored["score"], "band": scored["band"], "reasons": _j(scored["reasons"]), "missing": _j(gaps),
         "readiness": readiness, "id": candidate["id"]},
    )
    return {"score": scored["score"], "band": scored["band"], "readiness": readiness}


async def update_review(db: AsyncSession, user: dict, candidate_id: str, payload: dict) -> dict:
    org_id = user["org_id"]
    candidate = await load_candidate(db, org_id, candidate_id, lock=True)
    corrections = dict(candidate["corrections"] or {})
    for key, value in (payload.get("corrections") or {}).items():
        normalised = normalise_correction(key, value)
        if normalised is None:
            corrections.pop(key, None)
        else:
            corrections[key] = {"value": normalised, "by": _uid(user), "at": datetime.now(timezone.utc).isoformat(),
                                "note": _clip((payload.get("correction_notes") or {}).get(key), 500)}
    sets = ["corrections = CAST(:corrections AS jsonb)", "updated_at = NOW()"]
    params: dict[str, Any] = {"corrections": _j(corrections), "id": candidate["id"]}
    if "responsible_user_id" in payload:
        params["responsible"] = await _require_user_in_org(db, org_id, payload.get("responsible_user_id"))
        sets.append("responsible_user_id = CAST(:responsible AS uuid)")
    if "internal_review_date" in payload:
        params["review_date"] = date.fromisoformat(payload["internal_review_date"]) if payload.get("internal_review_date") else None
        sets.append("internal_review_date = :review_date")
    status_value = payload.get("review_status")
    if status_value:
        if status_value not in ("new", "deferred", "rejected"):
            raise HTTPException(status_code=422, detail="Review status must be new, deferred or rejected (use import to import).")
        if candidate["review_status"] == "imported":
            raise HTTPException(status_code=409, detail="This notice is already imported; manage it from the tender.")
        if status_value == "rejected" and not (payload.get("review_note") or "").strip():
            raise HTTPException(status_code=422, detail="Give a short reason when rejecting a notice.")
        sets += ["review_status = :status", "reviewed_by = :user_id", "reviewed_at = NOW()"]
        params.update({"status": status_value, "user_id": _uid(user)})
    if "review_note" in payload:
        sets.append("review_note = :note")
        params["note"] = _clip(payload.get("review_note"), 2000)
    await db.execute(text(f"UPDATE crm.tender_candidates SET {', '.join(sets)} WHERE id = :id"), params)  # nosec B608 - fixed clauses
    candidate = await load_candidate(db, org_id, candidate_id)
    scored = await rescore(db, org_id, candidate)
    if status_value:
        await emit_event(db, user={"org_id": org_id, "user_id": _uid(user)}, event_type=f"tender.egp_candidate.{status_value}.v1",
                         aggregate_type="tender_candidate", aggregate_id=candidate["id"],
                         event_data={"note": params.get("note"), "notice_id": candidate["source_notice_id"]},
                         idempotency_suffix=datetime.now(timezone.utc).isoformat())
    return {"id": str(candidate["id"]), **scored}


# ----------------------------------------------------------------------------
# Import
# ----------------------------------------------------------------------------

def _dedupe_key(*parts: Any) -> str:
    raw = ":".join(str(p) for p in parts)
    return raw if len(raw) <= 160 else raw[:120] + ":" + hashlib.sha1(raw.encode(), usedforsecurity=False).hexdigest()[:20]


async def _find_possible_duplicates(db: AsyncSession, org_id: str, *, notice_id: str, reference: Optional[str],
                                    title: Optional[str], url: Optional[str]) -> list[dict]:
    return await _rows(
        db,
        """
        SELECT id, tender_name, bid_number, source_notice_id, stage
        FROM crm.tenders
        WHERE organization_id = :org_id AND is_deleted = false
          AND COALESCE(source_notice_id, '') <> :notice_id
          AND (
               (CAST(:reference AS text) IS NOT NULL AND lower(trim(bid_number)) = lower(trim(CAST(:reference AS text))))
            OR (CAST(:title AS text) IS NOT NULL AND lower(trim(tender_name)) = lower(trim(CAST(:title AS text))))
            OR (CAST(:url AS text) IS NOT NULL AND source_url = CAST(:url AS text))
          )
        ORDER BY created_at DESC
        LIMIT 5
        """,
        {"org_id": org_id, "notice_id": notice_id, "reference": reference, "title": title, "url": url},
    )


async def _add_requirement(db: AsyncSession, *, org_id: str, tender_id: str, user_id: Optional[str], key: str, label: str,
                           category: str, severity: str, source: str, sort_order: int, excerpt: Optional[str] = None,
                           source_url: Optional[str] = None, section: Optional[str] = None, mandatory: bool = True,
                           responsible_user_id: Optional[str] = None, due_date: Optional[date] = None) -> Optional[str]:
    dedupe = _dedupe_key("egp", key)
    row = (await db.execute(
        text("""
            INSERT INTO crm.tender_requirements (
                organization_id, tender_id, label, category, severity, status, mandatory, source, sort_order,
                source_url, source_excerpt, source_section, dedupe_key, responsible_user_id, due_date, created_by
            ) VALUES (
                :org_id, :tender_id, :label, :category, :severity, 'PENDING', :mandatory, :source, :sort_order,
                :source_url, :excerpt, :section, :dedupe, :responsible, :due_date, :user_id
            )
            ON CONFLICT (organization_id, tender_id, dedupe_key) WHERE is_deleted = false AND dedupe_key IS NOT NULL
            DO NOTHING
            RETURNING id
        """),
        {"org_id": org_id, "tender_id": tender_id, "label": label[:255], "category": category, "severity": severity,
         "mandatory": mandatory, "source": source, "sort_order": sort_order, "source_url": source_url,
         "excerpt": (excerpt or "")[:2000] or None, "section": _clip(section, 255), "dedupe": dedupe,
         "responsible": responsible_user_id, "due_date": due_date, "user_id": user_id},
    )).first()
    if row:
        return str(row[0])
    existing = (await db.execute(
        text("SELECT id FROM crm.tender_requirements WHERE organization_id = :org_id AND tender_id = :tender_id AND dedupe_key = :dedupe AND is_deleted = false"),
        {"org_id": org_id, "tender_id": tender_id, "dedupe": dedupe},
    )).scalar()
    return str(existing) if existing else None


async def _add_task(db: AsyncSession, *, org_id: str, tender_id: str, user_id: Optional[str], code: str, title: str,
                    description: str, assignee: Optional[str], due: Optional[date], priority: str,
                    requirement_id: Optional[str]) -> str:
    dedupe = f"EGP_INTAKE:{tender_id}:{code}"
    row = (await db.execute(
        text("""
            INSERT INTO crm.tasks (
                organization_id, title, description, entity_type, entity_id, assigned_to_user_id, due_date,
                status, priority, created_by, primary_entity_type, primary_entity_id, source_event,
                expected_outcome, deduplication_key
            ) VALUES (
                :org_id, :title, :description, 'tender', :tender_id, :assignee, :due, 'not_started', :priority,
                :user_id, 'tender', :tender_id, 'egp_tender_import', :outcome, :dedupe
            )
            -- Must repeat the partial unique index predicate (idx_crm_tasks_dedupe_active).
            ON CONFLICT (organization_id, deduplication_key)
                WHERE is_deleted = false AND status NOT IN ('cancelled', 'superseded')
            DO NOTHING
            RETURNING id
        """),
        {"org_id": org_id, "title": title[:255], "outcome": title, "description": description, "tender_id": tender_id, "assignee": assignee,
         "due": due, "priority": priority, "user_id": user_id, "dedupe": dedupe},
    )).first()
    task_id = str(row[0]) if row else str((await db.execute(
        text("""SELECT id FROM crm.tasks WHERE organization_id = :org_id AND deduplication_key = :dedupe
                AND is_deleted = false AND status NOT IN ('cancelled', 'superseded') LIMIT 1"""),
        {"org_id": org_id, "dedupe": dedupe},
    )).scalar())
    if requirement_id:
        await db.execute(
            text("UPDATE crm.tender_requirements SET linked_task_id = :task_id, updated_at = NOW() WHERE id = :id AND linked_task_id IS NULL"),
            {"task_id": task_id, "id": requirement_id},
        )
    return task_id


async def build_checklists(db: AsyncSession, *, org_id: str, tender_id: str, user_id: Optional[str], candidate: dict,
                           fields: dict, responsible: Optional[str], review_date: Optional[date],
                           create_tasks: bool = True) -> dict:
    """Published requirements (source EGP_PUBLISHED, each with its excerpt)
    and SNC's internal checklist (source SNC_INTERNAL) are separate rows.
    create_tasks=False when the intake workflow owns the first tasks (its
    review tasks replace the decision/documents tasks created here)."""
    published: list[str] = []
    internal: list[str] = []
    tasks: list[str] = []
    order = 100

    def ev(key: str) -> dict:
        return fields.get(key) or {}

    categories = _value(fields, "required_categories")
    codes = _value(fields, "category_codes") or []
    if categories:
        label = "Registered in required supplier category: " + categories + (f" ({', '.join(codes)})" if codes else "")
        rid = await _add_requirement(db, org_id=org_id, tender_id=tender_id, user_id=user_id, key="pub:categories",
                                     label=label, category="PRAZ", severity="CRITICAL", source="EGP_PUBLISHED",
                                     sort_order=order, excerpt=ev("required_categories").get("excerpt"),
                                     source_url=ev("required_categories").get("source_url"), section=ev("required_categories").get("section"))
        published.append(rid)
    for key, label_fmt, category, severity in (
        ("bid_validity_days", "Bid validity period: {} days", "TENDER_FORMS_DECLARATIONS", "MAJOR"),
        ("bid_form_fee", "Bid form fee stated on notice: {}", "TENDER_SPECIFIC_FEES", "MAJOR"),
        ("delivery_period", "Delivery / contract period stated on notice: {}", "TECHNICAL_CAPABILITY", "INFORMATIONAL"),
        ("procurement_method", "Procurement method: {}", "TENDER_FORMS_DECLARATIONS", "INFORMATIONAL"),
    ):
        value = _value(fields, key)
        if value in (None, ""):
            continue
        order += 1
        rid = await _add_requirement(db, org_id=org_id, tender_id=tender_id, user_id=user_id, key=f"pub:{key}",
                                     label=label_fmt.format(value), category=category, severity=severity,
                                     source="EGP_PUBLISHED", sort_order=order, excerpt=ev(key).get("excerpt"),
                                     source_url=ev(key).get("source_url"), section=ev(key).get("section"),
                                     mandatory=severity != "INFORMATIONAL")
        published.append(rid)
    addenda = _value(fields, "addenda_count")
    if isinstance(addenda, int) and addenda > 0:
        order += 1
        published.append(await _add_requirement(
            db, org_id=org_id, tender_id=tender_id, user_id=user_id, key=f"pub:addenda:{addenda}",
            label=f"{addenda} addendum/addenda published on e-GP - obtain and read each one", category="TENDER_FORMS_DECLARATIONS",
            severity="CRITICAL", source="EGP_PUBLISHED", sort_order=order, excerpt=ev("addenda_count").get("excerpt"),
            source_url=ev("addenda_count").get("source_url"), section=ev("addenda_count").get("section")))

    closing = _value(fields, "closing_at") or {}
    closing_at = datetime.fromisoformat(closing["at"]) if closing.get("at") else None
    doc_due = None
    if closing_at:
        doc_due = min(filter(None, [review_date, (closing_at - timedelta(days=5)).astimezone(HARARE).date()]))
    internal_items = [
        ("decision", "Bid / no-bid decision for this e-GP notice", "COMMERCIAL_BOQ", "CRITICAL", review_date, "high",
         "Decide whether SNC bids. Relevance score and missing evidence are on the discovery record; eligibility is not assumed."),
        ("documents", "Confirm every official bidding document is attached here", "TENDER_FORMS_DECLARATIONS",
         "CRITICAL", doc_due, "high", "AEGIS downloads the documents the e-GP notice lists; anything it could not download, "
         "or anything only available elsewhere, is attached by the reviewer. AEGIS never purchases documents."),
        ("praz_check", "Confirm SNC holds a valid PRAZ registration in the required category", "PRAZ", "CRITICAL", review_date, "normal",
         "Check against the corporate credentials vault - none are assumed."),
        ("site_visit", "Confirm any mandatory site visit / pre-bid meeting from the bidding documents", "SITE_VISIT", "MAJOR", doc_due, "normal",
         "The e-GP schedule shows a pre-bid meeting at most; the bidding document can require a compulsory site visit."),
        ("bid_security", "Confirm bid security requirement (amount, form, validity) from the bidding documents", "BID_SECURITY", "MAJOR", doc_due, "normal",
         "The notice shows an amount at most; form and validity are in the bidding documents."),
    ]
    if not closing_at:
        internal_items.append(("closing_time", "Confirm the closing date and time - not stated precisely on the notice", "TENDER_FORMS_DECLARATIONS",
                               "FATAL", review_date, "urgent", "Do not assume a closing time."))
    for conflict in candidate.get("conflicts") or []:
        internal_items.append((f"conflict:{conflict.get('field')}", f"Resolve conflicting source values for {str(conflict.get('field')).replace('_', ' ')}",
                               "TENDER_FORMS_DECLARATIONS", "MAJOR", review_date, "high", "The notice page and the Bulletin Board disagree."))
    for code, label, category, severity, due, priority, description in internal_items:
        order += 1
        rid = await _add_requirement(db, org_id=org_id, tender_id=tender_id, user_id=user_id, key=f"snc:{code}", label=label,
                                     category=category, severity=severity, source="SNC_INTERNAL", sort_order=order,
                                     responsible_user_id=responsible, due_date=due)
        internal.append(rid)
        if create_tasks and code in ("decision", "documents", "closing_time"):
            tasks.append(await _add_task(db, org_id=org_id, tender_id=tender_id, user_id=user_id, code=code, title=label,
                                         description=description, assignee=responsible, due=due, priority=priority,
                                         requirement_id=rid))
    return {"published_requirement_ids": [r for r in published if r], "internal_requirement_ids": [r for r in internal if r],
            "task_ids": tasks}


async def import_candidates(db: AsyncSession, user: dict, items: list[dict], *, responsible_user_id: Optional[str],
                            internal_review_date: Optional[str]) -> list[dict]:
    """One savepoint per notice: a problem with one never half-imports
    another. The caller commits once at the end."""
    org_id = user["org_id"]
    actor = _uid(user)
    default_responsible = await _require_user_in_org(db, org_id, responsible_user_id)
    default_review = date.fromisoformat(internal_review_date) if internal_review_date else None
    results: list[dict] = []
    for item in items:
        candidate_id = str(item.get("candidate_id") or "")
        try:
            async with db.begin_nested():
                results.append(await _import_one(db, user, org_id, actor, candidate_id, item,
                                                 default_responsible, default_review))
        except HTTPException as exc:
            results.append({"candidate_id": candidate_id, "status": "failed", "message": str(exc.detail)})
        except Exception as exc:  # noqa: BLE001 - reported per item, never as success
            logger.exception("egp_import.item_failed", candidate_id=candidate_id)
            results.append({"candidate_id": candidate_id, "status": "failed", "message": f"Import failed: {type(exc).__name__}"})
    return results


async def _import_one(db: AsyncSession, user: dict, org_id: str, actor: Optional[str], candidate_id: str, item: dict,
                      default_responsible: Optional[str], default_review: Optional[date]) -> dict:
    candidate = await load_candidate(db, org_id, candidate_id, lock=True)
    if candidate["review_status"] == "imported" and candidate["tender_id"]:
        live = (await db.execute(text("SELECT 1 FROM crm.tenders WHERE id = :id AND is_deleted = false"), {"id": candidate["tender_id"]})).first()
        if live:
            return {"candidate_id": candidate_id, "status": "already_imported", "tender_id": str(candidate["tender_id"]),
                    "tender_url": TENDER_URL.format(id=candidate["tender_id"]), "message": "Already imported - no duplicate created."}

    responsible = await _require_user_in_org(db, org_id, item.get("responsible_user_id")) if item.get("responsible_user_id") else (
        str(candidate["responsible_user_id"]) if candidate["responsible_user_id"] else default_responsible)
    review_date = date.fromisoformat(item["internal_review_date"]) if item.get("internal_review_date") else (
        candidate["internal_review_date"] or default_review)
    fields = effective_fields(candidate["fields"] or {}, candidate["corrections"] or {})
    title = _clip(_value(fields, "title") or _value(fields, "project_name"), 255)
    if not title:
        raise HTTPException(status_code=422, detail="This notice has no title captured - correct it before importing.")
    reference = _clip(_value(fields, "official_reference"), 100)
    notice_url = portal.normalize_notice_url(candidate["notice_url"])

    # 1. Same official notice already in the pipeline -> link, never duplicate.
    existing = await _row(
        db,
        "SELECT id FROM crm.tenders WHERE organization_id = :org_id AND source_key = :key AND source_notice_id = :nid AND is_deleted = false",
        {"org_id": org_id, "key": candidate["source_key"], "nid": candidate["source_notice_id"]},
    )
    status_value = "linked_existing" if existing else "imported"
    tender_id = str(existing["id"]) if existing else None

    # 2. Explicit link to a tender someone entered by hand.
    if not tender_id and item.get("link_to_tender_id"):
        target = await _row(
            db,
            "SELECT id, source_notice_id FROM crm.tenders WHERE id = CAST(:id AS uuid) AND organization_id = :org_id AND is_deleted = false FOR UPDATE",
            {"id": str(item["link_to_tender_id"]), "org_id": org_id},
        )
        if not target:
            raise HTTPException(status_code=404, detail="Tender to link was not found.")
        if target["source_notice_id"] and target["source_notice_id"] != candidate["source_notice_id"]:
            raise HTTPException(status_code=409, detail="That tender is already linked to a different e-GP notice.")
        tender_id = str(target["id"])
        status_value = "linked_existing"
        await db.execute(
            text("""
                UPDATE crm.tenders
                SET source_key = :key, source_notice_id = :nid, source_url = :url, source_reference = :ref,
                    procuring_entity = COALESCE(procuring_entity, :entity), procurement_method = COALESCE(procurement_method, :method),
                    source_status = :status, source_timezone = :tz, source_first_seen_at = :first_seen,
                    source_last_checked_at = :checked, source_candidate_id = :cid, updated_at = NOW()
                WHERE id = :id
            """),
            {"key": candidate["source_key"], "nid": candidate["source_notice_id"], "url": notice_url, "ref": reference,
             "entity": _clip(_value(fields, "procuring_entity"), 255), "method": _clip(_value(fields, "procurement_method"), 120),
             "status": _clip(candidate["notice_status"], 60), "tz": candidate["source_timezone"], "first_seen": candidate["first_seen_at"],
             "checked": candidate["last_checked_at"], "cid": candidate["id"], "id": tender_id},
        )

    # 3. Uncertain matches by reference / title / URL -> a person decides.
    if not tender_id and not item.get("create_new"):
        duplicates = await _find_possible_duplicates(db, org_id, notice_id=candidate["source_notice_id"], reference=reference,
                                                     title=title, url=notice_url)
        if duplicates:
            await db.execute(
                text("UPDATE crm.tender_candidates SET review_status = 'needs_dedupe_review', possible_duplicate_tender_ids = CAST(:ids AS jsonb), updated_at = NOW() WHERE id = :id"),
                {"ids": _j([str(d["id"]) for d in duplicates]), "id": candidate["id"]},
            )
            return {"candidate_id": candidate_id, "status": "needs_dedupe_review",
                    "possible_duplicates": [{"id": str(d["id"]), "tender_name": d["tender_name"], "bid_number": d["bid_number"],
                                             "url": TENDER_URL.format(id=d["id"])} for d in duplicates],
                    "message": "Possible existing tender found - choose to link it or import as new."}

    closing = _value(fields, "closing_at") or {}
    deadline = datetime.fromisoformat(closing["at"]) if closing.get("at") and closing.get("time_specified") else None
    created = False
    if not tender_id:
        name = title
        clash = (await db.execute(
            text("SELECT 1 FROM crm.tenders WHERE organization_id = :org_id AND is_deleted = false AND lower(tender_name) = lower(:name)"),
            {"org_id": org_id, "name": name},
        )).first()
        if clash:
            name = _clip(f"{title} ({reference or 'e-GP ' + candidate['source_notice_id']})", 255)
        row = (await db.execute(
            text("""
                INSERT INTO crm.tenders (
                    organization_id, created_by, tender_name, bid_number, stage, submission_deadline, region, category,
                    assigned_to_user_id, source_key, source_notice_id, source_url, source_reference, procuring_entity,
                    procurement_method, source_status, source_timezone, source_first_seen_at, source_last_checked_at,
                    source_candidate_id, imported_by, imported_at, is_deleted, created_at, updated_at
                ) VALUES (
                    :org_id, :user_id, :name, :ref, 'Tender Identified', :deadline, :region, :category,
                    :assignee, :key, :nid, :url, :ref_full, :entity, :method, :status, :tz, :first_seen, :checked,
                    :cid, :user_id, NOW(), false, NOW(), NOW()
                )
                ON CONFLICT (organization_id, source_key, source_notice_id)
                    WHERE is_deleted = false AND source_notice_id IS NOT NULL
                DO NOTHING
                RETURNING id
            """),
            {"org_id": org_id, "user_id": actor, "name": name, "ref": reference, "deadline": deadline,
             "region": _clip(_value(fields, "project_location"), 120), "category": _clip(_value(fields, "procurement_class"), 100),
             "assignee": responsible, "key": candidate["source_key"], "nid": candidate["source_notice_id"], "url": notice_url,
             "ref_full": _clip(_value(fields, "official_reference"), 255), "entity": _clip(_value(fields, "procuring_entity"), 255),
             "method": _clip(_value(fields, "procurement_method"), 120), "status": _clip(candidate["notice_status"], 60),
             "tz": candidate["source_timezone"], "first_seen": candidate["first_seen_at"], "checked": candidate["last_checked_at"],
             "cid": candidate["id"]},
        )).first()
        if row:
            tender_id, created = str(row[0]), True
        else:
            tender_id = str((await db.execute(
                text("SELECT id FROM crm.tenders WHERE organization_id = :org_id AND source_key = :key AND source_notice_id = :nid AND is_deleted = false"),
                {"org_id": org_id, "key": candidate["source_key"], "nid": candidate["source_notice_id"]},
            )).scalar())
            status_value = "linked_existing"

    workflow_settings = await get_workflow_settings(db, org_id)
    checklists = await build_checklists(db, org_id=org_id, tender_id=tender_id, user_id=actor, candidate=candidate,
                                        fields=fields, responsible=responsible, review_date=review_date,
                                        create_tasks=not workflow_settings["workflow_enabled"])

    # Evidence: official attachments and any documents already obtained.
    await db.execute(text("UPDATE crm.tender_candidate_documents SET tender_id = :tid, updated_at = NOW() WHERE candidate_id = :cid"),
                     {"tid": tender_id, "cid": candidate["id"]})
    await db.execute(
        text("""
            INSERT INTO core.document_links (organization_id, document_id, entity_type, entity_id, link_role, linked_by)
            SELECT :org_id, cd.document_id, 'tender', :tid, 'egp_official_document', :user_id
            FROM crm.tender_candidate_documents cd
            WHERE cd.candidate_id = :cid AND cd.document_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM core.document_links l WHERE l.document_id = cd.document_id
                              AND l.entity_type = 'tender' AND l.entity_id = :tid)
        """),
        {"org_id": org_id, "tid": tender_id, "user_id": actor, "cid": candidate["id"]},
    )
    await db.execute(text("UPDATE crm.tender_source_changes SET tender_id = :tid WHERE candidate_id = :cid AND tender_id IS NULL"),
                     {"tid": tender_id, "cid": candidate["id"]})
    await db.execute(
        text("""
            UPDATE crm.tender_candidates
            SET review_status = 'imported', tender_id = :tid, reviewed_by = :user_id, reviewed_at = NOW(),
                responsible_user_id = COALESCE(CAST(:responsible AS uuid), responsible_user_id),
                internal_review_date = COALESCE(CAST(:review_date AS date), internal_review_date), updated_at = NOW()
            WHERE id = :id
        """),
        {"tid": tender_id, "user_id": actor, "responsible": responsible, "review_date": review_date, "id": candidate["id"]},
    )
    event = {"candidate_id": candidate_id, "notice_id": candidate["source_notice_id"], "reference": reference,
             "source_url": notice_url, "result": status_value, **checklists}
    await emit_event(db, user={"org_id": org_id, "user_id": actor}, event_type="tender.egp_imported.v1", aggregate_type="tender",
                     aggregate_id=tender_id, event_data=event, idempotency_suffix=candidate_id)
    await db.execute(
        text("""
            INSERT INTO core.audit_log (organization_id, table_name, record_id, action, new_data, created_by)
            VALUES (:org_id, 'crm.tenders', :tid, 'EGP_IMPORT', CAST(:data AS jsonb), :user_id)
        """),
        {"org_id": org_id, "tid": tender_id, "data": _j(event), "user_id": actor},
    )
    entered = None
    if created:
        # Review workflow + new-tender emails; documents are collected and
        # the emails sent after the caller commits (pipeline.after_commit).
        entered = await on_tender_entered(db, org_id=org_id, tender_id=tender_id, actor=actor,
                                          origin="egp_auto_import" if actor is None else "egp_import")
    if responsible and responsible != actor and created:
        await emit_notification(db, org_id=org_id, user_id=responsible, title="e-GP tender assigned to you",
                                message=f'"{title}" was imported from e-GP and assigned to you for review.',
                                notification_type="tender", priority="normal", action_url=TENDER_URL.format(id=tender_id),
                                metadata={"tender_id": tender_id, "candidate_id": candidate_id})
    return {"candidate_id": candidate_id, "status": status_value, "created": created, "tender_id": tender_id,
            "tender_url": TENDER_URL.format(id=tender_id), "deadline_set": deadline is not None, **checklists,
            "workflow": entered,
            "message": "Imported into the tender pipeline." if created else "Linked to the existing tender - no duplicate created."}


# ----------------------------------------------------------------------------
# Recheck
# ----------------------------------------------------------------------------

async def recheck_candidate(db: AsyncSession, user: dict, candidate_id: str, *,
                            client_factory: Optional[ClientFactory] = None) -> dict:
    org_id = user["org_id"]
    candidate = await load_candidate(db, org_id, candidate_id, lock=True)
    source = await ensure_source(db, org_id)
    profile = profile_dict(await ensure_default_profile(db, org_id, None))
    credentials = await load_credentials(db, org_id)
    factory = client_factory or _client_factory(source)
    async with factory() as client:
        detail, status_value, error = await fetch_detail_page(client, candidate["source_notice_id"])
    # The Bulletin Board row is not re-read here, so only keep board values
    # the notice page itself does not supply (no stale-vs-new "conflicts").
    board = {k: v for k, v in (candidate["fields"] or {}).items() if (v or {}).get("section") == "Bulletin Board row"}
    if detail is not None:
        board = {k: v for k, v in board.items() if k not in detail.fields}
    saved = await save_candidate_version(
        db, org_id=org_id, run_id=None, existing=candidate, notice_id=candidate["source_notice_id"], summary=board,
        detail=detail, detail_status=status_value, detail_error=error, profile=profile, credentials=credentials,
        capture_kind="recheck", user_id=_uid(user),
    )
    if candidate["tender_id"] and status_value in ("fetched", "unavailable"):
        await db.execute(
            text("UPDATE crm.tenders SET source_last_checked_at = NOW() WHERE id = :id AND organization_id = :org_id"),
            {"id": candidate["tender_id"], "org_id": org_id},
        )
    return {"candidate_id": candidate_id, "detail_status": status_value, "error": error, "changes_detected": saved["changes"],
            "checked_url": portal.detail_url(candidate["source_notice_id"])}


# ----------------------------------------------------------------------------
# Change review
# ----------------------------------------------------------------------------

async def decide_change(db: AsyncSession, user: dict, change_id: str, action: str, note: Optional[str]) -> dict:
    org_id = user["org_id"]
    if action not in ("apply", "acknowledge"):
        raise HTTPException(status_code=422, detail="Action must be apply or acknowledge.")
    change = await _row(db, "SELECT * FROM crm.tender_source_changes WHERE id = CAST(:id AS uuid) AND organization_id = :org_id FOR UPDATE",
                        {"id": change_id, "org_id": org_id})
    if not change:
        raise HTTPException(status_code=404, detail="Change not found.")
    if change["review_status"] != "pending":
        return {"id": change_id, "status": change["review_status"], "message": "Already reviewed.", "applied": []}
    applied: list[str] = []
    kept: list[str] = []
    calendar_sync = False
    tender_id = change["tender_id"]
    if action == "apply":
        if not tender_id:
            raise HTTPException(status_code=409, detail="This notice is not imported yet - there is no tender to apply the change to.")
        tender = await _row(db, "SELECT * FROM crm.tenders WHERE id = :id AND organization_id = :org_id AND is_deleted = false FOR UPDATE",
                            {"id": tender_id, "org_id": org_id})
        if not tender:
            raise HTTPException(status_code=404, detail="The linked tender no longer exists.")
        new, old, key = change["new_value"], change["old_value"], change["field_key"]
        if key == "closing_at":
            new_at = datetime.fromisoformat(new) if isinstance(new, str) and "T" in new else None
            if new_at is None:
                raise HTTPException(status_code=422, detail="The new closing value has no time - set the deadline manually after checking the documents.")
            await db.execute(text("UPDATE crm.tenders SET submission_deadline = :d, updated_at = NOW() WHERE id = :id"), {"d": new_at, "id": tender_id})
            applied.append(f"Submission deadline changed from {tender['submission_deadline'] or 'not set'} to {new_at.isoformat()}")
            calendar_sync = True
        elif key in ("notice_status", "board_status", "notice_page"):
            await db.execute(text("UPDATE crm.tenders SET source_status = :s, updated_at = NOW() WHERE id = :id"),
                             {"s": _clip(str(new), 60), "id": tender_id})
            applied.append(f"Source status recorded as '{new}'. The tender stage was not changed - decide that yourself.")
        elif key == "official_reference":
            await db.execute(text("UPDATE crm.tenders SET source_reference = :r, updated_at = NOW() WHERE id = :id"), {"r": _clip(str(new), 255), "id": tender_id})
            if (tender["bid_number"] or None) in (None, _clip(str(old), 100) if old else None):
                await db.execute(text("UPDATE crm.tenders SET bid_number = :r WHERE id = :id"), {"r": _clip(str(new), 100), "id": tender_id})
                applied.append("Bid number updated to the new official reference.")
            else:
                kept.append("Bid number was edited in AEGIS and was left as is.")
        elif key == "procuring_entity":
            await db.execute(text("UPDATE crm.tenders SET procuring_entity = :v, updated_at = NOW() WHERE id = :id"), {"v": _clip(str(new), 255), "id": tender_id})
            applied.append("Procuring entity updated.")
        elif key == "procurement_method":
            await db.execute(text("UPDATE crm.tenders SET procurement_method = :v, updated_at = NOW() WHERE id = :id"), {"v": _clip(str(new), 120), "id": tender_id})
            applied.append("Procurement method updated.")
        elif key == "project_location":
            if (tender["region"] or None) in (None, _clip(str(old), 120) if old else None):
                await db.execute(text("UPDATE crm.tenders SET region = :v, updated_at = NOW() WHERE id = :id"), {"v": _clip(str(new), 120), "id": tender_id})
                applied.append("Region updated to the new project location.")
            else:
                kept.append("Region was edited in AEGIS and was left as is.")
        elif key in ("required_categories", "category_codes"):
            await _add_requirement(db, org_id=org_id, tender_id=str(tender_id), user_id=_uid(user), key=f"pub:categories:{change_id}",
                                   label=f"Required supplier categories changed on e-GP: {new}", category="PRAZ", severity="CRITICAL",
                                   source="EGP_PUBLISHED", sort_order=150, excerpt=(change["new_evidence"] or {}).get("excerpt"),
                                   source_url=(change["new_evidence"] or {}).get("source_url"))
            applied.append("Added a published requirement for the changed supplier categories.")
        elif key in ("addenda_count", "documents"):
            rid = await _add_requirement(db, org_id=org_id, tender_id=str(tender_id), user_id=_uid(user), key=f"snc:addendum:{change_id}",
                                         label="Obtain and read the new/revised e-GP documents or addendum", category="TENDER_FORMS_DECLARATIONS",
                                         severity="CRITICAL", source="SNC_INTERNAL", sort_order=151,
                                         responsible_user_id=str(tender["assigned_to_user_id"]) if tender["assigned_to_user_id"] else None)
            await _add_task(db, org_id=org_id, tender_id=str(tender_id), user_id=_uid(user), code=f"addendum:{change_id}",
                            title="Obtain and read the new e-GP addendum/documents",
                            description=f"e-GP shows a change in {key.replace('_', ' ')}: {old} -> {new}.",
                            assignee=str(tender["assigned_to_user_id"]) if tender["assigned_to_user_id"] else None,
                            due=None, priority="high", requirement_id=rid)
            applied.append("Added a checklist item and task to obtain the new documents.")
        else:
            applied.append("Recorded in the source history; no tender field is mapped to this value.")
    await db.execute(
        text("""
            UPDATE crm.tender_source_changes
            SET review_status = :status, reviewed_by = :user_id, reviewed_at = NOW(), review_note = :note,
                applied_to_tender = :applied
            WHERE id = :id
        """),
        {"status": "applied" if action == "apply" else "acknowledged", "user_id": _uid(user), "note": _clip(note, 2000),
         "applied": action == "apply" and bool(applied), "id": change["id"]},
    )
    await emit_event(db, user={"org_id": org_id, "user_id": _uid(user)}, event_type=f"tender.egp_change.{action}.v1",
                     aggregate_type="tender_source_change", aggregate_id=change["id"],
                     event_data={"field": change["field_key"], "old": change["old_value"], "new": change["new_value"],
                                 "applied": applied, "kept": kept, "tender_id": str(tender_id) if tender_id else None})
    return {"id": change_id, "status": "applied" if action == "apply" else "acknowledged", "applied": applied, "kept": kept,
            "tender_id": str(tender_id) if tender_id else None, "calendar_sync": calendar_sync}


# ----------------------------------------------------------------------------
# Official documents obtained by the user
# ----------------------------------------------------------------------------

async def attach_document(db: AsyncSession, user: dict, candidate_id: str, *, document_id: str,
                          candidate_document_id: Optional[str], label: Optional[str]) -> dict:
    org_id = user["org_id"]
    candidate = await load_candidate(db, org_id, candidate_id, lock=True)
    doc = await _row(
        db,
        """
        SELECT d.id, d.title, d.tender_id, fa.file_name, fa.mime_type, fa.size_bytes, fa.extraction_status
        FROM core.documents d
        LEFT JOIN core.file_attachments fa ON fa.id = d.file_attachment_id AND fa.is_deleted = false
        WHERE d.id = CAST(:id AS uuid) AND d.organization_id = :org_id AND d.is_deleted = false
        """,
        {"id": document_id, "org_id": org_id},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if not doc["file_name"]:
        raise HTTPException(status_code=422, detail="That document has no uploaded file.")
    extension = PurePosixPath(doc["file_name"]).suffix.lower()
    if extension not in ALLOWED_DOCUMENT_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"'{extension or 'no extension'}' files are not accepted. Upload PDF, Word, Excel or an image.")
    if (doc["size_bytes"] or 0) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=422, detail="File is larger than 30 MB.")
    if candidate_document_id:
        updated = (await db.execute(
            text("""
                UPDATE crm.tender_candidate_documents
                SET document_id = :doc, attached_by = :user_id, attached_at = NOW(), updated_at = NOW()
                WHERE id = CAST(:id AS uuid) AND candidate_id = :cid
                RETURNING id
            """),
            {"doc": doc["id"], "user_id": _uid(user), "id": candidate_document_id, "cid": candidate["id"]},
        )).first()
        if not updated:
            raise HTTPException(status_code=404, detail="Official attachment record not found.")
        row_id = str(updated[0])
    else:
        row_id = str((await db.execute(
            text("""
                INSERT INTO crm.tender_candidate_documents (organization_id, candidate_id, tender_id, label, access, document_id, attached_by, attached_at)
                VALUES (:org_id, :cid, :tid, :label, 'manual_upload', :doc, :user_id, NOW())
                RETURNING id
            """),
            {"org_id": org_id, "cid": candidate["id"], "tid": candidate["tender_id"], "label": _clip(label or doc["title"], 255),
             "doc": doc["id"], "user_id": _uid(user)},
        )).scalar())
    if candidate["tender_id"]:
        await db.execute(
            text("""
                INSERT INTO core.document_links (organization_id, document_id, entity_type, entity_id, link_role, linked_by)
                SELECT :org_id, :doc, 'tender', :tid, 'egp_official_document', :user_id
                WHERE NOT EXISTS (SELECT 1 FROM core.document_links WHERE document_id = :doc AND entity_type = 'tender' AND entity_id = :tid)
            """),
            {"org_id": org_id, "doc": doc["id"], "tid": candidate["tender_id"], "user_id": _uid(user)},
        )
    scored = await rescore(db, org_id, await load_candidate(db, org_id, candidate_id))
    return {"id": row_id, "document_id": str(doc["id"]), "extraction_status": doc["extraction_status"] or "pending", **scored}
