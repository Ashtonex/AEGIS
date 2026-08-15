from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from core.database import get_db
from core.security import get_current_user, require_permission
from app.shared.sql import insert_returning_id_sql, update_returning_id_sql

router = APIRouter()

CONTACT_COLUMNS = (
    "contact_name",
    "email",
    "client_org_id",
    "phone",
    "job_title",
    "project_id",
    "whatsapp_preference",
    "linkedin",
)


class ContactPayload(BaseModel):
    """The only client-controlled columns for CRM contacts."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    contact_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    email: Optional[EmailStr] = None
    client_org_id: Optional[UUID] = None
    phone: Optional[str] = Field(default=None, max_length=50)
    job_title: Optional[str] = Field(default=None, max_length=100)
    project_id: Optional[UUID] = None
    whatsapp_preference: Optional[bool] = None
    linkedin: Optional[str] = Field(default=None, max_length=255)


def _payload_values(payload: ContactPayload) -> dict:
    return payload.model_dump(exclude_unset=True, exclude_none=False)


"""
Module: crm_contacts
Description: Auto-generated CRUD endpoints for crm.contacts.
"""


@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("crm_contacts.read")),
):
    # Fetch active records scoped to the user's organization
    query = text("""
        SELECT *
        FROM crm.contacts
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "crm_contacts listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    payload: ContactPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("crm_contacts.create")),
):
    values = _payload_values(payload)
    safe_keys = [column for column in CONTACT_COLUMNS if column in values]

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")
    if not values.get("contact_name"):
        raise HTTPException(status_code=422, detail="contact_name is required.")

    # Same lookup-before-insert crm_leads.py's qualify_lead already does for
    # its own contact creation - the "+ New Client Contact" quick-add here
    # (used from the opportunity-create modal) previously inserted
    # unconditionally, which is how the same person typed in twice became
    # two rows. A blank string email is treated as "no email", matching the
    # partial unique index in migration 090 (which excludes '').
    email = (values.get("email") or "").strip()
    if email:
        existing = await db.execute(
            text("""
                SELECT id FROM crm.contacts
                WHERE organization_id=:org_id AND lower(email)=lower(:email) AND is_deleted=false
                LIMIT 1
            """),
            {"org_id": user["org_id"], "email": email},
        )
        existing_id = existing.scalar()
        if existing_id:
            return {
                "success": True,
                "data": {"id": str(existing_id)},
                "message": "A contact with this email already exists - matched to the existing record.",
                "meta": {},
            }

    params = {k: values[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = insert_returning_id_sql("crm.contacts", safe_keys, CONTACT_COLUMNS)

    try:
        result = await db.execute(query, params)
        await db.commit()
        new_id = str(result.scalar())
        return {
            "success": True,
            "data": {"id": new_id},
            "message": "crm_contacts created.",
            "meta": {},
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/duplicates")
async def find_duplicate_contacts(
    name: Optional[str] = None,
    email: Optional[str] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("crm_contacts.read")),
):
    """Same shape as GET /crm/opportunities/duplicates - candidates matching
    on lowercased name or email, for the same manual check-then-merge flow."""
    if not (name or email):
        raise HTTPException(status_code=422, detail="name or email is required.")
    rows = await db.execute(
        text("""
            SELECT id, contact_name, email, client_org_id, phone, created_at
            FROM crm.contacts
            WHERE organization_id=:org_id AND is_deleted=false AND (
                (CAST(:name AS varchar) IS NOT NULL AND lower(contact_name)=lower(CAST(:name AS varchar)))
                OR (CAST(:email AS varchar) IS NOT NULL AND CAST(:email AS varchar) <> '' AND lower(email)=lower(CAST(:email AS varchar)))
            )
            ORDER BY created_at DESC
            LIMIT 25
        """),
        {"org_id": user["org_id"], "name": name, "email": email},
    )
    items = [dict(row._mapping) for row in rows]
    return {
        "success": True,
        "data": items,
        "message": "Duplicate contact candidates fetched.",
        "meta": {"total": len(items)},
    }


class MergeContactPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_contact_ids: list[str]


@router.post("/{contact_id}/merge")
async def merge_contacts(
    contact_id: str,
    payload: MergeContactPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("crm_contacts.delete")),
):
    """Unlike merge_opportunities (routers/crm.py), a contact is referenced
    by many more tables, so every FK pointing at the source rows has to be
    repointed at the survivor before those rows are soft-deleted - otherwise
    an opportunity, lead, or activity would end up quietly referencing a
    now-deleted contact. FK list taken directly from the live schema's
    foreign-key constraints on crm.contacts, not guessed from code.
    """
    if not payload.source_contact_ids:
        raise HTTPException(status_code=422, detail="At least one source contact is required.")
    source_ids = [sid for sid in payload.source_contact_ids if sid != contact_id]
    if not source_ids:
        raise HTTPException(status_code=422, detail="Source contacts must differ from the target.")
    org_id = user["org_id"]
    params = {"target_id": contact_id, "source_ids": source_ids, "org_id": org_id}

    target = await db.execute(
        text("SELECT 1 FROM crm.contacts WHERE id=:target_id AND organization_id=:org_id AND is_deleted=false"),
        {"target_id": contact_id, "org_id": org_id},
    )
    if not target.scalar():
        raise HTTPException(status_code=404, detail="Target contact not found")

    try:
        # Plain repoints - no unique constraint on contact_id alone in any of these.
        for table, column in [
            ("crm.activities", "contact_id"),
            ("crm.campaign_members", "contact_id"),
            ("crm.communication_events", "contact_id"),
            ("crm.interactions", "contact_id"),
            ("crm.leads", "contact_id"),
            ("crm.opportunities", "client_id"),
            ("crm.opportunities", "contact_id"),
            ("crm.support_tickets", "contact_id"),
            ("crm.tender_interests", "contact_id"),
            ("crm.tickets", "client_id"),
        ]:
            await db.execute(
                text(f"""
                    UPDATE {table} SET {column}=:target_id
                    WHERE {column} = ANY(:source_ids) AND organization_id=:org_id
                """),  # nosec B608 - table/column from a fixed literal list above, not user input
                params,
            )

        # crm.client_portal_access has UNIQUE (organization_id, contact_id) -
        # if the target already has portal access, the source's row becomes
        # redundant (drop it) rather than repointed (which would conflict).
        await db.execute(
            text("""
                DELETE FROM crm.client_portal_access
                WHERE contact_id = ANY(:source_ids) AND organization_id=:org_id
                  AND EXISTS (
                    SELECT 1 FROM crm.client_portal_access t2
                    WHERE t2.contact_id=:target_id AND t2.organization_id=:org_id
                  )
            """),
            params,
        )
        await db.execute(
            text("""
                UPDATE crm.client_portal_access SET contact_id=:target_id
                WHERE contact_id = ANY(:source_ids) AND organization_id=:org_id
            """),
            params,
        )

        # core.document_links is polymorphic (entity_id isn't a real FK) -
        # same drop-redundant-then-repoint shape, keyed on entity_type='contact'
        # plus the (document_id, link_role) pair the table's own unique
        # constraint is built on.
        await db.execute(
            text("""
                DELETE FROM core.document_links dl
                WHERE dl.entity_type='contact' AND dl.entity_id = ANY(:source_ids) AND dl.organization_id=:org_id
                  AND EXISTS (
                    SELECT 1 FROM core.document_links t2
                    WHERE t2.entity_type='contact' AND t2.entity_id=:target_id
                      AND t2.organization_id=:org_id
                      AND t2.document_id=dl.document_id AND t2.link_role=dl.link_role
                  )
            """),
            params,
        )
        await db.execute(
            text("""
                UPDATE core.document_links SET entity_id=:target_id
                WHERE entity_type='contact' AND entity_id = ANY(:source_ids) AND organization_id=:org_id
            """),
            params,
        )

        result = await db.execute(
            text("""
                UPDATE crm.contacts
                SET is_deleted=true, updated_at=NOW()
                WHERE id::text = ANY(:source_ids) AND organization_id=:org_id AND is_deleted=false
                RETURNING id
            """),
            params,
        )
        merged_ids = [str(row.id) for row in result]
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during contact merge: {str(e)}")

    return {
        "success": True,
        "data": {"id": contact_id, "merged_ids": merged_ids},
        "message": "Duplicate contacts merged.",
        "meta": {"merged": len(merged_ids)},
    }


@router.get("/{item_id}")
async def get_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("crm_contacts.read")),
):
    query = text("""
        SELECT *
        FROM crm.contacts
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": dict(item._mapping),
        "message": "crm_contacts retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    payload: ContactPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("crm_contacts.update")),
):
    values = _payload_values(payload)
    safe_keys = [column for column in CONTACT_COLUMNS if column in values]

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "No fields to update.",
        }

    params = {k: values[k] for k in safe_keys}
    params["item_id"] = item_id
    params["org_id"] = user["org_id"]

    query = update_returning_id_sql("crm.contacts", safe_keys, CONTACT_COLUMNS)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "crm_contacts updated.",
            "meta": {},
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.delete("/{item_id}")
async def delete_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("crm_contacts.delete")),
):
    query = text("""
        UPDATE crm.contacts
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id
        RETURNING id
    """)

    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    if not result.first():
        raise HTTPException(status_code=404, detail="Item not found")

    await db.commit()
    return {
        "success": True,
        "data": None,
        "message": "crm_contacts deleted (soft delete).",
        "meta": {},
    }


class ContactDocumentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str
    link_role: str = Field(default="attachment", max_length=80)


@router.post("/{contact_id}/documents", status_code=201)
async def attach_contact_document(
    contact_id: str,
    payload: ContactDocumentPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("crm_contacts.update")),
):
    """Same core.document_links polymorphic pattern as support-ticket
    attachments (crm_lifecycle.py) and lead documents (crm_leads.py) -
    contacts had zero document linkage before this."""
    org_id = user["org_id"]
    contact = await db.execute(
        text("SELECT 1 FROM crm.contacts WHERE id=:contact_id AND organization_id=:org_id AND is_deleted=false"),
        {"contact_id": contact_id, "org_id": org_id},
    )
    if not contact.scalar():
        raise HTTPException(status_code=404, detail="Contact not found")
    document = await db.execute(
        text("SELECT 1 FROM core.documents WHERE id=:document_id AND organization_id=:org_id AND is_deleted=false"),
        {"document_id": payload.document_id, "org_id": org_id},
    )
    if not document.scalar():
        raise HTTPException(status_code=404, detail="Document not found in this organization.")
    result = await db.execute(
        text("""
            INSERT INTO core.document_links (organization_id, document_id, entity_type, entity_id, link_role, linked_by)
            VALUES (:org_id, :document_id, 'contact', :contact_id, :link_role, :user_id)
            ON CONFLICT (organization_id, document_id, entity_type, entity_id, link_role) DO NOTHING
            RETURNING id
        """),
        {
            "org_id": org_id,
            "document_id": payload.document_id,
            "contact_id": contact_id,
            "link_role": payload.link_role,
            "user_id": user["sub"],
        },
    )
    new_id = result.scalar()
    await db.commit()
    return {
        "success": True,
        "data": {"id": str(new_id) if new_id else None},
        "message": "Document attached to contact." if new_id else "Document was already attached to this contact.",
        "meta": {},
    }


@router.get("/{contact_id}/documents")
async def list_contact_documents(
    contact_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("crm_contacts.read")),
):
    org_id = user["org_id"]
    rows = await db.execute(
        text("""
            SELECT d.id, d.title, d.file_name, d.file_size_bytes, d.category, dl.link_role, dl.linked_at
            FROM core.document_links dl
            JOIN core.documents d ON d.id = dl.document_id AND d.organization_id = dl.organization_id
            WHERE dl.organization_id=:org_id AND dl.entity_type='contact' AND dl.entity_id=:contact_id
              AND dl.is_deleted=false AND d.is_deleted=false
            ORDER BY dl.linked_at DESC
        """),
        {"org_id": org_id, "contact_id": contact_id},
    )
    items = [dict(row._mapping) for row in rows]
    return {"success": True, "data": items, "message": "Contact documents listed.", "meta": {"total": len(items)}}
