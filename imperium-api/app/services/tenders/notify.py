"""New-tender email: one email per tender to every configured address.

Recipients come from crm.tender_automation_settings.notify_user_ids, each
{"user_id", "company": bool, "private": bool}, plus notify_extra_emails:

  company  the person's AEGIS login (core.users.email), through the
           configured EMAIL_REDIRECTS (ashton@admin.com -> admin@...)
  private  the mailbox behind their Microsoft Teams guest account
           (core.users.teams_account, decoded by core.email), else the
           personal email on their HR record (hr.employees.personal_email)

Nothing is guessed: an address that can't be resolved becomes an
'unresolved' row the admin view flags, and everyone else still gets the
email. crm.tender_notification_deliveries holds one row per tender x
address (unique), so a retry or a second run never emails anyone twice;
rows are claimed (status 'sending') before the send.
"""

from __future__ import annotations

import html
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.tenders.egp.parser import HARARE
from app.services.tenders.workflow import STATUS_LABELS, _id_list, _row, _rows, get_settings, linked_documents
from core.config import settings as app_settings
from core.email import real_address_from_teams_account, send_email_exact
from core.logging import logger

KIND = "new_tender"
MAX_ATTEMPTS = 5
STALE_SENDING = timedelta(minutes=10)


def _norm(address: Optional[str]) -> Optional[str]:
    value = (address or "").strip()
    name, _, domain = value.partition("@")
    if not name or "." not in domain or " " in value:
        return None
    return value.lower()


async def resolve_recipients(db: AsyncSession, org_id: str, settings: dict) -> list[dict]:
    """[{key, email, user_id, label, source, status}] - status 'pending' for a
    resolved address, 'unresolved' for one that needs admin configuration."""
    out: list[dict] = []
    entries = [e for e in settings["notify_user_ids"] or [] if isinstance(e, (dict, str))]
    ids = _id_list(entries)
    users = {str(u["id"]): u for u in await _rows(
        db,
        """
        SELECT u.id, u.full_name, u.email, u.teams_account, u.is_active,
               (SELECT e.personal_email FROM hr.employees e
                WHERE e.linked_user_id = u.id AND e.organization_id = u.organization_id
                  AND COALESCE(e.is_deleted, false) = false AND e.personal_email IS NOT NULL
                ORDER BY e.updated_at DESC NULLS LAST LIMIT 1) AS personal_email
        FROM core.users u
        WHERE u.organization_id = :org_id AND u.is_deleted = false AND u.id = ANY(CAST(:ids AS uuid[]))
        """,
        {"org_id": org_id, "ids": ids or ["00000000-0000-0000-0000-000000000000"]},
    )}
    redirects = app_settings.email_redirects
    for entry in entries:
        user_id = _id_list([entry])[0] if _id_list([entry]) else None
        wants_company = entry.get("company", True) if isinstance(entry, dict) else True
        wants_private = entry.get("private", False) if isinstance(entry, dict) else False
        user = users.get(user_id or "")
        if not user or not user["is_active"]:
            out.append({"key": f"unresolved:{user_id}:user", "email": None, "user_id": None, "label": "Unknown or inactive user",
                        "source": None, "status": "unresolved"})
            continue
        name = user["full_name"] or user["email"]
        if wants_company:
            login = _norm(user["email"])
            redirected = _norm(redirects.get(login or "", "")) if login else None
            email = redirected or login
            if email:
                out.append({"key": email, "email": email, "user_id": user_id, "label": f"{name} (company)",
                            "source": "aegis_login_redirect" if redirected else "aegis_login", "status": "pending"})
            else:
                out.append({"key": f"unresolved:{user_id}:company", "email": None, "user_id": user_id,
                            "label": f"{name} (company)", "source": None, "status": "unresolved"})
        if wants_private:
            teams = _norm(real_address_from_teams_account(user["teams_account"]))
            hr = _norm(user["personal_email"])
            email = teams or hr
            if email:
                out.append({"key": email, "email": email, "user_id": user_id, "label": f"{name} (private)",
                            "source": "teams_account" if teams else "hr_personal_email", "status": "pending"})
            else:
                out.append({"key": f"unresolved:{user_id}:private", "email": None, "user_id": user_id,
                            "label": f"{name} (private)", "source": None, "status": "unresolved"})
    for extra in settings["notify_extra_emails"] or []:
        email = _norm(extra if isinstance(extra, str) else (extra or {}).get("email"))
        if email:
            out.append({"key": email, "email": email, "user_id": None, "label": email, "source": "admin_configured",
                        "status": "pending"})
    seen: set[str] = set()
    unique = []
    for item in out:
        if item["key"] in seen:
            continue
        seen.add(item["key"])
        unique.append(item)
    return unique


async def queue_new_tender_email(db: AsyncSession, org_id: str, tender_id: str) -> int:
    """Creates the delivery rows (in the caller's transaction). Re-queuing
    the same tender adds nothing."""
    settings = await get_settings(db, org_id)
    if not settings["notify_enabled"]:
        return 0
    added = 0
    for r in await resolve_recipients(db, org_id, settings):
        result = await db.execute(
            text("""
                INSERT INTO crm.tender_notification_deliveries (organization_id, tender_id, kind, recipient_key,
                    recipient_email, recipient_user_id, recipient_label, address_source, status, last_error)
                VALUES (:org_id, :tid, :kind, :key, :email, :uid, :label, :source, :status, :error)
                ON CONFLICT (tender_id, kind, recipient_key) DO NOTHING
            """),
            {"org_id": org_id, "tid": tender_id, "kind": KIND, "key": r["key"], "email": r["email"], "uid": r["user_id"],
             "label": r["label"][:255], "source": r["source"], "status": r["status"],
             "error": "No verified address on file - add it in Tender automation settings or the person's profile."
                      if r["status"] == "unresolved" else None},
        )
        added += result.rowcount or 0
    return added


def _fmt(at: Optional[datetime]) -> Optional[str]:
    return at.astimezone(HARARE).strftime("%a %d %b %Y, %H:%M (Harare)") if at else None


async def build_email(db: AsyncSession, org_id: str, tender_id: str) -> Optional[dict]:
    t = await _row(
        db,
        """
        SELECT t.*, p.full_name AS primary_name,
               (SELECT string_agg(u.full_name, ', ') FROM core.users u
                WHERE u.id = ANY(SELECT CAST(jsonb_array_elements_text(t.review_support_user_ids) AS uuid))) AS support_names,
               q.full_name AS qs_name
        FROM crm.tenders t
        LEFT JOIN core.users p ON p.id = t.review_primary_user_id
        LEFT JOIN core.users q ON q.id = t.qs_assigned_user_id
        WHERE t.id = :id AND t.organization_id = :org_id AND t.is_deleted = false
        """,
        {"id": tender_id, "org_id": org_id},
    )
    if not t:
        return None
    docs = await linked_documents(db, org_id, tender_id)
    material = t["source_material_status"] or {}
    link = f"{app_settings.PUBLIC_APP_URL.rstrip('/')}/dashboard/crm/tenders/{tender_id}"
    source = "PRAZ e-GP" if t["source_key"] == "praz_egp" else ("Entered in AEGIS" if not t["source_key"] else t["source_key"])
    reference = " / ".join(x for x in [t["source_reference"], f"e-GP Tender ID {t['source_notice_id']}" if t["source_notice_id"] else None,
                                       t["bid_number"] if t["bid_number"] and not t["source_notice_id"] else None] if x) or "Not captured"
    visit = None
    if t["site_visit_at"] or t["site_visit_location"] or t["site_visit_details"]:
        visit = ", ".join(x for x in [_fmt(t["site_visit_at"]), t["site_visit_location"]] if x) or t["site_visit_details"]
    rule = {"required": "compulsory", "optional": "optional", "not_required": "not required"}.get(t["site_visit_status"] or "", "attendance rule not confirmed")
    bond_parts = [f"{t['bid_security_currency'] or ''} {float(t['bond_amount']):,.2f}".strip() if t["bond_amount"] else None,
                  t["bid_security_form"], t["bid_security_validity"]]
    bond = ", ".join(x for x in bond_parts if x) or None
    fees = material.get("facts") or {}
    pending: list[str] = []
    if not t["submission_deadline"]:
        pending.append("Submission deadline not captured")
    pending.append("Every detail below is as captured from the source - not yet verified by the initial review"
                   if t["review_workflow_status"] in (None, "captured", "pending_tender_review", "returned_for_correction")
                   else "Verified by initial review; QS verification pending" if t["review_workflow_status"] == "pending_qs_verification"
                   else "Verified by initial review and QS")
    if not visit:
        pending.append("Site visit / briefing: not found yet")
    elif t["site_visit_source"] != "reviewer":
        pending.append("Site visit: from the e-GP schedule - whether attendance is compulsory is confirmed in review")
    if not bond:
        pending.append("Bid bond / security: not found yet")
    docs_info = material.get("documents") or {}
    if docs_info.get("failed"):
        pending.append(f"{docs_info['failed']} document(s) failed to download - the reviewer will fetch them")
    rows = [
        ("Reference", reference), ("Procuring entity", t["procuring_entity"] or "Not captured"),
        ("Source", source + (f" - {t['source_url']}" if t["source_url"] else "")),
        ("Submission deadline", _fmt(t["submission_deadline"]) or "Not captured"),
        ("Site visit / briefing", f"{visit} ({rule})" if visit else "Not found yet"),
        ("Bid bond / security", bond or "Not found yet"),
    ]
    if fees.get("bid_bond_establishment_fee"):
        rows.append(("Cash bid bond establishment fee (e-GP)", str(fees["bid_bond_establishment_fee"])))
    if fees.get("spoc_fee"):
        rows.append(("SPOC fee (e-GP)", str(fees["spoc_fee"])))
    rows += [
        ("Documents attached", f"{len(docs)}" + (f" of {docs_info.get('listed')} listed on e-GP" if docs_info.get("listed") else "")),
        ("Workflow status", STATUS_LABELS.get(t["review_workflow_status"] or "", "Not started")),
        ("Initial review", ", ".join(x for x in [f"{t['primary_name']} (primary)" if t["primary_name"] else None,
                                                  t["support_names"]] if x) or "Not assigned"),
    ]
    title = t["tender_name"] or "New tender"
    subject = f"New tender: {title}"[:180]
    table = "".join(f"<tr><td style='padding:4px 12px 4px 0;color:#555;vertical-align:top'>{html.escape(k)}</td>"
                    f"<td style='padding:4px 0'>{html.escape(str(v))}</td></tr>" for k, v in rows)
    pending_html = "".join(f"<li>{html.escape(p)}</li>" for p in pending)
    body = (f"<div style='font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111'>"
            f"<p>A new tender was entered into AEGIS.</p><h2 style='font-size:18px;margin:8px 0'>{html.escape(title)}</h2>"
            f"<table style='border-collapse:collapse'>{table}</table>"
            f"<p style='margin-top:12px'><b>Awaiting manual verification</b></p><ul>{pending_html}</ul>"
            f"<p><a href='{html.escape(link)}'>Open the tender in AEGIS</a></p>"
            f"<p style='color:#777;font-size:12px'>Tender notice information is for internal bid evaluation only.</p></div>")
    plain = "\n".join([f"A new tender was entered into AEGIS: {title}", ""] + [f"{k}: {v}" for k, v in rows]
                      + ["", "Awaiting manual verification:"] + [f"- {p}" for p in pending] + ["", f"Open in AEGIS: {link}"])
    return {"subject": subject, "html": body, "text": plain}


async def deliver_pending(db: AsyncSession, *, org_id: Optional[str] = None, tender_id: Optional[str] = None,
                          limit: int = 50) -> dict:
    """Claims due deliveries, sends them, records the outcome. Commits.
    Safe to call from several places at once: rows are claimed with
    FOR UPDATE SKIP LOCKED and a claimed row is not picked up again."""
    claimed = await _rows(
        db,
        """
        UPDATE crm.tender_notification_deliveries d
        SET status = 'sending', attempts = d.attempts + 1, last_attempt_at = NOW(), updated_at = NOW()
        WHERE d.id IN (
            SELECT id FROM crm.tender_notification_deliveries
            WHERE kind = :kind AND recipient_email IS NOT NULL AND attempts < :max
              AND (CAST(:org_id AS uuid) IS NULL OR organization_id = CAST(:org_id AS uuid))
              AND (CAST(:tid AS uuid) IS NULL OR tender_id = CAST(:tid AS uuid))
              AND (status = 'pending'
                   OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW())
                   OR (status = 'sending' AND last_attempt_at < NOW() - CAST(:stale AS interval)))
            ORDER BY created_at
            LIMIT :limit
            FOR UPDATE SKIP LOCKED
        )
        RETURNING d.*
        """,
        {"kind": KIND, "max": MAX_ATTEMPTS, "org_id": org_id, "tid": tender_id, "limit": limit,
         "stale": STALE_SENDING},
    )
    await db.commit()
    sent = failed = 0
    emails: dict[str, Optional[dict]] = {}
    for row in claimed:
        key = str(row["tender_id"])
        if key not in emails:
            emails[key] = await build_email(db, str(row["organization_id"]), key)
        message = emails[key]
        if message is None:
            await db.execute(text("UPDATE crm.tender_notification_deliveries SET status = 'skipped', last_error = 'Tender no longer exists.', updated_at = NOW() WHERE id = :id"),
                             {"id": row["id"]})
            await db.commit()
            continue
        result = await send_email_exact(row["recipient_email"], message["subject"], message["html"], message["text"])
        if result.ok:
            sent += 1
            await db.execute(text("UPDATE crm.tender_notification_deliveries SET status = 'sent', sent_at = NOW(), last_error = NULL, next_attempt_at = NULL, updated_at = NOW() WHERE id = :id"),
                             {"id": row["id"]})
        else:
            failed += 1
            retry = result.retryable and row["attempts"] < MAX_ATTEMPTS
            await db.execute(
                text("""
                    UPDATE crm.tender_notification_deliveries
                    SET status = 'failed', last_error = :error, updated_at = NOW(),
                        next_attempt_at = CASE WHEN :retry THEN NOW() + CAST(:wait AS interval) ELSE NULL END
                    WHERE id = :id
                """),
                {"error": ((result.error or "Send failed") + ("" if retry else " (not retried automatically)"))[:1000],
                 "retry": retry, "wait": timedelta(minutes=5 * 2 ** (row["attempts"] - 1)), "id": row["id"]},
            )
            logger.warning("tender_notification.failed", tender_id=key, recipient=row["recipient_label"], retry=retry)
        await db.commit()
    return {"claimed": len(claimed), "sent": sent, "failed": failed}


async def retry_delivery(db: AsyncSession, org_id: str, delivery_id: str) -> dict:
    row = await _row(db, "SELECT * FROM crm.tender_notification_deliveries WHERE id = CAST(:id AS uuid) AND organization_id = :org_id",
                     {"id": delivery_id, "org_id": org_id})
    if not row:
        return {"retried": False, "reason": "not_found"}
    if row["status"] == "sent":
        return {"retried": False, "reason": "already_sent"}
    if row["status"] == "unresolved" or not row["recipient_email"]:
        return {"retried": False, "reason": "unresolved"}
    await db.execute(
        text("""
            UPDATE crm.tender_notification_deliveries
            SET status = 'pending', attempts = LEAST(attempts, :reset), next_attempt_at = NULL, updated_at = NOW()
            WHERE id = :id AND status <> 'sent'
        """),
        {"reset": MAX_ATTEMPTS - 1, "id": row["id"]},
    )
    return {"retried": True}


async def requeue_unresolved(db: AsyncSession, org_id: str) -> int:
    """After an admin adds a missing address: re-resolve every tender that
    still has an unresolved row, adding the newly resolvable deliveries."""
    tenders = await _rows(db, "SELECT DISTINCT tender_id FROM crm.tender_notification_deliveries WHERE organization_id = :org_id AND status = 'unresolved'",
                          {"org_id": org_id})
    added = 0
    for t in tenders:
        added += await queue_new_tender_email(db, org_id, str(t["tender_id"]))
    if tenders:
        settings = await get_settings(db, org_id)
        keys = [r["key"] for r in await resolve_recipients(db, org_id, settings) if r["status"] == "unresolved"]
        await db.execute(
            text("""
                UPDATE crm.tender_notification_deliveries SET status = 'skipped', last_error = 'Address resolved since; see the new delivery row.', updated_at = NOW()
                WHERE organization_id = :org_id AND status = 'unresolved' AND NOT (recipient_key = ANY(CAST(:keys AS text[])))
            """),
            {"org_id": org_id, "keys": keys or [""]},
        )
    return added


def recipient_preview(resolved: list[dict]) -> list[dict[str, Any]]:
    return [{"label": r["label"], "email": r["email"], "source": r["source"], "status": r["status"]} for r in resolved]
