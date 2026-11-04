"""Public procurement notices: the SNC tenders shown on the website.

Rows live in procurement.public_notices (migration 283); triggers create one
when an RFQ or purchase order is issued. The public status is derived here,
when a notice is read, from its RFQ, its purchase orders and when anything
last moved - so it can never drift out of step with the orders themselves.

The public payload carries title, RFQ description, project, dates and status
only: never amounts, supplier names or PO notes.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.documents.branding import PROCUREMENT_EMAIL

DORMANT_AFTER = timedelta(days=30)

STATUS_LABELS = {
    "open": "Active",
    "evaluating": "Under evaluation",
    "awarded": "Awarded",
    "in_delivery": "In delivery",
    "fulfilled": "Fulfilled",
    "dormant": "Dormant",
    "cancelled": "Cancelled",
}

STATUS_DESCRIPTIONS = {
    "open": "Quotations are being accepted until the closing date.",
    "evaluating": "The closing date has passed and quotations are being evaluated.",
    "awarded": "A purchase order has been issued and the supply is in progress.",
    "in_delivery": "Goods or services are being delivered against the order.",
    "fulfilled": "The order has been delivered in full.",
    "dormant": "No movement on this notice for 30 days or more.",
    "cancelled": "This procurement was cancelled.",
}

ISSUED_PO = {"issued", "partially_received", "received", "invoiced", "closed"}
DELIVERED_PO = {"received", "invoiced", "closed"}


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def derive_status(
    *,
    rfq_status: Optional[str],
    closing_date: Optional[datetime],
    po_statuses: Iterable[str],
    last_activity_at: Optional[datetime],
    now: Optional[datetime] = None,
) -> str:
    """Public status key (see STATUS_LABELS) for a notice.

    rfq_status: None for a direct-PO notice. po_statuses: statuses of the
    notice's issued purchase orders (cancelled included)."""
    now = _aware(now) or datetime.now(timezone.utc)
    closing_date = _aware(closing_date)
    statuses = [str(s) for s in po_statuses or []]
    live = [s for s in statuses if s in ISSUED_PO]
    # Closing date counts as movement: an RFQ is not stale while it is still open.
    last = max(filter(None, [_aware(last_activity_at), closing_date if closing_date and closing_date <= now else None]),
               default=None)
    stale = last is not None and now - last >= DORMANT_AFTER

    if live:
        if all(s in DELIVERED_PO for s in live):
            return "fulfilled"
        moving = "in_delivery" if any(s in DELIVERED_PO or s == "partially_received" for s in live) else "awarded"
        return "dormant" if stale else moving
    if rfq_status is None or rfq_status == "cancelled" or (statuses and rfq_status != "issued"):
        # Direct PO that is not live any more, a cancelled RFQ, or an RFQ whose
        # orders were all cancelled after it closed.
        return "cancelled"
    if rfq_status == "closed":
        return "dormant"  # closed without an award
    if closing_date is None or closing_date > now:
        return "open"
    return "dormant" if stale else "evaluating"


def notice_query(
    *,
    where: str = "n.organization_id = :org_id",
    select: str = "",
    source: str = "procurement.public_notices n",
    joins: str = "",
) -> str:
    """SELECT of notices with everything serialize() needs. select / source /
    joins let callers add columns or start from another table joined to n."""
    return f"""
    SELECT {select}n.id, n.organization_id, n.reference, n.is_published, n.hidden_reason, n.published_at,
           n.last_activity_at, n.announce, n.rfq_id, n.purchase_order_id,
           r.status AS rfq_status, r.closing_date, r.title AS rfq_title, r.description AS rfq_description,
           r.requisition_id,
           po.title AS po_title,
           COALESCE(rp.name, pp.name) AS project_name,
           COALESCE(pos.statuses, ARRAY[]::text[]) AS po_statuses,
           pos.awarded_at
    FROM {source}
    LEFT JOIN procurement.rfqs r ON r.id = n.rfq_id AND r.is_deleted = false
    LEFT JOIN procurement.purchase_orders po ON po.id = n.purchase_order_id AND po.is_deleted = false
    LEFT JOIN projects.projects rp ON rp.id = r.project_id
    LEFT JOIN projects.projects pp ON pp.id = po.project_id
    {joins}
    LEFT JOIN LATERAL (
        SELECT array_agg(x.status::text ORDER BY x.issued_at) AS statuses, min(x.issued_at) AS awarded_at
        FROM procurement.purchase_orders x
        WHERE x.organization_id = n.organization_id AND x.is_deleted = false
          AND x.status NOT IN ('draft', 'approved')
          AND (x.id = n.purchase_order_id OR (n.rfq_id IS NOT NULL AND x.rfq_id = n.rfq_id))
    ) pos ON true
    WHERE {where}
      AND (r.id IS NOT NULL OR po.id IS NOT NULL)
"""


NOTICE_SQL = notice_query()


def serialize(row: Dict[str, Any], now: Optional[datetime] = None) -> Dict[str, Any]:
    """Public-safe notice. No amounts, suppliers or internal notes."""
    status = derive_status(
        rfq_status=row.get("rfq_status") if row.get("rfq_id") else None,
        closing_date=row.get("closing_date"),
        po_statuses=row.get("po_statuses") or [],
        last_activity_at=row.get("last_activity_at"),
        now=now,
    )
    is_rfq = bool(row.get("rfq_id"))
    project = row.get("project_name")
    title = (row.get("rfq_title") if is_rfq else row.get("po_title")) or (
        f"Supply order - {project}" if project else "Supply order"
    )
    return {
        "reference": row["reference"],
        "title": title,
        "description": row.get("rfq_description") if is_rfq else None,
        "type": "Request for quotation" if is_rfq else "Direct purchase order",
        "project": project,
        "status": status,
        "status_label": STATUS_LABELS[status],
        "status_description": STATUS_DESCRIPTIONS[status],
        "published_at": row.get("published_at"),
        "closing_date": row.get("closing_date") if is_rfq else None,
        "awarded_at": row.get("awarded_at"),
        "last_activity_at": row.get("last_activity_at"),
        "accepting_quotations": status == "open",
        "contact_email": PROCUREMENT_EMAIL,
        "portal_path": f"/portal/supplier?notice={row['reference']}" if is_rfq else None,
    }


async def list_public(db: AsyncSession, org_id: str, limit: int = 200) -> list[Dict[str, Any]]:
    rows = await db.execute(
        text(NOTICE_SQL + " AND n.is_published = true ORDER BY n.published_at DESC LIMIT :limit"),
        {"org_id": org_id, "limit": limit},
    )
    return [serialize(dict(r)) for r in rows.mappings()]


async def get_public(db: AsyncSession, org_id: str, reference: str) -> Optional[Dict[str, Any]]:
    """One published notice, with the items an RFQ asks suppliers to price
    (description, quantity, unit - never the estimated cost)."""
    row = (
        await db.execute(
            text(NOTICE_SQL + " AND n.is_published = true AND n.reference = :reference"),
            {"org_id": org_id, "reference": reference.strip().upper()},
        )
    ).mappings().first()
    if not row:
        return None
    notice = serialize(dict(row))
    notice["items"] = []
    if row["rfq_id"] and row["requisition_id"]:
        items = await db.execute(
            text("""
                SELECT description, quantity, unit_of_measure AS unit, work_package
                FROM procurement.requisition_lines
                WHERE requisition_id = :requisition_id AND organization_id = :org_id AND is_deleted = false
                ORDER BY created_at, id
                LIMIT 300
            """),
            {"requisition_id": row["requisition_id"], "org_id": org_id},
        )
        notice["items"] = [
            {"description": i["description"], "quantity": float(i["quantity"]) if i["quantity"] is not None else None,
             "unit": i["unit"], "work_package": i["work_package"]}
            for i in items.mappings()
        ]
    return notice


async def code_belongs_to_notice(db: AsyncSession, org_id: str, reference: str, code: str) -> bool:
    """True when an AEGIS verification code was issued for this notice's RFQ
    document or for a purchase order under it - so a valid code from an
    unrelated document is not shown as vouching for it."""
    from app.services.documents.attestation import normalize_code

    normalized = normalize_code(code)
    if not normalized:
        return False
    return bool(
        (
            await db.execute(
                text("""
                    SELECT 1
                    FROM core.document_attestations a
                    JOIN procurement.public_notices n ON n.organization_id = a.organization_id
                    LEFT JOIN procurement.purchase_orders po
                      ON a.entity_type = 'procurement.purchase_order' AND po.id = a.entity_id
                    WHERE a.verification_code = :code
                      AND a.organization_id = CAST(:org_id AS uuid)
                      AND n.reference = :reference
                      AND (
                            -- the RFQ document itself
                            (a.entity_type = 'procurement.rfq' AND a.entity_id = n.rfq_id)
                            -- or a purchase order under the notice
                         OR (po.id IS NOT NULL AND (n.purchase_order_id = po.id
                                                    OR (po.rfq_id IS NOT NULL AND n.rfq_id = po.rfq_id)))
                      )
                    LIMIT 1
                """),
                {"code": normalized, "org_id": org_id, "reference": reference.strip().upper()},
            )
        ).scalar()
    )


async def reference_for_po(db: AsyncSession, org_id: str, po_id: Any) -> Optional[Dict[str, Any]]:
    """{"reference", "is_published"} of the notice a purchase order belongs to."""
    row = (
        await db.execute(
            text("""
                SELECT n.reference, n.is_published
                FROM procurement.purchase_orders po
                JOIN procurement.public_notices n
                  ON n.organization_id = po.organization_id
                 AND (n.purchase_order_id = po.id OR (po.rfq_id IS NOT NULL AND n.rfq_id = po.rfq_id))
                WHERE po.id = :po_id AND po.organization_id = :org_id
                LIMIT 1
            """),
            {"po_id": po_id, "org_id": org_id},
        )
    ).mappings().first()
    return dict(row) if row else None
