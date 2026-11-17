"""Project workspaces in Microsoft 365.

When a project becomes active AEGIS sets up, in the connected SharePoint site:

    03_PROJECTS/{code - name}/01 Contract .. 10 Completion   (routing.py template)

and, once an admin has linked the "projects" Team and granted the app
Channel.Create + TeamsTab.Create, a channel in that Team named after the
project with three tabs: Project Files (the folder), AEGIS (the project page)
and Site Diary (the workbook below).

Day by day, the background job (app/workers/arq_worker.py) then:

* copies every site photo / delivery docket attached to a daily report from
  Supabase Storage into 08 Photos/{date}/ or 05 Site Reports/{date}/ - the
  Supabase file stays the one AEGIS serves; the copy is recorded on
  core.file_attachments.mirror_*;
* republishes 05 Site Reports/Site Diary - {project}.xlsx, one row per daily
  report (status, people, hours, plant, value of materials used, targets
  done, work done, delays, photos), when any report changed.

Only uses the site AEGIS already has (Sites.Selected) for files. Teams calls
fail with 403 until the admin grants the Teams permissions; that is recorded
as channel_status='needs_permission' and retried, never treated as an error
for the folders or copies.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import supabase
from core.logging import logger
from app.services.microsoft import sharepoint
from app.services.microsoft.auth import get_access_token, invalidate_cached_token
from app.services.microsoft.errors import GraphError, GraphPermissionError
from app.services.microsoft.graph_client import GraphClient
from app.services.microsoft.routing import LIBRARY_PROJECTS, PROJECT_FOLDER_TEMPLATE
from app.services.microsoft.types import GraphDriveItem

EVIDENCE_BUCKET = "documents"
PHOTOS_FOLDER = "08 Photos"
SITE_REPORTS_FOLDER = "05 Site Reports"
WEB_TAB_APP = "com.microsoft.teamspace.tab.web"
TEAMS_PERMISSIONS = ("Channel.Create", "TeamsTab.Create", "Channel.ReadBasic.All")
MAX_MIRROR_ATTEMPTS = 6
MIRROR_BATCH = 25

# SharePoint rejects these in folder / file names; Teams is stricter for
# channel names (see _channel_name).
_SP_BAD = re.compile(r'["*:<>?/\\|#%]')
_CHANNEL_BAD = re.compile(r"[~#%&*{}+/\\:<>?|'\",]")


class WorkspaceNotReady(Exception):
    """Project workspaces are off, or the SharePoint side is not mapped."""


@dataclass
class Connection:
    tenant_id: Optional[str]
    drive_id: str
    projects_root_item_id: str
    team_id: Optional[str]


def _clean_sp_name(value: str) -> str:
    cleaned = _SP_BAD.sub("-", value or "").strip().strip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:120] or "Project"


def project_folder_name(project_code: Optional[str], project_name: Optional[str]) -> str:
    code = (project_code or "").strip()
    name = (project_name or "").strip()
    return _clean_sp_name(f"{code} - {name}" if code and name else (name or code or "Project"))


def _channel_name(project_code: Optional[str], project_name: Optional[str]) -> str:
    raw = project_folder_name(project_code, project_name)
    cleaned = _CHANNEL_BAD.sub(" ", raw).replace("..", ".")
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lstrip("_.").rstrip(".")
    return cleaned[:50].rstrip() or "Project"


def project_page_url(project_id: UUID | str) -> str:
    base = settings.PUBLIC_APP_URL.strip().rstrip("/")
    return f"{base}/dashboard/projects/{project_id}"


async def load_connection(db: AsyncSession, org_id: str) -> Connection:
    row = (
        await db.execute(
            text("""
            SELECT tenant_id, drive_id, library_map, enabled, sync_documents,
                   sync_project_workspaces, projects_team_id
            FROM core.organisation_integrations
            WHERE organization_id = CAST(:org_id AS uuid) AND provider = 'microsoft365' AND is_deleted = false
        """),
            {"org_id": str(org_id)},
        )
    ).mappings().first()
    if not row or not row["enabled"] or not row["sync_project_workspaces"]:
        raise WorkspaceNotReady("Project workspaces in Microsoft 365 are switched off.")
    root = (row["library_map"] or {}).get(LIBRARY_PROJECTS)
    if not row["drive_id"] or not root:
        raise WorkspaceNotReady("The 03_PROJECTS SharePoint library is not mapped yet.")
    return Connection(
        tenant_id=row["tenant_id"] or settings.MICROSOFT_GRAPH_TENANT_ID,
        drive_id=row["drive_id"],
        projects_root_item_id=root,
        team_id=row["projects_team_id"] or None,
    )


async def granted_app_roles(tenant_id: Optional[str]) -> list[str]:
    """The application permissions in the app's current access token (its
    'roles' claim). Only the permission names leave this function."""
    token = await get_access_token(tenant_id)
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        return sorted(str(r) for r in claims.get("roles", []))
    except Exception:  # noqa: BLE001 - an unreadable token just means "unknown"
        return []


# --------------------------------------------------------------------------
# Workspace (folders, channel, tabs)
# --------------------------------------------------------------------------


async def _project(db: AsyncSession, org_id: str, project_id: UUID | str) -> dict:
    row = (
        await db.execute(
            text("""
            SELECT id, project_code, name, status FROM projects.projects
            WHERE id = CAST(:id AS uuid) AND organization_id = CAST(:org_id AS uuid) AND is_deleted = false
        """),
            {"id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().first()
    if not row:
        raise WorkspaceNotReady("Project not found.")
    return dict(row)


async def get_workspace(db: AsyncSession, org_id: str, project_id: UUID | str) -> Optional[dict]:
    row = (
        await db.execute(
            text("""
            SELECT * FROM projects.project_m365_workspaces
            WHERE organization_id = CAST(:org_id AS uuid) AND project_id = CAST(:project_id AS uuid)
        """),
            {"org_id": str(org_id), "project_id": str(project_id)},
        )
    ).mappings().first()
    return dict(row) if row else None


async def _save_workspace(db: AsyncSession, org_id: str, project_id: UUID | str, **values: Any) -> None:
    columns = list(values.keys())
    params = {k: (json.dumps(v) if k == "tabs_installed" else v) for k, v in values.items()}
    params.update({"org_id": str(org_id), "project_id": str(project_id)})
    insert_cols = ", ".join(["organization_id", "project_id", *columns])
    insert_vals = ", ".join(
        ["CAST(:org_id AS uuid)", "CAST(:project_id AS uuid)"]
        + [f"CAST(:{c} AS jsonb)" if c == "tabs_installed" else f":{c}" for c in columns]
    )
    updates = ", ".join(
        [f"{c} = EXCLUDED.{c}" for c in columns] + ["updated_at = NOW()"]
    )
    await db.execute(
        text(f"""
        INSERT INTO projects.project_m365_workspaces ({insert_cols})
        VALUES ({insert_vals})
        ON CONFLICT (organization_id, project_id) DO UPDATE SET {updates}
    """),  # nosec B608 - column names come from this module's own keyword arguments
        params,
    )


async def _ensure_folders(client: GraphClient, conn: Connection, folder_name: str) -> GraphDriveItem:
    project_folder = await sharepoint.ensure_folder(client, conn.drive_id, conn.projects_root_item_id, folder_name)
    existing = {c.name.strip().lower() for c in await sharepoint.list_children(client, conn.drive_id, project_folder.item_id) if c.is_folder}
    for sub in PROJECT_FOLDER_TEMPLATE:
        if sub.lower() not in existing:
            await sharepoint.ensure_folder(client, conn.drive_id, project_folder.item_id, sub)
    return project_folder


async def _find_channel(client: GraphClient, team_id: str, name: str) -> Optional[dict]:
    channels = await client.get_all_pages(f"teams/{team_id}/channels")
    for ch in channels:
        if (ch.get("displayName") or "").strip().lower() == name.strip().lower():
            return ch
    return None


async def _ensure_channel(client: GraphClient, team_id: str, name: str, description: str) -> dict:
    try:
        return await client.post(
            f"teams/{team_id}/channels",
            # isFavoriteByDefault = "Recommended": shows the channel in every
            # member's list. Without it Teams files app-created channels under
            # Hidden and nobody sees them.
            json={
                "displayName": name, "description": description[:1024],
                "membershipType": "standard", "isFavoriteByDefault": True,
            },
        )
    except GraphError as exc:
        # 400/409 when a channel of that name already exists (e.g. created by
        # hand, or a previous run whose response was lost): reuse it.
        if getattr(exc, "status_code", None) in (400, 409):
            found = await _find_channel(client, team_id, name)
            if found:
                return found
        raise


async def _ensure_web_tab(
    client: GraphClient, team_id: str, channel_id: str, installed: list[str], name: str, url: Optional[str]
) -> bool:
    if not url or name in installed:
        return False
    await client.post(
        f"teams/{team_id}/channels/{channel_id}/tabs",
        json={
            "displayName": name,
            "teamsApp@odata.bind": f"{settings.MICROSOFT_GRAPH_BASE_URL.rstrip('/')}/appCatalogs/teamsApps/{WEB_TAB_APP}",
            "configuration": {"entityId": None, "contentUrl": url, "websiteUrl": url, "removeUrl": None},
        },
    )
    installed.append(name)
    return True


async def ensure_workspace(db: AsyncSession, org_id: str, project_id: UUID | str) -> dict:
    """Idempotent. Folders first (works with today's permissions); then the
    channel and tabs when a Team is linked. Commits nothing - caller owns the
    transaction."""
    conn = await load_connection(db, org_id)
    project = await _project(db, org_id, project_id)
    client = GraphClient(tenant_id=conn.tenant_id)
    current = await get_workspace(db, org_id, project_id) or {}
    now = datetime.now(timezone.utc)

    folder_name = project_folder_name(project["project_code"], project["name"])
    try:
        if current.get("folder_item_id") and current.get("folders_ready_at") and current.get("folder_name") == folder_name:
            folder_item_id, folder_web_url = current["folder_item_id"], current["folder_web_url"]
        else:
            folder = await _ensure_folders(client, conn, folder_name)
            folder_item_id, folder_web_url = folder.item_id, folder.web_url
            await _save_workspace(
                db, org_id, project_id, folder_name=folder_name, folder_drive_id=conn.drive_id,
                folder_item_id=folder_item_id, folder_web_url=folder_web_url, folders_ready_at=now,
                last_attempt_at=now, last_error=None,
            )
    except GraphError as exc:
        await _save_workspace(db, org_id, project_id, last_attempt_at=now, last_error=f"Folders: {exc}"[:2000])
        raise

    if not conn.team_id:
        await _save_workspace(db, org_id, project_id, channel_status="not_linked", last_attempt_at=now)
        return await get_workspace(db, org_id, project_id) or {}

    installed = list(current.get("tabs_installed") or [])
    if current.get("team_id") and current.get("team_id") != conn.team_id:
        # The Team was changed: set the project up again in the new one.
        current = {**current, "channel_id": None}
        installed = []
    channel_name = _channel_name(project["project_code"], project["name"])
    try:
        channel_id = current.get("channel_id")
        channel_web_url = current.get("channel_web_url")
        if not channel_id:
            channel = await _ensure_channel(
                client, conn.team_id, channel_name,
                f"AEGIS project workspace for {folder_name}. Files, site photos and the Site Diary are kept in sync by AEGIS.",
            )
            channel_id, channel_web_url = channel["id"], channel.get("webUrl")
        await _ensure_web_tab(client, conn.team_id, channel_id, installed, "Project Files", folder_web_url)
        await _ensure_web_tab(client, conn.team_id, channel_id, installed, "AEGIS", project_page_url(project_id))
        await _ensure_web_tab(client, conn.team_id, channel_id, installed, "Site Diary", current.get("diary_web_url"))
        await _save_workspace(
            db, org_id, project_id, channel_status="ready", team_id=conn.team_id, channel_id=channel_id,
            channel_name=channel_name, channel_web_url=channel_web_url, tabs_installed=installed,
            last_attempt_at=now, last_error=None,
        )
    except GraphPermissionError as exc:
        # Permissions granted after the cached app token was issued only show
        # up in a new token, so drop it and let the next attempt fetch one.
        invalidate_cached_token(conn.tenant_id)
        detail = f"HTTP {exc.status_code}" + (f" {exc.graph_code}" if exc.graph_code else "") + f": {exc}"
        await _save_workspace(
            db, org_id, project_id, channel_status="needs_permission", team_id=conn.team_id,
            tabs_installed=installed, last_attempt_at=now,
            last_error=f"Microsoft refused the Teams request ({detail})"[:2000],
        )
    except GraphError as exc:
        await _save_workspace(
            db, org_id, project_id, channel_status="failed", team_id=conn.team_id,
            tabs_installed=installed, last_attempt_at=now, last_error=f"Teams: {exc}"[:2000],
        )
    return await get_workspace(db, org_id, project_id) or {}


async def _subfolder(client: GraphClient, conn: Connection, workspace: dict, segments: list[str]) -> str:
    folder = await sharepoint.ensure_folder_path(client, conn.drive_id, workspace["folder_item_id"], segments)
    return folder.item_id


# --------------------------------------------------------------------------
# Site evidence copies
# --------------------------------------------------------------------------


async def _download_from_storage(path: str) -> bytes:
    return await asyncio.to_thread(supabase.storage.from_(EVIDENCE_BUCKET).download, path)


async def mirror_pending_evidence(db: AsyncSession, org_id: str, *, limit: int = MIRROR_BATCH) -> dict:
    """Copies site photos / dockets not yet in SharePoint. Each file commits
    on its own so one bad file never holds the rest back."""
    conn = await load_connection(db, org_id)
    rows = (
        await db.execute(
            text("""
            SELECT DISTINCT ON (fa.id)
                   fa.id AS attachment_id, fa.storage_path, fa.file_name, fa.mime_type, fa.mirror_attempts,
                   d.id AS document_id, dl.link_role, r.report_date, r.project_id
            FROM core.document_links dl
            JOIN core.documents d ON d.id = dl.document_id AND d.organization_id = dl.organization_id AND d.is_deleted = false
            JOIN core.file_attachments fa ON fa.id = d.file_attachment_id AND fa.is_deleted = false
            JOIN projects.daily_site_reports r ON r.id = dl.entity_id AND r.is_deleted = false
            JOIN projects.project_m365_workspaces w
              ON w.organization_id = dl.organization_id AND w.project_id = r.project_id AND w.folders_ready_at IS NOT NULL
            WHERE dl.organization_id = CAST(:org_id AS uuid) AND dl.entity_type = 'daily_site_report'
              AND dl.is_deleted = false AND COALESCE(fa.provider, 'supabase') = 'supabase'
              AND fa.storage_path LIKE 'site-evidence/%'
              AND (fa.mirror_status IS NULL OR fa.mirror_status IN ('pending', 'failed'))
              AND fa.mirror_attempts < :max_attempts
            ORDER BY fa.id, dl.linked_at
            LIMIT :limit
        """),
            {"org_id": str(org_id), "max_attempts": MAX_MIRROR_ATTEMPTS, "limit": limit},
        )
    ).mappings().all()
    client = GraphClient(tenant_id=conn.tenant_id)
    copied = failed = 0
    for row in rows:
        try:
            workspace = await get_workspace(db, org_id, row["project_id"])
            day = row["report_date"].isoformat() if isinstance(row["report_date"], date) else str(row["report_date"])
            top = SITE_REPORTS_FOLDER if row["link_role"] == "delivery_docket" else PHOTOS_FOLDER
            parent_id = await _subfolder(client, conn, workspace, [top, day])
            content = await _download_from_storage(row["storage_path"])
            name = _clean_sp_name(f"{str(row['attachment_id'])[:8]} {row['file_name'] or 'site-file'}")
            uploader = sharepoint.upload_small_file if len(content) <= sharepoint.SIMPLE_UPLOAD_MAX_BYTES else sharepoint.upload_large_file
            item = await uploader(client, conn.drive_id, parent_id, name, content, row["mime_type"] or "application/octet-stream")
            await db.execute(
                text("""
                UPDATE core.file_attachments
                SET mirror_status = 'synced', mirror_item_id = :item_id, mirror_web_url = :web_url,
                    mirror_error = NULL, mirrored_at = NOW(), mirror_attempts = mirror_attempts + 1
                WHERE id = :id
            """),
                {"id": row["attachment_id"], "item_id": item.item_id, "web_url": item.web_url},
            )
            await db.commit()
            copied += 1
        except Exception as exc:  # noqa: BLE001 - recorded per file, retried next run
            await db.rollback()
            logger.warning(f"Site evidence copy to SharePoint failed for {row['attachment_id']}: {exc}")
            await db.execute(
                text("""
                UPDATE core.file_attachments
                SET mirror_status = 'failed', mirror_error = :err, mirror_attempts = mirror_attempts + 1
                WHERE id = :id
            """),
                {"id": row["attachment_id"], "err": str(exc)[:2000]},
            )
            await db.commit()
            failed += 1
    return {"copied": copied, "failed": failed}


# --------------------------------------------------------------------------
# Site Diary workbook
# --------------------------------------------------------------------------

DIARY_HEADERS = [
    "Date", "Status", "Shift", "People", "Labour hours", "Plant hours", "Fuel (L)",
    "Materials used ($)", "Targets done", "Work completed", "Delays / weather", "Safety notes",
    "Photos", "Dockets", "Day folder",
]
DIARY_WIDTHS = [12, 11, 9, 8, 12, 11, 9, 15, 12, 60, 40, 40, 8, 8, 40]


async def _diary_rows(db: AsyncSession, org_id: str, project_id: UUID | str) -> list[dict]:
    rows = (
        await db.execute(
            text("""
            SELECT r.id, r.report_date, r.status, r.shift, r.actual_work, r.delays, r.safety_notes, r.updated_at,
                   COALESCE(l.people, 0) AS people, COALESCE(l.hours, 0) AS labour_hours,
                   COALESCE(e.hours, 0) AS plant_hours, COALESCE(e.fuel, 0) AS fuel,
                   COALESCE(m.value, 0) AS materials_value,
                   COALESCE(t.done, 0) AS targets_done, COALESCE(t.total, 0) AS targets_total,
                   COALESCE(ev.photos, 0) AS photos, COALESCE(ev.dockets, 0) AS dockets
            FROM projects.daily_site_reports r
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS people, SUM(COALESCE(regular_hours, 0) + COALESCE(overtime_hours, 0)) AS hours
                FROM projects.daily_report_labour WHERE report_id = r.id AND is_deleted = false
            ) l ON true
            LEFT JOIN LATERAL (
                SELECT SUM(COALESCE(operating_hours, 0)) AS hours, SUM(COALESCE(fuel_litres, 0)) AS fuel
                FROM projects.daily_report_equipment WHERE report_id = r.id AND is_deleted = false
            ) e ON true
            LEFT JOIN LATERAL (
                SELECT SUM(COALESCE(quantity_used, 0) * COALESCE(unit_cost, 0)) AS value
                FROM projects.daily_report_materials WHERE report_id = r.id AND is_deleted = false
            ) m ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(*) FILTER (WHERE achieved_qty > 0) AS done, COUNT(*) AS total
                FROM projects.site_daily_targets
                WHERE organization_id = r.organization_id AND project_id = r.project_id
                  AND target_date = r.report_date AND is_deleted = false
            ) t ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(*) FILTER (WHERE link_role <> 'delivery_docket') AS photos,
                       COUNT(*) FILTER (WHERE link_role = 'delivery_docket') AS dockets
                FROM core.document_links
                WHERE organization_id = r.organization_id AND entity_type = 'daily_site_report'
                  AND entity_id = r.id AND is_deleted = false
            ) ev ON true
            WHERE r.organization_id = CAST(:org_id AS uuid) AND r.project_id = CAST(:project_id AS uuid)
              AND r.is_deleted = false
            ORDER BY r.report_date DESC, r.shift
        """),
            {"org_id": str(org_id), "project_id": str(project_id)},
        )
    ).mappings().all()
    return [dict(r) for r in rows]


def _num(value: Any) -> float:
    try:
        return float(Decimal(str(value or 0)))
    except Exception:  # noqa: BLE001
        return 0.0


def build_diary(project_label: str, rows: list[dict], folder_web_url: Optional[str], published_at: datetime) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Site Diary"
    ws.append(DIARY_HEADERS)
    for r in rows:
        day = r["report_date"]
        ws.append([
            day,
            str(r["status"] or "").title(),
            str(r["shift"] or ""),
            int(r["people"] or 0),
            round(_num(r["labour_hours"]), 2),
            round(_num(r["plant_hours"]), 2),
            round(_num(r["fuel"]), 1),
            round(_num(r["materials_value"]), 2),
            f"{int(r['targets_done'])} of {int(r['targets_total'])}" if r["targets_total"] else "",
            (r["actual_work"] or "").strip(),
            (r["delays"] or "").strip(),
            (r["safety_notes"] or "").strip(),
            int(r["photos"] or 0),
            int(r["dockets"] or 0),
            folder_web_url or "",
        ])
    header_fill = PatternFill("solid", fgColor="1F2937")
    for i, cell in enumerate(ws[1], start=1):
        cell.fill, cell.font = header_fill, Font(bold=True, color="FFFFFF")
        ws.column_dimensions[get_column_letter(i)].width = DIARY_WIDTHS[i - 1]
    for row in ws.iter_rows(min_row=2):
        row[0].number_format = "yyyy-mm-dd"
        row[7].number_format = '"$"#,##0.00'
        for idx in (9, 10, 11):
            row[idx].alignment = Alignment(wrap_text=True, vertical="top")
    if not rows:
        ws.append([None] * len(DIARY_HEADERS))
    ws.add_table(Table(
        displayName="SiteDiary",
        ref=f"A1:{get_column_letter(len(DIARY_HEADERS))}{max(2, len(rows) + 1)}",
        tableStyleInfo=TableStyleInfo(name="TableStyleMedium2", showRowStripes=True),
    ))
    ws.freeze_panes = "B2"
    ws.protection.sheet = True
    ws.protection.autoFilter = False
    ws.protection.sort = False

    about = wb.create_sheet("About")
    about.append([f"Site Diary - {project_label}"])
    about.append([f"Published by AEGIS {published_at.strftime('%Y-%m-%d %H:%M')} UTC. One row per daily site report, newest first."])
    about.append(["This file is rebuilt by AEGIS whenever a daily report changes; edits made here are overwritten. Make changes in AEGIS."])
    about.append(["Materials used is quantity used x the procurement price of each material."])
    about["A1"].font = Font(bold=True, size=14)
    about.column_dimensions["A"].width = 110
    about.protection.sheet = True
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _diary_signature(rows: list[dict], folder_web_url: Optional[str]) -> str:
    material = [
        [str(r[k]) for k in (
            "report_date", "status", "shift", "people", "labour_hours", "plant_hours", "fuel", "materials_value",
            "targets_done", "targets_total", "actual_work", "delays", "safety_notes", "photos", "dockets",
        )]
        for r in rows
    ]
    return hashlib.sha256(json.dumps([material, folder_web_url], default=str).encode()).hexdigest()


async def publish_diary(db: AsyncSession, org_id: str, project_id: UUID | str, *, force: bool = False) -> Optional[str]:
    """Rebuilds and uploads the project's Site Diary when its content changed.
    Returns 'published', 'unchanged' or None when the workspace isn't ready."""
    workspace = await get_workspace(db, org_id, project_id)
    if not workspace or not workspace.get("folders_ready_at"):
        return None
    conn = await load_connection(db, org_id)
    project = await _project(db, org_id, project_id)
    rows = await _diary_rows(db, org_id, project_id)
    signature = _diary_signature(rows, workspace.get("folder_web_url"))
    if not force and signature == workspace.get("diary_signature") and workspace.get("diary_item_id"):
        return "unchanged"
    label = project_folder_name(project["project_code"], project["name"])
    now = datetime.now(timezone.utc)
    content = build_diary(label, rows, workspace.get("folder_web_url"), now)
    client = GraphClient(tenant_id=conn.tenant_id)
    parent_id = await _subfolder(client, conn, workspace, [SITE_REPORTS_FOLDER])
    item = await sharepoint.upload_small_file(
        client, conn.drive_id, parent_id, _clean_sp_name(f"Site Diary - {label}.xlsx"), content,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    await _save_workspace(
        db, org_id, project_id, diary_item_id=item.item_id, diary_web_url=item.web_url,
        diary_signature=signature, diary_published_at=now,
    )
    return "published"


# --------------------------------------------------------------------------
# The background run
# --------------------------------------------------------------------------


async def organisations_enabled(db: AsyncSession) -> list[str]:
    rows = await db.execute(text("""
        SELECT organization_id FROM core.organisation_integrations
        WHERE provider = 'microsoft365' AND is_deleted = false AND enabled = true AND sync_project_workspaces = true
    """))
    return [str(r[0]) for r in rows]


async def run_for_organisation(db: AsyncSession, org_id: str) -> dict:
    """One pass: set up newly active projects (and retry Teams setup that is
    waiting on permissions, at most every 30 minutes), copy new site files,
    republish changed diaries. Commits as it goes."""
    summary: dict[str, Any] = {"set_up": 0, "teams_waiting": 0, "diaries": 0, "errors": []}
    conn = await load_connection(db, org_id)
    projects = (
        await db.execute(
            text("""
            SELECT p.id, w.folders_ready_at, w.channel_status, w.team_id, w.last_attempt_at, w.diary_web_url, w.tabs_installed
            FROM projects.projects p
            LEFT JOIN projects.project_m365_workspaces w
              ON w.organization_id = p.organization_id AND w.project_id = p.id
            WHERE p.organization_id = CAST(:org_id AS uuid) AND p.is_deleted = false AND p.status = 'active'
        """),
            {"org_id": org_id},
        )
    ).mappings().all()
    now = datetime.now(timezone.utc)
    for p in projects:
        needs_folders = not p["folders_ready_at"]
        team_pending = bool(conn.team_id) and (
            p["channel_status"] != "ready"
            or p["team_id"] != conn.team_id
            or (p["diary_web_url"] and "Site Diary" not in (p["tabs_installed"] or []))
        )
        recently_tried = p["last_attempt_at"] and (now - p["last_attempt_at"]).total_seconds() < 1800
        if needs_folders or (team_pending and not recently_tried):
            try:
                ws = await ensure_workspace(db, org_id, p["id"])
                await db.commit()
                summary["set_up"] += 1 if needs_folders else 0
                summary["teams_waiting"] += 1 if ws.get("channel_status") == "needs_permission" else 0
            except Exception as exc:  # noqa: BLE001 - recorded, retried next run
                await db.rollback()
                summary["errors"].append(f"{p['id']}: {exc}")
    try:
        summary.update(await mirror_pending_evidence(db, org_id))
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        summary["errors"].append(f"copies: {exc}")

    changed = (
        await db.execute(
            text("""
            SELECT w.project_id FROM projects.project_m365_workspaces w
            JOIN projects.projects p ON p.id = w.project_id AND p.is_deleted = false
            WHERE w.organization_id = CAST(:org_id AS uuid) AND w.folders_ready_at IS NOT NULL
              AND (w.diary_published_at IS NULL OR EXISTS (
                    SELECT 1 FROM projects.daily_site_reports r
                    WHERE r.project_id = w.project_id AND r.organization_id = w.organization_id
                      AND r.updated_at > w.diary_published_at)
                   OR EXISTS (
                    SELECT 1 FROM core.document_links dl
                    JOIN projects.daily_site_reports r2 ON r2.id = dl.entity_id
                    WHERE dl.organization_id = w.organization_id AND dl.entity_type = 'daily_site_report'
                      AND r2.project_id = w.project_id AND dl.linked_at > w.diary_published_at)
                   OR EXISTS (
                    SELECT 1 FROM projects.site_daily_targets t
                    WHERE t.organization_id = w.organization_id AND t.project_id = w.project_id
                      AND t.updated_at > w.diary_published_at))
        """),
            {"org_id": org_id},
        )
    ).all()
    for (project_id,) in changed:
        try:
            if await publish_diary(db, org_id, project_id) == "published":
                summary["diaries"] += 1
            await db.commit()
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            summary["errors"].append(f"diary {project_id}: {exc}")
    return summary
