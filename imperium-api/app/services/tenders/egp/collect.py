"""Collect a tender's official material from e-GP: notice facts, the
activity schedule and every bidding document, attached to the tender.

Reads exactly what an anonymous visitor reaches from the public notice page
(see portal.py): the notice page, its "Documents: Preview" popup, its
"View all activity" popup, and the download links in that popup. Nothing is
signed into.

What it writes, and what it never does:
  * documents: stored in the private 'documents' bucket and registered like
    a dashboard upload (core.file_attachments + core.documents + a 'tender'
    document link); text extraction is queued. Each official document is
    tracked in crm.tender_candidate_documents with its download status, so a
    failure is visible and the next collection retries it (3 attempts).
  * facts: a value read from the source fills a tender field only when the
    field is empty or was itself filled from the source - a value a person
    entered is never overwritten. Every value read, and every disagreement
    with what the tender already says, goes into
    crm.tenders.source_material_status for the reviewer.
  * nothing read here is "verified": the initial review does that.
Commits after each document so partial progress survives.
"""

from __future__ import annotations

import json
import mimetypes
import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any, Optional
from urllib.parse import unquote

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.jobs.queue import enqueue_background_job
from app.services.tenders.egp import portal
from app.services.tenders.egp.discovery import ClientFactory, _client_factory, ensure_source
from app.services.tenders.egp.parser import (
    parse_amount,
    parse_detail_page,
    parse_document_list,
    parse_schedule,
)
from app.services.tenders.workflow import record_event
from core.config import settings
from core.logging import logger

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".png", ".jpg", ".jpeg", ".zip", ".dwg", ".rar"}
MAX_BYTES = 30 * 1024 * 1024
MAX_DOWNLOAD_ATTEMPTS = 3
# File signatures: a download that is really an HTML error page is rejected.
_MAGIC = {
    ".pdf": (b"%PDF",), ".docx": (b"PK",), ".xlsx": (b"PK",), ".zip": (b"PK",),
    ".doc": (b"\xd0\xcf\x11\xe0",), ".xls": (b"\xd0\xcf\x11\xe0",),
    ".png": (b"\x89PNG",), ".jpg": (b"\xff\xd8",), ".jpeg": (b"\xff\xd8",), ".rar": (b"Rar!",), ".dwg": (b"AC10",),
}


def _j(value: Any) -> str:
    return json.dumps(value, default=str)


async def _row(db: AsyncSession, sql: str, params: dict) -> Optional[dict]:
    row = (await db.execute(text(sql), params)).mappings().first()
    return dict(row) if row else None


def _file_name(document_name: str, disposition: Optional[str]) -> str:
    name = document_name
    match = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', disposition or "", re.I)
    if match:
        name = unquote(match.group(1))
    name = PurePosixPath(name.replace("\\", "/")).name
    name = re.sub(r"[^\w.\- ()]", "_", name).strip() or "document"
    return name[:180]


def _check_content(name: str, content: bytes) -> Optional[str]:
    ext = PurePosixPath(name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return f"'{ext or 'no extension'}' files are not accepted."
    if not content:
        return "The portal returned an empty file."
    signatures = _MAGIC.get(ext)
    if signatures and not any(content.startswith(sig) for sig in signatures):
        return "The download is not a valid file of its type (the portal may have returned an error page)."
    return None


async def _store(content: bytes, file_name: str, mime: str) -> str:
    """Upload to the private 'documents' bucket at the dashboard's path
    convention. Returns the storage path."""
    ext = PurePosixPath(file_name).suffix.lower()
    path = f"documents/{int(time.time() * 1000)}-{secrets.token_hex(4)}{ext}"
    url = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/documents/{path}"
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(url, content=content, headers={
            "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}", "apikey": settings.SUPABASE_SERVICE_KEY,
            "Content-Type": mime, "x-upsert": "false", "cache-control": "3600"})
    if response.status_code >= 300:
        raise RuntimeError(f"Storage upload failed (HTTP {response.status_code}).")
    return path


async def _register(db: AsyncSession, *, org_id: str, tender_id: str, file_name: str, path: str, mime: str,
                    size: int, label: str) -> tuple[str, str]:
    attachment_id = (await db.execute(
        text("""
            INSERT INTO core.file_attachments (organization_id, uploaded_by, file_name, storage_path, mime_type, size_bytes,
                extraction_status)
            VALUES (:org_id, NULL, :name, :path, :mime, :size, 'pending')
            RETURNING id
        """),
        {"org_id": org_id, "name": file_name, "path": path, "mime": mime, "size": size},
    )).scalar()
    document_id = (await db.execute(
        text("""
            INSERT INTO core.documents (organization_id, title, category, tender_id, file_name, file_size_bytes,
                file_attachment_id, created_by)
            VALUES (:org_id, :title, 'tender', :tid, :name, :size, :fa, NULL)
            RETURNING id
        """),
        {"org_id": org_id, "title": f"e-GP: {label}"[:255], "tid": tender_id, "name": file_name, "size": size,
         "fa": attachment_id},
    )).scalar()
    await db.execute(
        text("""
            INSERT INTO core.document_links (organization_id, document_id, entity_type, entity_id, link_role, linked_by)
            VALUES (:org_id, :doc, 'tender', :tid, 'egp_official_document', NULL)
            ON CONFLICT DO NOTHING
        """),
        {"org_id": org_id, "doc": document_id, "tid": tender_id},
    )
    return str(document_id), str(attachment_id)


async def _ensure_candidate(db: AsyncSession, org_id: str, tender: dict) -> str:
    """Documents hang off the staged notice. A tender entered by hand (or
    backfilled from 'Tender ID: N') gets a minimal one, already imported."""
    existing = await _row(db, """SELECT id FROM crm.tender_candidates
                                 WHERE organization_id = :org_id AND source_key = :key AND source_notice_id = :nid""",
                          {"org_id": org_id, "key": tender["source_key"], "nid": tender["source_notice_id"]})
    if existing:
        await db.execute(text("UPDATE crm.tender_candidates SET tender_id = COALESCE(tender_id, :tid) WHERE id = :id"),
                         {"tid": tender["id"], "id": existing["id"]})
        return str(existing["id"])
    return str((await db.execute(
        text("""
            INSERT INTO crm.tender_candidates (organization_id, source_key, source_notice_id, notice_url, title,
                review_status, tender_id, detail_status)
            VALUES (:org_id, :key, :nid, :url, :title, 'imported', :tid, 'not_fetched')
            ON CONFLICT (organization_id, source_key, source_notice_id) DO UPDATE SET tender_id = COALESCE(crm.tender_candidates.tender_id, EXCLUDED.tender_id)
            RETURNING id
        """),
        {"org_id": org_id, "key": tender["source_key"], "nid": tender["source_notice_id"],
         "url": portal.detail_url(tender["source_notice_id"]), "title": tender["tender_name"], "tid": tender["id"]},
    )).scalar())


def _person_entered(source: Optional[str], has_value: bool) -> bool:
    """A value a person entered: tagged 'reviewer', or present with no source
    tag at all (typed in before this tracking existed)."""
    return source == "reviewer" or (not source and has_value)


async def collect_for_tender(db: AsyncSession, org_id: str, tender_id: str, *,
                             client_factory: Optional[ClientFactory] = None) -> dict:
    tender = await _row(db, "SELECT * FROM crm.tenders WHERE id = :id AND organization_id = :org_id AND is_deleted = false",
                        {"id": tender_id, "org_id": org_id})
    if not tender:
        return {"status": "skipped", "reason": "Tender not found."}
    if tender["source_key"] != portal.SOURCE_KEY or not (tender["source_notice_id"] or "").isdigit():
        return {"status": "skipped", "reason": "Not an e-GP tender - nothing to collect automatically."}
    notice_id = tender["source_notice_id"]
    source = await ensure_source(db, org_id)
    candidate_id = await _ensure_candidate(db, org_id, tender)
    await db.commit()
    factory = client_factory or _client_factory(source)
    status: dict[str, Any] = {"collected_at": datetime.now(timezone.utc).isoformat(), "notice": None, "schedule": None,
                              "documents": {"listed": 0, "downloaded": 0, "failed": 0, "already_attached": 0},
                              "facts": {}, "discrepancies": [], "errors": []}
    updates: dict[str, Any] = {}

    async with factory() as client:
        # 1. Notice page: reference, entity, published date, bid security amount.
        try:
            response = await client.get(portal.detail_url(notice_id))
            detail = parse_detail_page(response.text, response.url)
            if detail.has_captcha or detail.is_login_shell or not detail.structure_found:
                raise portal.PortalRestricted("Notice page not readable (login, CAPTCHA or withdrawn).", url=response.url)
            status["notice"] = "read"
            facts = status["facts"]
            for key in ("official_reference", "procuring_entity", "project_location", "bid_security_amount",
                        "bid_bond_establishment_fee", "spoc_fee", "bid_validity_days", "addenda_count"):
                value = detail.value(key)
                if value not in (None, ""):
                    facts[key] = value
            if not tender["source_reference"] and facts.get("official_reference"):
                updates["source_reference"] = str(facts["official_reference"])[:255]
            if not tender["procuring_entity"] and facts.get("procuring_entity"):
                updates["procuring_entity"] = str(facts["procuring_entity"])[:255]
            published = (detail.value("published_at") or {}).get("at") if isinstance(detail.value("published_at"), dict) else None
            if published and not tender["source_published_at"]:
                updates["source_published_at"] = datetime.fromisoformat(published)
            amount = parse_amount(facts.get("bid_security_amount"))
            current = float(tender["bond_amount"] or 0)
            if amount:
                if _person_entered(tender["bid_security_source"], current > 0):
                    if current != amount:
                        status["discrepancies"].append({"field": "bond_amount", "tender": current, "source": amount})
                else:
                    updates["bond_amount"] = amount
                    updates["bid_security_source"] = "egp_notice"
        except portal.PortalAccessError as exc:
            status["notice"] = "failed"
            status["errors"].append(f"Notice page: {exc}")

        # 2. Activity schedule: pre-bid meeting / site visit, clarification and closing.
        try:
            response = await client.get(portal.schedule_url(notice_id), popup=True)
            fields, found = parse_schedule(response.text, response.url)
            if not found:
                raise portal.PortalRestricted("Activity schedule not returned (login shell or changed page).", url=response.url)
            status["schedule"] = "read"
            schedule = {k: v["value"] for k, v in fields.items()}
            status["facts"]["schedule"] = schedule
            mode = str(schedule.get("pre_bid_mode") or "")
            start = (schedule.get("pre_bid_start") or {}).get("at")
            site_entered = _person_entered(tender["site_visit_source"],
                                           bool(tender["site_visit_at"] or tender["site_visit_mandatory"] or tender["site_visit_status"]))
            if site_entered:
                if start and tender["site_visit_at"] and abs((tender["site_visit_at"] - datetime.fromisoformat(start)).total_seconds()) > 60:
                    status["discrepancies"].append({"field": "site_visit_at", "tender": tender["site_visit_at"].isoformat(),
                                                    "source": start})
            else:
                if start:
                    updates["site_visit_at"] = datetime.fromisoformat(start)
                    updates["site_visit_location"] = schedule.get("pre_bid_venue")
                updates["site_visit_status"] = "unknown"
                updates["site_visit_details"] = (
                    f"e-GP activity schedule: pre-bid meeting {mode or 'not stated'}"
                    + (f", {schedule.get('pre_bid_venue')}" if schedule.get("pre_bid_venue") else "")
                    + ". Whether attendance is compulsory is not stated there - read the bidding document "
                      "(it can require a compulsory site visit even when the schedule says 'Not Required').")
                updates["site_visit_source"] = "egp_schedule"
            clar = (schedule.get("clarification_deadline") or {}).get("at")
            if clar and not tender["clarification_deadline"]:
                updates["clarification_deadline"] = datetime.fromisoformat(clar)
            closing = (schedule.get("submission_deadline") or {}).get("at")
            if closing:
                closing_at = datetime.fromisoformat(closing)
                if not tender["submission_deadline"]:
                    updates["submission_deadline"] = closing_at
                elif abs((tender["submission_deadline"] - closing_at).total_seconds()) > 60:
                    status["discrepancies"].append({"field": "submission_deadline",
                                                    "tender": tender["submission_deadline"].isoformat(), "source": closing})
        except portal.PortalAccessError as exc:
            status["schedule"] = "failed"
            status["errors"].append(f"Activity schedule: {exc}")

        if updates:
            sets = ", ".join(f"{k} = :{k}" for k in updates)
            await db.execute(text(f"UPDATE crm.tenders SET {sets}, updated_at = NOW() WHERE id = :id"),  # nosec B608 - fixed keys above
                             {**updates, "id": tender_id})
        await db.commit()

        # 3. Documents.
        try:
            response = await client.get(portal.documents_url(notice_id), popup=True)
            documents, found = parse_document_list(response.text, response.url)
            if not found:
                raise portal.PortalRestricted("Document list not returned (login shell or changed page).", url=response.url)
        except portal.PortalAccessError as exc:
            documents = []
            status["errors"].append(f"Document list: {exc}")
            status["documents"]["list"] = "failed"
        status["documents"]["listed"] = len(documents)
        for doc in documents:
            await db.execute(
                text("""
                    INSERT INTO crm.tender_candidate_documents (organization_id, candidate_id, tender_id, label, official_url,
                        access, official_document_key, published_label, download_status)
                    VALUES (:org_id, :cid, :tid, :label, :url, 'public', :key, :published, 'pending')
                    ON CONFLICT (candidate_id, official_document_key) WHERE official_document_key IS NOT NULL
                    DO UPDATE SET official_url = EXCLUDED.official_url, tender_id = EXCLUDED.tender_id,
                                  published_label = EXCLUDED.published_label, updated_at = NOW()
                """),
                {"org_id": org_id, "cid": candidate_id, "tid": tender_id, "label": doc.name, "url": doc.url, "key": doc.key,
                 "published": doc.published_raw},
            )
            row = await _row(db, "SELECT * FROM crm.tender_candidate_documents WHERE candidate_id = :cid AND official_document_key = :key",
                             {"cid": candidate_id, "key": doc.key})
            await db.commit()
            if row["document_id"]:
                status["documents"]["already_attached"] += 1
                continue
            if row["download_attempts"] >= MAX_DOWNLOAD_ATTEMPTS:
                status["documents"]["failed"] += 1
                continue
            error: Optional[str] = None
            try:
                fetched = await client.download(doc.url, max_bytes=MAX_BYTES)
                name = _file_name(doc.name, fetched.disposition)
                error = _check_content(name, fetched.content)
                if not error:
                    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
                    path = await _store(fetched.content, name, mime)
                    document_id, attachment_id = await _register(db, org_id=org_id, tender_id=tender_id, file_name=name,
                                                                 path=path, mime=mime, size=len(fetched.content), label=doc.name)
                    await db.execute(
                        text("""
                            UPDATE crm.tender_candidate_documents
                            SET document_id = :doc, download_status = 'downloaded', download_error = NULL,
                                download_attempts = download_attempts + 1, downloaded_at = NOW(), size_bytes = :size,
                                attached_at = NOW(), updated_at = NOW()
                            WHERE id = :id
                        """),
                        {"doc": document_id, "size": len(fetched.content), "id": row["id"]},
                    )
                    await db.commit()
                    status["documents"]["downloaded"] += 1
                    await enqueue_background_job("extract_document_text_job", source_table="file_attachment",
                                                 record_id=attachment_id)
                    continue
                state = "rejected"
            except portal.PortalAccessError as exc:
                error, state = str(exc), "failed"
            except Exception as exc:  # noqa: BLE001 - recorded on the document, never reported as success
                await db.rollback()
                logger.exception("egp_collect.document_failed", tender_id=tender_id, document_key=doc.key)
                error, state = f"{type(exc).__name__}: {str(exc)[:200]}", "failed"
            await db.execute(
                text("""
                    UPDATE crm.tender_candidate_documents
                    SET download_status = :state, download_error = :error, download_attempts = download_attempts + 1, updated_at = NOW()
                    WHERE id = :id
                """),
                {"state": state, "error": (error or "")[:1000], "id": row["id"]},
            )
            await db.commit()
            status["documents"]["failed"] += 1
            status["errors"].append(f"{doc.name}: {error}")

    status["requests_made"] = getattr(client, "requests_made", None)
    await db.execute(text("UPDATE crm.tenders SET source_material_status = CAST(:s AS jsonb), source_last_checked_at = NOW() WHERE id = :id"),
                     {"s": _j(status), "id": tender_id})
    await record_event(db, org_id=org_id, tender_id=tender_id, action="source_material_collected", actor=None,
                       from_status=tender["review_workflow_status"], to_status=tender["review_workflow_status"],
                       data={"notice": status["notice"], "schedule": status["schedule"], "documents": status["documents"],
                             "fields_filled": sorted(updates), "discrepancies": status["discrepancies"],
                             "errors": status["errors"][:10]})
    await db.commit()
    return {"status": "collected", **status}
