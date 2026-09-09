"""Tenant-fenced Workforce transactions and durable command replay receipts."""

from __future__ import annotations

import hashlib
import json
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import AsyncSessionLocal
from core.security import get_current_user


async def workforce_db(
    user: dict = Depends(get_current_user),
) -> AsyncIterator[AsyncSession]:
    """Never lend the privileged authentication session to business queries.

    Services must not commit: the request owns one atomic transaction. SET LOCAL
    role/context are reset by PostgreSQL when the connection returns to the pool.
    """
    async with AsyncSessionLocal() as db:
        try:
            async with db.begin():
                await bind_workforce_context(db, user)
                yield db
        except IntegrityError as exc:
            raise HTTPException(
                409, "The change conflicts with existing workforce evidence"
            ) from exc


async def bind_workforce_context(db: AsyncSession, user: dict) -> None:
    org_id, actor_id = str(UUID(str(user["org_id"]))), str(UUID(str(user["user_id"])))
    configured = (
        await db.execute(
            text(
                "SELECT 1 FROM pg_roles WHERE rolname='aegis_workforce_runtime' AND NOT rolsuper AND NOT rolbypassrls"
            )
        )
    ).scalar()
    if not configured:
        raise HTTPException(503, "Workforce runtime isolation is not configured")
    await db.execute(text("SET LOCAL ROLE aegis_workforce_runtime"))
    role = (
        await db.execute(
            text(
                "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user"
            )
        )
    ).first()
    if not role or role.rolsuper or role.rolbypassrls:
        raise HTTPException(503, "Workforce runtime isolation is not configured")
    await db.execute(
        text(
            "SELECT set_config('app.organization_id',:org,true), set_config('request.jwt.claim.sub',:actor,true)"
        ),
        {"org": org_id, "actor": actor_id},
    )


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


async def begin_command(
    db: AsyncSession, user: dict, action: str, key: UUID, payload: object
) -> tuple[UUID | None, dict | None]:
    fingerprint = hashlib.sha256(canonical_json(payload).encode()).hexdigest()
    params = {
        "org": user["org_id"],
        "actor": user["user_id"],
        "action": action,
        "key": key,
        "hash": fingerprint,
    }
    inserted = (
        await db.execute(
            text("""
        INSERT INTO core.command_receipts(organization_id,actor_id,action,command_key,payload_hash)
        VALUES(:org,:actor,:action,:key,:hash)
        ON CONFLICT(organization_id,actor_id,action,command_key) DO NOTHING RETURNING id
    """),
            params,
        )
    ).scalar()
    if inserted:
        return inserted, None
    record = (
        (
            await db.execute(
                text("""
        SELECT payload_hash,result FROM core.command_receipts
        WHERE organization_id=:org AND actor_id=:actor AND action=:action AND command_key=:key
        FOR UPDATE
    """),
                params,
            )
        )
        .mappings()
        .one()
    )
    if record["payload_hash"] != fingerprint:
        raise HTTPException(
            409, "Idempotency key was already used with different content"
        )
    if record["result"] is None:
        raise HTTPException(409, "The original command has not completed")
    return None, record["result"]


async def complete_command(
    db: AsyncSession, user: dict, receipt_id: UUID, response: dict
) -> dict:
    await db.execute(
        text(
            "UPDATE core.command_receipts SET result=CAST(:result AS jsonb) WHERE id=:id AND organization_id=:org"
        ),
        {"id": receipt_id, "org": user["org_id"], "result": canonical_json(response)},
    )
    return response


async def audit_action(
    db: AsyncSession,
    user: dict,
    table: str,
    record_id: UUID,
    action: str,
    details: dict,
) -> None:
    # Use the existing audit store. Only safe business metadata belongs here;
    # identity numbers, salary, banking and clinical details must not be copied.
    await db.execute(
        text("""
        INSERT INTO core.audit_log(organization_id,table_name,record_id,action,new_data,created_by)
        VALUES(:org,:table,:id,:action,CAST(:details AS jsonb),:actor)
    """),
        {
            "org": user["org_id"],
            "table": table,
            "id": record_id,
            "action": action,
            "details": canonical_json(details),
            "actor": user["user_id"],
        },
    )
