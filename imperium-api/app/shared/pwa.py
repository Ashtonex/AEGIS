from __future__ import annotations

import asyncio
import json
from base64 import urlsafe_b64encode
from functools import lru_cache
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

try:
    from py_vapid import Vapid
    from pywebpush import WebPushException, webpush
except ImportError:
    class Vapid:
        @classmethod
        def from_string(cls, *args, **kwargs):
            return cls()
        @classmethod
        def from_file(cls, *args, **kwargs):
            return cls()
        def generate_keys(self):
            pass
        def private_pem(self):
            return b""
        def public_pem(self):
            return b""
        @property
        def public_key(self):
            class PK:
                def public_bytes(self, *args, **kwargs):
                    return b"mock_public_bytes"
            return PK()

    class WebPushException(Exception):
        pass

    def webpush(*args, **kwargs):
        pass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.logging import logger


@lru_cache(maxsize=1)
def _load_vapid() -> Vapid:
    if settings.PWA_VAPID_PRIVATE_KEY_PEM:
        return Vapid.from_string(settings.PWA_VAPID_PRIVATE_KEY_PEM)

    private_path = Path(settings.PWA_VAPID_PRIVATE_KEY_PATH)
    if private_path.exists():
        return Vapid.from_file(str(private_path))

    private_path.parent.mkdir(parents=True, exist_ok=True)
    vapid = Vapid()
    vapid.generate_keys()
    private_path.write_bytes(vapid.private_pem())
    public_path = Path(settings.PWA_VAPID_PUBLIC_KEY_PATH)
    public_path.parent.mkdir(parents=True, exist_ok=True)
    public_path.write_bytes(vapid.public_pem())
    return vapid


def pwa_push_enabled() -> bool:
    return bool(settings.PWA_VAPID_SUBJECT)


def pwa_public_key() -> str:
    vapid = _load_vapid()
    public_bytes = vapid.public_key.public_bytes(
        Encoding.X962,
        PublicFormat.UncompressedPoint,
    )
    return urlsafe_b64encode(public_bytes).decode("utf-8").rstrip("=")


def _normalize_subscription(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "endpoint": row["endpoint"],
        "keys": {
            "p256dh": row["p256dh"],
            "auth": row["auth"],
        },
    }


async def send_web_push(subscription: dict[str, Any], payload: dict[str, Any]) -> bool:
    if not pwa_push_enabled():
        return False

    def _send() -> bool:
        try:
            webpush(
                subscription_info=subscription,
                data=json.dumps(payload, default=str),
                vapid_private_key=_load_vapid(),
                vapid_claims={"sub": settings.PWA_VAPID_SUBJECT},
                ttl=3600,
            )
            return True
        except WebPushException as exc:
            logger.warning("Web push delivery failed: %s", exc)
            return False

    return await asyncio.to_thread(_send)


async def dispatch_user_pushes(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: str,
    payload: dict[str, Any],
) -> int:
    rows = (
        await db.execute(
            text("""
            SELECT endpoint, p256dh, auth
            FROM core.pwa_push_subscriptions
            WHERE organization_id = :org_id
              AND user_id = :user_id
              AND is_active = true
              AND is_deleted = false
        """),
            {"org_id": org_id, "user_id": user_id},
        )
    ).mappings().all()

    sent = 0
    for row in rows:
        if await send_web_push(_normalize_subscription(dict(row)), payload):
            sent += 1
    return sent

