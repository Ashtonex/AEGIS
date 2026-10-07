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
from core.cache import delete_sync as _cache_delete_sync


def _clear_verified_token_cache(token: str) -> None:
    """Test-only equivalent of the old _verified_token_cache.clear() - the
    cache now has a local-process layer plus a Redis-backed layer (shared
    across worker processes), so clearing it means clearing both for this
    specific token's key."""
    security._local_verified_token_cache.pop(security._token_cache_key(token), None)
    security._local_rejected_tokens.pop(security._token_cache_key(token), None)
    _cache_delete_sync(f"auth:token:{security._token_cache_key(token)}")


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
    token = _forged_superadmin_token("supabase-signed-legacy-secret")
    _clear_verified_token_cache(token)
    response = _Response(
        200,
        {
            "id": "user-123",
            "email": "ashton@admin.com",
            "app_metadata": {"org_id": "org-1", "role": "SUPERADMIN"},
            "user_metadata": {"full_name": "Ashton"},
        },
    )
    monkeypatch.setattr(security, "_auth_http_client", lambda: _Client(response))

    payload = security.verify_token(_Creds(token))

    assert payload == {
        "sub": "user-123",
        "email": "ashton@admin.com",
        "app_metadata": {"org_id": "org-1", "role": "SUPERADMIN"},
        "user_metadata": {"full_name": "Ashton"},
        "role": "authenticated",
    }


def test_verify_token_reuses_recently_verified_token_during_auth_outage(monkeypatch):
    breaker = security._supabase_auth_breaker
    breaker.record_success()
    token = _forged_superadmin_token()
    _clear_verified_token_cache(token)
    verified_user = {
        "id": "user-123",
        "email": "ashton@admin.com",
        "app_metadata": {"org_id": "org-1", "role": "SUPERADMIN"},
        "user_metadata": {"full_name": "Ashton"},
    }
    response = _Response(200, verified_user)
    monkeypatch.setattr(security, "_auth_http_client", lambda: _Client(response))

    assert security.verify_token(_Creds(token))["sub"] == "user-123"

    try:
        for _ in range(breaker.failure_threshold):
            with pytest.raises(httpx.ConnectError):
                breaker.call_sync(lambda: (_ for _ in ()).throw(httpx.ConnectError("down")))
        assert breaker.is_open

        payload = security.verify_token(_Creds(token))
        assert payload["sub"] == "user-123"
        assert payload["email"] == "ashton@admin.com"
    finally:
        breaker.record_success()
        _clear_verified_token_cache(token)


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
    _clear_verified_token_cache(forged)

    # Local verification must not match any configured key/issuer.
    assert security._decode_locally(forged) is None

    # The Supabase Auth API fallback authoritatively rejects the forged token.
    unauthorized_response = _Response(401, {"message": "invalid JWT"})
    monkeypatch.setattr(
        security, "_auth_http_client", lambda: _Client(unauthorized_response)
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
        _clear_verified_token_cache(forged)
        with pytest.raises(HTTPException) as exc_info:
            security.verify_token(_Creds(forged))
        assert exc_info.value.status_code == 503
    finally:
        breaker.record_success()  # don't leak an open circuit into other tests


# ── Stress-test hardening (2026-10-07) ──────────────────────────────────────

def test_garbage_token_is_rejected_without_any_network_call(monkeypatch):
    calls = []
    monkeypatch.setattr(security, "_call_supabase_auth_api", lambda token: calls.append(token))
    with pytest.raises(HTTPException) as exc_info:
        security.verify_token_str("not-a-jwt-at-all")
    assert exc_info.value.status_code == 401
    assert calls == []


def test_rejected_token_is_not_re_sent_to_supabase(monkeypatch):
    forged = _forged_superadmin_token("replayed-junk")
    _clear_verified_token_cache(forged)
    calls = []

    def fake(token):
        calls.append(token)
        return _Response(401, {"message": "invalid JWT"})

    monkeypatch.setattr(security, "_call_supabase_auth_api", fake)
    for _ in range(3):
        with pytest.raises(HTTPException):
            security.verify_token_str(forged)
    assert len(calls) == 1
    _clear_verified_token_cache(forged)


def test_es256_token_verified_locally_against_jwks(monkeypatch):
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    public_jwk = jwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    public_jwk.update({"kid": "test-kid", "alg": "ES256"})
    monkeypatch.setattr(security, "_jwks_keys", {"test-kid": jwt.PyJWK(public_jwk)})
    monkeypatch.setattr(security, "_jwks_fetched_at", __import__("time").time())
    monkeypatch.setattr(security, "_call_supabase_auth_api", lambda token: (_ for _ in ()).throw(AssertionError("no network")))
    issuer = f"{security.settings.SUPABASE_URL.rstrip('/')}/auth/v1"
    claims = {
        "sub": "user-es256", "aud": "authenticated", "iss": issuer, "email": "a@b.c",
        "app_metadata": {"org_id": "org-1"}, "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    good = jwt.encode(claims, private_key, algorithm="ES256", headers={"kid": "test-kid"})
    assert security.verify_token_str(good)["sub"] == "user-es256"

    other_key = ec.generate_private_key(ec.SECP256R1())
    forged = jwt.encode(claims, other_key, algorithm="ES256", headers={"kid": "test-kid"})
    with pytest.raises(HTTPException) as exc_info:
        security.verify_token_str(forged)
    assert exc_info.value.status_code == 401

    unknown_kid = jwt.encode(claims, other_key, algorithm="ES256", headers={"kid": "made-up"})
    with pytest.raises(HTTPException) as exc_info:
        security.verify_token_str(unknown_kid)
    assert exc_info.value.status_code == 401


def test_ip_with_many_failures_is_throttled(monkeypatch):
    monkeypatch.setattr(security, "_auth_failures", lambda ip: security.AUTH_FAILURES_PER_MINUTE)
    with pytest.raises(HTTPException) as exc_info:
        security.verify_token_str("anything", client_ip="203.0.113.9")
    assert exc_info.value.status_code == 429
