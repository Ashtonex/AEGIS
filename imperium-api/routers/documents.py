from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db, supabase
from core.logging import logger
from core.security import require_permission
from app.shared.pagination import ok

router = APIRouter()

DOCUMENTS_BUCKET = "documents"
SIGNED_URL_TTL_SECONDS = 300


class DocumentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # Field names and set below mirror the actual core.documents columns
    # (see migrations/006_crm_documents_expansion.sql) - this table has no
    # doc_number/classification/project_id/description/status columns.
    title: str = Field(min_length=1, max_length=255)
    category: str = Field(default="other", max_length=100)
    opportunity_id: Optional[UUID] = None
    tender_id: Optional[UUID] = None
    file_name: Optional[str] = None
    file_size_bytes: Optional[int] = 0
    # Path of an object the client already uploaded to the private
    # 'documents' Storage bucket (see migrations/076) - links this
    # document to a real file via core.file_attachments. Documents
    # registered without one (or from before this existed) have no file
    # to serve; the signed-url endpoint reports that explicitly rather
    # than erroring unhelpfully.
    storage_path: Optional[str] = None
    mime_type: Optional[str] = None


class StatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    status: str = Field(min_length=1, max_length=40)


@router.get("/")
async def list_documents(
    category: Optional[str] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    classification: Optional[str] = None,
    search: Optional[str] = None,
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("documents.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List controlled documents under organization scope, applying filters.
    """
    query_str = """
        SELECT d.*
        FROM core.documents d
        WHERE d.organization_id = :org_id AND d.is_deleted = false
    """
    params = {"org_id": user["org_id"]}

    if category:
        query_str += " AND d.category = :category"
        params["category"] = category
    if status_filter:
        query_str += " AND d.status = :status"
        params["status"] = status_filter
    if classification:
        query_str += " AND d.classification = :classification"
        params["classification"] = classification
    if project_id:
        query_str += " AND d.project_id = :project_id"
        params["project_id"] = project_id
    if search:
        query_str += " AND (d.title ILIKE :search OR d.file_name ILIKE :search OR d.doc_number ILIKE :search)"
        params["search"] = f"%{search}%"

    query_str += " ORDER BY d.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Documents listed.")


@router.get("/{document_id}")
async def get_document(
    document_id: UUID,
    user: dict = Depends(require_permission("documents.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
        SELECT * FROM core.documents
        WHERE id = :id AND organization_id = :org_id AND is_deleted = false
    """),
        {"id": document_id, "org_id": user["org_id"]},
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found.")
    return ok(dict(row._mapping), "Document retrieved.")


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_document(
    payload: DocumentCreate,
    user: dict = Depends(require_permission("documents.create")),
    db: AsyncSession = Depends(get_db),
):
    if payload.opportunity_id:
        opp_check = await db.execute(
            text("""
                SELECT 1 FROM crm.opportunities
                WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            """),
            {"id": payload.opportunity_id, "org_id": user["org_id"]},
        )
        if not opp_check.first():
            raise HTTPException(status_code=404, detail="Opportunity not found.")

    if payload.tender_id:
        tender_check = await db.execute(
            text("""
                SELECT 1 FROM crm.tenders
                WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            """),
            {"id": payload.tender_id, "org_id": user["org_id"]},
        )
        if not tender_check.first():
            raise HTTPException(status_code=404, detail="Tender not found.")

    try:
        file_attachment_id = None
        if payload.storage_path:
            file_attachment_id = (
                await db.execute(
                    text("""
                INSERT INTO core.file_attachments (
                    organization_id, uploaded_by, file_name, storage_path, mime_type, size_bytes
                ) VALUES (
                    :org_id, :user_id, :file_name, :storage_path, :mime_type, :size_bytes
                ) RETURNING id
            """),
                    {
                        "org_id": user["org_id"],
                        "user_id": user["user_id"],
                        "file_name": payload.file_name,
                        "storage_path": payload.storage_path,
                        "mime_type": payload.mime_type,
                        "size_bytes": payload.file_size_bytes or 0,
                    },
                )
            ).scalar()

        doc_id = (
            await db.execute(
                text("""
            INSERT INTO core.documents (
                organization_id, title, category, opportunity_id, tender_id,
                file_name, file_size_bytes, file_attachment_id, created_by
            ) VALUES (
                :org_id, :title, :category, :opportunity_id, :tender_id,
                :file_name, :file_size_bytes, :file_attachment_id, :user_id
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "title": payload.title,
                    "category": payload.category,
                    "opportunity_id": payload.opportunity_id,
                    "tender_id": payload.tender_id,
                    "file_name": payload.file_name,
                    "file_size_bytes": payload.file_size_bytes,
                    "file_attachment_id": file_attachment_id,
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        await db.commit()
        return ok(
            {"id": str(doc_id)},
            "Document registered successfully.",
        )
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{document_id}/signed-url")
async def get_signed_url(
    document_id: UUID,
    user: dict = Depends(require_permission("documents.read")),
    db: AsyncSession = Depends(get_db),
):
    """Mints a short-lived signed URL for this document's stored file.
    Deliberately server-side: the 'documents' bucket has no SELECT policy
    for authenticated clients, so this permission check (and the org
    match below) is the only gate on who can actually read the bytes -
    a client can't fetch the object directly even knowing its path."""
    row = (
        await db.execute(
            text("""
        SELECT fa.storage_path, fa.mime_type, fa.file_name
        FROM core.documents d
        JOIN core.file_attachments fa ON fa.id = d.file_attachment_id AND fa.is_deleted = false
        WHERE d.id = :id AND d.organization_id = :org_id AND d.is_deleted = false
    """),
            {"id": document_id, "org_id": user["org_id"]},
        )
    ).mappings().first()

    if not row:
        doc_exists = await db.execute(
            text("SELECT 1 FROM core.documents WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": document_id, "org_id": user["org_id"]},
        )
        if not doc_exists.first():
            raise HTTPException(status_code=404, detail="Document not found.")
        raise HTTPException(
            status_code=404,
            detail="This document was registered without an uploaded file, so there is nothing to download.",
        )

    try:
        signed = supabase.storage.from_(DOCUMENTS_BUCKET).create_signed_url(
            row["storage_path"], SIGNED_URL_TTL_SECONDS
        )
    except Exception:
        logger.exception("Failed to create signed URL for document", document_id=str(document_id))
        raise HTTPException(status_code=502, detail="Could not generate a download link for this file. Try again.")

    signed_url = signed.get("signedURL")
    if not signed_url:
        raise HTTPException(status_code=502, detail="Could not generate a download link for this file. Try again.")

    return ok(
        {
            "url": signed_url,
            "file_name": row["file_name"],
            "mime_type": row["mime_type"],
            "expires_in": SIGNED_URL_TTL_SECONDS,
        },
        "Signed download URL generated.",
    )


@router.patch("/{document_id}/status")
async def update_status(
    document_id: UUID,
    payload: StatusUpdate,
    user: dict = Depends(require_permission("documents.update")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
        UPDATE core.documents
        SET status = :status, updated_at = NOW()
        WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        RETURNING id
    """),
        {"id": document_id, "status": payload.status, "org_id": user["org_id"]},
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Document not found.")
    await db.commit()
    return ok({"id": str(document_id)}, "Document status updated.")


@router.get("/{document_id}/versions")
async def get_versions(
    document_id: UUID,
    user: dict = Depends(require_permission("documents.read")),
    db: AsyncSession = Depends(get_db),
):
    document = (
        (
            await db.execute(
                text("""
        SELECT d.id, d.title, d.file_name, d.created_at, d.updated_at, d.created_by,
               u.full_name AS author_name, u.email AS author_email
        FROM core.documents d
        LEFT JOIN core.users u ON u.id=d.created_by AND u.organization_id=d.organization_id
        WHERE d.id=:id AND d.organization_id=:org_id AND d.is_deleted=false
    """),
                {"id": document_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found.")

    audit_rows = (
        (
            await db.execute(
                text("""
        SELECT a.id, a.action, a.old_data, a.new_data, a.created_at,
               u.full_name AS author_name, u.email AS author_email
        FROM core.audit_log a
        LEFT JOIN core.users u ON u.id=a.created_by
        WHERE a.record_id=:id
          AND a.table_name='documents'
          AND COALESCE(a.new_data->>'organization_id', a.old_data->>'organization_id')=:org_id
        ORDER BY a.created_at DESC
        LIMIT 100
    """),
                {"id": document_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .all()
    )
    versions = [
        {
            "version": "current",
            "updated_at": document["updated_at"] or document["created_at"],
            "author": document["author_name"]
            or document["author_email"]
            or "Recorded user",
            "notes": f"Current repository record for {document['file_name'] or document['title']}",
            "source": "core.documents",
        }
    ]
    versions.extend(
        {
            "version": f"audit-{index + 1}",
            "updated_at": row["created_at"],
            "author": row["author_name"] or row["author_email"] or "Recorded user",
            "notes": f"{row['action']} captured in core audit log",
            "source": "core.audit_log",
            "old_data": row["old_data"],
            "new_data": row["new_data"],
        }
        for index, row in enumerate(audit_rows)
    )
    return ok(versions, "Document versions retrieved.")


@router.get("/{document_id}/links")
async def get_links(
    document_id: UUID,
    user: dict = Depends(require_permission("documents.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
        SELECT * FROM core.document_links
        WHERE document_id = :doc_id AND organization_id = :org_id AND is_deleted = false
    """),
        {"doc_id": document_id, "org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in result]
    return ok(items, "Document links retrieved.")
