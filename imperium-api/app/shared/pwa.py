from __future__ import annotations

import asyncio
import json
from base64 import urlsafe_b64encode
from functools import lru_cache
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    PrivateFormat,
    NoEncryption,
    load_pem_private_key,
)
from cryptography.hazmat.primitives.asymmetric import ec

try:
    from py_vapid import Vapid
except ImportError:
    class Vapid:  # type: ignore[no-redef]
        def __init__(self, key: ec.EllipticCurvePrivateKey | None = None):
            self._key = key or ec.generate_private_key(ec.SECP256R1())

        @classmethod
        def from_string(cls, pem_str: str) -> "Vapid":
            data = pem_str.encode("utf-8") if isinstance(pem_str, str) else pem_str
            key = load_pem_private_key(data, password=None)
            if not isinstance(key, ec.EllipticCurvePrivateKey):
                raise ValueError("VAPID key must be an elliptic curve private key")
            return cls(key)

        @classmethod
        def from_file(cls, path: str) -> "Vapid":
            data = Path(path).read_bytes()
            key = load_pem_private_key(data, password=None)
            if not isinstance(key, ec.EllipticCurvePrivateKey):
                raise ValueError("VAPID key must be an elliptic curve private key")
            return cls(key)

        def generate_keys(self) -> None:
            self._key = ec.generate_private_key(ec.SECP256R1())

        def private_pem(self) -> bytes:
            return self._key.private_bytes(
                Encoding.PEM,
                PrivateFormat.PKCS8,
                NoEncryption(),
            )

        def public_pem(self) -> bytes:
            return self._key.public_key().public_bytes(
                Encoding.PEM,
                PublicFormat.SubjectPublicKeyInfo,
            )

        @property
        def public_key(self):
            return self._key.public_key()

try:
    from pywebpush import WebPushException, webpush
except ImportError:
    class WebPushException(Exception):  # type: ignore[no-redef]
        pass

    def webpush(*args, **kwargs):  # type: ignore[no-redef]
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
        try:
            return Vapid.from_file(str(private_path))
        except Exception as exc:
            logger.warning("Existing VAPID private key could not be loaded (%s); regenerating.", exc)

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


async def send_web_push(subscription: dict[str, Any], payload: dict[str, Any]) -> bool | str:
    if not pwa_push_enabled():
        return False

    priority = payload.get("priority", "normal")
    urgency_map = {"urgent": "high", "high": "high", "normal": "normal", "low": "low"}
    urgency = urgency_map.get(priority, "normal")
    ttl = 86400 if priority in ("urgent", "high") else 43200

    def _send() -> bool | str:
        try:
            webpush(
                subscription_info=subscription,
                data=json.dumps(payload, default=str),
                vapid_private_key=_load_vapid(),
                vapid_claims={"sub": settings.PWA_VAPID_SUBJECT},
                ttl=ttl,
                headers={"Urgency": urgency},
            )
            return True
        except WebPushException as exc:
            logger.warning("Web push delivery failed: %s", exc)
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code in (404, 410):
                return "expired"
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
    expired_endpoints: list[str] = []
    for row in rows:
        outcome = await send_web_push(_normalize_subscription(dict(row)), payload)
        if outcome is True:
            sent += 1
        elif outcome == "expired":
            expired_endpoints.append(row["endpoint"])

    if expired_endpoints:
        await db.execute(
            text("""
            UPDATE core.pwa_push_subscriptions
            SET is_active = false, updated_at = NOW()
            WHERE endpoint = ANY(:endpoints)
        """),
            {"endpoints": expired_endpoints},
        )
        await db.commit()

    return sent

