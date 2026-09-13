"""Phase 8/9 orchestration: AEGIS upload -> SharePoint, and permission-gated
retrieval of a document that lives in SharePoint.

This is the service layer routers/documents.py (or a future
routers/documents.py upload endpoint) calls - it never runs unauthenticated
and never runs client-side. It deliberately extends the existing
core.file_attachments / core.documents / core.document_links tables (see
migrations/001, 006, 021, 076 and routers/documents.py) rather than
introducing a parallel document table, so every existing per-entity
Documents panel keeps working for both provider='supabase' and
provider='sharepoint' rows.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.logging import logger
from app.services.microsoft import sharepoint
from app.services.microsoft.errors import GraphError, GraphNotConfiguredError
from app.services.microsoft.graph_client import GraphClient
from app.services.microsoft.routing import RoutingDenied, project_folder_path, resolve_library

MAX_SIMPLE_UPLOAD_BYTES = sharepoint.SIMPLE_UPLOAD_MAX_BYTES


@dataclass
class OrganisationConnection:
    tenant_id: str
    site_id: str
    drive_id: str
    library_map: dict[str, Any]
    sync_documents: bool


class MicrosoftIntegrationNotReady(Exception):
    """Connection missing, disabled, or document sync turned off for this
    organisation - callers should surface this as 'Microsoft 365 sync is not
    enabled', not as an unexpected error."""


async def _load_connection(db: AsyncSession, organization_id: UUID) -> OrganisationConnection:
    row = (
        await db.execute(
            text("""
                SELECT tenant_id, site_id, drive_id, library_map, enabled, sync_documents
                FROM core.organisation_integrations
                WHERE organization_id = :org_id AND provider = 'microsoft365' AND is_deleted = false
            """),
            {"org_id": organization_id},
        )
    ).mappings().first()

    if not row or not row["enabled"] or not row["sync_documents"]:
        raise MicrosoftIntegrationNotReady("Microsoft 365 document sync is not enabled for this organisation.")
    if not row["site_id"] or not row["drive_id"]:
        raise MicrosoftIntegrationNotReady("Microsoft 365 is connected but no SharePoint site/library is selected yet.")

    tenant_id = row["tenant_id"] or settings.MICROSOFT_GRAPH_TENANT_ID
    if not tenant_id:
        raise GraphNotConfiguredError("No Microsoft tenant configured for this organisation.")

    return OrganisationConnection(
        tenant_id=tenant_id,
        site_id=row["site_id"],
        drive_id=row["drive_id"],
        library_map=dict(row["library_map"] or {}),
        sync_documents=row["sync_documents"],
    )


async def _resolve_destination_folder(
    db: AsyncSession,
    client: GraphClient,
    connection: OrganisationConnection,
    organization_id: UUID,
    *,
    module: str,
    project_id: Optional[UUID],
    project_code: Optional[str],
    project_name: Optional[str],
    subfolder: Optional[str],
    confidentiality_level: str,
) -> tuple[str, str]:
    """Returns (drive_id, item_id) for the destination folder, using
    core.sharepoint_folder_map as a cache so repeated uploads to the same
    project/module don't re-walk or re-create the folder tree every time."""
    library_name = resolve_library(module, confidentiality_level=confidentiality_level)
    library_item_id = connection.library_map.get(library_name)
    if not library_item_id:
        raise MicrosoftIntegrationNotReady(
            f"SharePoint library '{library_name}' is not mapped yet - run the setup wizard's "
            "'Select Document Libraries' step."
        )

    path_segments: list[str] = []
    if module == "project" and project_id and project_code and project_name:
        path_segments = project_folder_path(project_code, project_name, subfolder)
    elif subfolder:
        path_segments = [subfolder]

    cache_key_subfolder = "/".join(path_segments)
    cached = (
        await db.execute(
            text("""
                SELECT drive_id, item_id FROM core.sharepoint_folder_map
                WHERE organization_id = :org_id AND module = :module
                  AND project_id IS NOT DISTINCT FROM :project_id
                  AND subfolder = :subfolder AND is_deleted = false
            """),
            {"org_id": organization_id, "module": module, "project_id": project_id, "subfolder": cache_key_subfolder},
        )
    ).mappings().first()
    if cached:
        return cached["drive_id"], cached["item_id"]

    if path_segments:
        folder = await sharepoint.ensure_folder_path(client, connection.drive_id, library_item_id, path_segments)
        drive_id, item_id, web_url = connection.drive_id, folder.item_id, folder.web_url
    else:
        drive_id, item_id = connection.drive_id, library_item_id
        web_url = None

    await db.execute(
        text("""
            INSERT INTO core.sharepoint_folder_map
                (organization_id, module, project_id, subfolder, drive_id, item_id, web_url, path_label)
            VALUES (:org_id, :module, :project_id, :subfolder, :drive_id, :item_id, :web_url, :path_label)
            ON CONFLICT (organization_id, module, project_id, subfolder) DO NOTHING
        """),
        {
            "org_id": organization_id, "module": module, "project_id": project_id,
            "subfolder": cache_key_subfolder, "drive_id": drive_id, "item_id": item_id,
            "web_url": web_url, "path_label": f"{library_name}/{cache_key_subfolder}".rstrip("/"),
        },
    )
    return drive_id, item_id


async def upload_document(
    db: AsyncSession,
    *,
    organization_id: UUID,
    uploaded_by: UUID,
    module: str,
    file_name: str,
    content: bytes,
    mime_type: str,
    confidentiality_level: str = "internal",
    project_id: Optional[UUID] = None,
    project_code: Optional[str] = None,
    project_name: Optional[str] = None,
    subfolder: Optional[str] = None,
) -> dict[str, Any]:
    """Phase 8's upload flow. Caller (a router) is responsible for AEGIS
    permission checks, organisation scoping and file size/type validation
    BEFORE calling this - this function assumes those already passed and
    focuses purely on "get the bytes into the right SharePoint folder and
    record the result".

    Returns the inserted core.file_attachments row as a dict.
    """
    connection = await _load_connection(db, organization_id)
    client = GraphClient(tenant_id=connection.tenant_id)

    try:
        drive_id, parent_item_id = await _resolve_destination_folder(
            db, client, connection, organization_id,
            module=module, project_id=project_id, project_code=project_code,
            project_name=project_name, subfolder=subfolder, confidentiality_level=confidentiality_level,
        )

        uploader = sharepoint.upload_small_file if len(content) <= MAX_SIMPLE_UPLOAD_BYTES else sharepoint.upload_large_file
        item = await uploader(client, drive_id, parent_item_id, file_name, content, mime_type)
        sync_status = "synced"
    except (RoutingDenied, MicrosoftIntegrationNotReady):
        raise
    except GraphError as exc:
        # NOTE: this call raises straight through rather than staging a
        # 'pending' attachment row for background retry - the durable
        # "don't lose the upload, retry later" path (Phase 22) is not yet
        # wired up here. The caller (a future upload endpoint) should catch
        # GraphError and tell the user to retry, or queue the raw bytes
        # itself, until that fallback lands.
        logger.error("microsoft_graph.document_upload_failed", extra={"organization_id": str(organization_id), "error": str(exc)})
        raise

    checksum = hashlib.sha256(content).hexdigest()
    row = (
        await db.execute(
            text("""
                INSERT INTO core.file_attachments (
                    organization_id, uploaded_by, file_name, storage_path, mime_type, size_bytes,
                    provider, module, document_category, confidentiality_level,
                    provider_site_id, provider_drive_id, provider_item_id, provider_parent_item_id,
                    sharepoint_web_url, sharepoint_etag, checksum_sha256, sync_status, last_synced_at
                ) VALUES (
                    :org_id, :uploaded_by, :file_name, :storage_path, :mime_type, :size_bytes,
                    'sharepoint', :module, :document_category, :confidentiality_level,
                    :site_id, :drive_id, :item_id, :parent_item_id,
                    :web_url, :etag, :checksum, :sync_status, NOW()
                )
                RETURNING *
            """),
            {
                "org_id": organization_id, "uploaded_by": uploaded_by, "file_name": file_name,
                # storage_path kept populated (rather than NULL) with the SharePoint web URL so any
                # existing code path that still reads storage_path for display has something sensible.
                "storage_path": item.web_url, "mime_type": mime_type, "size_bytes": len(content),
                "module": module, "document_category": module, "confidentiality_level": confidentiality_level,
                "site_id": connection.site_id, "drive_id": drive_id, "item_id": item.item_id,
                "parent_item_id": parent_item_id, "web_url": item.web_url, "etag": item.etag,
                "checksum": checksum, "sync_status": sync_status,
            },
        )
    ).mappings().first()

    await db.execute(
        text("""
            INSERT INTO core.domain_events (organization_id, event_type, aggregate_type, aggregate_id, project_id, actor_id, idempotency_key, payload)
            VALUES (:org_id, 'microsoft.document.uploaded.v1', 'file_attachment', :aggregate_id, :project_id, :actor_id, :idempotency_key, :payload)
            ON CONFLICT DO NOTHING
        """),
        {
            "org_id": organization_id, "aggregate_id": row["id"], "project_id": project_id, "actor_id": uploaded_by,
            "idempotency_key": f"microsoft.document.uploaded:{row['id']}",
            "payload": {"file_name": file_name, "module": module, "sharepoint_item_id": item.item_id, "web_url": item.web_url},
        },
    )

    return dict(row)


async def get_download_url(db: AsyncSession, *, organization_id: UUID, file_attachment_id: UUID) -> str:
    """Phase 9: caller must already have verified the requesting user's AEGIS
    permission for the owning entity before calling this - this only proves
    the attachment belongs to the caller's organisation, not that the
    specific user may see it."""
    row = (
        await db.execute(
            text("""
                SELECT provider, provider_drive_id, provider_item_id, tenant_id
                FROM core.file_attachments fa
                LEFT JOIN core.organisation_integrations oi
                    ON oi.organization_id = fa.organization_id AND oi.provider = 'microsoft365' AND oi.is_deleted = false
                WHERE fa.id = :id AND fa.organization_id = :org_id AND fa.is_deleted = false
            """),
            {"id": file_attachment_id, "org_id": organization_id},
        )
    ).mappings().first()
    if not row or row["provider"] != "sharepoint":
        raise ValueError("Document is not a SharePoint-backed attachment.")

    tenant_id = row["tenant_id"] or settings.MICROSOFT_GRAPH_TENANT_ID
    client = GraphClient(tenant_id=tenant_id)
    return await sharepoint.get_download_url(client, row["provider_drive_id"], row["provider_item_id"])
