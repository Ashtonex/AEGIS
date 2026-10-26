"""Shared harness for workflow verification scripts that run against the
configured (production) database without changing it.

* rollback_session(): an AsyncSession inside ONE outer transaction that is
  always rolled back. Endpoint code may call commit()/rollback() freely -
  those only release/roll back savepoints.
* block_outbound(): replaces every outbound channel (web push, email) with
  a recorder, so nothing reaches real people. Calls are reported as
  SIMULATED, never as delivered.
"""

import contextlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from core.database import engine  # noqa: E402

OUTBOUND_CALLS: list[tuple[str, dict]] = []
FAILURES: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("  PASS " if cond else "  FAIL ") + label)
    if not cond:
        FAILURES.append(label)


@contextlib.contextmanager
def block_outbound():
    import core.email
    import app.shared.notification_delivery as delivery
    import app.shared.pwa as pwa

    async def fake_push(subscription, payload):
        OUTBOUND_CALLS.append(("web_push", {"title": payload.get("title")}))
        return True

    async def fake_email(*args, **kwargs):
        OUTBOUND_CALLS.append(("email", {"subject": kwargs.get("subject")}))
        return True

    async def fake_escalate(db, **kwargs):
        OUTBOUND_CALLS.append(("email_escalation", {"title": kwargs.get("title")}))

    originals = []

    def patch(obj, name, value):
        originals.append((obj, name, getattr(obj, name)))
        setattr(obj, name, value)

    patch(pwa, "send_web_push", fake_push)
    patch(delivery, "email_escalate", fake_escalate)
    real_send_email = core.email.send_email
    patch(core.email, "send_email", fake_email)
    # Modules that did `from core.email import send_email` hold their own reference.
    for module in list(sys.modules.values()):
        if module is not None and getattr(module, "send_email", None) is real_send_email:
            patch(module, "send_email", fake_email)
    try:
        yield OUTBOUND_CALLS
    finally:
        for obj, name, value in reversed(originals):
            setattr(obj, name, value)


@contextlib.asynccontextmanager
async def rollback_session():
    async with engine.connect() as conn:
        outer = await conn.begin()
        db = AsyncSession(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
        try:
            yield db
        finally:
            await db.close()
            await outer.rollback()
    await engine.dispose()


async def table_counts(db, tables: list[str]) -> dict[str, int]:
    return {t: (await db.execute(text(f"SELECT count(*) FROM {t}"))).scalar() for t in tables}


def finish() -> None:
    if OUTBOUND_CALLS:
        print(f"\n  (SIMULATED, not delivered) outbound calls intercepted: {len(OUTBOUND_CALLS)}")
    print("\nRESULT:", "ALL PASSED" if not FAILURES else f"{len(FAILURES)} FAILURE(S)")
    sys.exit(1 if FAILURES else 0)
