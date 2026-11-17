"""Microsoft 365 setup wizard (Phase 24) - Settings > Integrations > Microsoft 365.

Every endpoint here is server-side administration of the connection: it
reads/writes core.organisation_integrations and talks to Graph using the
app-only service-principal credentials in core/config.py
(MICROSOFT_GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET) - never a value supplied
by the browser. No endpoint ever returns a client secret, certificate or
access token; only non-secret identifiers (site/drive/calendar IDs, display
names, connection status) leave this API.
"""

from __future__ import annotations

import json
import re
from urllib.parse import parse_qs, urlparse
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.logging import logger
from core.project_scope import require_project_access
from core.security import require_any_permission, require_permission
from app.shared.pagination import ok
from app.services.microsoft import calendar as ms_calendar
from app.services.microsoft import sharepoint
from app.services.microsoft.auth import invalidate_cached_token, is_configured
from app.services.microsoft.errors import GraphError
from app.services.microsoft.graph_client import GraphClient
from app.services.microsoft.routing import MODULE_LIBRARY_MAP
from app.services.microsoft import project_workspace

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ConnectSitePayload(Payload):
    site_id: str = Field(min_length=1, max_length=255)
    site_name: str = Field(min_length=1, max_length=255)
    site_web_url: str = Field(min_length=1, max_length=2048)
    drive_id: str = Field(min_length=1, max_length=255)
    tenant_id: Optional[str] = Field(default=None, max_length=120)


class LibraryMapPayload(Payload):
    # module key (see app/services/microsoft/routing.py MODULE_LIBRARY_MAP
    # library names, e.g. "01_FINANCE") -> the folder's driveItem id.
    library_map: dict[str, str] = Field(default_factory=dict)


class SelectCalendarPayload(Payload):
    calendar_owner_id: str = Field(min_length=1, max_length=255)
    calendar_id: str = Field(min_length=1, max_length=255)
    calendar_name: str = Field(min_length=1, max_length=255)
    is_group: bool = False
    calendar_timezone: str = Field(default="Africa/Harare", max_length=80)


class ProjectWorkspaceSettingsPayload(Payload):
    enabled: Optional[bool] = None
    # The Team that gets a channel per active project: its "Get link to team"
    # link or its group id. Empty string unlinks it.
    team: Optional[str] = Field(default=None, max_length=2048)
    team_name: Optional[str] = Field(default=None, max_length=255)


_GROUP_ID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _team_id_from(value: str) -> Optional[str]:
    value = value.strip()
    if not value:
        return None
    if value.startswith("http"):
        group = parse_qs(urlparse(value).query).get("groupId")
        if group and _GROUP_ID_RE.fullmatch(group[0]):
            return group[0]
        return None
    match = _GROUP_ID_RE.fullmatch(value)
    return match.group(0) if match else None


class TogglePayload(Payload):
    sync_documents: Optional[bool] = None
    sync_calendar: Optional[bool] = None
    sync_data_room: Optional[bool] = None


async def _get_row(db: AsyncSession, org_id: UUID) -> Optional[dict]:
    row = (
        await db.execute(
            text("""
                SELECT * FROM core.organisation_integrations
                WHERE organization_id = :org_id AND provider = 'microsoft365' AND is_deleted = false
            """),
            {"org_id": org_id},
        )
    ).mappings().first()
    return dict(row) if row else None


async def _require_row(db: AsyncSession, org_id: UUID) -> dict:
    row = await _get_row(db, org_id)
    if not row:
        raise HTTPException(status_code=404, detail="Microsoft 365 has not been connected yet - discover and select a SharePoint site first.")
    return row


def _client_for(row: dict) -> GraphClient:
    return GraphClient(tenant_id=row.get("tenant_id"))


@router.get("/status")
async def get_status(
    user: dict = Depends(require_permission("integrations.microsoft.read")),
    db: AsyncSession = Depends(get_db),
):
    """Never returns a secret - just enough for the wizard's status card
    (Phase 28's 'Connected / Healthy / Last sync / Pending / Failed')."""
    row = await _get_row(db, user["org_id"])
    pending_failed = (
        await db.execute(
            text("""
                SELECT
                    COUNT(*) FILTER (WHERE sync_status IN ('pending', 'syncing')) AS pending,
                    COUNT(*) FILTER (WHERE sync_status = 'failed') AS failed
                FROM core.file_attachments
                WHERE organization_id = :org_id AND provider = 'sharepoint' AND is_deleted = false
            """),
            {"org_id": user["org_id"]},
        )
    ).mappings().first()

    return ok({
        "app_registration_configured": is_configured(row.get("tenant_id") if row else None),
        "connected": bool(row and row["connection_status"] == "connected"),
        "connection_status": row["connection_status"] if row else "not_connected",
        "site_name": row.get("site_name") if row else None,
        "site_web_url": row.get("site_web_url") if row else None,
        "calendar_name": row.get("calendar_name") if row else None,
        "enabled": bool(row and row["enabled"]),
        "sync_documents": bool(row and row["sync_documents"]),
        "sync_calendar": bool(row and row["sync_calendar"]),
        "sync_data_room": bool(row and row["sync_data_room"]),
        "data_room_root_web_url": row.get("data_room_root_web_url") if row else None,
        "library_map": row.get("library_map") if row else {},
        "last_test_at": row.get("last_test_at") if row else None,
        "last_test_error": row.get("last_test_error") if row else None,
        "last_synced_at": row.get("last_synced_at") if row else None,
        "pending_document_syncs": int(pending_failed["pending"]) if pending_failed else 0,
        "failed_document_syncs": int(pending_failed["failed"]) if pending_failed else 0,
    }, "Microsoft 365 connection status retrieved.")


@router.post("/test-connection")
async def test_connection(
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Attempts a real, minimal Graph call (read the connected site, or - if
    not yet connected - the app registration's own /organization record) so
    'Test Connection' proves the credentials actually work, not just that
    they're present."""
    row = await _get_row(db, user["org_id"])
    tenant_id = row.get("tenant_id") if row else None

    if not is_configured(tenant_id):
        raise HTTPException(status_code=503, detail="Microsoft Graph app-only credentials are not configured on the server.")

    invalidate_cached_token(tenant_id)
    client = GraphClient(tenant_id=tenant_id)
    try:
        if row and row.get("site_id"):
            await client.get(f"sites/{row['site_id']}", params={"select": "id,displayName"})
        else:
            await client.get("organization", params={"$select": "id,displayName"})
        error_message = None
        connection_status = "connected"
    except GraphError as exc:
        error_message = str(exc)
        connection_status = "error"
        logger.warning("microsoft_graph.test_connection_failed", organization_id=str(user["org_id"]), error=error_message)

    if row:
        await db.execute(
            text("""
                UPDATE core.organisation_integrations
                SET connection_status = :status, last_test_at = NOW(), last_test_error = :error, updated_at = NOW()
                WHERE id = :id
            """),
            {"status": connection_status, "error": error_message, "id": row["id"]},
        )
        await db.commit()

    if error_message:
        raise HTTPException(status_code=502, detail=f"Microsoft Graph connection test failed: {error_message}")
    return ok({"connection_status": connection_status}, "Microsoft Graph connection verified.")


@router.get("/discover-sites")
async def discover_sites(
    query: str = Query(min_length=2, max_length=255),
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Phase 4/24's 'Discover SharePoint Site' step - search rather than
    guess a hostname, so the admin picks the exact SNC_Controlled_Data site
    from real results."""
    if not is_configured():
        raise HTTPException(status_code=503, detail="Microsoft Graph app-only credentials are not configured on the server.")
    client = GraphClient()
    try:
        sites = await sharepoint.search_sites(client, query)
    except GraphError as exc:
        raise HTTPException(status_code=502, detail=f"SharePoint site search failed: {exc}") from exc
    return ok([{"site_id": s.site_id, "name": s.name, "web_url": s.web_url} for s in sites], "Sites found.")


@router.get("/sites/{site_id}/libraries")
async def list_libraries(
    site_id: str,
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    if not is_configured():
        raise HTTPException(status_code=503, detail="Microsoft Graph app-only credentials are not configured on the server.")
    client = GraphClient()
    try:
        drives = await sharepoint.list_document_libraries(client, site_id)
    except GraphError as exc:
        raise HTTPException(status_code=502, detail=f"Listing SharePoint libraries failed: {exc}") from exc
    return ok([{"drive_id": d.drive_id, "name": d.name, "web_url": d.web_url} for d in drives], "Libraries found.")


@router.get("/drives/{drive_id}/folders")
async def list_top_level_folders(
    drive_id: str,
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Lists the folders directly under a library's root - what the
    'Select Document Libraries' step maps against AEGIS module keys (see
    app/services/microsoft/routing.py MODULE_LIBRARY_MAP)."""
    if not is_configured():
        raise HTTPException(status_code=503, detail="Microsoft Graph app-only credentials are not configured on the server.")
    client = GraphClient()
    try:
        children = await sharepoint.list_children(client, drive_id)
    except GraphError as exc:
        raise HTTPException(status_code=502, detail=f"Listing folders failed: {exc}") from exc
    folders = [c for c in children if c.is_folder]
    return ok(
        {
            "folders": [{"item_id": f.item_id, "name": f.name, "web_url": f.web_url} for f in folders],
            "recognised_module_libraries": sorted(set(MODULE_LIBRARY_MAP.values())),
        },
        "Folders found.",
    )


@router.post("/connect", status_code=status.HTTP_201_CREATED)
async def connect_site(
    payload: ConnectSitePayload,
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Persists the chosen site+library. Does not itself enable sync -
    'Select Document Libraries', 'Select Calendar' and an explicit
    enable/toggle step still need to happen before enabled=true."""
    row = await db.execute(
        text("""
            INSERT INTO core.organisation_integrations
                (organization_id, provider, tenant_id, site_id, site_name, site_web_url, drive_id, created_by)
            VALUES (:org_id, 'microsoft365', :tenant_id, :site_id, :site_name, :site_web_url, :drive_id, :user_id)
            ON CONFLICT (organization_id, provider) DO UPDATE SET
                tenant_id = EXCLUDED.tenant_id, site_id = EXCLUDED.site_id, site_name = EXCLUDED.site_name,
                site_web_url = EXCLUDED.site_web_url, drive_id = EXCLUDED.drive_id,
                connection_status = 'not_connected', updated_by = :user_id, updated_at = NOW(), is_deleted = false
            RETURNING *
        """),
        {
            "org_id": user["org_id"], "tenant_id": payload.tenant_id, "site_id": payload.site_id,
            "site_name": payload.site_name, "site_web_url": payload.site_web_url, "drive_id": payload.drive_id,
            "user_id": user.get("user_id") or user.get("sub"),
        },
    )
    saved = row.mappings().first()
    await db.commit()
    return ok(dict(saved), "SharePoint site connected. Next: map document libraries and select a calendar.")


@router.put("/library-map")
async def set_library_map(
    payload: LibraryMapPayload,
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = await _require_row(db, user["org_id"])
    updated = (
        await db.execute(
            text("""
                UPDATE core.organisation_integrations
                SET library_map = CAST(:library_map AS jsonb), updated_at = NOW()
                WHERE id = :id
                RETURNING *
            """),
            {"library_map": json.dumps(payload.library_map), "id": row["id"]},
        )
    ).mappings().first()
    await db.commit()
    return ok(dict(updated), "Document library mapping saved.")


@router.get("/calendars")
async def list_calendars(
    owner_id: str = Query(min_length=1, max_length=255),
    is_group: bool = Query(default=False),
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    """`owner_id` is the shared mailbox or Microsoft 365 Group's object ID or
    UPN, resolved by the admin ahead of time (see docs/microsoft365-phase1/
    SETUP_GUIDE.md for how to find it in the Microsoft 365 admin center)."""
    if not is_configured():
        raise HTTPException(status_code=503, detail="Microsoft Graph app-only credentials are not configured on the server.")
    client = GraphClient()
    try:
        calendars = await ms_calendar.list_calendars(client, owner_id, is_group=is_group)
    except GraphError as exc:
        raise HTTPException(status_code=502, detail=f"Listing calendars failed: {exc}") from exc
    return ok(
        [{"calendar_id": c.calendar_id, "name": c.name, "owner_address": c.owner_address} for c in calendars],
        "Calendars found.",
    )


@router.put("/calendar")
async def select_calendar(
    payload: SelectCalendarPayload,
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = await _require_row(db, user["org_id"])
    # calendar_owner_id encodes mailbox kind for calendar_service.py's
    # _load_connection: a UPN (contains '@') means a user/shared mailbox, a
    # bare GUID means a Microsoft 365 Group. Reject an ambiguous group UPN
    # up front rather than silently mis-resolving it later.
    if payload.is_group and "@" in payload.calendar_owner_id:
        raise HTTPException(status_code=400, detail="A group calendar owner must be the group's object ID, not a UPN.")

    updated = (
        await db.execute(
            text("""
                UPDATE core.organisation_integrations
                SET calendar_owner_id = :owner_id, calendar_id = :calendar_id, calendar_name = :calendar_name,
                    calendar_timezone = :timezone, updated_at = NOW()
                WHERE id = :id
                RETURNING *
            """),
            {
                "owner_id": payload.calendar_owner_id, "calendar_id": payload.calendar_id,
                "calendar_name": payload.calendar_name, "timezone": payload.calendar_timezone, "id": row["id"],
            },
        )
    ).mappings().first()
    await db.commit()
    return ok(dict(updated), "Calendar selected.")


@router.post("/permission-test")
async def permission_test(
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Phase 24's 'Run Permission Test' - proves the app registration's
    admin-consented permissions actually allow both a SharePoint read and a
    calendar read against the SPECIFIC connected resources, not just that
    authentication succeeds."""
    row = await _require_row(db, user["org_id"])
    client = _client_for(row)
    results: dict[str, Any] = {"sharepoint": None, "calendar": None}

    try:
        await sharepoint.list_children(client, row["drive_id"])
        results["sharepoint"] = {"ok": True}
    except GraphError as exc:
        results["sharepoint"] = {"ok": False, "error": str(exc)}

    if row.get("calendar_owner_id") and row.get("calendar_id"):
        try:
            is_group = "@" not in str(row["calendar_owner_id"])
            await ms_calendar.list_calendars(client, row["calendar_owner_id"], is_group=is_group)
            results["calendar"] = {"ok": True}
        except GraphError as exc:
            results["calendar"] = {"ok": False, "error": str(exc)}
    else:
        results["calendar"] = {"ok": False, "error": "No calendar selected yet."}

    return ok(results, "Permission test complete.")


@router.patch("/settings")
async def update_settings(
    payload: TogglePayload,
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = await _require_row(db, user["org_id"])
    if payload.sync_documents and not row.get("library_map"):
        raise HTTPException(status_code=400, detail="Map at least one document library before enabling document sync.")
    if payload.sync_calendar and not row.get("calendar_id"):
        raise HTTPException(status_code=400, detail="Select a calendar before enabling calendar sync.")
    # sync_data_room needs no library_map entry - the Financial Data Room
    # gets its own dedicated root folder in the connected drive, created
    # automatically on first use (see app/services/microsoft/
    # data_room_sync.py's _ensure_root_folder). It only needs the
    # site/drive connection this row already proves exists.

    sync_documents = payload.sync_documents if payload.sync_documents is not None else row["sync_documents"]
    sync_calendar = payload.sync_calendar if payload.sync_calendar is not None else row["sync_calendar"]
    sync_data_room = payload.sync_data_room if payload.sync_data_room is not None else row["sync_data_room"]
    updated = (
        await db.execute(
            text("""
                UPDATE core.organisation_integrations
                SET sync_documents = :sync_documents, sync_calendar = :sync_calendar,
                    sync_data_room = :sync_data_room,
                    enabled = (:sync_documents OR :sync_calendar OR :sync_data_room), updated_at = NOW()
                WHERE id = :id
                RETURNING *
            """),
            {
                "sync_documents": sync_documents, "sync_calendar": sync_calendar,
                "sync_data_room": sync_data_room, "id": row["id"],
            },
        )
    ).mappings().first()
    await db.commit()
    return ok(dict(updated), "Microsoft 365 sync settings updated.")


@router.post("/disconnect")
async def disconnect(
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Disables sync and clears the resource selection but keeps the row
    (soft, reversible) - documents already in SharePoint and past calendar
    events are untouched; nothing is deleted on the Microsoft side."""
    row = await _require_row(db, user["org_id"])
    await db.execute(
        text("""
            UPDATE core.organisation_integrations
            SET enabled = false, sync_documents = false, sync_calendar = false, sync_data_room = false,
                connection_status = 'not_connected', updated_at = NOW()
            WHERE id = :id
        """),
        {"id": row["id"]},
    )
    await db.commit()
    return ok({"disconnected": True}, "Microsoft 365 integration disconnected.")


# --------------------------------------------------------------------------
# Project workspaces (SharePoint folders + Teams channel per active project)
# --------------------------------------------------------------------------


@router.get("/project-workspaces")
async def project_workspaces_overview(
    user: dict = Depends(require_permission("integrations.microsoft.read")),
    db: AsyncSession = Depends(get_db),
):
    """Settings card: on/off, the linked Team, which Graph permissions the
    app holds (names only, read from its token) and each project's state."""
    row = await _get_row(db, user["org_id"])
    roles: list[str] = []
    roles_error = None
    if row:
        try:
            roles = await project_workspace.granted_app_roles(row.get("tenant_id"))
        except GraphError as exc:
            roles_error = str(exc)
    projects = (
        await db.execute(
            text("""
            SELECT p.id AS project_id, p.project_code, p.name, p.status,
                   w.folder_web_url, w.folders_ready_at, w.channel_status, w.channel_web_url,
                   w.diary_web_url, w.diary_published_at, w.last_error, w.last_attempt_at,
                   COALESCE(f.copied, 0) AS files_copied, COALESCE(f.failed, 0) AS files_failed
            FROM projects.projects p
            LEFT JOIN projects.project_m365_workspaces w
              ON w.organization_id = p.organization_id AND w.project_id = p.id
            LEFT JOIN LATERAL (
                SELECT COUNT(*) FILTER (WHERE fa.mirror_status = 'synced') AS copied,
                       COUNT(*) FILTER (WHERE fa.mirror_status = 'failed') AS failed
                FROM core.document_links dl
                JOIN projects.daily_site_reports r ON r.id = dl.entity_id
                JOIN core.documents d ON d.id = dl.document_id
                JOIN core.file_attachments fa ON fa.id = d.file_attachment_id
                WHERE dl.organization_id = p.organization_id AND dl.entity_type = 'daily_site_report'
                  AND dl.is_deleted = false AND r.project_id = p.id
            ) f ON true
            WHERE p.organization_id = :org_id AND p.is_deleted = false
              AND (p.status = 'active' OR w.id IS NOT NULL)
            ORDER BY p.status <> 'active', p.name
        """),
            {"org_id": user["org_id"]},
        )
    ).mappings().all()
    missing = [perm for perm in project_workspace.TEAMS_PERMISSIONS if perm not in roles]
    return ok({
        "enabled": bool(row and row.get("sync_project_workspaces")),
        "sharepoint_ready": bool(row and row.get("drive_id") and (row.get("library_map") or {}).get("03_PROJECTS")),
        "team_id": row.get("projects_team_id") if row else None,
        "team_name": row.get("projects_team_name") if row else None,
        "granted_permissions": roles,
        "permissions_error": roles_error,
        "teams_permissions_needed": list(project_workspace.TEAMS_PERMISSIONS),
        "teams_permissions_missing": missing,
        "projects": [dict(p) for p in projects],
    }, "Project workspaces retrieved.")


@router.patch("/project-workspaces/settings")
async def update_project_workspace_settings(
    payload: ProjectWorkspaceSettingsPayload,
    user: dict = Depends(require_permission("integrations.microsoft.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = await _require_row(db, user["org_id"])
    values: dict[str, Any] = {}
    if payload.enabled is not None:
        if payload.enabled and not (row.get("library_map") or {}).get("03_PROJECTS"):
            raise HTTPException(status_code=400, detail="Map the 03_PROJECTS SharePoint library before switching project workspaces on.")
        values["sync_project_workspaces"] = payload.enabled
    if payload.team is not None:
        team_id = _team_id_from(payload.team)
        if payload.team.strip() and not team_id:
            raise HTTPException(
                status_code=422,
                detail="That isn't a Team link. In Teams open the Team's ... menu, choose Get link to team, and paste that link.",
            )
        values["projects_team_id"] = team_id
        values["projects_team_name"] = (payload.team_name or None) if team_id else None
    if not values:
        return ok({"updated": False}, "Nothing to change.")
    sets = ", ".join(f"{k} = :{k}" for k in values)
    await db.execute(
        text(f"UPDATE core.organisation_integrations SET {sets}, updated_at = NOW() WHERE id = :id"),  # nosec B608 - keys are fixed above
        {**values, "id": row["id"]},
    )
    await db.commit()
    return ok({"updated": True, **values}, "Project workspace settings saved.")


@router.post("/project-workspaces/{project_id}/sync")
async def sync_project_workspace(
    project_id: UUID,
    user: dict = Depends(require_any_permission("integrations.microsoft.manage", "projects.update")),
    db: AsyncSession = Depends(get_db),
):
    """Set up / repair one project's workspace now and republish its diary,
    instead of waiting for the next background run."""
    await require_project_access(db, user, project_id)
    try:
        workspace = await project_workspace.ensure_workspace(db, user["org_id"], project_id)
        await db.commit()
        await project_workspace.publish_diary(db, user["org_id"], project_id, force=True)
        await db.commit()
        if workspace.get("channel_status") == "ready":
            # Adds the Site Diary tab now that the diary exists.
            await project_workspace.ensure_workspace(db, user["org_id"], project_id)
            await db.commit()
    except project_workspace.WorkspaceNotReady as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except GraphError as exc:
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"Microsoft 365 refused the request: {exc}")
    return ok(await project_workspace.get_workspace(db, user["org_id"], project_id), "Project workspace synced.")


@router.get("/project-workspaces/{project_id}")
async def get_project_workspace(
    project_id: UUID,
    user: dict = Depends(require_any_permission("projects.read", "projects.read_all", "integrations.microsoft.read")),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(db, user, project_id)
    row = await _get_row(db, user["org_id"])
    workspace = await project_workspace.get_workspace(db, user["org_id"], project_id)
    return ok({
        "enabled": bool(row and row.get("sync_project_workspaces")),
        "team_linked": bool(row and row.get("projects_team_id")),
        "workspace": workspace,
    }, "Project workspace retrieved.")
