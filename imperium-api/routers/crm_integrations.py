"""CRM integration and sales-intelligence foundation endpoints."""

from base64 import urlsafe_b64encode
from datetime import datetime, timedelta
from email import policy
from email.parser import BytesParser
from email.message import EmailMessage
import hashlib
import imaplib
import json
import smtplib
import ssl
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from cryptography.fernet import Fernet, InvalidToken

from core.config import settings
from core.database import get_db
from core.security import require_permission
from routers.crm_communications import _insert_communication

router = APIRouter()

Provider = Literal[
    "gmail",
    "outlook",
    "google_calendar",
    "microsoft_calendar",
    "namecheap_private_email",
    "whatsapp",
    "maps",
    "documents",
    "accounting",
]


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ConnectedAccountPayload(Payload):
    provider: Provider
    account_label: Optional[str] = Field(default=None, max_length=255)
    account_email: Optional[EmailStr] = None
    app_password: Optional[str] = Field(default=None, min_length=1, max_length=1024)
    scopes: list[str] = Field(default_factory=list)
    settings: dict[str, Any] = Field(default_factory=dict)


class SyncRequestPayload(Payload):
    sync_type: Literal["email", "calendar", "contacts", "documents", "messages", "accounting"]
    direction: Literal["pull", "push", "bidirectional"] = "pull"


class EmailSyncPayload(Payload):
    provider: Provider
    account_id: Optional[UUID] = None
    external_message_id: str = Field(min_length=1, max_length=255)
    external_thread_id: Optional[str] = Field(default=None, max_length=255)
    subject: Optional[str] = Field(default=None, max_length=255)
    body: Optional[str] = None
    snippet: Optional[str] = None
    message_date: Optional[datetime] = None
    from_address: Optional[EmailStr] = None
    to_addresses: list[EmailStr] = Field(default_factory=list)
    cc_addresses: list[EmailStr] = Field(default_factory=list)
    bcc_addresses: list[EmailStr] = Field(default_factory=list)
    raw_payload: dict[str, Any] = Field(default_factory=dict)


class EmailSendPayload(Payload):
    account_id: UUID
    to_addresses: list[EmailStr] = Field(min_length=1)
    subject: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1)
    contact_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    opportunity_id: Optional[UUID] = None


class CalendarEventPayload(Payload):
    provider: Provider = "google_calendar"
    account_id: Optional[UUID] = None
    external_event_id: Optional[str] = Field(default=None, max_length=255)
    calendar_id: Optional[str] = Field(default=None, max_length=255)
    subject: str = Field(min_length=1, max_length=255)
    starts_at: datetime
    ends_at: Optional[datetime] = None
    location: Optional[str] = None
    attendees: list[EmailStr] = Field(default_factory=list)
    contact_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    opportunity_id: Optional[UUID] = None
    notes: Optional[str] = None
    raw_payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid_time_window(self):
        if self.ends_at and self.ends_at < self.starts_at:
            raise ValueError("ends_at cannot precede starts_at")
        return self


class RecommendationStatusPayload(Payload):
    status: Literal["open", "accepted", "dismissed", "completed"]


def _response(data: Any, message: str, total: Optional[int] = None) -> dict[str, Any]:
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


def _user_id(user: dict) -> Optional[str]:
    return user.get("user_id") or user.get("sub")


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    return Fernet(urlsafe_b64encode(digest))


def _encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def _decrypt_secret(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise HTTPException(status_code=503, detail="Connected account credential could not be decrypted.") from exc


NAMECHEAP_DEFAULTS = {
    "imap_host": "mail.privateemail.com",
    "imap_port": 993,
    "imap_security": "ssl",
    "smtp_host": "mail.privateemail.com",
    "smtp_port": 465,
    "smtp_security": "ssl",
    "sync_folder": "INBOX",
}


def _namecheap_settings(overrides: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    merged = {**NAMECHEAP_DEFAULTS, **(overrides or {})}
    merged["imap_port"] = int(merged.get("imap_port") or 993)
    merged["smtp_port"] = int(merged.get("smtp_port") or 465)
    return merged


def _provider_catalog() -> list[dict[str, Any]]:
    google_ready = bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)
    microsoft_ready = bool(settings.MICROSOFT_CLIENT_ID and settings.MICROSOFT_CLIENT_SECRET)
    whatsapp_ready = bool(settings.WHATSAPP_ACCESS_TOKEN and settings.WHATSAPP_PHONE_NUMBER_ID)
    return [
        {
            "provider": "gmail",
            "label": "Gmail",
            "category": "email",
            "auth_type": "oauth2",
            "configured": google_ready,
            "capabilities": ["email_pull", "email_send", "contact_match", "thread_timeline"],
            "required_env": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CRM_OAUTH_REDIRECT_URL"],
        },
        {
            "provider": "outlook",
            "label": "Outlook",
            "category": "email",
            "auth_type": "oauth2",
            "configured": microsoft_ready,
            "capabilities": ["email_pull", "email_send", "contact_match", "thread_timeline"],
            "required_env": ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "CRM_OAUTH_REDIRECT_URL"],
        },
        {
            "provider": "google_calendar",
            "label": "Google Calendar",
            "category": "calendar",
            "auth_type": "oauth2",
            "configured": google_ready,
            "capabilities": ["meeting_pull", "meeting_create", "crm_activity_mirror"],
            "required_env": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CRM_OAUTH_REDIRECT_URL"],
        },
        {
            "provider": "microsoft_calendar",
            "label": "Microsoft Calendar",
            "category": "calendar",
            "auth_type": "oauth2",
            "configured": microsoft_ready,
            "capabilities": ["meeting_pull", "meeting_create", "crm_activity_mirror"],
            "required_env": ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "CRM_OAUTH_REDIRECT_URL"],
        },
        {
            "provider": "namecheap_private_email",
            "label": "Namecheap Private Email",
            "category": "email",
            "auth_type": "imap_smtp",
            "configured": True,
            "capabilities": ["imap_inbox_pull", "smtp_send", "contact_match", "crm_timeline"],
            "required_env": [],
            "defaults": NAMECHEAP_DEFAULTS,
        },
        {
            "provider": "whatsapp",
            "label": "WhatsApp",
            "category": "messaging",
            "auth_type": "webhook",
            "configured": whatsapp_ready,
            "capabilities": ["message_send", "webhook_receive", "crm_activity_mirror"],
            "required_env": ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
        },
        {
            "provider": "maps",
            "label": "Maps",
            "category": "field_sales",
            "auth_type": "api_key",
            "configured": bool(settings.MAPS_API_KEY),
            "capabilities": ["territory_map", "site_visit_route", "region_pipeline"],
            "required_env": ["MAPS_API_KEY"],
        },
        {
            "provider": "documents",
            "label": "Documents",
            "category": "documents",
            "auth_type": "system",
            "configured": True,
            "capabilities": ["document_upload", "proposal_files", "handoff_evidence"],
            "required_env": [],
        },
        {
            "provider": "accounting",
            "label": "Accounting",
            "category": "finance",
            "auth_type": "api_key",
            "configured": bool(settings.ACCOUNTING_PROVIDER_API_KEY),
            "capabilities": ["invoice_status", "customer_balance", "forecast_cashflow"],
            "required_env": ["ACCOUNTING_PROVIDER_API_KEY"],
        },
    ]


def _catalog_by_provider() -> dict[str, dict[str, Any]]:
    return {item["provider"]: item for item in _provider_catalog()}


async def _ensure_account(db: AsyncSession, org_id: str, account_id: UUID) -> dict[str, Any]:
    row = (
        await db.execute(
            text("""
            SELECT *
            FROM crm.connected_accounts
            WHERE id=:account_id AND organization_id=:org_id AND is_deleted=false
            """),
            {"account_id": account_id, "org_id": org_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Connected account was not found.")
    return dict(row)


async def _record_sync_error(
    db: AsyncSession,
    *,
    org_id: str,
    job_id: Optional[UUID],
    account_id: Optional[UUID],
    provider: str,
    message: str,
    error_code: str,
    severity: str = "error",
) -> None:
    await db.execute(
        text("""
        INSERT INTO crm.integration_sync_errors (
            organization_id, job_id, account_id, provider, severity, error_code, message
        )
        VALUES (:org_id, :job_id, :account_id, :provider, :severity, :error_code, :message)
        """),
        {
            "org_id": org_id,
            "job_id": job_id,
            "account_id": account_id,
            "provider": provider,
            "severity": severity,
            "error_code": error_code,
            "message": message,
        },
    )


def _test_namecheap_connection(account_email: str, password: str, config: dict[str, Any]) -> None:
    try:
        with imaplib.IMAP4_SSL(config["imap_host"], config["imap_port"], timeout=20) as imap:
            imap.login(account_email, password)
            imap.logout()
        if config.get("smtp_security") == "starttls":
            with smtplib.SMTP(config["smtp_host"], config["smtp_port"], timeout=20) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                smtp.login(account_email, password)
        else:
            with smtplib.SMTP_SSL(config["smtp_host"], config["smtp_port"], timeout=20, context=ssl.create_default_context()) as smtp:
                smtp.login(account_email, password)
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail="Namecheap mailbox connection failed. Check the full email address and mailbox/app password.",
        ) from exc


def _extract_email_addresses(value: str) -> list[str]:
    if not value:
        return []
    addresses: list[str] = []
    for part in value.split(","):
        cleaned = part.strip()
        if "<" in cleaned and ">" in cleaned:
            cleaned = cleaned.split("<", 1)[1].split(">", 1)[0].strip()
        if "@" in cleaned:
            addresses.append(cleaned.lower())
    return addresses


async def _sync_namecheap_inbox(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: Optional[str],
    account: dict[str, Any],
    job_id: UUID,
    max_messages: int = 25,
) -> tuple[int, int, Optional[str]]:
    account_email = account.get("account_email")
    password = _decrypt_secret(account.get("access_token_ciphertext"))
    if not account_email or not password:
        raise HTTPException(status_code=422, detail="Namecheap account email and app password are required before sync.")

    config = _namecheap_settings(account.get("settings"))
    written = 0
    read = 0
    last_uid: Optional[str] = None
    try:
        with imaplib.IMAP4_SSL(config["imap_host"], config["imap_port"], timeout=30) as imap:
            imap.login(account_email, password)
            status_code, _ = imap.select(config.get("sync_folder") or "INBOX")
            if status_code != "OK":
                raise RuntimeError("Inbox folder could not be selected.")

            search_since = (datetime.utcnow() - timedelta(days=30)).strftime("%d-%b-%Y")
            status_code, data = imap.uid("search", None, f'(SINCE "{search_since}")')
            if status_code != "OK" or not data:
                imap.logout()
                return (0, 0, None)
            uids = data[0].split()[-max_messages:]
            for uid_bytes in uids:
                uid = uid_bytes.decode("utf-8")
                last_uid = uid
                status_code, fetched = imap.uid("fetch", uid, "(RFC822)")
                if status_code != "OK" or not fetched:
                    continue
                raw_message = next((part[1] for part in fetched if isinstance(part, tuple) and part[1]), None)
                if not raw_message:
                    continue
                read += 1
                message = BytesParser(policy=policy.default).parsebytes(raw_message)
                subject = str(message.get("subject") or "(no subject)")[:255]
                from_address = _extract_email_addresses(str(message.get("from") or ""))
                to_addresses = _extract_email_addresses(str(message.get("to") or ""))
                message_id = str(message.get("message-id") or f"namecheap-{account['id']}-{uid}")[:255]
                body = ""
                if message.is_multipart():
                    for part in message.walk():
                        if part.get_content_type() == "text/plain":
                            body = part.get_content()
                            break
                elif message.get_content_type() == "text/plain":
                    body = message.get_content()
                matched = await _match_crm_party(db, org_id, [*from_address, *to_addresses])
                communication_id = await _insert_communication(
                    db,
                    org_id=org_id,
                    user_id=user_id,
                    values={
                        "channel": "email",
                        "direction": "inbound",
                        "subject": subject,
                        "body": body[:20000] if body else None,
                        "status": "completed",
                        "started_at": datetime.utcnow(),
                        "from_address": from_address[0] if from_address else None,
                        "to_address": ", ".join(to_addresses),
                        "external_provider": "namecheap_private_email",
                        "external_message_id": message_id,
                        "contact_id": matched["contact_id"],
                        "lead_id": matched["lead_id"],
                        "opportunity_id": matched["opportunity_id"],
                        "metadata": {"source": "namecheap_imap", "uid": uid, "account_id": str(account["id"])},
                        "raw_payload": {"headers": {"from": str(message.get("from") or ""), "to": str(message.get("to") or "")}},
                    },
                )
                await db.execute(
                    text("""
                    INSERT INTO crm.synced_email_events (
                        organization_id, account_id, communication_event_id, provider,
                        external_message_id, external_thread_id, message_date, from_address,
                        to_addresses, subject, snippet, raw_payload
                    )
                    VALUES (
                        :org_id, :account_id, :communication_id, 'namecheap_private_email',
                        :external_message_id, :external_thread_id, NOW(), :from_address,
                        :to_addresses, :subject, :snippet, CAST(:raw_payload AS jsonb)
                    )
                    ON CONFLICT (organization_id, provider, external_message_id)
                    WHERE is_deleted = false
                    DO UPDATE SET
                        communication_event_id=EXCLUDED.communication_event_id,
                        raw_payload=EXCLUDED.raw_payload,
                        updated_at=NOW()
                    """),
                    {
                        "org_id": org_id,
                        "account_id": account["id"],
                        "communication_id": communication_id,
                        "external_message_id": message_id,
                        "external_thread_id": str(message.get("in-reply-to") or ""),
                        "from_address": from_address[0] if from_address else None,
                        "to_addresses": to_addresses,
                        "subject": subject,
                        "snippet": body[:500] if body else "",
                        "raw_payload": json.dumps({"uid": uid}),
                    },
                )
                written += 1
            imap.logout()
    except HTTPException:
        raise
    except Exception as exc:
        await _record_sync_error(
            db,
            org_id=org_id,
            job_id=job_id,
            account_id=account["id"],
            provider="namecheap_private_email",
            message=f"Namecheap IMAP sync failed: {exc}",
            error_code="namecheap_imap_sync_failed",
        )
        raise HTTPException(status_code=502, detail="Namecheap inbox sync failed.") from exc

    return read, written, last_uid


async def _match_crm_party(
    db: AsyncSession,
    org_id: str,
    email_addresses: list[str],
) -> dict[str, Optional[str]]:
    emails = [email.lower() for email in email_addresses if email]
    if not emails:
        return {"contact_id": None, "lead_id": None, "opportunity_id": None}

    contact = (
        await db.execute(
            text("""
            SELECT c.id, o.id AS opportunity_id
            FROM crm.contacts c
            LEFT JOIN crm.opportunities o
              ON o.client_id = c.id
             AND o.organization_id = c.organization_id
             AND o.is_deleted = false
             AND COALESCE(o.win_loss_status, '') NOT IN ('won', 'lost')
            WHERE c.organization_id=:org_id
              AND c.is_deleted=false
              AND lower(c.email) = ANY(:emails)
            ORDER BY o.updated_at DESC NULLS LAST, c.updated_at DESC
            LIMIT 1
            """),
            {"org_id": org_id, "emails": emails},
        )
    ).mappings().first()
    if contact:
        return {
            "contact_id": str(contact["id"]),
            "lead_id": None,
            "opportunity_id": str(contact["opportunity_id"]) if contact["opportunity_id"] else None,
        }

    lead = (
        await db.execute(
            text("""
            SELECT id
            FROM crm.leads
            WHERE organization_id=:org_id
              AND is_deleted=false
              AND lower(contact_email) = ANY(:emails)
            ORDER BY updated_at DESC
            LIMIT 1
            """),
            {"org_id": org_id, "emails": emails},
        )
    ).mappings().first()
    return {
        "contact_id": None,
        "lead_id": str(lead["id"]) if lead else None,
        "opportunity_id": None,
    }


@router.get("/providers")
async def list_providers(
    user: dict = Depends(require_permission("crm.integrations.read")),
):
    return _response(_provider_catalog(), "CRM integration provider catalog retrieved.")


@router.get("/connected-accounts")
async def list_connected_accounts(
    user: dict = Depends(require_permission("crm.integrations.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            text("""
            SELECT ca.id,
                   ca.organization_id,
                   ca.owner_user_id,
                   ca.provider,
                   ca.provider_account_id,
                   ca.account_label,
                   ca.account_email,
                   ca.status,
                   ca.auth_type,
                   ca.scopes,
                   ca.token_status,
                   ca.token_expires_at,
                   ca.sync_cursor,
                   ca.last_sync_at,
                   ca.last_error_at,
                   ca.last_error,
                   ca.settings,
                   ca.metadata,
                   ca.created_by,
                   ca.created_at,
                   ca.updated_at,
                   ca.is_deleted,
                   latest.status AS latest_sync_status,
                   latest.created_at AS latest_sync_created_at,
                   latest.finished_at AS latest_sync_finished_at
            FROM crm.connected_accounts ca
            LEFT JOIN LATERAL (
                SELECT status, created_at, finished_at
                FROM crm.integration_sync_jobs sj
                WHERE sj.organization_id = ca.organization_id
                  AND sj.account_id = ca.id
                  AND sj.is_deleted = false
                ORDER BY sj.created_at DESC
                LIMIT 1
            ) latest ON true
            WHERE ca.organization_id=:org_id AND ca.is_deleted=false
            ORDER BY ca.provider, ca.created_at DESC
            """),
            {"org_id": user["org_id"]},
        )
    ).mappings().all()
    return _response([dict(row) for row in rows], "Connected CRM accounts retrieved.", len(rows))


@router.post("/connected-accounts", status_code=status.HTTP_201_CREATED)
async def upsert_connected_account(
    payload: ConnectedAccountPayload,
    user: dict = Depends(require_permission("crm.integrations.manage")),
    db: AsyncSession = Depends(get_db),
):
    catalog = _catalog_by_provider()[payload.provider]
    provider_settings = payload.settings
    encrypted_secret = None
    if payload.provider == "namecheap_private_email":
        if not payload.account_email:
            raise HTTPException(status_code=422, detail="Namecheap Private Email requires the mailbox address.")
        provider_settings = _namecheap_settings(payload.settings)
        if payload.app_password:
            _test_namecheap_connection(str(payload.account_email), payload.app_password, provider_settings)
            encrypted_secret = _encrypt_secret(payload.app_password)
        token_status = "valid" if encrypted_secret else "not_configured"
        account_status = "connected" if encrypted_secret else "pending_setup"
    else:
        token_status = "valid" if catalog["configured"] else "not_configured"
        account_status = "connected" if catalog["configured"] else "pending_setup"

    row = (
        await db.execute(
            text("""
            INSERT INTO crm.connected_accounts (
                organization_id, owner_user_id, provider, account_label, account_email,
                status, auth_type, scopes, token_status, access_token_ciphertext,
                settings, metadata, created_by
            )
            VALUES (
                :org_id, :owner_user_id, :provider, :account_label, :account_email,
                :status, :auth_type, :scopes, :token_status, :access_token_ciphertext,
                CAST(:settings AS jsonb), CAST(:metadata AS jsonb), :created_by
            )
            ON CONFLICT (
                organization_id, owner_user_id, provider,
                lower(COALESCE(account_email, provider_account_id, account_label, 'default'))
            )
            WHERE is_deleted = false
            DO UPDATE SET
                account_label=EXCLUDED.account_label,
                account_email=EXCLUDED.account_email,
                scopes=EXCLUDED.scopes,
                status=EXCLUDED.status,
                token_status=EXCLUDED.token_status,
                access_token_ciphertext=COALESCE(EXCLUDED.access_token_ciphertext, crm.connected_accounts.access_token_ciphertext),
                settings=EXCLUDED.settings,
                metadata=EXCLUDED.metadata,
                updated_at=NOW()
            RETURNING id
            """),
            {
                "org_id": user["org_id"],
                "owner_user_id": _user_id(user),
                "provider": payload.provider,
                "account_label": payload.account_label or catalog["label"],
                "account_email": str(payload.account_email) if payload.account_email else None,
                "status": account_status,
                "auth_type": catalog["auth_type"],
                "scopes": payload.scopes or catalog["capabilities"],
                "token_status": token_status,
                "access_token_ciphertext": encrypted_secret,
                "settings": json.dumps(provider_settings),
                "metadata": json.dumps({"configured": catalog["configured"], "required_env": catalog["required_env"]}),
                "created_by": _user_id(user),
            },
        )
    ).scalar()
    await db.commit()
    return _response({"id": str(row), "status": account_status}, "CRM connected account saved.")


@router.patch("/connected-accounts/{account_id}/disconnect")
async def disconnect_connected_account(
    account_id: UUID,
    user: dict = Depends(require_permission("crm.integrations.manage")),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_account(db, user["org_id"], account_id)
    result = await db.execute(
        text("""
        UPDATE crm.connected_accounts
        SET status='disconnected',
            token_status='revoked',
            access_token_ciphertext=NULL,
            refresh_token_ciphertext=NULL,
            updated_at=NOW()
        WHERE id=:account_id AND organization_id=:org_id AND is_deleted=false
        RETURNING id
        """),
        {"account_id": account_id, "org_id": user["org_id"]},
    )
    await db.commit()
    return _response({"id": str(result.scalar())}, "CRM connected account disconnected.")


@router.post("/connected-accounts/{account_id}/sync", status_code=status.HTTP_201_CREATED)
async def queue_sync_job(
    account_id: UUID,
    payload: SyncRequestPayload,
    user: dict = Depends(require_permission("crm.integrations.manage")),
    db: AsyncSession = Depends(get_db),
):
    account = await _ensure_account(db, user["org_id"], account_id)
    blocked = account["status"] != "connected" or account["token_status"] not in ("valid", "not_configured")
    if account["provider"] == "namecheap_private_email" and not account.get("access_token_ciphertext"):
        blocked = True
    job_status = "blocked" if blocked else "queued"
    error_summary = None if not blocked else "Provider credentials are not connected yet."
    row = (
        await db.execute(
            text("""
            INSERT INTO crm.integration_sync_jobs (
                organization_id, account_id, provider, sync_type, direction, status,
                cursor_before, error_summary, metadata, created_by, started_at, finished_at
            )
            VALUES (
                :org_id, :account_id, :provider, :sync_type, :direction, :status,
                :cursor_before, :error_summary, CAST(:metadata AS jsonb), :created_by,
                CASE WHEN :status = 'blocked' THEN NOW() ELSE NULL END,
                CASE WHEN :status = 'blocked' THEN NOW() ELSE NULL END
            )
            RETURNING id
            """),
            {
                "org_id": user["org_id"],
                "account_id": account_id,
                "provider": account["provider"],
                "sync_type": payload.sync_type,
                "direction": payload.direction,
                "status": job_status,
                "cursor_before": account.get("sync_cursor"),
                "error_summary": error_summary,
                "metadata": json.dumps({"queued_from": "crm_connected_apps"}),
                "created_by": _user_id(user),
            },
        )
    ).scalar()
    if blocked:
        await db.execute(
            text("""
            INSERT INTO crm.integration_sync_errors (
                organization_id, job_id, account_id, provider, severity, error_code, message
            )
            VALUES (:org_id, :job_id, :account_id, :provider, 'warning', 'provider_not_connected', :message)
            """),
            {
                "org_id": user["org_id"],
                "job_id": row,
                "account_id": account_id,
                "provider": account["provider"],
                "message": error_summary,
            },
        )
    elif account["provider"] == "namecheap_private_email" and payload.sync_type == "email":
        await db.execute(
            text("""
            UPDATE crm.integration_sync_jobs
            SET status='running', started_at=NOW(), updated_at=NOW()
            WHERE id=:job_id AND organization_id=:org_id
            """),
            {"job_id": row, "org_id": user["org_id"]},
        )
        read, written, cursor_after = await _sync_namecheap_inbox(
            db,
            org_id=user["org_id"],
            user_id=_user_id(user),
            account=account,
            job_id=row,
        )
        await db.execute(
            text("""
            UPDATE crm.integration_sync_jobs
            SET status='completed',
                records_read=:records_read,
                records_written=:records_written,
                cursor_after=:cursor_after,
                finished_at=NOW(),
                updated_at=NOW()
            WHERE id=:job_id AND organization_id=:org_id
            """),
            {
                "job_id": row,
                "org_id": user["org_id"],
                "records_read": read,
                "records_written": written,
                "cursor_after": cursor_after,
            },
        )
        await db.execute(
            text("""
            UPDATE crm.connected_accounts
            SET last_sync_at=NOW(), sync_cursor=COALESCE(:cursor_after, sync_cursor), updated_at=NOW()
            WHERE id=:account_id AND organization_id=:org_id
            """),
            {"account_id": account_id, "org_id": user["org_id"], "cursor_after": cursor_after},
        )
        job_status = "completed"
    await db.commit()
    return _response({"id": str(row), "status": job_status}, "CRM integration sync job recorded.")


@router.get("/sync-jobs")
async def list_sync_jobs(
    account_id: Optional[UUID] = None,
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(require_permission("crm.integrations.read")),
    db: AsyncSession = Depends(get_db),
):
    params: dict[str, Any] = {"org_id": user["org_id"], "limit": limit}
    filter_sql = ""
    if account_id:
        filter_sql = "AND sj.account_id=:account_id"
        params["account_id"] = account_id
    rows = (
        await db.execute(
            text(f"""
            SELECT sj.*, ca.account_label, ca.account_email
            FROM crm.integration_sync_jobs sj
            LEFT JOIN crm.connected_accounts ca ON ca.id=sj.account_id AND ca.organization_id=sj.organization_id
            WHERE sj.organization_id=:org_id AND sj.is_deleted=false {filter_sql}
            ORDER BY sj.created_at DESC
            LIMIT :limit
            """),
            params,
        )
    ).mappings().all()
    return _response([dict(row) for row in rows], "CRM integration sync jobs retrieved.", len(rows))


@router.post("/email-events", status_code=status.HTTP_201_CREATED)
async def ingest_email_event(
    payload: EmailSyncPayload,
    user: dict = Depends(require_permission("crm.integrations.manage")),
    db: AsyncSession = Depends(get_db),
):
    account = None
    if payload.account_id:
        account = await _ensure_account(db, user["org_id"], payload.account_id)
    matched = await _match_crm_party(
        db,
        user["org_id"],
        [str(payload.from_address) if payload.from_address else "", *[str(a) for a in payload.to_addresses]],
    )
    communication_id = await _insert_communication(
        db,
        org_id=user["org_id"],
        user_id=_user_id(user),
        values={
            "channel": "email",
            "direction": "inbound",
            "subject": payload.subject,
            "body": payload.body or payload.snippet,
            "status": "completed",
            "started_at": payload.message_date or datetime.utcnow(),
            "from_address": str(payload.from_address) if payload.from_address else None,
            "to_address": ", ".join(str(address) for address in payload.to_addresses),
            "external_provider": payload.provider,
            "external_message_id": payload.external_message_id,
            "contact_id": matched["contact_id"],
            "lead_id": matched["lead_id"],
            "opportunity_id": matched["opportunity_id"],
            "metadata": {"source": "provider_sync", "account_id": str(payload.account_id) if payload.account_id else None},
            "raw_payload": payload.raw_payload,
        },
    )
    await db.execute(
        text("""
        INSERT INTO crm.synced_email_events (
            organization_id, account_id, communication_event_id, provider, external_message_id,
            external_thread_id, message_date, from_address, to_addresses, cc_addresses,
            bcc_addresses, subject, snippet, raw_payload
        )
        VALUES (
            :org_id, :account_id, :communication_id, :provider, :external_message_id,
            :external_thread_id, :message_date, :from_address, :to_addresses, :cc_addresses,
            :bcc_addresses, :subject, :snippet, CAST(:raw_payload AS jsonb)
        )
        ON CONFLICT (organization_id, provider, external_message_id)
        WHERE is_deleted = false
        DO UPDATE SET
            communication_event_id=EXCLUDED.communication_event_id,
            message_date=EXCLUDED.message_date,
            raw_payload=EXCLUDED.raw_payload,
            updated_at=NOW()
        """),
        {
            "org_id": user["org_id"],
            "account_id": payload.account_id,
            "communication_id": communication_id,
            "provider": payload.provider,
            "external_message_id": payload.external_message_id,
            "external_thread_id": payload.external_thread_id,
            "message_date": payload.message_date or datetime.utcnow(),
            "from_address": str(payload.from_address) if payload.from_address else None,
            "to_addresses": [str(address) for address in payload.to_addresses],
            "cc_addresses": [str(address) for address in payload.cc_addresses],
            "bcc_addresses": [str(address) for address in payload.bcc_addresses],
            "subject": payload.subject,
            "snippet": payload.snippet,
            "raw_payload": json.dumps(payload.raw_payload),
        },
    )
    if account:
        await db.execute(
            text("""
            UPDATE crm.connected_accounts
            SET last_sync_at=NOW(), sync_cursor=COALESCE(:cursor, sync_cursor), updated_at=NOW()
            WHERE id=:account_id AND organization_id=:org_id
            """),
            {"account_id": payload.account_id, "org_id": user["org_id"], "cursor": payload.external_message_id},
        )
    await db.commit()
    return _response({"communication_id": str(communication_id)}, "CRM email event synced.")


@router.post("/calendar-events", status_code=status.HTTP_201_CREATED)
async def schedule_or_sync_calendar_event(
    payload: CalendarEventPayload,
    user: dict = Depends(require_permission("crm.integrations.manage")),
    db: AsyncSession = Depends(get_db),
):
    if payload.account_id:
        await _ensure_account(db, user["org_id"], payload.account_id)
    external_event_id = payload.external_event_id or f"aegis-{uuid4()}"
    communication_id = await _insert_communication(
        db,
        org_id=user["org_id"],
        user_id=_user_id(user),
        values={
            "channel": "meeting",
            "direction": "outbound",
            "subject": payload.subject,
            "body": payload.notes,
            "status": "planned",
            "started_at": payload.starts_at,
            "ended_at": payload.ends_at,
            "external_provider": payload.provider,
            "external_message_id": external_event_id,
            "contact_id": str(payload.contact_id) if payload.contact_id else None,
            "lead_id": str(payload.lead_id) if payload.lead_id else None,
            "opportunity_id": str(payload.opportunity_id) if payload.opportunity_id else None,
            "metadata": {"location": payload.location, "attendees": [str(a) for a in payload.attendees]},
            "raw_payload": payload.raw_payload,
        },
    )
    await db.execute(
        text("""
        INSERT INTO crm.synced_calendar_events (
            organization_id, account_id, communication_event_id, provider, external_event_id,
            calendar_id, subject, starts_at, ends_at, location, attendees, raw_payload
        )
        VALUES (
            :org_id, :account_id, :communication_id, :provider, :external_event_id,
            :calendar_id, :subject, :starts_at, :ends_at, :location,
            CAST(:attendees AS jsonb), CAST(:raw_payload AS jsonb)
        )
        ON CONFLICT (organization_id, provider, external_event_id)
        WHERE is_deleted = false
        DO UPDATE SET
            communication_event_id=EXCLUDED.communication_event_id,
            starts_at=EXCLUDED.starts_at,
            ends_at=EXCLUDED.ends_at,
            attendees=EXCLUDED.attendees,
            raw_payload=EXCLUDED.raw_payload,
            updated_at=NOW()
        """),
        {
            "org_id": user["org_id"],
            "account_id": payload.account_id,
            "communication_id": communication_id,
            "provider": payload.provider,
            "external_event_id": external_event_id,
            "calendar_id": payload.calendar_id,
            "subject": payload.subject,
            "starts_at": payload.starts_at,
            "ends_at": payload.ends_at,
            "location": payload.location,
            "attendees": json.dumps([str(a) for a in payload.attendees]),
            "raw_payload": json.dumps(payload.raw_payload),
        },
    )
    await db.commit()
    return _response({"communication_id": str(communication_id), "external_event_id": external_event_id}, "CRM calendar event recorded.")


@router.post("/email/send", status_code=status.HTTP_201_CREATED)
async def send_private_email(
    payload: EmailSendPayload,
    user: dict = Depends(require_permission("crm.integrations.manage")),
    db: AsyncSession = Depends(get_db),
):
    account = await _ensure_account(db, user["org_id"], payload.account_id)
    if account["provider"] != "namecheap_private_email":
        raise HTTPException(status_code=422, detail="SMTP send is currently enabled for Namecheap Private Email accounts.")
    account_email = account.get("account_email")
    password = _decrypt_secret(account.get("access_token_ciphertext"))
    if not account_email or not password:
        raise HTTPException(status_code=422, detail="Namecheap account email and app password are required before sending.")

    config = _namecheap_settings(account.get("settings"))
    message = EmailMessage()
    message["From"] = account_email
    message["To"] = ", ".join(str(address) for address in payload.to_addresses)
    message["Subject"] = payload.subject
    message.set_content(payload.body)
    external_message_id = f"aegis-smtp-{uuid4()}"
    try:
        if config.get("smtp_security") == "starttls":
            with smtplib.SMTP(config["smtp_host"], config["smtp_port"], timeout=30) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                smtp.login(account_email, password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP_SSL(config["smtp_host"], config["smtp_port"], timeout=30, context=ssl.create_default_context()) as smtp:
                smtp.login(account_email, password)
                smtp.send_message(message)
    except Exception as exc:
        await _record_sync_error(
            db,
            org_id=user["org_id"],
            job_id=None,
            account_id=payload.account_id,
            provider="namecheap_private_email",
            message=f"Namecheap SMTP send failed: {exc}",
            error_code="namecheap_smtp_send_failed",
        )
        await db.execute(
            text("""
            UPDATE crm.connected_accounts
            SET last_error_at=NOW(), last_error=:error, updated_at=NOW()
            WHERE id=:account_id AND organization_id=:org_id
            """),
            {
                "account_id": payload.account_id,
                "org_id": user["org_id"],
                "error": "Namecheap SMTP send failed. Check mailbox credentials and SMTP settings.",
            },
        )
        await db.commit()
        raise HTTPException(status_code=502, detail="Namecheap email send failed.") from exc

    communication_id = await _insert_communication(
        db,
        org_id=user["org_id"],
        user_id=_user_id(user),
        values={
            "channel": "email",
            "direction": "outbound",
            "subject": payload.subject,
            "body": payload.body,
            "status": "completed",
            "started_at": datetime.utcnow(),
            "from_address": account_email,
            "to_address": ", ".join(str(address) for address in payload.to_addresses),
            "external_provider": "namecheap_private_email",
            "external_message_id": external_message_id,
            "contact_id": str(payload.contact_id) if payload.contact_id else None,
            "lead_id": str(payload.lead_id) if payload.lead_id else None,
            "opportunity_id": str(payload.opportunity_id) if payload.opportunity_id else None,
            "metadata": {"source": "namecheap_smtp", "account_id": str(payload.account_id)},
            "raw_payload": {"to": [str(address) for address in payload.to_addresses]},
        },
    )
    await db.execute(
        text("""
        INSERT INTO crm.synced_email_events (
            organization_id, account_id, communication_event_id, provider,
            external_message_id, message_date, from_address, to_addresses, subject, snippet, raw_payload
        )
        VALUES (
            :org_id, :account_id, :communication_id, 'namecheap_private_email',
            :external_message_id, NOW(), :from_address, :to_addresses, :subject, :snippet, CAST(:raw_payload AS jsonb)
        )
        ON CONFLICT (organization_id, provider, external_message_id)
        WHERE is_deleted = false
        DO NOTHING
        """),
        {
            "org_id": user["org_id"],
            "account_id": payload.account_id,
            "communication_id": communication_id,
            "external_message_id": external_message_id,
            "from_address": account_email,
            "to_addresses": [str(address) for address in payload.to_addresses],
            "subject": payload.subject,
            "snippet": payload.body[:500],
            "raw_payload": json.dumps({"source": "smtp_send"}),
        },
    )
    await db.commit()
    return _response({"communication_id": str(communication_id)}, "Namecheap email sent and logged.")


def _lead_score(row: dict[str, Any]) -> tuple[int, str, str, list[str], str]:
    score = 25
    reasons: list[str] = []
    flags: list[str] = []
    budget = float(row.get("estimated_budget") or 0)
    if budget >= 250000:
        score += 25
        reasons.append("high estimated value")
    elif budget >= 50000:
        score += 15
        reasons.append("qualified commercial value")
    if row.get("contact_email"):
        score += 10
        reasons.append("reachable by email")
    else:
        flags.append("missing email")
    if row.get("sector"):
        score += 8
        reasons.append(f"sector captured: {row['sector']}")
    if str(row.get("lead_source") or "").lower() in {"website", "tender", "referral"}:
        score += 10
        reasons.append("strong source signal")
    age_days = int(row.get("age_days") or 0)
    if age_days > 14:
        score -= 15
        flags.append("stale lead")
    if str(row.get("status") or "").lower() in {"qualified", "converted"}:
        score += 12
    score = max(0, min(100, score))
    action = "Call and qualify budget, decision maker, and procurement timeline."
    if score >= 75:
        action = "Convert or book a proposal/site-visit conversation within 24 hours."
    return score, "; ".join(reasons) or "basic lead data available", action, flags, "urgent" if score >= 85 else "high" if score >= 70 else "normal"


def _opportunity_score(row: dict[str, Any]) -> tuple[int, str, str, list[str], str]:
    probability = float(row.get("probability") or 0)
    score = int(probability * 0.55)
    reasons: list[str] = [f"{int(probability)}% win probability"]
    flags: list[str] = []
    budget = float(row.get("budget") or row.get("deal_value") or 0)
    if budget >= 250000:
        score += 18
        reasons.append("large deal value")
    elif budget >= 50000:
        score += 10
        reasons.append("meaningful deal value")
    stage = row.get("stage") or ""
    if stage in {"Quotation", "Negotiation"}:
        score += 15
        reasons.append(f"advanced stage: {stage}")
    if row.get("next_activity_due_at"):
        score += 10
        reasons.append("next action scheduled")
    else:
        score -= 15
        flags.append("no next action")
    if row.get("is_stale"):
        score -= 20
        flags.append("stale opportunity")
    if str(row.get("risk_level") or "").lower() == "high":
        score -= 10
        flags.append("high commercial risk")
    margin = float(row.get("expected_margin") or 0)
    if margin >= 20:
        score += 8
        reasons.append("healthy margin")
    score = max(0, min(100, score))
    action = "Set the next client action and update commercial risk notes."
    if score >= 75:
        action = "Push toward proposal decision, CCB check, or close plan this week."
    if "no next action" in flags:
        action = "Schedule a next action before moving this deal further."
    return score, "; ".join(reasons), action, flags, "urgent" if "no next action" in flags or score >= 85 else "high" if score >= 70 else "normal"


async def _upsert_recommendation(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: Optional[str],
    entity_type: str,
    entity_id: str,
    score: int,
    rationale: str,
    action: str,
    flags: list[str],
    priority: str,
    snapshot: dict[str, Any],
) -> None:
    await db.execute(
        text("""
        INSERT INTO crm.ai_recommendations (
            organization_id, entity_type, entity_id, score, priority, recommendation,
            rationale, risk_flags, suggested_action_type, due_at, source_snapshot, created_by
        )
        VALUES (
            :org_id, :entity_type, :entity_id, :score, :priority, :recommendation,
            :rationale, CAST(:risk_flags AS jsonb), :suggested_action_type, :due_at,
            CAST(:source_snapshot AS jsonb), :created_by
        )
        ON CONFLICT (organization_id, entity_type, entity_id, model_version)
        WHERE is_deleted = false
        DO UPDATE SET
            score=EXCLUDED.score,
            priority=EXCLUDED.priority,
            recommendation=EXCLUDED.recommendation,
            rationale=EXCLUDED.rationale,
            risk_flags=EXCLUDED.risk_flags,
            suggested_action_type=EXCLUDED.suggested_action_type,
            due_at=EXCLUDED.due_at,
            source_snapshot=EXCLUDED.source_snapshot,
            status='open',
            updated_at=NOW()
        """),
        {
            "org_id": org_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "score": score,
            "priority": priority,
            "recommendation": action,
            "rationale": rationale,
            "risk_flags": json.dumps(flags),
            "suggested_action_type": "Follow-up" if entity_type == "opportunity" else "Qualification",
            "due_at": datetime.utcnow() + timedelta(days=1 if priority in {"urgent", "high"} else 3),
            "source_snapshot": json.dumps(snapshot, default=str),
            "created_by": user_id,
        },
    )


@router.post("/ai/run-scoring")
async def run_ai_scoring(
    user: dict = Depends(require_permission("crm.ai.manage")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    actor = _user_id(user)
    lead_rows = (
        await db.execute(
            text("""
            SELECT id, company_name, contact_email, lead_source, status, sector, estimated_budget,
                   EXTRACT(DAY FROM NOW() - created_at)::int AS age_days
            FROM crm.leads
            WHERE organization_id=:org_id AND is_deleted=false
              AND lower(COALESCE(status, '')) NOT IN ('converted', 'disqualified')
            ORDER BY updated_at DESC
            LIMIT 200
            """),
            {"org_id": org_id},
        )
    ).mappings().all()
    opp_rows = (
        await db.execute(
            text("""
            SELECT id, name, stage, budget, deal_value, probability, expected_margin, risk_level,
                   next_activity_due_at,
                   CASE
                     WHEN win_loss_status IS NULL
                      AND next_activity_due_at IS NULL
                      AND updated_at < NOW() - INTERVAL '14 days'
                     THEN true ELSE false
                   END AS is_stale
            FROM crm.opportunities
            WHERE organization_id=:org_id AND is_deleted=false
              AND COALESCE(win_loss_status, '') NOT IN ('won', 'lost')
              AND COALESCE(stage, '') NOT IN ('Contract', 'Lost')
            ORDER BY updated_at DESC
            LIMIT 200
            """),
            {"org_id": org_id},
        )
    ).mappings().all()

    for row in lead_rows:
        data = dict(row)
        score, rationale, action, flags, priority = _lead_score(data)
        await _upsert_recommendation(
            db, org_id=org_id, user_id=actor, entity_type="lead", entity_id=str(data["id"]),
            score=score, rationale=rationale, action=action, flags=flags, priority=priority, snapshot=data,
        )
        await db.execute(
            text("""
            UPDATE crm.leads
            SET ai_score=:score, ai_rationale=:rationale, ai_next_action=:action, ai_scored_at=NOW()
            WHERE id=:id AND organization_id=:org_id
            """),
            {"id": data["id"], "org_id": org_id, "score": score, "rationale": rationale, "action": action},
        )

    for row in opp_rows:
        data = dict(row)
        score, rationale, action, flags, priority = _opportunity_score(data)
        await _upsert_recommendation(
            db, org_id=org_id, user_id=actor, entity_type="opportunity", entity_id=str(data["id"]),
            score=score, rationale=rationale, action=action, flags=flags, priority=priority, snapshot=data,
        )
        await db.execute(
            text("""
            UPDATE crm.opportunities
            SET ai_score=:score, ai_rationale=:rationale, ai_next_action=:action, ai_scored_at=NOW()
            WHERE id=:id AND organization_id=:org_id
            """),
            {"id": data["id"], "org_id": org_id, "score": score, "rationale": rationale, "action": action},
        )

    await db.commit()
    return _response(
        {"leads_scored": len(lead_rows), "opportunities_scored": len(opp_rows)},
        "CRM AI scoring completed.",
    )


@router.get("/ai/recommendations")
async def list_ai_recommendations(
    entity_type: Optional[Literal["lead", "opportunity"]] = None,
    status_filter: Literal["open", "accepted", "dismissed", "completed", "all"] = Query(default="open", alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(require_permission("crm.ai.read")),
    db: AsyncSession = Depends(get_db),
):
    params: dict[str, Any] = {"org_id": user["org_id"], "limit": limit}
    filters = ""
    if entity_type:
        filters += " AND ar.entity_type=:entity_type"
        params["entity_type"] = entity_type
    if status_filter != "all":
        filters += " AND ar.status=:status"
        params["status"] = status_filter
    rows = (
        await db.execute(
            text(f"""
            SELECT ar.*,
                   COALESCE(l.company_name, o.name) AS entity_name,
                   COALESCE(l.contact_email, c.email) AS entity_email
            FROM crm.ai_recommendations ar
            LEFT JOIN crm.leads l ON ar.entity_type='lead' AND l.id=ar.entity_id AND l.organization_id=ar.organization_id
            LEFT JOIN crm.opportunities o ON ar.entity_type='opportunity' AND o.id=ar.entity_id AND o.organization_id=ar.organization_id
            LEFT JOIN crm.contacts c ON c.id=o.client_id AND c.organization_id=o.organization_id
            WHERE ar.organization_id=:org_id AND ar.is_deleted=false {filters}
            ORDER BY ar.score DESC, ar.created_at DESC
            LIMIT :limit
            """),
            params,
        )
    ).mappings().all()
    return _response([dict(row) for row in rows], "CRM AI recommendations retrieved.", len(rows))


@router.patch("/ai/recommendations/{recommendation_id}")
async def update_recommendation_status(
    recommendation_id: UUID,
    payload: RecommendationStatusPayload,
    user: dict = Depends(require_permission("crm.ai.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            text("""
            UPDATE crm.ai_recommendations
            SET status=:status, updated_at=NOW()
            WHERE id=:id AND organization_id=:org_id AND is_deleted=false
            RETURNING id
            """),
            {"id": recommendation_id, "org_id": user["org_id"], "status": payload.status},
        )
    ).scalar()
    if not row:
        raise HTTPException(status_code=404, detail="Recommendation was not found.")
    await db.commit()
    return _response({"id": str(row)}, "CRM AI recommendation updated.")
