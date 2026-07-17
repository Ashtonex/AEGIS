"""Shared document numbering, PO numbering, and reference sequence generator.

AEGIS requires human-readable, unique reference codes for every controlled
business record.  All sequences must be:
  - Organisation-scoped (no cross-tenant collisions)
  - Monotonically increasing within the organisation
  - Idempotent when called inside a transaction with a known seed

Sequences are stored in a dedicated table ``core.sequences`` (created by
migration 022).  The generator uses a simple counter with a prefix.

If the sequences table does not yet exist (pre-migration), the helper
falls back to a UUID-derived short code so callers do not crash.
"""

from __future__ import annotations

from typing import Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# Registry of known sequence prefixes.
# key = sequence_name, value = prefix string
SEQUENCE_REGISTRY: dict[str, str] = {
    "purchase_requisition": "PR",
    "material_request": "MR",
    "purchase_order": "PO",
    "goods_received_note": "GRN",
    "supplier_invoice": "INV",
    "rfq": "RFQ",
    "document": "DOC",
    "employee": "EMP",
    "compliance_obligation": "OBL",
    "report": "RPT",
    "variation": "VAR",
    "progress_claim": "CLM",
}


async def next_reference(
    db: AsyncSession,
    org_id: str,
    sequence_name: str,
    year: Optional[int] = None,
) -> str:
    """Generate the next reference code for a given sequence.

    Attempts an atomic increment in ``core.sequences``.  Falls back to
    a timestamp-based stub if the table does not exist yet.

    Args:
        db: Active async SQLAlchemy session.
        org_id: Organisation UUID string.
        sequence_name: One of the keys in ``SEQUENCE_REGISTRY``.
        year: Optional 4-digit year suffix (e.g. 2026).  If omitted,
            the generated code has no year component.

    Returns:
        A human-readable reference string such as ``PO-2026-00042``.
    """
    prefix = SEQUENCE_REGISTRY.get(sequence_name, sequence_name.upper()[:3])

    try:
        row = await db.execute(
            text("""
                INSERT INTO core.sequences (organization_id, sequence_name, last_value)
                VALUES (:org_id, :name, 1)
                ON CONFLICT (organization_id, sequence_name)
                DO UPDATE SET last_value = core.sequences.last_value + 1
                RETURNING last_value
            """),
            {"org_id": org_id, "name": sequence_name},
        )
        counter = row.scalar() or 1
    except Exception:
        # Fallback before migration 022 is applied
        import time

        counter = int(time.time()) % 100000

    if year:
        return f"{prefix}-{year}-{counter:05d}"
    return f"{prefix}-{counter:05d}"
