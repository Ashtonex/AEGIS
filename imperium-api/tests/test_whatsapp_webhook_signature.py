"""The public Meta WhatsApp webhook must refuse anything it cannot verify.

Regression for the fail-open path: with WHATSAPP_APP_SECRET unset, any
unsigned POST used to be processed (fake inbound messages / status updates
for the tenant owning the phone number id). The database is replaced with a
mock that fails the test if it is ever touched before verification.
"""
import asyncio
import hashlib
import hmac
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from core.config import settings
from routers import crm_communications


def _request(body: bytes, signature: str | None = None):
    request = MagicMock()
    request.body = AsyncMock(return_value=body)
    request.headers = {"x-hub-signature-256": signature} if signature is not None else {}
    return request


def _untouchable_db():
    db = MagicMock()
    db.execute = AsyncMock(side_effect=AssertionError("database touched before signature verified"))
    db.commit = AsyncMock(side_effect=AssertionError("commit before signature verified"))
    return db


BODY = json.dumps({"entry": [{"changes": [{"value": {"metadata": {"phone_number_id": "123"},
                                                     "messages": [{"from": "263770000000", "id": "wamid.x",
                                                                   "text": {"body": "forged"}}]}}]}]}).encode()


def _call(request, db):
    return asyncio.run(crm_communications.receive_whatsapp_webhook(request, db))


def test_unsigned_post_refused_when_app_secret_unset():
    with patch.object(settings, "WHATSAPP_APP_SECRET", None):
        with pytest.raises(HTTPException) as exc:
            _call(_request(BODY), _untouchable_db())
    assert exc.value.status_code == 403


def test_empty_app_secret_is_treated_as_unset():
    with patch.object(settings, "WHATSAPP_APP_SECRET", ""):
        with pytest.raises(HTTPException) as exc:
            _call(_request(BODY, "sha256=" + hmac.new(b"", BODY, hashlib.sha256).hexdigest()), _untouchable_db())
    assert exc.value.status_code == 403


def test_wrong_signature_refused():
    with patch.object(settings, "WHATSAPP_APP_SECRET", "app-secret"):
        with pytest.raises(HTTPException) as exc:
            _call(_request(BODY, "sha256=" + "0" * 64), _untouchable_db())
    assert exc.value.status_code == 403


def test_missing_signature_refused():
    with patch.object(settings, "WHATSAPP_APP_SECRET", "app-secret"):
        with pytest.raises(HTTPException) as exc:
            _call(_request(BODY), _untouchable_db())
    assert exc.value.status_code == 403


def test_signed_malformed_json_is_400_not_500():
    bad = b"{not json"
    sig = "sha256=" + hmac.new(b"app-secret", bad, hashlib.sha256).hexdigest()
    with patch.object(settings, "WHATSAPP_APP_SECRET", "app-secret"):
        with pytest.raises(HTTPException) as exc:
            _call(_request(bad, sig), _untouchable_db())
    assert exc.value.status_code == 400


def test_correctly_signed_post_is_processed():
    sig = "sha256=" + hmac.new(b"app-secret", BODY, hashlib.sha256).hexdigest()
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    with patch.object(settings, "WHATSAPP_APP_SECRET", "app-secret"), \
         patch.object(crm_communications, "_org_for_whatsapp_phone_id", AsyncMock(return_value=None)):
        _call(_request(BODY, sig), db)
    db.commit.assert_awaited_once()
