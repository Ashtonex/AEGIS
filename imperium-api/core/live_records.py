"""Row loaders for live push that carries the row itself.

Most live tables send a bare "table changed" ping, and the page refetches over
REST. Through the Vercel proxy that costs about 0.4 s of debounce plus 0.7 s
per call, too slow for a message or a photo to feel instant. For the tables
registered here, each worker loads the changed row once, using the same query
the REST endpoint uses, and pushes it whole to the sockets allowed to see it.

A loader returns None when there is nothing to push, for example when the
row is soft-deleted or was never visible. The event then goes out without
``data`` and clients fall back to a refetch.

pg_notify payloads cap at 8000 bytes, which is why the trigger sends only ids
and the row is read here. A loaded row has no such limit.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class LiveRecord:
    data: dict[str, Any]
    # When set, only sockets whose user may see this project receive it, the
    # same project-scope rule the REST endpoint applies (core/project_scope).
    project_id: Optional[str] = None


Loader = Callable[[AsyncSession, str, str], Awaitable[Optional[LiveRecord]]]


async def _load_communication(db: AsyncSession, org_id: str, row_id: str) -> Optional[LiveRecord]:
    # Same projection as GET /crm-communications/ (list_communications).
    row = (
        await db.execute(
            text("""
            SELECT ce.*,
                   actor.full_name AS actor_name,
                   actor.email AS actor_email,
                   recipient.full_name AS recipient_name,
                   recipient.email AS recipient_email,
                   c.contact_name,
                   l.company_name AS lead_company,
                   o.name AS opportunity_name
            FROM crm.communication_events ce
            LEFT JOIN core.users actor ON actor.id=ce.actor_user_id
            LEFT JOIN core.users recipient ON recipient.id=ce.recipient_user_id
            LEFT JOIN crm.contacts c ON c.id=ce.contact_id AND c.organization_id=ce.organization_id
            LEFT JOIN crm.leads l ON l.id=ce.lead_id AND l.organization_id=ce.organization_id
            LEFT JOIN crm.opportunities o ON o.id=ce.opportunity_id AND o.organization_id=ce.organization_id
            WHERE ce.id = CAST(:row_id AS uuid) AND ce.organization_id = CAST(:org_id AS uuid)
              AND ce.is_deleted = false
        """),
            {"row_id": row_id, "org_id": org_id},
        )
    ).mappings().first()
    return LiveRecord(dict(row)) if row else None


async def _load_document(db: AsyncSession, org_id: str, row_id: str) -> Optional[LiveRecord]:
    # Same projection as GET /documents/ (list_documents): org-wide, no
    # project scope, matching what that endpoint returns.
    row = (
        await db.execute(
            text("""
            SELECT d.* FROM core.documents d
            WHERE d.id = CAST(:row_id AS uuid) AND d.organization_id = CAST(:org_id AS uuid)
              AND d.is_deleted = false
        """),
            {"row_id": row_id, "org_id": org_id},
        )
    ).mappings().first()
    return LiveRecord(dict(row)) if row else None


async def _load_report_evidence(db: AsyncSession, org_id: str, row_id: str) -> Optional[LiveRecord]:
    # Imported here: routers import core, so a module-level import would loop.
    from routers.site_reports import load_report_evidence

    items = await load_report_evidence(db, org_id, link_id=row_id)
    if not items:
        return None
    item = items[0]
    return LiveRecord(item, project_id=item.get("project_id"))


LOADERS: dict[str, Loader] = {
    "crm.communication_events": _load_communication,
    "core.documents": _load_document,
    "core.document_links": _load_report_evidence,
}
