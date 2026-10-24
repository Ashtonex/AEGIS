"""
Measured client collection delay (DSO) per client.

How long a client actually takes to pay, measured from the claims they have
already paid: days from certification (and from submission) to the date the
claim was cleared by receipts. A receipt is a cashbook inflow allocated to the
claim through finance.receipt_allocations; a claim's receipt date is the date
of its last allocated receipt (the day it was fully collected).

The client is identified from the claim's project (projects.projects):
client_org_id, then client_id, then the client_name text - most projects only
carry a name. When a client has fewer than MIN_PAID_CLAIMS measurable paid
claims, the documented default constants are used instead and the profile says
so (source = "default").

Shared by the company cash forecast (cash_position.py) and anything else that
needs to date a client receipt, e.g. per-tender cash curves.
"""

from datetime import date
from statistics import median
from typing import Iterable, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CLIENT_COLLECTION_DAYS_AFTER_CERTIFICATION = 30
CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION = 45
MIN_PAID_CLAIMS = 3

# One identity per client: the CRM organisation when linked, else the client
# record, else the normalised name typed on the project.
CLIENT_KEY_SQL = "COALESCE(p.client_org_id::text, p.client_id::text, 'name:' || lower(btrim(p.client_name)))"

_PAID_CLAIM_SAMPLES_SQL = f"""
    SELECT {CLIENT_KEY_SQL} AS client_key,
           p.client_name,
           pc.certified_at::date AS certified_on,
           pc.submitted_at::date AS submitted_on,
           rcpt.received_on
    FROM finance.progress_claims pc
    JOIN projects.projects p ON p.id = pc.project_id
    JOIN (
        SELECT ra.progress_claim_id, MAX(ct.transaction_date) AS received_on
        FROM finance.receipt_allocations ra
        JOIN finance.cashbook_transactions ct
          ON ct.id = ra.cashbook_transaction_id AND ct.is_deleted = false AND ct.direction = 'inflow'
        WHERE ra.organization_id = :org_id
        GROUP BY ra.progress_claim_id
    ) rcpt ON rcpt.progress_claim_id = pc.id
    WHERE pc.organization_id = :org_id AND pc.is_deleted = false AND pc.status = 'paid'
"""


def client_key(client_org_id=None, client_id=None, client_name: Optional[str] = None) -> Optional[str]:
    """Python twin of CLIENT_KEY_SQL."""
    if client_org_id:
        return str(client_org_id)
    if client_id:
        return str(client_id)
    if client_name and client_name.strip():
        return "name:" + client_name.strip().lower()
    return None


def _median_days(pairs: Iterable[tuple[Optional[date], Optional[date]]]) -> Optional[int]:
    days = [max((received - start).days, 0) for start, received in pairs if start and received]
    return int(round(median(days))) if days else None


def summarise_collection_delays(samples: list[dict], min_paid_claims: int = MIN_PAID_CLAIMS) -> dict:
    """Collection profile for one client from its paid-claim samples.

    Each sample has certified_on, submitted_on and received_on dates. Uses the
    median (one slow or same-day payment shouldn't swing the forecast) and
    falls back to the default constants below min_paid_claims samples.
    """
    measurable = [s for s in samples if s.get("received_on")]
    after_cert = _median_days((s.get("certified_on"), s["received_on"]) for s in measurable)
    after_sub = _median_days((s.get("submitted_on"), s["received_on"]) for s in measurable)
    if len(measurable) < min_paid_claims or after_cert is None:
        return {
            "days_after_certification": CLIENT_COLLECTION_DAYS_AFTER_CERTIFICATION,
            "days_after_submission": CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION,
            "paid_claims_measured": len(measurable),
            "source": "default",
        }
    return {
        "days_after_certification": after_cert,
        # A claim certified on receipt has no separate submission history -
        # never let submission->receipt be shorter than certification->receipt.
        "days_after_submission": max(after_sub if after_sub is not None else after_cert, after_cert),
        "paid_claims_measured": len(measurable),
        "source": "measured",
    }


def default_collection_profile() -> dict:
    return {**summarise_collection_delays([]), "client_key": None, "client_name": None}


async def client_collection_profiles(db: AsyncSession, org_id: str) -> dict[str, dict]:
    """Every client with paid-claim history, keyed by client key."""
    rows = (await db.execute(text(_PAID_CLAIM_SAMPLES_SQL), {"org_id": org_id})).mappings().all()
    by_client: dict[str, list[dict]] = {}
    names: dict[str, str] = {}
    for r in rows:
        if r["client_key"] is None:
            continue
        by_client.setdefault(r["client_key"], []).append(dict(r))
        names.setdefault(r["client_key"], r["client_name"])
    return {
        key: {**summarise_collection_delays(samples), "client_key": key, "client_name": names.get(key)}
        for key, samples in by_client.items()
    }


async def client_collection_days(
    db: AsyncSession,
    org_id: str,
    client_id: Optional[str] = None,
    *,
    client_name: Optional[str] = None,
    project_id: Optional[str] = None,
) -> dict:
    """Collection profile for one client.

    Identify the client by any of: client_id (a CRM organisation id or client
    id, as stored on projects.client_org_id / client_id), client_name (matched
    case-insensitively against projects.client_name), or project_id (uses that
    project's client). Returns days_after_certification, days_after_submission,
    paid_claims_measured, source ("measured" | "default"), client_key and
    client_name. Never raises for an unknown client - it gets the defaults.
    """
    if project_id:
        row = (await db.execute(
            text("SELECT client_org_id, client_id, client_name FROM projects.projects WHERE id = CAST(:pid AS uuid)"),
            {"pid": str(project_id)},
        )).mappings().first()
        if row:
            client_id = client_id or (str(row["client_org_id"] or row["client_id"] or "") or None)
            client_name = client_name or row["client_name"]
    if not client_id and not (client_name and client_name.strip()):
        return default_collection_profile()

    rows = (await db.execute(
        text(_PAID_CLAIM_SAMPLES_SQL + """
              AND (p.client_org_id::text = :cid OR p.client_id::text = :cid
                   OR lower(btrim(p.client_name)) = :cname)
        """),
        {"org_id": org_id, "cid": str(client_id or ""), "cname": (client_name or "").strip().lower() or None},
    )).mappings().all()
    return {
        **summarise_collection_delays([dict(r) for r in rows]),
        "client_key": client_key(client_id, None, client_name),
        "client_name": client_name or (rows[0]["client_name"] if rows else None),
    }
