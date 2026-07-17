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


def page_offset(page: int, page_size: int) -> tuple[int, int]:
    """Return (limit, offset) for SQL queries from 1-based page parameters."""
    limit = max(1, min(page_size, 500))  # Hard cap at 500 records per page
    offset = (max(1, page) - 1) * limit
    return limit, offset
