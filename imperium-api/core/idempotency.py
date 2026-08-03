"""Generic Idempotency-Key mechanism for critical write endpoints.

A client sends an `Idempotency-Key` header with a write request. If the same
key is replayed against the same endpoint (a client retry after a dropped
response, a double-click, a proxy resending a timed-out request), the
original response is returned instead of the handler's side effects running
again. Backed by core.idempotency_keys (migration 065).

Usage inside a route handler (deliberately not a FastAPI dependency: a
dependency can't short-circuit with the route's own success response, only
raise):

    idempotency_key = request.headers.get("Idempotency-Key")
    if idempotency_key:
        cached = await begin_idempotent_request(
            db, org_id=user["org_id"], key=idempotency_key,
            endpoint="POST /quotations", request_body=payload,
        )
        if cached is not None:
            return cached
    try:
        ... normal handler logic, building `result` ...
    except Exception:
        if idempotency_key:
            await fail_idempotent_request(db, org_id=user["org_id"], key=idempotency_key, endpoint="POST /quotations")
        raise
    if idempotency_key:
        await complete_idempotent_request(
            db, org_id=user["org_id"], key=idempotency_key,
            endpoint="POST /quotations", response_status=200, response_body=result,
        )
    return result
"""

import hashlib
import json
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _request_hash(body: Any) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()


async def begin_idempotent_request(
    db: AsyncSession, *, org_id: str, key: str, endpoint: str, request_body: Any,
) -> Optional[Dict[str, Any]]:
    """Claims `key` for `endpoint`. Returns None if this call claimed it (the
    caller should proceed with its normal logic). Returns the previously
    stored response body if an earlier call already completed under this
    key - the caller should return that as-is without re-running side
    effects. Raises 409 if a request with this key is still in flight, or
    422 if the key was already used with a materially different request
    body (a client bug, not a safe retry)."""
    req_hash = _request_hash(request_body)
    claimed = await db.execute(
        text("""
            INSERT INTO core.idempotency_keys
                (organization_id, idempotency_key, endpoint, request_hash, status)
            VALUES (CAST(:org_id AS uuid), :key, :endpoint, :req_hash, 'in_progress')
            ON CONFLICT (organization_id, idempotency_key, endpoint) DO NOTHING
            RETURNING id
        """),
        {"org_id": org_id, "key": key, "endpoint": endpoint, "req_hash": req_hash},
    )
    await db.commit()
    if claimed.first() is not None:
        return None

    existing = (
        await db.execute(
            text("""
                SELECT status, request_hash, response_body
                FROM core.idempotency_keys
                WHERE organization_id = CAST(:org_id AS uuid) AND idempotency_key = :key AND endpoint = :endpoint
            """),
            {"org_id": org_id, "key": key, "endpoint": endpoint},
        )
    ).mappings().first()

    if existing is None:
        # Row vanished between the failed insert and this select (another
        # request just failed and released it) - treat as a fresh claim
        # rather than blocking a legitimate retry.
        return None

    if existing["request_hash"] != req_hash:
        raise HTTPException(
            status_code=422,
            detail="This Idempotency-Key was already used with a different request body.",
        )

    if existing["status"] == "in_progress":
        raise HTTPException(
            status_code=409,
            detail="A request with this Idempotency-Key is already being processed.",
        )

    response_body = existing["response_body"]
    if isinstance(response_body, str):
        # asyncpg doesn't auto-decode jsonb read through a raw text() query.
        response_body = json.loads(response_body)
    return response_body


async def complete_idempotent_request(
    db: AsyncSession, *, org_id: str, key: str, endpoint: str, response_status: int, response_body: Any,
) -> None:
    await db.execute(
        text("""
            UPDATE core.idempotency_keys
            SET status = 'completed', response_status = :response_status,
                response_body = CAST(:response_body AS jsonb), completed_at = NOW()
            WHERE organization_id = CAST(:org_id AS uuid) AND idempotency_key = :key AND endpoint = :endpoint
        """),
        {
            "org_id": org_id,
            "key": key,
            "endpoint": endpoint,
            "response_status": response_status,
            "response_body": json.dumps(response_body, default=str),
        },
    )
    await db.commit()


async def fail_idempotent_request(db: AsyncSession, *, org_id: str, key: str, endpoint: str) -> None:
    """Releases a claimed key after the handler raised, so a legitimate
    retry with the same key isn't stuck behind a request that never
    completed."""
    await db.execute(
        text("""
            DELETE FROM core.idempotency_keys
            WHERE organization_id = CAST(:org_id AS uuid) AND idempotency_key = :key
                AND endpoint = :endpoint AND status = 'in_progress'
        """),
        {"org_id": org_id, "key": key, "endpoint": endpoint},
    )
    await db.commit()
