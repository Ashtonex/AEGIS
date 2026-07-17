from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok

router = APIRouter()


class DocumentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=255)
    category: str = Field(default="other", max_length=80)
    classification: str = Field(default="internal", max_length=80)
    project_id: Optional[UUID] = None
    description: Optional[str] = None
    file_name: Optional[str] = None
    size_bytes: Optional[int] = 0


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
    # Generate human-readable document number
    from app.shared.sequences import next_reference

    doc_no = await next_reference(db, user["org_id"], "document")

    try:
        doc_id = (
            await db.execute(
                text("""
            INSERT INTO core.documents (
                organization_id, doc_number, title, category, classification,
                project_id, description, file_name, file_size_bytes, status, created_by
            ) VALUES (
                :org_id, :doc_number, :title, :category, :classification,
                :project_id, :description, :file_name, :size_bytes, 'draft', :user_id
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "doc_number": doc_no,
                    "title": payload.title,
                    "category": payload.category,
                    "classification": payload.classification,
                    "project_id": payload.project_id,
                    "description": payload.description,
                    "file_name": payload.file_name,
                    "size_bytes": payload.size_bytes,
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        await db.commit()
        return ok(
            {"id": str(doc_id), "doc_number": doc_no},
            "Document registered successfully.",
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


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
