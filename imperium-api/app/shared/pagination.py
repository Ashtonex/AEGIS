"""Shared pagination and response formatting utilities.

All operational API endpoints must return responses using these helpers
to maintain a consistent shape across every AEGIS module.
"""

from __future__ import annotations

from math import ceil
from typing import Any, Optional, Sequence


def ok(data: Any, message: str = "OK", total: Optional[int] = None) -> dict:
    """Standard success response envelope.

    Args:
        data: The response payload (list or dict).
        message: Human-readable status message.
        total: If *data* is a list, the total record count before pagination.

    Returns:
        ``{"success": True, "data": data, "message": message, "meta": {...}}``
    """
    meta: dict[str, Any] = {}
    if total is not None:
        meta["total"] = total
    return {"success": True, "data": data, "message": message, "meta": meta}


def paginated(
    data: Sequence[dict],
    *,
    total: int,
    page: int,
    page_size: int,
    message: str = "Listed.",
) -> dict:
    """Paginated response envelope.

    Args:
        data: Current page of records.
        total: Total records matching the query (before pagination).
        page: Current 1-based page number.
        page_size: Maximum records per page.
        message: Human-readable status message.

    Returns:
        Standard envelope with ``meta`` containing pagination details.
    """
    return {
        "success": True,
        "data": list(data),
        "message": message,
        "meta": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": ceil(total / page_size) if page_size > 0 else 1,
        },
    }


def limited(
    rows: Sequence[dict],
    *,
    limit: int,
    offset: int,
    message: str = "Listed.",
    total_key: str = "_total",
) -> dict:
    """Envelope for limit/offset lists whose query also selects
    ``COUNT(*) OVER () AS _total`` - the total matching rows before
    LIMIT/OFFSET, fetched in the same round trip. The helper strips that
    column from each row.

    ``meta.has_more`` lets a "Show more" control know whether to render.
    When the page is empty (e.g. offset past the end) there is no row to
    read the total from, so ``total`` is None; callers asking from offset 0
    get an exact 0.
    """
    data = [{k: v for k, v in row.items() if k != total_key} for row in rows]
    if rows:
        total: Optional[int] = int(rows[0][total_key])
    else:
        total = 0 if offset == 0 else None
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": total is not None and offset + len(data) < total,
        },
    }


# For lists a screen genuinely needs whole (a Kanban's columns, per-person
# workload counts, category tallies computed in the browser) paging would
# silently break the screen, so they get a ceiling far above real volume
# instead (audit item 4.3's "Top-N cap far above real user need"). Query
# with LIMIT SAFETY_CAP + 1 and pass the rows to apply_safety_cap(): the
# extra row is how truncation is detected, and it's reported as
# meta.truncated so the UI can say so rather than show a silently short list.
LIST_SAFETY_CAP = 2000


def apply_safety_cap(rows: list, cap: int = LIST_SAFETY_CAP) -> tuple[list, bool]:
    """Returns (rows trimmed to ``cap``, whether anything was cut off)."""
    if len(rows) > cap:
        return rows[:cap], True
    return rows, False


def page_offset(page: int, page_size: int) -> tuple[int, int]:
    """Return (limit, offset) for SQL queries from 1-based page parameters."""
    limit = max(1, min(page_size, 500))  # Hard cap at 500 records per page
    offset = (max(1, page) - 1) * limit
    return limit, offset
