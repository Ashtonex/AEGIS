"""
AEGIS document attestation: signed, publicly verifiable PDFs.

Issuing a document:
    code = new_verification_code()
    pdf = render(..., verification={"code": code, "url": verification_url(code)})
    await attest(db, code=code, pdf=pdf, ...)

attest() stores the SHA-256 of the exact bytes issued and an Ed25519
signature over a canonical record of the document (number, counterparty,
amount, hash, issue time). The verify endpoint re-checks that signature with
the public key in core.document_signing_keys and compares the stored columns
with the signed record, so an edited row or an edited file both show up.

The signing key is derived from this host's secret (DOCUMENT_SIGNING_SECRET,
else SECRET_KEY); only its public half is stored, so documents signed on any
AEGIS host verify on every other.
"""

import hashlib
import hmac
import json
import secrets
from base64 import b64decode, b64encode
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings

PAYLOAD_VERSION = 1
CODE_PREFIX = "SNC"
# Crockford base32 without I, L, O, U: nothing that reads as another character.
CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

_signing_key: Optional[tuple] = None


def _private_key() -> tuple:
    """(private key, key id, public key b64) for this host, derived once."""
    global _signing_key
    if _signing_key is None:
        secret = getattr(settings, "DOCUMENT_SIGNING_SECRET", None) or settings.SECRET_KEY
        seed = hmac.new(secret.encode(), b"aegis-document-attestation-v1", hashlib.sha256).digest()
        key = Ed25519PrivateKey.from_private_bytes(seed)
        public = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        key_id = "aegis-ed25519-" + hashlib.sha256(public).hexdigest()[:12]
        _signing_key = (key, key_id, b64encode(public).decode())
    return _signing_key


def new_verification_code() -> str:
    """SNC-XXXX-XXXX-XXXX: 60 random bits, easy to read out and type."""
    chars = "".join(secrets.choice(CODE_ALPHABET) for _ in range(12))
    return f"{CODE_PREFIX}-{chars[0:4]}-{chars[4:8]}-{chars[8:12]}"


def normalize_code(code: str) -> str:
    raw = "".join(ch for ch in str(code or "").upper() if ch.isalnum())
    raw = raw.replace("O", "0").replace("I", "1").replace("L", "1")
    if raw.startswith(CODE_PREFIX):
        raw = raw[len(CODE_PREFIX):]
    if len(raw) != 12:
        return ""
    return f"{CODE_PREFIX}-{raw[0:4]}-{raw[4:8]}-{raw[8:12]}"


def verification_url(code: str) -> str:
    return f"{settings.PUBLIC_APP_URL.strip().rstrip('/')}/verify/{code}"


def _canonical(payload: Dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _str(value: Any) -> Optional[str]:
    if value is None or str(value).strip() == "":
        return None
    return str(value)


async def _register_key(db: AsyncSession) -> tuple:
    key, key_id, public_b64 = _private_key()
    await db.execute(
        text("""
            INSERT INTO core.document_signing_keys (key_id, algorithm, public_key, label)
            VALUES (:key_id, 'ed25519', :public_key, :label)
            ON CONFLICT (key_id) DO NOTHING
        """),
        {"key_id": key_id, "public_key": public_b64, "label": f"AEGIS {settings.ENVIRONMENT}"},
    )
    return key, key_id


async def attest(
    db: AsyncSession,
    *,
    code: str,
    pdf: bytes,
    organization_id: Any,
    document_type: str,
    document_number: str,
    title: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Any = None,
    project_id: Any = None,
    project_name: Optional[str] = None,
    counterparty: Optional[str] = None,
    amount: Any = None,
    currency: Optional[str] = None,
    document_status: Optional[str] = None,
    filename: Optional[str] = None,
    issued_by: Any = None,
    issued_by_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Sign and record a rendered PDF. The caller commits."""
    key, key_id = await _register_key(db)
    issued_at = datetime.now(timezone.utc).replace(microsecond=0)
    sha256 = hashlib.sha256(pdf).hexdigest()
    amount_str = None if amount is None else str(Decimal(str(amount)).quantize(Decimal("0.01")))
    payload = {
        "v": PAYLOAD_VERSION,
        "code": code,
        "organization_id": str(organization_id),
        "document_type": document_type,
        "document_number": document_number,
        "title": _str(title),
        "entity_type": _str(entity_type),
        "entity_id": _str(entity_id),
        "project_id": _str(project_id),
        "project_name": _str(project_name),
        "counterparty": _str(counterparty),
        "amount": amount_str,
        "currency": _str(currency),
        "document_status": _str(document_status),
        "file_sha256": sha256,
        "file_size": len(pdf),
        "issued_at": issued_at.isoformat(),
        "issued_by": _str(issued_by),
        "key_id": key_id,
    }
    signature = b64encode(key.sign(_canonical(payload))).decode()
    await db.execute(
        text("""
            INSERT INTO core.document_attestations (
                organization_id, verification_code, document_type, document_number, title,
                entity_type, entity_id, project_id, project_name, counterparty, amount, currency,
                document_status, file_sha256, file_size, filename, payload, signature, key_id,
                issued_by, issued_by_name, issued_at
            ) VALUES (
                CAST(:org_id AS uuid), :code, :document_type, :document_number, :title,
                :entity_type, CAST(:entity_id AS uuid), CAST(:project_id AS uuid), :project_name, :counterparty,
                CAST(:amount AS numeric), :currency, :document_status, :sha256, :size, :filename,
                CAST(:payload AS jsonb), :signature, :key_id, CAST(:issued_by AS uuid), :issued_by_name, :issued_at
            )
        """),
        {
            "org_id": str(organization_id), "code": code, "document_type": document_type,
            "document_number": document_number, "title": payload["title"], "entity_type": payload["entity_type"],
            "entity_id": payload["entity_id"], "project_id": payload["project_id"],
            "project_name": payload["project_name"], "counterparty": payload["counterparty"],
            "amount": amount_str, "currency": payload["currency"], "document_status": payload["document_status"],
            "sha256": sha256, "size": len(pdf), "filename": _str(filename), "payload": json.dumps(payload),
            "signature": signature, "key_id": key_id, "issued_by": payload["issued_by"],
            "issued_by_name": _str(issued_by_name), "issued_at": issued_at,
        },
    )
    return {"verification_code": code, "file_sha256": sha256, "key_id": key_id, "issued_at": issued_at.isoformat()}


# Columns that must agree with the signed payload; a mismatch means the row was edited.
_BOUND_COLUMNS = ("verification_code", "document_type", "document_number", "counterparty", "amount", "file_sha256")


async def verify(db: AsyncSession, code: str) -> Optional[Dict[str, Any]]:
    """Public verification result for a code, or None when unknown."""
    normalized = normalize_code(code)
    if not normalized:
        return None
    row = (
        await db.execute(
            text("""
                SELECT a.*, k.public_key, k.algorithm, k.retired_at AS key_retired_at
                FROM core.document_attestations a
                JOIN core.document_signing_keys k ON k.key_id = a.key_id
                WHERE a.verification_code = :code
            """),
            {"code": normalized},
        )
    ).mappings().first()
    if not row:
        return None

    payload = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"])
    signature_valid = False
    try:
        Ed25519PublicKey.from_public_bytes(b64decode(row["public_key"])).verify(
            b64decode(row["signature"]), _canonical(payload)
        )
        signature_valid = True
    except (InvalidSignature, ValueError):
        signature_valid = False

    def as_payload(column: str) -> Optional[str]:
        value = row[column]
        if column == "amount" and value is not None:
            return str(Decimal(str(value)).quantize(Decimal("0.01")))
        return _str(value)

    payload_key = {"verification_code": "code"}
    record_consistent = all(as_payload(col) == payload.get(payload_key.get(col, col)) for col in _BOUND_COLUMNS)

    if row["revoked_at"]:
        status = "revoked"
    elif signature_valid and record_consistent:
        status = "valid"
    else:
        status = "invalid"

    return {
        "status": status,
        "verification_code": row["verification_code"],
        "signature_valid": signature_valid,
        "record_consistent": record_consistent,
        "issuer": "Six Nine Construction (Pvt) Ltd",
        "document_type": row["document_type"],
        "document_number": row["document_number"],
        "title": row["title"],
        "project_name": row["project_name"],
        "counterparty": row["counterparty"],
        "amount": None if row["amount"] is None else str(row["amount"]),
        "currency": row["currency"],
        "document_status": row["document_status"],
        "issued_at": row["issued_at"].isoformat() if row["issued_at"] else None,
        "issued_by_name": row["issued_by_name"],
        "file_sha256": row["file_sha256"],
        "file_size": row["file_size"],
        "filename": row["filename"],
        "key_id": row["key_id"],
        "algorithm": row["algorithm"],
        "revoked_at": row["revoked_at"].isoformat() if row["revoked_at"] else None,
        "revoked_reason": row["revoked_reason"] if row["revoked_at"] else None,
    }
