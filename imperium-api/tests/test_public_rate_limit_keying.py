"""Anonymous endpoints must be rate limited per client IP, not per bearer.

core/rate_limit.py keys signed-in callers by their (unverified) bearer token.
Login, registration, refresh and the public intake forms never verify a
token, so before this fix a client could send a fresh junk
`Authorization: Bearer <random>` on every request and get a fresh bucket each
time - the login brute-force limit and the public form spam limits did
nothing. These tests drive the real routes through the app.
"""
import secrets
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from limits.storage import MemoryStorage
from limits.strategies import FixedWindowRateLimiter

import main
from core.rate_limit import limiter
from routers import auth as auth_router


@pytest.fixture()
def client():
    storage = MemoryStorage()
    with patch.object(limiter, "_storage", storage), \
         patch.object(limiter, "_limiter", FixedWindowRateLimiter(storage)), \
         patch.object(limiter, "_storage_dead", False), \
         patch.object(limiter, "enabled", True):
        yield TestClient(main.app, base_url="http://localhost", raise_server_exceptions=False)


def _reject_login(*_a, **_k):
    raise RuntimeError("bad credentials")


def _login(client, bearer=None):
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    return client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "wrong-password"},
                       headers=headers)


def test_login_is_limited_per_ip(client):
    with patch.object(auth_router.supabase.auth, "sign_in_with_password", _reject_login):
        codes = [_login(client).status_code for _ in range(12)]
    assert 429 in codes, codes


def test_rotating_junk_bearer_does_not_escape_login_limit(client):
    with patch.object(auth_router.supabase.auth, "sign_in_with_password", _reject_login):
        codes = [_login(client, "junk-" + secrets.token_hex(16)).status_code for _ in range(12)]
    assert 429 in codes, codes


def test_rotating_junk_bearer_does_not_escape_registration_limit(client):
    body = {"email": "x@example.com", "password": "Password123!", "full_name": "A B",
            "organization_id": "00000000-0000-0000-0000-000000000000"}
    codes = [client.post("/api/v1/auth/register", json=body,
                         headers={"Authorization": "Bearer junk-" + secrets.token_hex(16)}).status_code
             for _ in range(8)]
    assert 429 in codes, codes


@pytest.mark.parametrize("path", [
    "/api/v1/public/intake/enquiry",
    "/api/v1/public/intake/supplier",
    "/api/v1/public/intake/application",
    "/api/v1/public/intake/tender-interest/00000000-0000-0000-0000-000000000000",
    "/api/v1/public/intake/newsletter",
])
def test_public_intake_writes_are_keyed_by_ip(path):
    """Static check on the real limits: every public write endpoint's limit
    uses the remote address, never the default (token-aware) key."""
    from slowapi.util import get_remote_address
    import routers.public_intake as public_intake
    endpoint = {
        "/api/v1/public/intake/enquiry": public_intake.submit_enquiry,
        "/api/v1/public/intake/supplier": public_intake.submit_supplier,
        "/api/v1/public/intake/application": public_intake.submit_application,
        "/api/v1/public/intake/tender-interest/00000000-0000-0000-0000-000000000000": public_intake.submit_tender_interest,
        "/api/v1/public/intake/newsletter": public_intake.submit_newsletter_signup,
    }[path]
    name = f"{endpoint.__module__}.{endpoint.__name__}"
    limits = limiter._route_limits.get(name, [])
    assert limits, f"{name} has no explicit limit"
    assert all(limit.key_func is get_remote_address for limit in limits), name
