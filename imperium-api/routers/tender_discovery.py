"""e-GP tender discovery and intake.

Endpoints behind /api/v1/tender-discovery. Permissions:
  tender_discovery.read       view connection, runs, candidates, evidence
  tender_discovery.run        verify connection, start/resume/cancel runs, recheck
  tender_discovery.import     correct, reject, defer, import, review changes, attach documents
  tender_discovery.configure  edit the discovery profile and connector settings

See app/services/tenders/egp/ for the portal client, parser, scoring,
discovery runner and import logic.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.tenders.egp import portal
from app.services.tenders.egp.discovery import (
    ActiveRunExists,
    create_run,
    ensure_default_profile,
    ensure_source,
    execute_run,
    mark_stale_runs,
    probe_connection,
)
from app.services.tenders.egp.intake import (
    attach_document,
    decide_change,
    import_candidates,
    load_candidate,
    recheck_candidate,
    update_review,
)
from core.config import settings
from core.database import AsyncSessionLocal, get_db
from core.logging import logger
from core.security import require_permission, user_has_permission
from app.shared.task_stacks import generate_task_stack

router = APIRouter()

VERIFICATION_STALE_AFTER = timedelta(hours=24)


def _ok(data: Any, message: str = "", meta: Optional[dict] = None) -> dict:
    return {"success": True, "data": data, "message": message, "meta": meta or {}}


def _uid(user: dict) -> Optional[str]:
    return user.get("user_id") or user.get("sub")


async def _rows(db: AsyncSession, sql: str, params: dict) -> list[dict]:
    return [dict(r) for r in (await db.execute(text(sql), params)).mappings().all()]


async def _row(db: AsyncSession, sql: str, params: dict) -> Optional[dict]:
    row = (await db.execute(text(sql), params)).mappings().first()
    return dict(row) if row else None


def _limitations() -> list[dict]:
    return [
        {"key": "public_only", "title": "Public notices only",
         "detail": "AEGIS reads the public e-GP Bulletin Board and notice pages. It holds no e-GP login, password or session."},
        {"key": "documents_need_login", "title": "Bidding documents need your e-GP login",
         "detail": "The portal serves documents, the activity schedule and addenda only to signed-in suppliers. Sign in at the official portal in your own browser, download them, and attach them here. AEGIS never purchases documents or submits bids."},
        {"key": "no_ocr", "title": "No OCR",
         "detail": "Text is read from PDF and Word files. Scanned documents are flagged as unreadable, never as reviewed."},
        {"key": "terms", "title": "Internal use only", "detail": portal.TERMS_NOTE},
    ]


def _source_view(source: dict) -> dict:
    state = source["connection_state"]
    verified = source.get("last_verified_at")
    stale = bool(state == "connected_verified" and verified and datetime.now(timezone.utc) - verified > VERIFICATION_STALE_AFTER)
    return {
        "source_key": source["source_key"], "display_name": source["display_name"], "base_url": source["base_url"],
        "verified_from": source["verified_from"], "connection_state": state, "state_reason": source["state_reason"],
        "last_verified_at": verified, "last_probe_at": source["last_probe_at"], "last_probe": source["last_probe"],
        "verification_stale": stale, "enabled": source["enabled"],
        "min_request_interval_ms": source["min_request_interval_ms"], "max_pages_per_run": source["max_pages_per_run"],
        "max_details_per_run": source["max_details_per_run"],
        "scheduled_recheck_enabled": source["scheduled_recheck_enabled"],
        "authenticated_access": {
            "supported": False,
            "state": "not_connected",
            "login_url": portal.LOGIN_URL,
            "reason": "This deployment cannot securely hold an interactive e-GP login session (headless server; the portal's "
                      "sign-in uses its own crypto tooling). Use the official document import instead.",
        },
        "scheduled_recheck_supported": bool(settings.BACKGROUND_JOBS_ENABLED),
    }


# ----------------------------------------------------------------------------
# Overview + connection
# ----------------------------------------------------------------------------

@router.get("/overview")
async def overview(user: dict = Depends(require_permission("tender_discovery.read")), db: AsyncSession = Depends(get_db)):
    org_id = user["org_id"]
    source = await ensure_source(db, org_id)
    profile = await ensure_default_profile(db, org_id, _uid(user))
    await mark_stale_runs(db, org_id)
    await db.commit()
    runs = await _rows(db, """
        SELECT r.*, u.full_name AS started_by_name FROM crm.tender_discovery_runs r
        LEFT JOIN core.users u ON u.id = r.started_by
        WHERE r.organization_id = :org_id ORDER BY r.created_at DESC LIMIT 15
    """, {"org_id": org_id})
    counts = await _rows(db, """
        SELECT review_status, relevance_band, count(*) AS n FROM crm.tender_candidates
        WHERE organization_id = :org_id GROUP BY 1, 2
    """, {"org_id": org_id})
    pending_changes = (await db.execute(text(
        "SELECT count(*) FROM crm.tender_source_changes WHERE organization_id = :org_id AND review_status = 'pending'"),
        {"org_id": org_id})).scalar()
    credentials = (await db.execute(text(
        "SELECT count(*) FROM compliance.corporate_credentials WHERE organization_id = :org_id AND is_deleted = false"),
        {"org_id": org_id})).scalar()
    permissions = {key: await user_has_permission(db, user, f"tender_discovery.{key}") for key in ("run", "import", "configure")}
    return _ok({
        "source": _source_view(source),
        "profile": profile,
        "runs": runs,
        "active_run": next((r for r in runs if r["status"] in ("queued", "running")), None),
        "counts": counts,
        "pending_changes": pending_changes,
        "configured_credentials": credentials,
        "limitations": _limitations(),
        "permissions": permissions,
    })


@router.post("/connection/verify")
async def verify_connection(user: dict = Depends(require_permission("tender_discovery.run")), db: AsyncSession = Depends(get_db)):
    result = await probe_connection(db, org_id=user["org_id"], user_id=_uid(user))
    await db.commit()
    source = await ensure_source(db, user["org_id"])
    return _ok({**result, "source": _source_view(source)},
               "Connection verified." if result["connection_state"] == "connected_verified" else "Connection not verified.")


class SourceSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    min_request_interval_ms: Optional[int] = Field(default=None, ge=1500, le=60000)
    max_pages_per_run: Optional[int] = Field(default=None, ge=1, le=200)
    max_details_per_run: Optional[int] = Field(default=None, ge=0, le=300)
    scheduled_recheck_enabled: Optional[bool] = None
    enabled: Optional[bool] = None


@router.put("/connection/settings")
async def update_source_settings(payload: SourceSettings, user: dict = Depends(require_permission("tender_discovery.configure")),
                                 db: AsyncSession = Depends(get_db)):
    values = payload.model_dump(exclude_none=True)
    if values.get("scheduled_recheck_enabled") and not settings.BACKGROUND_JOBS_ENABLED:
        raise HTTPException(status_code=409, detail="Scheduled rechecks need the AEGIS background worker, which is not enabled on this deployment.")
    source = await ensure_source(db, user["org_id"])
    if values:
        sets = ", ".join(f"{k} = :{k}" for k in values)
        await db.execute(text(f"UPDATE crm.tender_sources SET {sets}, updated_by = :uid, updated_at = NOW() WHERE id = :id"),  # nosec B608 - keys from the pydantic model
                         {**values, "uid": _uid(user), "id": source["id"]})
    await db.commit()
    return _ok(_source_view(await ensure_source(db, user["org_id"])), "Connector settings saved.")


# ----------------------------------------------------------------------------
# Profile
# ----------------------------------------------------------------------------

class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    work_types: Optional[list[dict]] = None
    category_terms: Optional[list[dict]] = None
    category_codes: Optional[list[str]] = None
    preferred_locations: Optional[list[str]] = None
    nearby_locations: Optional[list[str]] = None
    exclude_terms: Optional[list[dict]] = None
    default_filters: Optional[dict] = None
    scoring: Optional[dict] = None


def _validate_profile(values: dict) -> None:
    for wt in values.get("work_types") or []:
        if not isinstance(wt.get("terms"), list) or not 0 <= int(wt.get("weight", -1)) <= 50:
            raise HTTPException(status_code=422, detail="Each work type needs a list of terms and a weight from 0 to 50.")
    for cat in values.get("category_terms") or []:
        if not str(cat.get("term") or "").strip() or not 0 <= int(cat.get("weight", -1)) <= 50:
            raise HTTPException(status_code=422, detail="Each category needs a term and a weight from 0 to 50.")
    for ex in values.get("exclude_terms") or []:
        if not str(ex.get("term") or "").strip() or not 0 <= int(ex.get("penalty", -1)) <= 100:
            raise HTTPException(status_code=422, detail="Each exclusion needs a term and a penalty from 0 to 100.")


@router.put("/profiles/{profile_id}")
async def update_profile(profile_id: UUID, payload: ProfileUpdate, user: dict = Depends(require_permission("tender_discovery.configure")),
                         db: AsyncSession = Depends(get_db)):
    values = payload.model_dump(exclude_none=True)
    _validate_profile(values)
    if not values:
        raise HTTPException(status_code=422, detail="Nothing to update.")
    sets = []
    params: dict[str, Any] = {"id": str(profile_id), "org_id": user["org_id"], "uid": _uid(user)}
    for key, value in values.items():
        if key in ("name", "description"):
            sets.append(f"{key} = :{key}")
            params[key] = value
        else:
            sets.append(f"{key} = CAST(:{key} AS jsonb)")
            params[key] = json.dumps(value)
    row = await _row(db, f"""
        UPDATE crm.tender_discovery_profiles SET {', '.join(sets)}, updated_by = :uid, updated_at = NOW()
        WHERE id = :id AND organization_id = :org_id AND is_deleted = false RETURNING *
    """, params)  # nosec B608 - columns come from the pydantic model
    if not row:
        raise HTTPException(status_code=404, detail="Profile not found.")
    await db.commit()
    return _ok(row, "Profile saved. New scores apply from the next run or recheck.")


# ----------------------------------------------------------------------------
# Runs
# ----------------------------------------------------------------------------

class RunFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = Field(default=None, max_length=50)
    reference: Optional[str] = Field(default=None, max_length=50)
    category_code: Optional[str] = Field(default=None, max_length=20)
    category_name: Optional[str] = Field(default=None, max_length=200)
    procuring_entity_id: Optional[str] = Field(default=None, max_length=10, pattern=r"^\d*$")
    published_from: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    published_to: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    closing_from: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    closing_to: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class RunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: Optional[UUID] = None
    filters: RunFilters = Field(default_factory=RunFilters)
    page_limit: Optional[int] = Field(default=None, ge=1, le=200)


async def run_discovery_in_background(run_id: str) -> None:
    """Runs in the API process after the response is sent. If the process
    restarts mid-run, the heartbeat goes stale and the run is closed as
    partial/interrupted, resumable from its last completed page."""
    try:
        async with AsyncSessionLocal() as db:
            await execute_run(db, run_id)
    except Exception:  # noqa: BLE001 - execute_run records its own failures
        logger.exception("egp_discovery.background_failed", run_id=run_id)


@router.post("/runs")
async def start_run(payload: RunCreate, background: BackgroundTasks,
                    user: dict = Depends(require_permission("tender_discovery.run")), db: AsyncSession = Depends(get_db)):
    org_id = user["org_id"]
    source = await ensure_source(db, org_id)
    if not source["enabled"]:
        raise HTTPException(status_code=409, detail="The e-GP connector is disabled in its settings.")
    if source["connection_state"] != "connected_verified":
        raise HTTPException(status_code=409, detail="Verify the e-GP connection first - discovery only runs against a verified source.")
    if payload.profile_id:
        profile = await _row(db, "SELECT * FROM crm.tender_discovery_profiles WHERE id = :id AND organization_id = :org_id AND is_deleted = false",
                             {"id": str(payload.profile_id), "org_id": org_id})
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found.")
    else:
        profile = await ensure_default_profile(db, org_id, _uid(user))
    try:
        run = await create_run(db, org_id=org_id, user_id=_uid(user), profile=profile,
                               filters=payload.filters.model_dump(exclude_none=True), page_limit=payload.page_limit)
    except ActiveRunExists as exc:
        raise HTTPException(status_code=409, detail={"message": "A discovery run is already in progress.", "run_id": exc.run_id})
    await db.commit()
    background.add_task(run_discovery_in_background, str(run["id"]))
    return _ok(run, "Discovery run queued.")


@router.get("/runs")
async def list_runs(limit: int = Query(default=20, ge=1, le=100), user: dict = Depends(require_permission("tender_discovery.read")),
                    db: AsyncSession = Depends(get_db)):
    runs = await _rows(db, """
        SELECT r.*, u.full_name AS started_by_name FROM crm.tender_discovery_runs r
        LEFT JOIN core.users u ON u.id = r.started_by
        WHERE r.organization_id = :org_id ORDER BY r.created_at DESC LIMIT :limit
    """, {"org_id": user["org_id"], "limit": limit})
    return _ok(runs)


@router.get("/runs/{run_id}")
async def get_run(run_id: UUID, user: dict = Depends(require_permission("tender_discovery.read")), db: AsyncSession = Depends(get_db)):
    await mark_stale_runs(db, user["org_id"])
    await db.commit()
    run = await _row(db, "SELECT * FROM crm.tender_discovery_runs WHERE id = :id AND organization_id = :org_id",
                     {"id": str(run_id), "org_id": user["org_id"]})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    return _ok(run)


@router.post("/runs/{run_id}/resume")
async def resume_run(run_id: UUID, background: BackgroundTasks, user: dict = Depends(require_permission("tender_discovery.run")),
                     db: AsyncSession = Depends(get_db)):
    org_id = user["org_id"]
    previous = await _row(db, "SELECT * FROM crm.tender_discovery_runs WHERE id = :id AND organization_id = :org_id",
                          {"id": str(run_id), "org_id": org_id})
    if not previous:
        raise HTTPException(status_code=404, detail="Run not found.")
    if previous["status"] not in ("partial", "failed"):
        raise HTTPException(status_code=409, detail="Only a partial or failed run can be resumed.")
    source = await ensure_source(db, org_id)
    if source["connection_state"] != "connected_verified":
        raise HTTPException(status_code=409, detail="Re-verify the e-GP connection before resuming.")
    profile = await _row(db, "SELECT * FROM crm.tender_discovery_profiles WHERE id = :id", {"id": previous["profile_id"]}) \
        if previous["profile_id"] else await ensure_default_profile(db, org_id, _uid(user))
    try:
        run = await create_run(db, org_id=org_id, user_id=_uid(user), profile=profile or {}, filters=previous["filters"] or {},
                               page_limit=previous["page_limit"], resumed_from=previous)
    except ActiveRunExists as exc:
        raise HTTPException(status_code=409, detail={"message": "A discovery run is already in progress.", "run_id": exc.run_id})
    await db.commit()
    background.add_task(run_discovery_in_background, str(run["id"]))
    return _ok(run, f"Resuming from page {int(previous['last_page_completed'] or 0) + 1}.")


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: UUID, user: dict = Depends(require_permission("tender_discovery.run")), db: AsyncSession = Depends(get_db)):
    row = await _row(db, """
        UPDATE crm.tender_discovery_runs SET cancel_requested = true
        WHERE id = :id AND organization_id = :org_id AND status IN ('queued', 'running') RETURNING id, status
    """, {"id": str(run_id), "org_id": user["org_id"]})
    await db.commit()
    if not row:
        raise HTTPException(status_code=409, detail="That run is not in progress.")
    return _ok(row, "Cancellation requested - the run stops after the current page.")


# ----------------------------------------------------------------------------
# Candidates
# ----------------------------------------------------------------------------

_SORTS = {
    "relevance": "c.relevance_score DESC NULLS LAST, c.closing_at ASC NULLS LAST",
    "closing": "c.closing_at ASC NULLS LAST",
    "published": "c.published_at DESC NULLS LAST",
    "recent": "c.last_seen_at DESC",
}


@router.get("/candidates")
async def list_candidates(
    review_status: Optional[str] = Query(default=None, pattern=r"^(new|deferred|rejected|imported|needs_dedupe_review|open)$"),
    band: Optional[str] = Query(default=None, pattern=r"^(strong|possible|weak)$"),
    q: Optional[str] = Query(default=None, max_length=120),
    entity: Optional[str] = Query(default=None, max_length=120),
    location: Optional[str] = Query(default=None, max_length=120),
    category: Optional[str] = Query(default=None, max_length=120),
    notice_status: Optional[str] = Query(default=None, max_length=60),
    published_from: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    published_to: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    closing_from: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    closing_to: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    site_visit: Optional[str] = Query(default=None, pattern=r"^(yes|no|unknown)$"),
    eligibility: Optional[str] = Query(default=None, pattern=r"^(stated|not_stated)$"),
    include_closed: bool = Query(default=False),
    sort: str = Query(default="relevance", pattern=r"^(relevance|closing|published|recent)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(require_permission("tender_discovery.read")),
    db: AsyncSession = Depends(get_db),
):
    where = ["c.organization_id = :org_id"]
    params: dict[str, Any] = {"org_id": user["org_id"], "limit": limit, "offset": offset}
    if review_status == "open":
        where.append("c.review_status IN ('new', 'deferred', 'needs_dedupe_review')")
    elif review_status:
        where.append("c.review_status = :review_status")
        params["review_status"] = review_status
    if band:
        where.append("c.relevance_band = :band")
        params["band"] = band
    for key, column in (("q", "concat_ws(' ', c.title, c.official_reference, c.procuring_entity, c.fields->'description'->>'value')"),
                        ("entity", "c.procuring_entity"), ("location", "concat_ws(' ', c.location_text, c.fields->'entity_address'->>'value')"),
                        ("category", "concat_ws(' ', c.category_names::text, c.category_codes::text)"),
                        ("notice_status", "concat_ws(' ', c.notice_status, c.fields->'board_status'->>'value')")):
        value = locals()[key]
        if value:
            where.append(f"{column} ILIKE :{key}")
            params[key] = f"%{value.strip()}%"
    for key, column, op in (("published_from", "c.published_at", ">="), ("published_to", "c.published_at", "<"),
                            ("closing_from", "c.closing_at", ">="), ("closing_to", "c.closing_at", "<")):
        value = locals()[key]
        if value:
            day = datetime.fromisoformat(value)
            if op == "<":
                day += timedelta(days=1)
            where.append(f"{column} {op} :{key}")
            params[key] = day.replace(tzinfo=timezone(timedelta(hours=2)))
    if site_visit == "unknown":
        where.append("c.fields->'site_visit' IS NULL AND NOT (c.corrections ? 'site_visit')")
    elif site_visit in ("yes", "no"):
        where.append("(c.corrections->'site_visit'->>'value' ILIKE :sv OR c.fields->'site_visit'->>'value' ILIKE :sv)")
        params["sv"] = "%mandatory%" if site_visit == "yes" else "%not%"
    if eligibility == "stated":
        where.append("c.fields ? 'required_categories'")
    elif eligibility == "not_stated":
        where.append("NOT (c.fields ? 'required_categories')")
    if not include_closed:
        where.append("(c.closing_at IS NULL OR c.closing_at >= NOW() OR c.review_status = 'imported')")
    clause = " AND ".join(where)
    rows = await _rows(db, f"""
        SELECT c.id, c.source_notice_id, c.notice_url, c.official_reference, c.title, c.procuring_entity, c.notice_status,
               c.published_at, c.closing_at, c.closing_time_specified, c.source_timezone, c.location_text,
               c.category_codes, c.category_names, c.relevance_score, c.relevance_band, c.match_reasons, c.missing_evidence,
               c.readiness, c.review_status, c.review_note, c.responsible_user_id, ru.full_name AS responsible_name,
               c.internal_review_date, c.tender_id, c.detail_status, c.detail_error, c.extraction_confidence,
               jsonb_array_length(c.conflicts) AS conflict_count, jsonb_array_length(c.unresolved_questions) AS question_count,
               c.first_seen_at, c.last_seen_at, c.last_checked_at, c.fields->'board_status'->>'value' AS board_status,
               (SELECT count(*) FROM crm.tender_source_changes ch WHERE ch.candidate_id = c.id AND ch.review_status = 'pending') AS pending_changes
        FROM crm.tender_candidates c
        LEFT JOIN core.users ru ON ru.id = c.responsible_user_id
        WHERE {clause}
        ORDER BY {_SORTS[sort]}
        LIMIT :limit OFFSET :offset
    """, params)  # nosec B608 - clause built from fixed fragments; values bound
    total = (await db.execute(text(f"SELECT count(*) FROM crm.tender_candidates c WHERE {clause}"), params)).scalar()  # nosec B608
    return _ok(rows, meta={"total": total, "limit": limit, "offset": offset})


@router.get("/candidates/{candidate_id}")
async def get_candidate(candidate_id: str, user: dict = Depends(require_permission("tender_discovery.read")), db: AsyncSession = Depends(get_db)):
    org_id = user["org_id"]
    candidate = await load_candidate(db, org_id, candidate_id)
    snapshots = await _rows(db, """
        SELECT s.id, s.captured_at, s.capture_kind, s.content_hash, s.run_id, u.full_name AS captured_by_name
        FROM crm.tender_source_snapshots s LEFT JOIN core.users u ON u.id = s.captured_by
        WHERE s.candidate_id = :id ORDER BY s.captured_at DESC
    """, {"id": candidate["id"]})
    changes = await _rows(db, """
        SELECT ch.*, u.full_name AS reviewed_by_name FROM crm.tender_source_changes ch
        LEFT JOIN core.users u ON u.id = ch.reviewed_by
        WHERE ch.candidate_id = :id ORDER BY ch.detected_at DESC
    """, {"id": candidate["id"]})
    can_read_documents = await user_has_permission(db, user, "documents.read")
    documents = await _rows(db, """
        SELECT cd.id, cd.label, cd.official_url, cd.access, cd.document_id, cd.attached_at, cd.notes,
               d.title AS document_title, fa.file_name, fa.mime_type, fa.size_bytes, fa.extraction_status, fa.extraction_error
        FROM crm.tender_candidate_documents cd
        LEFT JOIN core.documents d ON d.id = cd.document_id AND d.is_deleted = false
        LEFT JOIN core.file_attachments fa ON fa.id = d.file_attachment_id AND fa.is_deleted = false
        WHERE cd.candidate_id = :id ORDER BY cd.created_at
    """, {"id": candidate["id"]})
    if not can_read_documents:
        for doc in documents:
            doc.update({"document_id": None, "document_title": None, "file_name": None, "restricted": True})
    tender = None
    if candidate["tender_id"]:
        tender = await _row(db, """
            SELECT id, tender_name, stage, submission_deadline, bid_amount, assigned_to_user_id, source_last_checked_at, is_deleted
            FROM crm.tenders WHERE id = :id AND organization_id = :org_id
        """, {"id": candidate["tender_id"], "org_id": org_id})
    duplicates = []
    if candidate["possible_duplicate_tender_ids"]:
        duplicates = await _rows(db, """
            SELECT id, tender_name, bid_number, stage, source_notice_id FROM crm.tenders
            WHERE organization_id = :org_id AND is_deleted = false AND id::text = ANY(:ids)
        """, {"org_id": org_id, "ids": [str(i) for i in candidate["possible_duplicate_tender_ids"]]})
    return _ok({**candidate, "snapshots": snapshots, "changes": changes, "documents": documents, "tender": tender,
                "possible_duplicates": duplicates, "documents_access": {"login_url": portal.LOGIN_URL,
                                                                         "can_read_documents": can_read_documents}})


class ReviewUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    corrections: Optional[dict[str, Any]] = None
    correction_notes: Optional[dict[str, str]] = None
    responsible_user_id: Optional[str] = None
    internal_review_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    review_status: Optional[Literal["new", "deferred", "rejected"]] = None
    review_note: Optional[str] = Field(default=None, max_length=2000)


@router.patch("/candidates/{candidate_id}")
async def review_candidate(candidate_id: str, payload: ReviewUpdate, user: dict = Depends(require_permission("tender_discovery.import")),
                           db: AsyncSession = Depends(get_db)):
    data = payload.model_dump(exclude_unset=True)
    result = await update_review(db, user, candidate_id, data)
    await db.commit()
    return _ok(result, "Review saved.")


class ImportItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_id: UUID
    link_to_tender_id: Optional[UUID] = None
    create_new: bool = False
    responsible_user_id: Optional[str] = None
    internal_review_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[ImportItem] = Field(min_length=1, max_length=50)
    responsible_user_id: Optional[str] = None
    internal_review_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


@router.post("/candidates/import")
async def import_selected(payload: ImportRequest, user: dict = Depends(require_permission("tender_discovery.import")),
                          db: AsyncSession = Depends(get_db)):
    if not await user_has_permission(db, user, "crm.create_tenders"):
        raise HTTPException(status_code=403, detail="Importing creates tenders and needs crm.create_tenders as well.")
    items = [{**i.model_dump(), "candidate_id": str(i.candidate_id),
              "link_to_tender_id": str(i.link_to_tender_id) if i.link_to_tender_id else None} for i in payload.items]
    results = await import_candidates(db, user, items, responsible_user_id=payload.responsible_user_id,
                                      internal_review_date=payload.internal_review_date)
    await db.commit()
    # After commit (both helpers commit on their own): stage task pack and
    # calendar reminders, exactly as a manually created tender gets them.
    from routers.tender_bids import _sync_tender_calendar

    for result in results:
        if result.get("created"):
            try:
                await generate_task_stack(db, org_id=user["org_id"], entity_type="tender", entity_id=result["tender_id"],
                                          created_by=_uid(user), source_event="egp_tender_import",
                                          generation_reason="Imported from the PRAZ e-GP portal.")
            except Exception:  # noqa: BLE001 - the tender is already saved; the pack can be regenerated
                await db.rollback()
                logger.exception("egp_import.task_stack_failed", tender_id=result["tender_id"])
            await _sync_tender_calendar(db, org_id=user["org_id"], item_id=result["tender_id"],
                                        sync_submission=bool(result.get("deadline_set")), sync_visit=False)
    imported = sum(1 for r in results if r["status"] in ("imported", "linked_existing", "already_imported"))
    return _ok(results, f"{imported} of {len(results)} notice(s) are now in the tender pipeline.")


@router.post("/candidates/{candidate_id}/recheck")
async def recheck(candidate_id: str, user: dict = Depends(require_permission("tender_discovery.run")), db: AsyncSession = Depends(get_db)):
    source = await ensure_source(db, user["org_id"])
    if not source["enabled"]:
        raise HTTPException(status_code=409, detail="The e-GP connector is disabled in its settings.")
    result = await recheck_candidate(db, user, candidate_id)
    await db.commit()
    message = {
        "fetched": f"Notice re-read; {result['changes_detected']} change(s) found.",
        "unavailable": "The notice page no longer shows tender details - check the portal; nothing was assumed.",
        "restricted": "The portal restricted access to the notice page.",
        "failed": "The notice page could not be read - try again later.",
    }.get(result["detail_status"], "Recheck finished.")
    return _ok(result, message)


class ChangeDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["apply", "acknowledge"]
    note: Optional[str] = Field(default=None, max_length=2000)


@router.get("/changes")
async def list_changes(status: str = Query(default="pending", pattern=r"^(pending|applied|acknowledged|all)$"),
                       user: dict = Depends(require_permission("tender_discovery.read")), db: AsyncSession = Depends(get_db)):
    rows = await _rows(db, f"""
        SELECT ch.*, c.title, c.official_reference, c.notice_url, t.tender_name, u.full_name AS reviewed_by_name
        FROM crm.tender_source_changes ch
        JOIN crm.tender_candidates c ON c.id = ch.candidate_id
        LEFT JOIN crm.tenders t ON t.id = ch.tender_id
        LEFT JOIN core.users u ON u.id = ch.reviewed_by
        WHERE ch.organization_id = :org_id {'' if status == 'all' else 'AND ch.review_status = :status'}
        ORDER BY ch.detected_at DESC LIMIT 200
    """, {"org_id": user["org_id"], "status": status})  # nosec B608 - fixed fragment
    return _ok(rows)


@router.post("/changes/{change_id}/decision")
async def decide(change_id: UUID, payload: ChangeDecision, user: dict = Depends(require_permission("tender_discovery.import")),
                 db: AsyncSession = Depends(get_db)):
    result = await decide_change(db, user, str(change_id), payload.action, payload.note)
    await db.commit()
    if result.get("calendar_sync") and result.get("tender_id"):
        from routers.tender_bids import _sync_tender_calendar

        await _sync_tender_calendar(db, org_id=user["org_id"], item_id=result["tender_id"], sync_submission=True, sync_visit=False)
    return _ok(result, "Change applied." if payload.action == "apply" else "Change acknowledged.")


class AttachDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: UUID
    candidate_document_id: Optional[UUID] = None
    label: Optional[str] = Field(default=None, max_length=255)


@router.post("/candidates/{candidate_id}/documents")
async def attach(candidate_id: str, payload: AttachDocument, user: dict = Depends(require_permission("tender_discovery.import")),
                 db: AsyncSession = Depends(get_db)):
    if not await user_has_permission(db, user, "documents.create"):
        raise HTTPException(status_code=403, detail="Attaching documents needs documents.create as well.")
    result = await attach_document(db, user, candidate_id, document_id=str(payload.document_id),
                                   candidate_document_id=str(payload.candidate_document_id) if payload.candidate_document_id else None,
                                   label=payload.label)
    await db.commit()
    return _ok(result, "Official document attached. It counts as reviewed only once its text has been extracted.")


@router.get("/tenders/{tender_id}/source")
async def tender_source(tender_id: UUID, user: dict = Depends(require_permission("tender_discovery.read")), db: AsyncSession = Depends(get_db)):
    """Source evidence panel for a tender in the pipeline."""
    tender = await _row(db, """
        SELECT id, source_key, source_notice_id, source_url, source_reference, source_status, source_timezone,
               source_first_seen_at, source_last_checked_at, source_candidate_id, imported_at, imported_by
        FROM crm.tenders WHERE id = :id AND organization_id = :org_id AND is_deleted = false
    """, {"id": str(tender_id), "org_id": user["org_id"]})
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found.")
    candidate = await _row(db, """
        SELECT id, title, official_reference, notice_url, readiness, relevance_band, relevance_score, last_checked_at,
               detail_status, (SELECT count(*) FROM crm.tender_source_changes ch WHERE ch.candidate_id = c.id AND ch.review_status = 'pending') AS pending_changes
        FROM crm.tender_candidates c WHERE c.organization_id = :org_id AND (c.tender_id = :id OR c.id = :cid)
        ORDER BY (c.tender_id = :id) DESC LIMIT 1
    """, {"org_id": user["org_id"], "id": str(tender_id), "cid": tender["source_candidate_id"]})
    return _ok({"tender": tender, "candidate": candidate})
