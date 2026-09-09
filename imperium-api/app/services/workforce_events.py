"""Durable at-least-once delivery and transactionally deduplicated consumers.

The existing Core domain event is the outbox. Transport acknowledgement is separate
from business consumer acknowledgement; a Redis publication is not business success.
"""

from collections.abc import Awaitable, Callable
from sqlalchemy import text

from app.shared.workforce_transactions import bind_workforce_context

EVENT_FILTER = "(event_type LIKE 'workforce.%' OR event_type LIKE 'hr.engagement_%' OR event_type='worker.registered.v1')"
TRANSPORT = "redis:workforce:v1"


async def consume_once(
    db, user, event_id, consumer_key: str, operation: Callable[[dict], Awaitable[None]]
) -> bool:
    """Caller owns transaction; operation must use this same DB and not commit.

    Consumers must validate schema and capability before calling. External effects
    need their own idempotent adapter; this only guarantees atomic database effects.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,1))"),
        {"key": f"{user['org_id']}:{event_id}"},
    )
    event = (
        (
            await db.execute(
                text(
                    "SELECT * FROM core.domain_events WHERE organization_id=:org AND id=:id"
                ),
                {"org": user["org_id"], "id": event_id},
            )
        )
        .mappings()
        .first()
    )
    if not event:
        raise ValueError("Event is not accessible in this organisation")
    receipt = (
        await db.execute(
            text(
                "INSERT INTO core.event_receipts(organization_id,event_id,consumer_key) VALUES(:org,:id,:consumer) ON CONFLICT DO NOTHING RETURNING id"
            ),
            {"org": user["org_id"], "id": event_id, "consumer": consumer_key},
        )
    ).scalar()
    if not receipt:
        return False
    await operation(dict(event))
    return True


async def dispatch_workforce_events(sessions, publisher, *, limit: int = 100, event_filter: str = EVENT_FILTER, transport: str = TRANSPORT, stream: str = "workforce.events") -> dict:
    """Discover only event identities, then process under the fenced tenant role.

    Crash after transport delivery and before commit can republish the event. Every
    message carries its durable event ID so consumers can call consume_once.
    """
    async with sessions() as discovery:
        candidates = (
            (
                await discovery.execute(
                    text(f"""
            SELECT e.id,e.organization_id,e.actor_id FROM core.domain_events e
            WHERE {event_filter} AND e.actor_id IS NOT NULL
              AND NOT EXISTS(SELECT 1 FROM core.event_receipts r WHERE r.organization_id=e.organization_id AND r.event_id=e.id AND r.consumer_key=:consumer)
              AND NOT EXISTS(SELECT 1 FROM core.event_dispatch_attempts a WHERE a.organization_id=e.organization_id AND a.event_id=e.id AND a.next_attempt_at>now())
            ORDER BY e.occurred_at,e.id LIMIT :limit
        """),
                    {"consumer": transport, "limit": max(1, min(limit, 500))},
                )
            )
            .mappings()
            .all()
        )
    delivered = failed = 0
    for candidate in candidates:
        user = {
            "org_id": candidate["organization_id"],
            "user_id": candidate["actor_id"],
        }
        async with sessions.begin() as db:
            await bind_workforce_context(db, user)
            # Row-level FOR UPDATE would require UPDATE privileges on immutable
            # events. Transaction advisory locking preserves append-only grants.
            acquired = (
                await db.execute(
                    text("SELECT pg_try_advisory_xact_lock(hashtextextended(:key,1))"),
                    {"key": f"{user['org_id']}:{candidate['id']}"},
                )
            ).scalar()
            if not acquired:
                continue
            event = (
                (
                    await db.execute(
                        text(
                            "SELECT * FROM core.domain_events WHERE organization_id=:org AND id=:id"
                        ),
                        {"org": user["org_id"], "id": candidate["id"]},
                    )
                )
                .mappings()
                .first()
            )
            if not event:
                continue
            params = {"org": user["org_id"], "id": event["id"], "consumer": transport}
            if (
                await db.execute(
                    text(
                        "SELECT 1 FROM core.event_receipts WHERE organization_id=:org AND event_id=:id AND consumer_key=:consumer"
                    ),
                    params,
                )
            ).scalar():
                continue
            try:
                await publisher.publish(
                    stream,
                    event["event_type"],
                    {
                        "event_id": str(event["id"]),
                        "organization_id": str(event["organization_id"]),
                        "schema_version": event["schema_version"],
                        "aggregate_type": event["aggregate_type"],
                        "aggregate_id": str(event["aggregate_id"]),
                        "occurred_at": event["occurred_at"].isoformat(),
                        "data": event["payload"],
                    },
                )
            except Exception as exc:
                # Never store URLs, transport credentials or personnel in errors.
                await db.execute(
                    text("""INSERT INTO core.event_dispatch_attempts(organization_id,event_id,attempts,next_attempt_at,last_error)
                    VALUES(:org,:id,1,now()+interval '30 seconds',:error)
                    ON CONFLICT(organization_id,event_id) DO UPDATE SET attempts=core.event_dispatch_attempts.attempts+1,
                    next_attempt_at=now()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(core.event_dispatch_attempts.attempts,7)))::integer),last_error=:error"""),
                    {**params, "error": type(exc).__name__[:160]},
                )
                failed += 1
            else:
                await db.execute(
                    text(
                        "INSERT INTO core.event_receipts(organization_id,event_id,consumer_key) VALUES(:org,:id,:consumer) ON CONFLICT DO NOTHING"
                    ),
                    params,
                )
                delivered += 1
    return {"delivered": delivered, "failed": failed}
