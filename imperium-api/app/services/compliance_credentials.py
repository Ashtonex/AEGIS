"""Corporate Credentials Vault (compliance.corporate_credentials, migration
198) - the permanent, reusable, org-wide store of SNC's own registrations,
certifications, insurance and financial evidence. Tenders read from this
instead of re-collecting the same evidence per tender (see
app/services/tenders/compliance_matching.py).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_EXPIRY_STATUSES = {"valid", "expiring", "expired", "pending_verification", "unverified", "not_applicable"}


def _computed_status(status: str, expiry_date: Optional[date]) -> str:
    """Recomputes valid/expiring/expired from the stored expiry_date so the
    displayed status never drifts from reality just because nobody opened
    the record recently. pending_verification/unverified/not_applicable are
    left as explicitly set by a human."""
    if status not in ("valid", "expiring", "expired") or expiry_date is None:
        return status
    today = date.today()
    if expiry_date < today:
        return "expired"
    if expiry_date <= today + timedelta(days=30):
        return "expiring"
    return "valid"


def _with_computed_status(row: dict) -> dict:
    row = dict(row)
    row["status"] = _computed_status(row.get("status"), row.get("expiry_date"))
    return row


async def list_credentials(
    db: AsyncSession,
    *,
    org_id: str,
    category: Optional[str] = None,
    credential_type: Optional[str] = None,
    status: Optional[str] = None,
    expiring_within_days: Optional[int] = None,
) -> list[dict]:
    filters = ["organization_id = :org_id", "is_deleted = false"]
    params: dict[str, Any] = {"org_id": org_id}
    if category:
        filters.append("category = :category")
        params["category"] = category
    if credential_type:
        filters.append("credential_type = :credential_type")
        params["credential_type"] = credential_type
    if expiring_within_days is not None:
        filters.append("expiry_date IS NOT NULL AND expiry_date <= :expiry_cutoff")
        params["expiry_cutoff"] = date.today() + timedelta(days=expiring_within_days)
    where = " AND ".join(filters)
    rows = await db.execute(
        text(f"SELECT * FROM compliance.corporate_credentials WHERE {where} ORDER BY category, credential_type"),  # nosec B608 - filters are static column checks above
        params,
    )
    items = [_with_computed_status(dict(r._mapping)) for r in rows]
    if status:
        items = [item for item in items if item["status"] == status]
    return items


async def get_credential(db: AsyncSession, *, org_id: str, credential_id: UUID) -> Optional[dict]:
    row = await db.execute(
        text("SELECT * FROM compliance.corporate_credentials WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": credential_id, "org_id": org_id},
    )
    result = row.mappings().first()
    return _with_computed_status(dict(result)) if result else None


async def create_credential(db: AsyncSession, *, org_id: str, user_id: str, payload: dict) -> dict:
    row = await db.execute(
        text("""
            INSERT INTO compliance.corporate_credentials (
                organization_id, credential_type, issuing_organisation, registration_number,
                category, classification_grade, permitted_scope, value_limit, issue_date,
                expiry_date, review_date, status, evidence_document_id, notes, applicability,
                created_by
            ) VALUES (
                :org_id, :credential_type, :issuing_organisation, :registration_number,
                :category, :classification_grade, :permitted_scope, :value_limit, :issue_date,
                :expiry_date, :review_date, :status, :evidence_document_id, :notes, :applicability,
                :user_id
            ) RETURNING *
        """),
        {**payload, "org_id": org_id, "user_id": user_id},
    )
    return _with_computed_status(dict(row.mappings().first()))


async def update_credential(db: AsyncSession, *, org_id: str, user_id: str, credential_id: UUID, payload: dict) -> Optional[dict]:
    row = await db.execute(
        text("""
            UPDATE compliance.corporate_credentials
            SET credential_type = :credential_type, issuing_organisation = :issuing_organisation,
                registration_number = :registration_number, category = :category,
                classification_grade = :classification_grade, permitted_scope = :permitted_scope,
                value_limit = :value_limit, issue_date = :issue_date, expiry_date = :expiry_date,
                review_date = :review_date, status = :status, evidence_document_id = :evidence_document_id,
                notes = :notes, applicability = :applicability, updated_by = :user_id, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING *
        """),
        {**payload, "id": credential_id, "org_id": org_id, "user_id": user_id},
    )
    result = row.mappings().first()
    return _with_computed_status(dict(result)) if result else None


async def verify_credential(db: AsyncSession, *, org_id: str, user_id: str, credential_id: UUID, status: str) -> Optional[dict]:
    row = await db.execute(
        text("""
            UPDATE compliance.corporate_credentials
            SET status = :status, verification_date = NOW(), verified_by_user_id = :user_id, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING *
        """),
        {"status": status, "id": credential_id, "org_id": org_id, "user_id": user_id},
    )
    result = row.mappings().first()
    return _with_computed_status(dict(result)) if result else None


async def delete_credential(db: AsyncSession, *, org_id: str, credential_id: UUID) -> bool:
    row = await db.execute(
        text("""
            UPDATE compliance.corporate_credentials
            SET is_deleted = true, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"id": credential_id, "org_id": org_id},
    )
    return row.first() is not None
