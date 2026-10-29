"""Tender intake workflow: initial review -> QS, and tender automation admin.

Endpoints behind /api/v1/tender-workflow. Permissions (migration 276):
  tender_workflow.review  initial reviewers (CRM Associate, Document Controller, ...)
  tender_workflow.qs      Quantity Surveyors
  tender_workflow.admin   settings, starting/reassigning the workflow, email retries
Acting on a tender also needs the assignment: an initial reviewer of that
tender, or its assigned QS (admins excepted). See
app/services/tenders/workflow.py for the gate rules.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.tenders import notify, workflow
from app.services.tenders.egp import portal
from app.services.tenders.egp.discovery import ActiveRunExists, create_run, ensure_default_profile, ensure_source
from app.services.tenders.pipeline import after_commit, run_discovery_and_import
from core.config import settings as app_settings
from core.database import get_db
from core.security import get_current_user, require_permission, user_has_permission

router = APIRouter()


def _ok(data: Any, message: str = "") -> dict:
    return {"success": True, "data": data, "message": message, "meta": {}}


def _uid(user: dict) -> Optional[str]:
    return user.get("user_id") or user.get("sub")


async def _rows(db: AsyncSession, sql: str, params: dict) -> list[dict]:
    return [dict(r) for r in (await db.execute(text(sql), params)).mappings().all()]


async def _perms(db: AsyncSession, user: dict) -> dict:
    return {
        "review": await user_has_permission(db, user, "tender_workflow.review"),
        "qs": await user_has_permission(db, user, "tender_workflow.qs"),
        "admin": await user_has_permission(db, user, "tender_workflow.admin"),
        "read": await user_has_permission(db, user, "crm.view_tenders") or await user_has_permission(db, user, "tender_bids.read"),
    }


async def _require(db: AsyncSession, user: dict, *keys: str) -> dict:
    perms = await _perms(db, user)
    if not any(perms[k] for k in keys) and not perms["admin"]:
        raise HTTPException(status_code=403, detail="You do not have access to the tender workflow.")
    return perms


# ----------------------------------------------------------------------------
# Tender record
# ----------------------------------------------------------------------------

async def _tender_view(db: AsyncSession, user: dict, tender_id: str, perms: dict) -> dict:
    org_id = user["org_id"]
    t = await workflow.load_tender(db, org_id, tender_id)
    names = {str(r["id"]): r["full_name"] for r in await _rows(
        db, "SELECT id, full_name FROM core.users WHERE organization_id = :org_id", {"org_id": org_id})}

    def person(uid: Any) -> Optional[dict]:
        return {"id": str(uid), "name": names.get(str(uid), "Unknown user")} if uid else None

    items = await _rows(db, "SELECT * FROM crm.tender_review_items WHERE tender_id = :tid ORDER BY sort_order", {"tid": tender_id})
    for item in items:
        item["completed_by_name"] = names.get(str(item["completed_by"])) if item["completed_by"] else None
    documents = await workflow.linked_documents(db, org_id, tender_id)
    official = await _rows(db, """
        SELECT cd.id, cd.label, cd.official_url, cd.access, cd.download_status, cd.download_error, cd.download_attempts,
               cd.downloaded_at, cd.size_bytes, cd.document_id, cd.published_label
        FROM crm.tender_candidate_documents cd
        WHERE cd.tender_id = :tid ORDER BY cd.created_at""", {"tid": tender_id})
    events = await _rows(db, """
        SELECT e.id, e.action, e.from_status, e.to_status, e.automated, e.round, e.note, e.data, e.created_at,
               u.full_name AS actor_name
        FROM crm.tender_workflow_events e LEFT JOIN core.users u ON u.id = e.actor_user_id
        WHERE e.tender_id = :tid ORDER BY e.created_at DESC LIMIT 150""", {"tid": tender_id})
    deliveries = await _rows(db, """
        SELECT id, recipient_label, recipient_email, address_source, status, attempts, last_error, sent_at, last_attempt_at
        FROM crm.tender_notification_deliveries WHERE tender_id = :tid ORDER BY created_at""", {"tid": tender_id})
    tasks = await _rows(db, """
        SELECT k.id, k.title, k.status, k.priority, k.due_date, k.source_event, k.completed_at, u.full_name AS assignee_name
        FROM crm.tasks k LEFT JOIN core.users u ON u.id = k.assigned_to_user_id
        WHERE k.organization_id = :org_id AND k.entity_type = 'tender' AND k.entity_id = :tid
          AND k.generation_rule = :rule AND k.is_deleted = false
        ORDER BY k.created_at""", {"org_id": org_id, "tid": tender_id, "rule": workflow.GATE_RULE})
    status = t["review_workflow_status"]
    problems = workflow.gate_problems(t, items, documents) if status in workflow.REVIEW_OPEN else []
    by_key = {i["item_key"]: i["status"] for i in items}
    reviewer_ids = await workflow._reviewer_ids(db, org_id, t)
    me = _uid(user)
    can_review = status in workflow.REVIEW_OPEN and (perms["admin"] or (perms["review"] and me in reviewer_ids))
    can_qs = status == workflow.PENDING_QS and (perms["admin"] or (perms["qs"] and me == str(t["qs_assigned_user_id"] or "")))
    return {
        "tender": {
            "id": str(t["id"]), "tender_name": t["tender_name"], "bid_number": t["bid_number"], "stage": t["stage"],
            "source_key": t["source_key"], "source_notice_id": t["source_notice_id"], "source_url": t["source_url"],
            "source_reference": t["source_reference"], "procuring_entity": t["procuring_entity"], "region": t["region"],
            "source_published_at": t["source_published_at"], "submission_deadline": t["submission_deadline"],
            "submission_instructions": t["submission_instructions"], "clarification_deadline": t["clarification_deadline"],
            "site_visit_at": t["site_visit_at"], "site_visit_mandatory": t["site_visit_mandatory"],
            "site_visit_status": t["site_visit_status"], "site_visit_location": t["site_visit_location"],
            "site_visit_details": t["site_visit_details"], "site_visit_source": t["site_visit_source"],
            "bond_amount": float(t["bond_amount"]) if t["bond_amount"] is not None else None,
            "bid_security_currency": t["bid_security_currency"], "bid_security_form": t["bid_security_form"],
            "bid_security_validity": t["bid_security_validity"], "bid_security_source": t["bid_security_source"],
            "outstanding_notes": t["outstanding_notes"],
        },
        "workflow": {
            "status": status, "status_label": workflow.STATUS_LABELS.get(status or "", "Not started"),
            "round": t["review_round"], "started_at": t["review_started_at"],
            "primary_reviewer": person(t["review_primary_user_id"]),
            "support_reviewers": [person(u) for u in workflow._id_list(t["review_support_user_ids"])],
            "submitted_by": person(t["review_submitted_by"]), "submitted_at": t["review_submitted_at"],
            "confirmation_note": t["review_confirmation_note"],
            "qs": person(t["qs_assigned_user_id"]), "qs_assigned_at": t["qs_assigned_at"],
            "qs_verified_by": person(t["qs_verified_by"]), "qs_verified_at": t["qs_verified_at"],
        },
        "verification": {
            "deadline": by_key.get("deadline_verified"), "site_visit": by_key.get("site_visit_confirmed"),
            "bid_bond": by_key.get("bid_bond_confirmed"), "documents": by_key.get("documents_verified"),
            "qs_verified": t["qs_verified_at"] is not None,
        },
        "items": items, "documents": documents, "official_documents": official,
        "source_material": t["source_material_status"] or {}, "events": events, "deliveries": deliveries, "tasks": tasks,
        "gate": {"can_submit": can_review and not problems, "problems": problems},
        "permissions": {"can_review": can_review, "can_qs": can_qs, "is_admin": perms["admin"],
                        "can_edit_details": can_review or can_qs or perms["admin"]},
        "review_items": [{"key": k, "label": label, "guidance": g} for k, label, g in workflow.REVIEW_ITEMS],
    }


@router.get("/tenders/{tender_id}")
async def get_tender_workflow(tender_id: UUID, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    perms = await _require(db, user, "read", "review", "qs")
    return _ok(await _tender_view(db, user, str(tender_id), perms))


class ItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Optional[Literal["pending", "done", "not_applicable"]] = None
    not_applicable_reason: Optional[str] = Field(default=None, max_length=2000)
    notes: Optional[str] = Field(default=None, max_length=4000)


@router.patch("/tenders/{tender_id}/items/{item_key}")
async def update_item(tender_id: UUID, item_key: str, payload: ItemUpdate, user: dict = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    perms = await _require(db, user, "review")
    item = await workflow.update_item(db, user, str(tender_id), item_key, status=payload.status,
                                      not_applicable_reason=payload.not_applicable_reason, notes=payload.notes,
                                      is_admin=perms["admin"])
    await db.commit()
    return _ok(item, "Checklist updated.")


class DetailsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    submission_deadline: Optional[str] = None
    submission_instructions: Optional[str] = Field(default=None, max_length=4000)
    clarification_deadline: Optional[str] = None
    site_visit_status: Optional[str] = None
    site_visit_at: Optional[str] = None
    site_visit_location: Optional[str] = Field(default=None, max_length=1000)
    site_visit_details: Optional[str] = Field(default=None, max_length=4000)
    bond_amount: Optional[float] = None
    bid_security_currency: Optional[str] = Field(default=None, max_length=8)
    bid_security_form: Optional[str] = Field(default=None, max_length=1000)
    bid_security_validity: Optional[str] = Field(default=None, max_length=500)
    outstanding_notes: Optional[str] = Field(default=None, max_length=4000)


@router.patch("/tenders/{tender_id}/details")
async def update_details(tender_id: UUID, payload: DetailsUpdate, user: dict = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    perms = await _require(db, user, "review", "qs")
    changes = payload.model_dump(exclude_unset=True)
    await workflow.update_details(db, user, str(tender_id), changes, is_admin=perms["admin"])
    await db.commit()
    if {"submission_deadline", "site_visit_at"} & set(changes):
        from routers.tender_bids import _sync_tender_calendar

        await _sync_tender_calendar(db, org_id=user["org_id"], item_id=str(tender_id),
                                    sync_submission="submission_deadline" in changes, sync_visit="site_visit_at" in changes)
    return _ok(await _tender_view(db, user, str(tender_id), perms), "Details saved.")


class SubmitReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: bool
    note: Optional[str] = Field(default=None, max_length=4000)


@router.post("/tenders/{tender_id}/submit-review")
async def submit_review(tender_id: UUID, payload: SubmitReview, user: dict = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    perms = await _require(db, user, "review")
    result = await workflow.submit_review(db, user, str(tender_id), confirm=payload.confirm, note=payload.note,
                                          is_admin=perms["admin"])
    await db.commit()
    qs = result.get("qs")
    message = f"Submitted to QS - assigned to {qs['full_name']}." if qs else "Submitted - no active QS is configured; an admin must assign one."
    return _ok(await _tender_view(db, user, str(tender_id), perms), message)


class QsDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["verified", "return"]
    notes: Optional[str] = Field(default=None, max_length=4000)
    reopen_items: list[str] = Field(default_factory=list, max_length=len(workflow.REVIEW_ITEMS))


@router.post("/tenders/{tender_id}/qs-decision")
async def qs_decision(tender_id: UUID, payload: QsDecision, user: dict = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    perms = await _require(db, user, "qs")
    result = await workflow.qs_decision(db, user, str(tender_id), decision=payload.decision, notes=payload.notes,
                                        reopen_items=payload.reopen_items, is_admin=perms["admin"])
    await db.commit()
    message = ("Verified - QS preparation started." if result["status"] == workflow.QS_PREPARATION
               else "Returned to the initial reviewers for correction.")
    return _ok(await _tender_view(db, user, str(tender_id), perms), message)


class Reassign(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["primary_reviewer", "qs"]
    user_id: UUID


@router.post("/tenders/{tender_id}/reassign")
async def reassign(tender_id: UUID, payload: Reassign, user: dict = Depends(require_permission("tender_workflow.admin")),
                   db: AsyncSession = Depends(get_db)):
    await workflow.reassign(db, user, str(tender_id), role=payload.role, user_id=str(payload.user_id))
    await db.commit()
    return _ok(await _tender_view(db, user, str(tender_id), await _perms(db, user)), "Reassigned.")


@router.post("/tenders/{tender_id}/start")
async def start(tender_id: UUID, background: BackgroundTasks, send_email: bool = Query(default=False),
                user: dict = Depends(require_permission("tender_workflow.admin")), db: AsyncSession = Depends(get_db)):
    """Put an existing tender (entered before the workflow existed) on it.
    Emails go out only when asked - an old tender is not 'new'."""
    result = await workflow.start_workflow(db, org_id=user["org_id"], tender_id=str(tender_id), actor=_uid(user),
                                           origin="admin_start")
    if send_email:
        await notify.queue_new_tender_email(db, user["org_id"], str(tender_id))
    await db.commit()
    background.add_task(after_commit, user["org_id"], [str(tender_id)], post_import_hooks=False)
    message = "Already on the workflow." if result.get("already_started") else (
        "Waiting in Captured - no initial reviewers are configured." if result.get("blocked") else "Initial review started.")
    return _ok(await _tender_view(db, user, str(tender_id), await _perms(db, user)), message)


@router.post("/tenders/{tender_id}/collect")
async def collect(tender_id: UUID, background: BackgroundTasks, user: dict = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)):
    """Re-read the e-GP notice, schedule and documents (retries failed downloads)."""
    await _require(db, user, "review", "qs")
    tender = await workflow.load_tender(db, user["org_id"], str(tender_id))
    if tender["source_key"] != portal.SOURCE_KEY:
        raise HTTPException(status_code=409, detail="Only e-GP tenders can be collected automatically - upload documents by hand.")
    await db.execute(text("""UPDATE crm.tender_candidate_documents SET download_attempts = 0
                             WHERE tender_id = :tid AND document_id IS NULL AND download_status IN ('failed', 'rejected')"""),
                     {"tid": str(tender_id)})
    await db.commit()
    background.add_task(after_commit, user["org_id"], [str(tender_id)], post_import_hooks=False)
    return _ok({"queued": True}, "Collecting from e-GP - refresh in a minute.")


# ----------------------------------------------------------------------------
# Admin
# ----------------------------------------------------------------------------

def _credential_state(source: dict) -> dict:
    prefix = source.get("credential_env_prefix")
    if source.get("auth_mode") != "credentials" or not prefix:
        return {"needed": source.get("auth_mode") == "credentials", "configured": None, "env_vars": []}
    names = [f"{prefix}_USERNAME", f"{prefix}_PASSWORD"]
    return {"needed": True, "configured": all(bool(os.environ.get(n)) for n in names), "env_vars": names}


async def _settings_view(db: AsyncSession, org_id: str) -> dict:
    s = await workflow.get_settings(db, org_id)
    ids = set(workflow._id_list(s["review_user_ids"])) | set(workflow._id_list(s["qs_user_ids"])) | set(workflow._id_list(s["notify_user_ids"]))
    if s["qs_fixed_user_id"]:
        ids.add(str(s["qs_fixed_user_id"]))
    users = {str(u["id"]): u for u in await _rows(db, """SELECT id, full_name, email, is_active FROM core.users
                                                       WHERE organization_id = :org_id AND id = ANY(CAST(:ids AS uuid[]))""",
                                                  {"org_id": org_id, "ids": list(ids) or ["00000000-0000-0000-0000-000000000000"]})}

    def people(id_list: list[str]) -> list[dict]:
        return [{"id": i, "name": (users.get(i) or {}).get("full_name", "Unknown user"),
                 "active": bool((users.get(i) or {}).get("is_active"))} for i in id_list]

    return {
        "schedule_enabled": s["schedule_enabled"], "schedule_interval_minutes": s["schedule_interval_minutes"],
        "last_scheduled_run_at": s["last_scheduled_run_at"], "auto_import_enabled": s["auto_import_enabled"],
        "auto_import_bands": s["auto_import_bands"], "collect_documents": s["collect_documents"],
        "workflow_enabled": s["workflow_enabled"], "review_due_days": s["review_due_days"],
        "reviewers": people(workflow._id_list(s["review_user_ids"])), "qs": people(workflow._id_list(s["qs_user_ids"])),
        "qs_assignment_rule": s["qs_assignment_rule"], "qs_fixed_user_id": str(s["qs_fixed_user_id"]) if s["qs_fixed_user_id"] else None,
        "notify_enabled": s["notify_enabled"],
        "notify_users": [{**p, "company": bool((e or {}).get("company", True)), "private": bool((e or {}).get("private", False))}
                         for p, e in zip(people(workflow._id_list(s["notify_user_ids"])),
                                         [e for e in s["notify_user_ids"] if workflow._id_list([e])])],
        "notify_extra_emails": s["notify_extra_emails"],
        "resolved_recipients": notify.recipient_preview(await notify.resolve_recipients(db, org_id, s)),
        "updated_at": s["updated_at"],
    }


@router.get("/admin/overview")
async def admin_overview(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    perms = await _require(db, user, "review", "qs")
    org_id = user["org_id"]
    source = await ensure_source(db, org_id)
    await db.commit()
    runs = await _rows(db, """
        SELECT r.id, r.status, r.outcome, r.executor, r.created_at, r.finished_at, r.pages_fetched, r.pages_total,
               r.notices_seen, r.notices_matched, r.candidates_new, r.failures, r.summary, u.full_name AS started_by_name
        FROM crm.tender_discovery_runs r LEFT JOIN core.users u ON u.id = r.started_by
        WHERE r.organization_id = :org_id ORDER BY r.created_at DESC LIMIT 15""", {"org_id": org_id})
    new_tenders = await _rows(db, """
        SELECT t.id, t.tender_name, t.source_key, t.source_notice_id, t.created_at, t.submission_deadline, t.stage,
               t.review_workflow_status, p.full_name AS primary_name, q.full_name AS qs_name,
               (SELECT count(*) FROM core.documents d WHERE d.tender_id = t.id AND d.is_deleted = false) AS documents,
               (SELECT count(*) FROM crm.tender_candidate_documents cd WHERE cd.tender_id = t.id AND cd.document_id IS NULL) AS documents_missing,
               (SELECT count(*) FROM crm.tender_review_items i WHERE i.tender_id = t.id AND i.status = 'pending') AS items_pending
        FROM crm.tenders t
        LEFT JOIN core.users p ON p.id = t.review_primary_user_id
        LEFT JOIN core.users q ON q.id = t.qs_assigned_user_id
        WHERE t.organization_id = :org_id AND t.is_deleted = false
          AND (t.review_workflow_status IS NOT NULL AND t.review_workflow_status <> 'qs_preparation'
               OR t.created_at > NOW() - INTERVAL '30 days')
        ORDER BY t.created_at DESC LIMIT 200""", {"org_id": org_id})
    counts = {r["s"] or "not_started": r["n"] for r in await _rows(db, """
        SELECT review_workflow_status AS s, count(*) AS n FROM crm.tenders
        WHERE organization_id = :org_id AND is_deleted = false AND stage NOT IN ('Lost', 'Awarded', 'Awarded/Lost')
        GROUP BY 1""", {"org_id": org_id})}
    upcoming = await _rows(db, """
        SELECT id, tender_name, 'deadline' AS kind, submission_deadline AS at, NULL AS detail, review_workflow_status
        FROM crm.tenders WHERE organization_id = :org_id AND is_deleted = false AND stage NOT IN ('Lost', 'Awarded')
          AND submission_deadline BETWEEN NOW() AND NOW() + INTERVAL '21 days'
        UNION ALL
        SELECT id, tender_name, 'site_visit', site_visit_at, COALESCE(site_visit_status, 'unknown') || COALESCE(' - ' || site_visit_location, ''),
               review_workflow_status
        FROM crm.tenders WHERE organization_id = :org_id AND is_deleted = false AND stage NOT IN ('Lost', 'Awarded')
          AND site_visit_at BETWEEN NOW() AND NOW() + INTERVAL '21 days'
        ORDER BY at LIMIT 100""", {"org_id": org_id})
    email_problems = await _rows(db, """
        SELECT d.id, d.tender_id, t.tender_name, d.recipient_label, d.recipient_email, d.status, d.attempts, d.last_error,
               d.last_attempt_at, d.next_attempt_at
        FROM crm.tender_notification_deliveries d JOIN crm.tenders t ON t.id = d.tender_id
        WHERE d.organization_id = :org_id AND d.status IN ('failed', 'unresolved', 'pending', 'sending')
        ORDER BY d.created_at DESC LIMIT 100""", {"org_id": org_id})
    overdue = await _rows(db, """
        SELECT k.id, k.title, k.due_date, k.status, k.entity_id AS tender_id, u.full_name AS assignee_name
        FROM crm.tasks k LEFT JOIN core.users u ON u.id = k.assigned_to_user_id
        WHERE k.organization_id = :org_id AND k.generation_rule = :rule AND k.is_deleted = false
          AND k.status NOT IN ('completed', 'cancelled', 'superseded', 'not_applicable') AND k.due_date < CURRENT_DATE
        ORDER BY k.due_date LIMIT 100""", {"org_id": org_id, "rule": workflow.GATE_RULE})
    blocked = await _rows(db, """
        SELECT t.id, t.tender_name, t.review_workflow_status,
               CASE WHEN t.review_workflow_status = 'captured' THEN 'No initial reviewers configured'
                    ELSE 'No QS assigned' END AS reason
        FROM crm.tenders t
        WHERE t.organization_id = :org_id AND t.is_deleted = false
          AND (t.review_workflow_status = 'captured'
               OR (t.review_workflow_status = 'pending_qs_verification' AND t.qs_assigned_user_id IS NULL))""", {"org_id": org_id})
    collection_problems = await _rows(db, """
        SELECT cd.id, cd.tender_id, t.tender_name, cd.label, cd.download_status, cd.download_error, cd.download_attempts
        FROM crm.tender_candidate_documents cd JOIN crm.tenders t ON t.id = cd.tender_id
        WHERE cd.organization_id = :org_id AND cd.document_id IS NULL AND cd.download_status IN ('failed', 'rejected')
          AND t.is_deleted = false
        ORDER BY cd.updated_at DESC LIMIT 100""", {"org_id": org_id})
    s = await _settings_view(db, org_id)
    warnings: list[str] = []
    if not s["reviewers"]:
        warnings.append("No initial reviewers configured - new tenders wait in Captured.")
    if not s["qs"] and s["qs_assignment_rule"] != "fixed":
        warnings.append("No QS configured - reviewed tenders can't be assigned.")
    if any(r["status"] == "unresolved" for r in s["resolved_recipients"]):
        warnings.append("Some new-tender email addresses could not be resolved - see Recipients.")
    if not app_settings.RESEND_API_KEY or not app_settings.EMAIL_FROM_ADDRESS:
        warnings.append("Email is not configured on this server (RESEND_API_KEY / EMAIL_FROM_ADDRESS) - emails stay queued.")
    if not app_settings.BACKGROUND_JOBS_ENABLED:
        warnings.append("Background worker is off - document text extraction stays pending; reviewers read the files directly.")
    if s["schedule_enabled"] and s["last_scheduled_run_at"] and \
            datetime.now(timezone.utc) - s["last_scheduled_run_at"] > timedelta(minutes=s["schedule_interval_minutes"] * 2 + 60):
        warnings.append("The scheduled run is overdue - check that the cron job (scripts/run_tender_automation.py) is installed.")
    return _ok({
        "sources": [{
            "source_key": source["source_key"], "display_name": source["display_name"], "base_url": source["base_url"],
            "enabled": source["enabled"], "connection_state": source["connection_state"], "state_reason": source["state_reason"],
            "last_verified_at": source["last_verified_at"], "last_run_at": source["last_run_at"],
            "last_run_status": source["last_run_status"], "last_auth_problem": source["last_auth_problem"],
            "last_auth_problem_at": source["last_auth_problem_at"], "auth_mode": source["auth_mode"],
            "credentials": _credential_state(source),
            "access_note": "Public access - AEGIS reads e-GP as an anonymous visitor (notice, schedule and documents). "
                           "No e-GP login is used or stored; the supplier login has a CAPTCHA, which is never automated.",
        }],
        "runs": runs, "settings": s, "counts": counts, "new_tenders": new_tenders, "upcoming": upcoming,
        "email_problems": email_problems, "overdue_tasks": overdue, "blocked_handovers": blocked,
        "collection_problems": collection_problems, "warnings": warnings, "permissions": {"is_admin": perms["admin"]},
    })


class NotifyUser(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: UUID
    company: bool = True
    private: bool = False


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schedule_enabled: Optional[bool] = None
    schedule_interval_minutes: Optional[int] = Field(default=None, ge=60, le=10080)
    auto_import_enabled: Optional[bool] = None
    auto_import_bands: Optional[list[Literal["strong", "possible", "weak"]]] = Field(default=None, min_length=1)
    collect_documents: Optional[bool] = None
    workflow_enabled: Optional[bool] = None
    review_due_days: Optional[int] = Field(default=None, ge=0, le=14)
    review_user_ids: Optional[list[UUID]] = Field(default=None, max_length=20)
    qs_user_ids: Optional[list[UUID]] = Field(default=None, max_length=20)
    qs_assignment_rule: Optional[Literal["round_robin", "least_loaded", "fixed"]] = None
    qs_fixed_user_id: Optional[UUID] = None
    notify_enabled: Optional[bool] = None
    notify_users: Optional[list[NotifyUser]] = Field(default=None, max_length=30)
    notify_extra_emails: Optional[list[str]] = Field(default=None, max_length=20)


@router.put("/admin/settings")
async def update_settings(payload: SettingsUpdate, user: dict = Depends(require_permission("tender_workflow.admin")),
                          db: AsyncSession = Depends(get_db)):
    org_id = user["org_id"]
    await workflow.get_settings(db, org_id, lock=True)
    values = payload.model_dump(exclude_unset=True)
    for key in ("review_user_ids", "qs_user_ids"):
        if key in values:
            ids = [str(i) for i in values[key]]
            found = await workflow.active_users(db, org_id, ids)
            if len(found) != len(set(ids)):
                raise HTTPException(status_code=422, detail=f"{key.replace('_', ' ')}: every person must be an active user.")
            values[key] = list(dict.fromkeys(ids))
    if values.get("qs_fixed_user_id"):
        if not await workflow.active_users(db, org_id, [str(values["qs_fixed_user_id"])]):
            raise HTTPException(status_code=422, detail="The fixed QS must be an active user.")
        values["qs_fixed_user_id"] = str(values["qs_fixed_user_id"])
    if values.get("qs_assignment_rule") == "fixed" and not (values.get("qs_fixed_user_id")
                                                             or (await workflow.get_settings(db, org_id))["qs_fixed_user_id"]):
        raise HTTPException(status_code=422, detail="Choose the QS for the fixed assignment rule.")
    if "notify_users" in values:
        entries = values.pop("notify_users")
        found = await workflow.active_users(db, org_id, [str(e["user_id"]) for e in entries])
        if len(found) != len({str(e["user_id"]) for e in entries}):
            raise HTTPException(status_code=422, detail="Every email recipient must be an active user.")
        values["notify_user_ids"] = [{"user_id": str(e["user_id"]), "company": e["company"], "private": e["private"]}
                                     for e in entries]
    if "notify_extra_emails" in values:
        cleaned = []
        for email in values["notify_extra_emails"]:
            normalised = notify._norm(email)
            if not normalised:
                raise HTTPException(status_code=422, detail=f"'{email}' is not a valid email address.")
            cleaned.append(normalised)
        values["notify_extra_emails"] = list(dict.fromkeys(cleaned))
    json_keys = {"auto_import_bands", "review_user_ids", "qs_user_ids", "notify_user_ids", "notify_extra_emails"}
    if values:
        sets = ", ".join(f"{k} = CAST(:{k} AS jsonb)" if k in json_keys else f"{k} = :{k}" for k in values)
        params = {k: (workflow._j(v) if k in json_keys else v) for k, v in values.items()}
        await db.execute(text(f"UPDATE crm.tender_automation_settings SET {sets}, updated_by = :uid, updated_at = NOW() WHERE organization_id = :org_id"),  # nosec B608 - keys from the model
                         {**params, "uid": _uid(user), "org_id": org_id})
    requeued = 0
    if {"notify_user_ids", "notify_extra_emails"} & set(values):
        requeued = await notify.requeue_unresolved(db, org_id)
    # Tenders that arrived while nobody was configured to review them.
    resumed = await workflow.resume_captured(db, org_id, actor=_uid(user)) if values.get("review_user_ids") else 0
    await db.commit()
    if requeued:
        await notify.deliver_pending(db, org_id=org_id)
    message = "Tender automation settings saved."
    if resumed:
        message += f" {resumed} tender{'s' if resumed != 1 else ''} waiting in Captured moved to initial review."
    return _ok(await _settings_view(db, org_id), message)


@router.post("/admin/deliveries/{delivery_id}/retry")
async def retry_delivery(delivery_id: UUID, user: dict = Depends(require_permission("tender_workflow.admin")),
                         db: AsyncSession = Depends(get_db)):
    result = await notify.retry_delivery(db, user["org_id"], str(delivery_id))
    if not result["retried"]:
        reasons = {"not_found": "Delivery not found.", "already_sent": "That email was already delivered.",
                   "unresolved": "There is no address to send to - add it in the recipients settings first."}
        raise HTTPException(status_code=409, detail=reasons[result["reason"]])
    await db.commit()
    outcome = await notify.deliver_pending(db, org_id=user["org_id"])
    return _ok(outcome, "Retried.")


@router.post("/admin/run-now")
async def run_now(background: BackgroundTasks, user: dict = Depends(require_permission("tender_workflow.admin")),
                  db: AsyncSession = Depends(get_db)):
    """Discovery + auto-import (if enabled) + collection + emails, now."""
    org_id = user["org_id"]
    source = await ensure_source(db, org_id)
    if not source["enabled"]:
        raise HTTPException(status_code=409, detail="The e-GP connector is disabled.")
    if source["connection_state"] != "connected_verified":
        raise HTTPException(status_code=409, detail="Verify the e-GP connection first (e-GP Discovery -> Connect e-GP).")
    profile = await ensure_default_profile(db, org_id, _uid(user))
    try:
        run = await create_run(db, org_id=org_id, user_id=_uid(user), profile=profile,
                               filters=dict(profile.get("default_filters") or {}), page_limit=None)
    except ActiveRunExists as exc:
        raise HTTPException(status_code=409, detail={"message": "A discovery run is already in progress.", "run_id": exc.run_id})
    await db.commit()
    background.add_task(run_discovery_and_import, org_id, str(run["id"]))
    return _ok({"run_id": str(run["id"])}, "Run started.")
