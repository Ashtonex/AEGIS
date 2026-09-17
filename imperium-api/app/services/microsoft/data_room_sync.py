"""Financial Data Room <-> SharePoint sync (push uploads, pull reconciliation).

Mirrors document_service.py's shape (Phase 8/9's AEGIS-upload -> SharePoint
orchestration for core.file_attachments) but scoped to the Financial Data
Room's own folder taxonomy (finance.data_room_folders/data_room_documents,
see migrations/178) rather than the generic Documents feature's
module -> library routing (routing.py's MODULE_LIBRARY_MAP). The Data
Room's 18-folder tree (01 CORPORATE .. 18 BANKABILITY) doesn't match that
feature's library names (00_DIRECTORS .. 10_ARCHIVE), so it gets its own
dedicated root folder in the same connected drive (migrations/221) instead
of reusing core.organisation_integrations.library_map.

Every function here takes an AsyncSession and does its own reads/writes but
never commits - callers (routers/data_room.py) own the transaction boundary,
same convention as document_service.py.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Optional
from uuid import UUID

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.logging import logger
from app.services.microsoft import sharepoint
from app.services.microsoft.document_service import MicrosoftIntegrationNotReady
from app.services.microsoft.errors import GraphError, GraphNotConfiguredError
from app.services.microsoft.graph_client import GraphClient

DATA_ROOM_ROOT_FOLDER_NAME = "SNC Financial Data Room"
MAX_SIMPLE_UPLOAD_BYTES = sharepoint.SIMPLE_UPLOAD_MAX_BYTES


@dataclass
class DataRoomConnection:
    tenant_id: str
    site_id: str
    drive_id: str
    root_item_id: str


async def _load_connection(db: AsyncSession, organization_id: UUID) -> DataRoomConnection:
    row = (
        await db.execute(
            text("""
                SELECT tenant_id, site_id, drive_id, sync_data_room, data_room_root_item_id
                FROM core.organisation_integrations
                WHERE organization_id = :org_id AND provider = 'microsoft365' AND is_deleted = false
            """),
            {"org_id": organization_id},
        )
    ).mappings().first()

    if not row or not row["sync_data_room"]:
        raise MicrosoftIntegrationNotReady("Data Room SharePoint sync is not enabled for this organisation.")
    if not row["site_id"] or not row["drive_id"]:
        raise MicrosoftIntegrationNotReady("Microsoft 365 is connected but no SharePoint site/library is selected yet.")

    tenant_id = row["tenant_id"] or settings.MICROSOFT_GRAPH_TENANT_ID
    if not tenant_id:
        raise GraphNotConfiguredError("No Microsoft tenant configured for this organisation.")

    root_item_id = row["data_room_root_item_id"]
    if not root_item_id:
        root_item_id = await _ensure_root_folder(db, organization_id, tenant_id, row["drive_id"])

    return DataRoomConnection(tenant_id=tenant_id, site_id=row["site_id"], drive_id=row["drive_id"], root_item_id=root_item_id)


async def _ensure_root_folder(db: AsyncSession, organization_id: UUID, tenant_id: str, drive_id: str) -> str:
    """First-run self-healing: creates (or finds) the dedicated Data Room
    root folder at the connected drive's root, and persists it so future
    calls skip this. There is no wizard endpoint yet to point this at a
    different existing folder - an admin would do that with a direct UPDATE
    on data_room_root_item_id for now."""
    client = GraphClient(tenant_id=tenant_id)
    folder = await sharepoint.ensure_folder(client, drive_id, "root", DATA_ROOM_ROOT_FOLDER_NAME)

    await db.execute(
        text("""
            UPDATE core.organisation_integrations
            SET data_room_root_drive_id = :drive_id, data_room_root_item_id = :item_id,
                data_room_root_web_url = :web_url, updated_at = NOW()
            WHERE organization_id = :org_id AND provider = 'microsoft365'
        """),
        {"drive_id": drive_id, "item_id": folder.item_id, "web_url": folder.web_url, "org_id": organization_id},
    )
    return folder.item_id


async def resolve_data_room_folder(
    db: AsyncSession, connection: DataRoomConnection, organization_id: UUID, folder_path: str
) -> tuple[str, str]:
    """Returns (drive_id, item_id) for the SharePoint folder mirroring this
    Data Room folder_path, caching the result on the matching
    finance.data_room_folders row so repeat uploads to the same folder skip
    the walk. Assumes the caller already ensured the folder_path row exists
    in finance.data_room_folders (routers/data_room.py's
    _ensure_folder_exists runs first, same as the Supabase upload path)."""
    clean_path = (folder_path or "").strip().strip("/")

    cached = (
        await db.execute(
            text("""
                SELECT provider_drive_id, provider_item_id FROM finance.data_room_folders
                WHERE organization_id = :org_id AND folder_path = :folder_path AND is_deleted = false
            """),
            {"org_id": organization_id, "folder_path": clean_path},
        )
    ).mappings().first()
    if cached and cached["provider_item_id"]:
        return cached["provider_drive_id"], cached["provider_item_id"]

    client = GraphClient(tenant_id=connection.tenant_id)
    segments = [p for p in clean_path.split("/") if p]
    if segments:
        folder = await sharepoint.ensure_folder_path(client, connection.drive_id, connection.root_item_id, segments)
        drive_id, item_id = connection.drive_id, folder.item_id
    else:
        drive_id, item_id = connection.drive_id, connection.root_item_id

    await db.execute(
        text("""
            UPDATE finance.data_room_folders
            SET provider_drive_id = :drive_id, provider_item_id = :item_id, updated_at = NOW()
            WHERE organization_id = :org_id AND folder_path = :folder_path AND is_deleted = false
        """),
        {"drive_id": drive_id, "item_id": item_id, "org_id": organization_id, "folder_path": clean_path},
    )
    return drive_id, item_id


async def upload_document(
    db: AsyncSession, *, organization_id: UUID, folder_path: str, file_name: str, content: bytes, mime_type: str
) -> dict[str, Any]:
    """Pushes a Data Room upload straight to the org's real SharePoint site.
    Caller (routers/data_room.py) has already validated the upload and
    ensured folder_path exists in finance.data_room_folders - this focuses
    purely on getting the bytes into SharePoint and returning the
    identifiers to persist onto the finance.data_room_documents row it
    inserts.

    Raises MicrosoftIntegrationNotReady when sync isn't enabled/configured -
    the caller should catch this and fall back to the existing Supabase
    Storage upload path rather than surfacing it as an error."""
    connection = await _load_connection(db, organization_id)
    drive_id, parent_item_id = await resolve_data_room_folder(db, connection, organization_id, folder_path)

    client = GraphClient(tenant_id=connection.tenant_id)
    uploader = sharepoint.upload_small_file if len(content) <= MAX_SIMPLE_UPLOAD_BYTES else sharepoint.upload_large_file
    try:
        item = await uploader(client, drive_id, parent_item_id, file_name, content, mime_type)
    except GraphError as exc:
        logger.error("data_room.sharepoint_upload_failed", organization_id=str(organization_id), error=str(exc))
        raise

    return {
        "drive_id": drive_id,
        "item_id": item.item_id,
        "web_url": item.web_url,
        "etag": item.etag,
        "checksum": hashlib.sha256(content).hexdigest(),
    }


async def get_download_url(db: AsyncSession, *, organization_id: UUID, drive_id: str, item_id: str) -> str:
    connection = await _load_connection(db, organization_id)
    client = GraphClient(tenant_id=connection.tenant_id)
    return await sharepoint.get_download_url(client, drive_id, item_id)


async def fetch_bytes(db: AsyncSession, *, organization_id: UUID, drive_id: str, item_id: str) -> bytes:
    """Downloads the raw bytes of a SharePoint-backed document - used by the
    ZIP export path, which needs the content itself rather than a redirect
    URL."""
    connection = await _load_connection(db, organization_id)
    client = GraphClient(tenant_id=connection.tenant_id)
    download_url = await sharepoint.get_download_url(client, drive_id, item_id)
    async with httpx.AsyncClient(timeout=60.0) as http_client:
        response = await http_client.get(download_url)
        response.raise_for_status()
        return response.content


async def reconcile_from_sharepoint(
    db: AsyncSession, *, organization_id: UUID, actor_id: Optional[UUID], standard_sections: list[dict[str, str]]
) -> dict[str, int]:
    """The 'pull' half: walks the connected Data Room root folder in
    SharePoint and registers any file it doesn't already know about (a file
    someone dropped directly into SharePoint rather than through AEGIS).
    Matches files by provider_item_id (migrations/221's partial unique
    index), so running this repeatedly is safe - already-imported files are
    skipped, not duplicated."""
    connection = await _load_connection(db, organization_id)
    client = GraphClient(tenant_id=connection.tenant_id)

    section_by_name = {s["name"].strip().lower(): s["code"] for s in standard_sections}
    folders_created = 0
    documents_imported = 0

    async def walk(item_id: str, path_segments: list[str]) -> None:
        nonlocal folders_created, documents_imported
        children = await sharepoint.list_children(client, connection.drive_id, item_id)
        parent_path = "/".join(path_segments)
        top_level = path_segments[0].strip().lower() if path_segments else ""

        for child in children:
            child_path_segments = path_segments + [child.name]
            child_path = "/".join(child_path_segments)

            if child.is_folder:
                child_top_level = child_path_segments[0].strip().lower()
                section_code = section_by_name.get(child_top_level) or section_by_name.get(top_level) or "01_CORPORATE"
                existing = (
                    await db.execute(
                        text("""
                            SELECT id FROM finance.data_room_folders
                            WHERE organization_id = :org_id AND folder_path = :folder_path AND is_deleted = false
                        """),
                        {"org_id": organization_id, "folder_path": child_path},
                    )
                ).first()
                if not existing:
                    await db.execute(
                        text("""
                            INSERT INTO finance.data_room_folders (
                                organization_id, parent_path, folder_name, folder_path, section_code,
                                provider_drive_id, provider_item_id, created_by
                            ) VALUES (
                                :org_id, :parent_path, :folder_name, :folder_path, :section_code,
                                :drive_id, :item_id, :created_by
                            ) ON CONFLICT (organization_id, folder_path) DO UPDATE
                            SET provider_drive_id = EXCLUDED.provider_drive_id, provider_item_id = EXCLUDED.provider_item_id
                        """),
                        {
                            "org_id": organization_id, "parent_path": parent_path, "folder_name": child.name,
                            "folder_path": child_path, "section_code": section_code,
                            "drive_id": connection.drive_id, "item_id": child.item_id, "created_by": actor_id,
                        },
                    )
                    folders_created += 1
                else:
                    await db.execute(
                        text("""
                            UPDATE finance.data_room_folders
                            SET provider_drive_id = :drive_id, provider_item_id = :item_id
                            WHERE organization_id = :org_id AND folder_path = :folder_path AND is_deleted = false
                        """),
                        {"drive_id": connection.drive_id, "item_id": child.item_id, "org_id": organization_id, "folder_path": child_path},
                    )
                await walk(child.item_id, child_path_segments)
                continue

            already_known = (
                await db.execute(
                    text("""
                        SELECT id FROM finance.data_room_documents
                        WHERE organization_id = :org_id AND provider = 'sharepoint' AND provider_item_id = :item_id
                          AND is_deleted = false
                    """),
                    {"org_id": organization_id, "item_id": child.item_id},
                )
            ).first()
            if already_known:
                continue

            section_code = section_by_name.get(top_level, "01_CORPORATE")
            title = child.name.rsplit(".", 1)[0] if "." in child.name else child.name

            await db.execute(
                text("""
                    INSERT INTO finance.data_room_documents (
                        organization_id, folder_path, title, section_code, file_name, file_size_bytes,
                        storage_path, provider, provider_drive_id, provider_item_id,
                        sharepoint_web_url, sharepoint_etag, verification_status, sync_status,
                        last_synced_at, created_by
                    ) VALUES (
                        :org_id, :folder_path, :title, :section_code, :file_name, :file_size_bytes,
                        :storage_path, 'sharepoint', :drive_id, :item_id,
                        :web_url, :etag, 'unverified', 'synced',
                        NOW(), :created_by
                    )
                    ON CONFLICT (organization_id, provider_item_id) WHERE provider = 'sharepoint' AND is_deleted = false
                    DO NOTHING
                """),
                {
                    "org_id": organization_id, "folder_path": parent_path, "title": title,
                    "section_code": section_code, "file_name": child.name,
                    "file_size_bytes": child.size_bytes or 0,
                    "storage_path": child.web_url, "drive_id": connection.drive_id, "item_id": child.item_id,
                    "web_url": child.web_url, "etag": child.etag, "created_by": actor_id,
                },
            )
            documents_imported += 1

    await walk(connection.root_item_id, [])
    await db.execute(
        text("""
            UPDATE core.organisation_integrations
            SET last_synced_at = NOW(), updated_at = NOW()
            WHERE organization_id = :org_id AND provider = 'microsoft365'
        """),
        {"org_id": organization_id},
    )
    return {"folders_created": folders_created, "documents_imported": documents_imported}
