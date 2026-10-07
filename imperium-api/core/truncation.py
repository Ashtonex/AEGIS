"""Make hard row caps visible instead of silent.

Several list endpoints cap their query (LIMIT 500 and similar) to protect the
connection pool. Before this, a list that outgrew its cap simply stopped
showing rows, with nothing telling the user. Capped queries now fetch one row
past the cap and pass the result through `capped()`, which trims it and
records the cap for this request; StructuredLoggingMiddleware then adds an
`X-Results-Truncated: <cap>` response header, and the frontend's shared fetch
layer shows a "showing the first N records" notice.
"""
from contextvars import ContextVar
from typing import Any, Iterable

# Holds a per-request dict (set by the middleware). A mutable holder is used
# because BaseHTTPMiddleware runs the endpoint in a child task: a contextvar
# *set* there wouldn't be visible to the middleware, but a mutation of the
# shared dict is.
truncation_ctx: ContextVar[dict | None] = ContextVar("aegis_truncation", default=None)


def capped(rows: Iterable[Any], limit: int) -> list[Any]:
    """Materialise `rows` (queried with LIMIT limit+1) and trim to `limit`,
    recording the truncation for this request if a row was cut off."""
    items = list(rows)
    if len(items) > limit:
        holder = truncation_ctx.get()
        if holder is not None:
            holder["limit"] = min(limit, holder.get("limit", limit))
        return items[:limit]
    return items
