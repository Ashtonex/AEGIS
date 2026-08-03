from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

import httpx
import jwt
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import security


@dataclass
class _Creds:
    credentials: str


class _Response:
    def __init__(self, status_code: int, body: dict[str, object]):
        self.status_code = status_code
        self._body = body

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> dict[str, object]:
        return self._body


class _Client:
    def __init__(self, response: _Response):
        self.response = response

    def __enter__(self) -> "_Client":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def get(self, *args, **kwargs) -> _Response:
        return self.response


def test_verify_token_uses_supabase_auth_payload(monkeypatch):
    response = _Response(
        200,
        {
            "id": "user-123",
            "email": "ashton@admin.com",
            "app_metadata": {"org_id": "org-1", "role": "SUPERADMIN"},
            "user_metadata": {"full_name": "Ashton"},
        },
    )
    monkeypatch.setattr(security.httpx, "Client", lambda timeout: _Client(response))

    payload = security.verify_token(_Creds("real-token"))

    assert payload == {
        "sub": "user-123",
        "email": "ashton@admin.com",
        "app_metadata": {"org_id": "org-1", "role": "SUPERADMIN"},
        "user_metadata": {"full_name": "Ashton"},
        "role": "authenticated",
    }


def _forged_superadmin_token(secret: str = "attacker-guessed-or-wrong-secret") -> str:
    """Craft a token the way a forger would: no knowledge of the real
    Supabase JWT secret, just claiming SUPERADMIN for themselves."""
    payload = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "aud": "authenticated",
        "role": "SUPERADMIN",
        "app_metadata": {"role": "SUPERADMIN", "org_id": "00000000-0000-0000-0000-000000000001"},
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def test_verify_token_rejects_forged_signature_instead_of_trusting_claims(monkeypatch):
    """Regression test for the JWT bypass: verify_token must never accept a
    token's claims without a verified signature. A forged token (signed with
    a secret the real backend never configured) must fail local verification
    and must also be rejected by the Supabase Auth API fallback."""
    forged = _forged_superadmin_token()

    # Local verification must not match any configured key/issuer.
    assert security._decode_locally(forged) is None

    # The Supabase Auth API fallback authoritatively rejects the forged token.
    unauthorized_response = _Response(401, {"message": "invalid JWT"})
    monkeypatch.setattr(
        security.httpx, "Client", lambda timeout: _Client(unauthorized_response)
    )

    with pytest.raises(HTTPException) as exc_info:
        security.verify_token(_Creds(forged))
    assert exc_info.value.status_code == 401


def test_decode_locally_never_returns_unverified_payload_for_garbage_token():
    """A syntactically-invalid or unsigned token must never be treated as a
    verified payload by the local fast path."""
    assert security._decode_locally("not-a-jwt-at-all") is None


def test_verify_token_circuit_breaker_opens_after_repeated_supabase_failures(monkeypatch):
    """Once the Supabase Auth API fallback has failed enough times in a row,
    verify_token must fail fast (503, no further network calls) instead of
    letting every request block through the full retry+timeout duration."""
    breaker = security._supabase_auth_breaker
    breaker.record_success()  # ensure a clean starting state regardless of test order
    try:
        monkeypatch.setattr(
            security, "_call_supabase_auth_api", lambda token: (_ for _ in ()).throw(httpx.ConnectError("down"))
        )
        # verify_token wraps the breaker call in a broad except Exception ->
        # 401, so drive the breaker directly to its open threshold first
        # rather than relying on that mapping.
        for _ in range(breaker.failure_threshold):
            with pytest.raises(httpx.ConnectError):
                breaker.call_sync(lambda: security._call_supabase_auth_api("any-token"))
        assert breaker.is_open

        forged = _forged_superadmin_token()
        with pytest.raises(HTTPException) as exc_info:
            security.verify_token(_Creds(forged))
        assert exc_info.value.status_code == 503
    finally:
        breaker.record_success()  # don't leak an open circuit into other tests
