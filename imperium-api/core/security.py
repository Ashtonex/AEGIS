from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import jwt
import httpx
import hashlib
import threading
import time
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from core.database import get_db
from core.config import settings
from core.resilience import CircuitBreaker, CircuitBreakerOpen
from core.cache import cache_get_json_sync, cache_set_json_sync, get_int_sync, incr_with_ttl_sync
from core.logging import logger

security = HTTPBearer()

# Tracks the Supabase Auth API specifically (the network fallback path in
# verify_token below) so a struggling/unreachable Supabase fails fast for a
# cooldown period instead of every single request blocking for the full
# retry+timeout duration during an outage.
_supabase_auth_breaker = CircuitBreaker(
    "supabase_auth", failure_threshold=5, reset_timeout_seconds=30.0
)
_VERIFIED_TOKEN_CACHE_MAX_SECONDS = 300

# First-check, in-process layer in front of the Redis-backed token cache
# below. Redis gives cross-worker sharing (the main win from Step 3's
# multi-worker rollout); this local dict preserves the original resilience
# property that a Supabase Auth outage alone - independent of Redis's own
# health - can still be ridden out from a process that already verified this
# token recently. Without it, a correlated Supabase+Redis outage would 503
# every request instead of serving the last-known-good verification.
_local_verified_token_cache: dict[str, tuple[float, dict]] = {}
_LOCAL_TOKEN_CACHE_MAX_ENTRIES = 5000

# Stress test 2026-10-07: every unrecognised token used to cost a fresh
# TLS handshake to Supabase Auth (a new httpx.Client per call, up to 3
# retries) inside the 40-thread sync pool, with rejections never remembered.
# 50 concurrent junk tokens slowed unrelated requests from 30ms to 300ms+.
# The pieces below make a junk token cost microseconds instead.

# One pooled client for the Supabase Auth fallback (thread-safe).
_auth_http: httpx.Client | None = None


def _auth_http_client() -> httpx.Client:
    global _auth_http
    if _auth_http is None:
        _auth_http = httpx.Client(timeout=10.0, limits=httpx.Limits(max_connections=20, max_keepalive_connections=10))
    return _auth_http


# Supabase signs session tokens with an asymmetric (ES256) key published at
# /auth/v1/.well-known/jwks.json, so those tokens are verified here locally -
# no network call at all once the key set is cached.
_JWKS_TTL_SECONDS = 600
_JWKS_MIN_REFRESH_SECONDS = 60  # an unknown `kid` may trigger at most one refetch a minute
_jwks_lock = threading.Lock()
_jwks_keys: dict[str, jwt.PyJWK] = {}
_jwks_fetched_at = 0.0
_ASYMMETRIC_ALGS = {"ES256", "RS256", "EdDSA"}


def _refresh_jwks(force: bool = False) -> None:
    global _jwks_keys, _jwks_fetched_at
    now = time.time()
    if not force and _jwks_keys and now - _jwks_fetched_at < _JWKS_TTL_SECONDS:
        return
    if now - _jwks_fetched_at < _JWKS_MIN_REFRESH_SECONDS and _jwks_keys:
        return
    with _jwks_lock:
        if now - _jwks_fetched_at < _JWKS_MIN_REFRESH_SECONDS and _jwks_keys:
            return
        _jwks_fetched_at = now  # set before fetching, so a failing fetch is also rate-limited
        url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
        response = _auth_http_client().get(url, headers={"apikey": settings.SUPABASE_ANON_KEY})
        response.raise_for_status()
        keys: dict[str, jwt.PyJWK] = {}
        for jwk in response.json().get("keys", []):
            try:
                keys[jwk.get("kid", "")] = jwt.PyJWK(jwk)
            except jwt.PyJWTError:
                continue
        if keys:
            _jwks_keys = keys


def _jwks_key_for(kid: str | None) -> jwt.PyJWK | None:
    """None means "can't verify locally right now" (key set unreachable) -
    callers fall back to the Supabase Auth API in that case only."""
    try:
        _refresh_jwks()
        if kid not in _jwks_keys:
            _refresh_jwks(force=True)
    except Exception as exc:
        logger.warning("jwks_fetch_failed", error_type=exc.__class__.__name__)
        return None
    return _jwks_keys.get(kid) or (next(iter(_jwks_keys.values())) if kid is None and len(_jwks_keys) == 1 else None)


class _UnknownSigningKey(Exception):
    """The key set loaded, but this token's `kid` isn't in it: forged."""


def _decode_with_jwks(token: str, header: dict) -> dict | None:
    key = _jwks_key_for(header.get("kid"))
    if key is None:
        if _jwks_keys:
            raise _UnknownSigningKey()
        return None
    return jwt.decode(
        token,
        key.key,
        algorithms=[header.get("alg")],
        audience=settings.JWT_AUDIENCE,
        issuer=f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1",
    )


# Tokens Supabase (or local verification) has already rejected, so a replayed
# junk token is refused without another network call.
_REJECTED_TOKEN_TTL_SECONDS = 60
_local_rejected_tokens: dict[str, float] = {}


def _remember_rejected(token: str) -> None:
    if len(_local_rejected_tokens) > _LOCAL_TOKEN_CACHE_MAX_ENTRIES:
        _local_rejected_tokens.clear()
    _local_rejected_tokens[_token_cache_key(token)] = time.time() + _REJECTED_TOKEN_TTL_SECONDS


def _recently_rejected(token: str) -> bool:
    key = _token_cache_key(token)
    until = _local_rejected_tokens.get(key)
    if until and until > time.time():
        return True
    _local_rejected_tokens.pop(key, None)
    return False


# At most this many Supabase Auth fallback calls in flight per worker, so a
# flood can't occupy every thread in FastAPI's sync pool.
_FALLBACK_CONCURRENCY = threading.BoundedSemaphore(8)
_FALLBACK_WAIT_SECONDS = 3.0

# Per-IP failed-authentication throttle (fixed one-minute window, shared
# across workers via Redis, falling back to a per-process count).
AUTH_FAILURES_PER_MINUTE = 120
_local_auth_failures: dict[str, tuple[int, int]] = {}


def _failure_window_key(ip: str) -> str:
    return f"auth:fail:{ip}:{int(time.time() // 60)}"


def _record_auth_failure(ip: str | None) -> None:
    if not ip:
        return
    if incr_with_ttl_sync(_failure_window_key(ip), 90) is None:
        window = int(time.time() // 60)
        prev_window, count = _local_auth_failures.get(ip, (window, 0))
        _local_auth_failures[ip] = (window, (count if prev_window == window else 0) + 1)


def _auth_failures(ip: str | None) -> int:
    if not ip:
        return 0
    count = get_int_sync(_failure_window_key(ip))
    if count is None:
        window, local = _local_auth_failures.get(ip, (0, 0))
        return local if window == int(time.time() // 60) else 0
    return count

@retry(
    retry=retry_if_exception_type((httpx.TimeoutException, httpx.TransportError)),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=4),
    reraise=True,
)
def _call_supabase_auth_api(token: str) -> httpx.Response:
    """Retried on transient network failure only. A 4xx response (bad/
    expired token) is a legitimate outcome, not a service failure - it must
    not be retried and must not count against the circuit breaker, or a
    burst of ordinary expired-session requests would trip the breaker and
    lock out everyone with a valid session too."""
    auth_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user"
    response = _auth_http_client().get(
        auth_url,
        headers={
            "Authorization": f"Bearer {token}",
            "apikey": settings.SUPABASE_ANON_KEY,
            "Accept": "application/json",
        },
    )
    if response.status_code >= 500:
        response.raise_for_status()
    return response
SUPERADMIN_ROLE = "SUPERADMIN"

# Centralized Argon2 Password Hasher
ph = PasswordHasher()


def hash_password(password: str) -> str:
    """Hashes a plain-text password using Argon2id."""
    return ph.hash(password)


def verify_password(hash_str: str, password: str) -> bool:
    """Verifies an Argon2id password hash."""
    try:
        return ph.verify(hash_str, password)
    except VerifyMismatchError:
        return False


def verify_jwt(credentials: HTTPAuthorizationCredentials = Security(security)) -> dict:
    """
    Validate the JWT signature, audience, issuer, and expiration locally.
    Supports key rotation by checking multiple keys.
    """
    token = credentials.credentials
    keys_to_try = [settings.SECRET_KEY]
    if settings.JWT_SECRET_KEY:
        keys_to_try.append(settings.JWT_SECRET_KEY)

    last_err = None
    for key in keys_to_try:
        try:
            payload = jwt.decode(
                token,
                key,
                algorithms=[settings.JWT_ALGORITHM],
                audience=settings.JWT_AUDIENCE,
                issuer=settings.JWT_ISSUER,
            )
            return payload
        except jwt.ExpiredSignatureError as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired"
            ) from e
        except jwt.PyJWTError as e:
            last_err = e
            continue

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=f"Invalid authentication credentials. {str(last_err) if last_err else ''}",
    )


def require_role(required_role: str):
    """Enforces specific role assignments from local tokens."""

    def role_checker(payload: dict = Security(verify_jwt)):
        user_role = payload.get("app_metadata", {}).get("role", "anon")
        if (
            user_role != required_role
            and user_role != "admin"
            and user_role != SUPERADMIN_ROLE
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
            )
        return payload

    return role_checker


def _get_metadata(payload: dict, key: str) -> dict:
    metadata = payload.get(key)
    return metadata if isinstance(metadata, dict) else {}


def _local_issuers() -> list[str]:
    """Acceptable `iss` claims: the app's own issuer plus Supabase's real Auth issuer."""
    issuers = []
    if settings.JWT_ISSUER:
        issuers.append(settings.JWT_ISSUER)
    if settings.SUPABASE_URL:
        issuers.append(f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1")
    return issuers


def _decode_locally(token: str) -> dict | None:
    """Attempt to verify the token's signature locally.

    Returns the decoded payload only on a genuine signature match. Returns
    None (never a payload) if the signature cannot be verified with any known
    key/issuer combination, so the caller is forced to fall back to the
    authoritative Supabase Auth API instead of trusting unverified claims.

    NOTE: JWT_SECRET_KEY currently holds a Supabase API secret key
    (sb_secret_...), not the project's legacy JWT signing secret, so this
    will never actually verify a Supabase-issued token and every request
    falls through to the network path below. To restore local-only
    verification, set JWT_SECRET_KEY to the value from the Supabase
    dashboard under Settings -> API -> JWT Settings ("Legacy JWT Secret") -
    that value isn't obtainable via the service-role key or any API call.
    """
    keys_to_try = [k for k in (settings.JWT_SECRET_KEY, settings.SECRET_KEY) if k]
    issuers_to_try = _local_issuers()
    if not keys_to_try or not issuers_to_try:
        return None

    for key in keys_to_try:
        for issuer in issuers_to_try:
            try:
                return jwt.decode(
                    token,
                    key,
                    algorithms=[settings.JWT_ALGORITHM],
                    audience=settings.JWT_AUDIENCE,
                    issuer=issuer,
                )
            except jwt.ExpiredSignatureError:
                raise
            except jwt.PyJWTError:
                continue
    return None


def _token_cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _token_expiry(token: str) -> float | None:
    try:
        claims = jwt.decode(token, options={"verify_signature": False, "verify_aud": False})
    except jwt.PyJWTError:
        return None
    exp = claims.get("exp") if isinstance(claims, dict) else None
    return float(exp) if isinstance(exp, (int, float)) else None


def _cache_verified_token(token: str, authenticated_user: dict) -> None:
    exp = _token_expiry(token)
    if not exp:
        return
    now = time.time()
    ttl_expiry = min(exp, now + _VERIFIED_TOKEN_CACHE_MAX_SECONDS)
    ttl_seconds = int(ttl_expiry - now)
    if ttl_seconds <= 0:
        return
    key = _token_cache_key(token)
    if len(_local_verified_token_cache) > _LOCAL_TOKEN_CACHE_MAX_ENTRIES:
        _local_verified_token_cache.clear()
    _local_verified_token_cache[key] = (ttl_expiry, authenticated_user)
    cache_set_json_sync(f"auth:token:{key}", authenticated_user, ttl_seconds)


def _read_verified_token_cache(token: str) -> dict | None:
    key = _token_cache_key(token)
    local = _local_verified_token_cache.get(key)
    if local:
        expires_at, authenticated_user = local
        if expires_at > time.time():
            return authenticated_user
        _local_verified_token_cache.pop(key, None)
    return cache_get_json_sync(f"auth:token:{key}")


def _user_payload_from_supabase_user(authenticated_user: dict) -> dict:
    return {
        "sub": str(authenticated_user.get("id")),
        "email": authenticated_user.get("email"),
        "app_metadata": authenticated_user.get("app_metadata") or {},
        "user_metadata": authenticated_user.get("user_metadata") or {},
        "role": "authenticated",
    }


def verify_token(
    credentials: HTTPAuthorizationCredentials = Security(security),
    request: Request = None,
) -> dict:
    """Validate bearer token via local signature verification first, falling
    back to the Supabase Auth API. The token's signature is always verified
    by one of these two paths before any claim in it is trusted."""
    ip = request.client.host if request is not None and request.client else None
    return verify_token_str(credentials.credentials, client_ip=ip)


def verify_token_str(token: str, client_ip: str | None = None) -> dict:
    """Throttled wrapper: an IP that keeps presenting bad tokens gets a fast
    429 before any verification work is done for it."""
    if client_ip and _auth_failures(client_ip) >= AUTH_FAILURES_PER_MINUTE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed sign-in attempts from this address. Wait a minute and try again.",
            headers={"Retry-After": "60"},
        )
    try:
        return _verify_token_str(token)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            _record_auth_failure(client_ip)
        raise


def _reject(token: str, detail: str = "Invalid or expired authentication credentials.") -> HTTPException:
    _remember_rejected(token)
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _verify_token_str(token: str) -> dict:
    """Same validation as verify_token, taking a raw token string directly -
    for callers that can't supply it via the Authorization header, e.g. a
    WebSocket handshake, where the token arrives as a query parameter."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    # 0. Not even shaped like a JWT, or already rejected in the last minute:
    # refuse without any network call.
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication credentials.")
    if _recently_rejected(token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired authentication credentials.")

    # 1a. Supabase's asymmetric (ES256) session tokens: verified locally
    # against the published key set. A bad signature, unknown key or wrong
    # issuer is final - no fallback, no network.
    if header.get("alg") in _ASYMMETRIC_ALGS:
        try:
            payload = _decode_with_jwks(token, header)
        except jwt.ExpiredSignatureError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired") from e
        except (jwt.PyJWTError, _UnknownSigningKey) as e:
            raise _reject(token) from e
        if isinstance(payload, dict) and payload.get("sub"):
            return {
                "sub": str(payload.get("sub")),
                "email": payload.get("email") or (payload.get("user_metadata") or {}).get("email"),
                "app_metadata": payload.get("app_metadata") or {},
                "user_metadata": payload.get("user_metadata") or {},
                "role": "authenticated",
            }
        if isinstance(payload, dict):
            raise _reject(token)
        # payload is None: the key set couldn't be fetched - fall through to
        # the Supabase Auth API below so an outage of the JWKS endpoint alone
        # doesn't sign everyone out.

    # 1b. Fast path: local HS256 signature verification against known keys/issuers.
    try:
        payload = _decode_locally(token)
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired"
        ) from e

    if isinstance(payload, dict) and payload.get("sub"):
        sub = str(payload.get("sub"))
        email = payload.get("email") or payload.get("user_metadata", {}).get("email")
        app_meta = payload.get("app_metadata") or {}
        user_meta = payload.get("user_metadata") or {}
        return {
            "sub": sub,
            "email": email,
            "app_metadata": app_meta,
            "user_metadata": user_meta,
            "role": payload.get("role") or "authenticated",
        }

    # 2. Redis-cached result of a prior Supabase verification for this same
    # token - the normal fast path once a token has been seen once, shared
    # across every worker process (not just this one). Falls through to a
    # live Supabase call below on a miss or expiry (same TTL as before,
    # _VERIFIED_TOKEN_CACHE_MAX_SECONDS capped against the token's own exp).
    cached_user = _read_verified_token_cache(token)
    if cached_user:
        return _user_payload_from_supabase_user(cached_user)

    # 3. Fallback to Supabase Auth verification endpoint. This call has the
    # Supabase service validate the token's signature server-side, so it
    # remains secure even when local verification above can't confirm it.
    # Transient failures are retried (tenacity, up to 3 attempts) and a
    # circuit breaker fails fast for a cooldown period if Supabase itself is
    # struggling, rather than every request blocking for the full
    # retry+timeout duration during an outage.
    if not _FALLBACK_CONCURRENCY.acquire(timeout=_FALLBACK_WAIT_SECONDS):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service busy. Please retry.",
        )
    try:
        return _verify_with_supabase(token)
    finally:
        _FALLBACK_CONCURRENCY.release()


def _verify_with_supabase(token: str) -> dict:
    try:
        try:
            response = _supabase_auth_breaker.call_sync(lambda: _call_supabase_auth_api(token))
        except CircuitBreakerOpen as exc:
            cached_user = _read_verified_token_cache(token)
            if cached_user:
                return _user_payload_from_supabase_user(cached_user)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service temporarily unavailable. Please retry.",
            ) from exc
        if response.status_code != 200:
            raise _reject(token)
        authenticated_user = response.json()
        if not isinstance(authenticated_user, dict) or not authenticated_user.get("id"):
            raise ValueError("Supabase did not return a user for this token.")
        _cache_verified_token(token, authenticated_user)
        return _user_payload_from_supabase_user(authenticated_user)
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        # Every retry attempt hit a 5xx from Supabase itself - a genuine
        # service failure, not a rejected token.
        cached_user = _read_verified_token_cache(token)
        if cached_user:
            return _user_payload_from_supabase_user(cached_user)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable. Please retry.",
        ) from exc
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        # The token itself was never rejected here - Supabase's auth API
        # couldn't be reached in time even after retrying. Reporting this as
        # 401 would make a transient network blip look like an invalid
        # session, prompting a needless sign-out. 503 lets callers retry.
        cached_user = _read_verified_token_cache(token)
        if cached_user:
            return _user_payload_from_supabase_user(cached_user)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable. Please retry.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication credentials.",
        ) from exc


async def resolve_primary_role(
    db: AsyncSession, user_id: str, org_id: str, fallback_role: str = "authenticated"
) -> tuple[str, str | None]:
    """Resolve a user's single canonical role and that role's default landing
    path. A user commonly holds both the default EMPLOYEE assignment from
    auto-provisioning and a specific functional role granted afterwards - the
    functional role should win. The ORDER BY puts any non-EMPLOYEE role ahead
    of EMPLOYEE (and SUPERADMIN ahead of everything), so the first row is
    correct. Shared by get_current_user (permission checks) and
    portals.py's /resolve-access (post-login routing) so both use the exact
    same precedence rule."""
    assigned = await db.execute(
        text("""
        SELECT r.name, r.default_landing_path FROM core.user_roles ur
        JOIN core.roles r ON r.id = ur.role_id
        WHERE ur.user_id = :user_id AND ur.organization_id = :org_id
          AND r.organization_id = :org_id AND r.is_deleted = false
        ORDER BY (r.name = :superadmin) DESC, (r.name = 'EMPLOYEE') ASC, r.name
    """),
        {"user_id": user_id, "org_id": org_id, "superadmin": SUPERADMIN_ROLE},
    )
    rows = assigned.fetchall() if hasattr(assigned, "fetchall") else list(assigned)
    role_names = [row.name for row in rows]
    if SUPERADMIN_ROLE in role_names:
        row = next(r for r in rows if r.name == SUPERADMIN_ROLE)
        return SUPERADMIN_ROLE, getattr(row, "default_landing_path", None)
    if rows:
        return rows[0].name, getattr(rows[0], "default_landing_path", None)
    return fallback_role, None


async def get_current_user(
    payload: dict = Depends(verify_token), db: AsyncSession = Depends(get_db)
) -> dict:
    """Extracts user identity and organization from the verified token payload."""
    user_id = payload.get("sub")

    app_metadata = _get_metadata(payload, "app_metadata")

    # Authorization claims must come from app_metadata; user_metadata is user-editable in Supabase.
    org_id = app_metadata.get("org_id") or app_metadata.get("organization_id")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User ID not found in token.",
        )

    # Account status and assignments must reflect committed revocations on
    # every request, so none of this is cached across requests. Instead the
    # identity row, the primary role, the full permission-key set and the
    # audit-actor set_config are fetched in ONE round trip (previously four
    # sequential ones, ~220ms each against eu-west-1 - AEGIS audit item 1.3).
    #
    # set_config makes the acting user visible to core.process_audit_log()
    # (the DB trigger backing core.audit_log) for the rest of this request's
    # transaction. Every write across the app goes through this same `db`
    # session (FastAPI caches Depends(get_db) per-request), so setting it once
    # here covers every module. Without it every audit_log row's created_by
    # is silently NULL. It's transaction-local, so running it before the
    # checks below reject a request is harmless.
    #
    # The role subquery mirrors resolve_primary_role's precedence exactly
    # (SUPERADMIN first, EMPLOYEE last). The LEFT JOIN from a one-row anchor
    # guarantees a row (and so the set_config) even for an unknown user;
    # user_exists tells that case apart from a revoked one.
    identity = await db.execute(
        text("""
        SELECT
            set_config('request.jwt.claim.sub', :actor_sub, true) AS actor_sub,
            (u.id IS NOT NULL) AS user_exists,
            u.organization_id,
            u.is_active,
            u.is_deleted,
            (
                SELECT r.name FROM core.user_roles ur
                JOIN core.roles r ON r.id = ur.role_id
                WHERE ur.user_id = u.id AND ur.organization_id = u.organization_id
                  AND r.organization_id = u.organization_id AND r.is_deleted = false
                ORDER BY (r.name = :superadmin) DESC, (r.name = 'EMPLOYEE') ASC, r.name
                LIMIT 1
            ) AS role_name,
            ARRAY(
                SELECT DISTINCT p.key
                FROM core.permissions p
                JOIN core.role_permissions rp ON p.id = rp.permission_id
                JOIN core.user_roles ur ON rp.role_id = ur.role_id
                JOIN core.roles r ON r.id = ur.role_id
                    AND r.organization_id = u.organization_id AND r.is_deleted = false
                WHERE ur.user_id = u.id AND ur.organization_id = u.organization_id
            ) AS permission_keys
        FROM (SELECT 1) AS anchor
        LEFT JOIN core.users u ON u.id = :user_id
    """),
        {"user_id": user_id, "actor_sub": str(user_id), "superadmin": SUPERADMIN_ROLE},
    )
    identity_row = identity.fetchone()
    if identity_row is not None and not identity_row.user_exists:
        identity_row = None

    # A row that exists but is deactivated/soft-deleted was deliberately
    # revoked - reject it outright. Falling through to the auto-provisioning
    # block below would silently reactivate it, since that block can't tell
    # "revoked" apart from "never existed".
    if identity_row and (not identity_row.is_active or identity_row.is_deleted):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive, unassigned, or revoked.",
        )

    if not identity_row or not identity_row.organization_id:
        default_org_id = "00000000-0000-0000-0000-000000000001"
        org_check = await db.execute(
            text("SELECT id FROM core.organizations WHERE id = :org_id AND is_deleted = false"),
            {"org_id": default_org_id},
        )
        if org_check.fetchone():
            # New/unrecognized identities are provisioned at the lowest
            # privilege level (EMPLOYEE). Elevated roles must be granted
            # explicitly by an admin afterwards, never auto-assigned here.
            default_role = await db.execute(
                text("""
                    SELECT id FROM core.roles
                    WHERE organization_id = :org_id AND name = 'EMPLOYEE' AND is_deleted = false
                """),
                {"org_id": default_org_id},
            )
            default_role_row = default_role.fetchone()
            if not default_role_row:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="No default role configured for this organization.",
                )
            default_role_id = str(default_role_row.id)

            email = payload.get("email") or f"{user_id}@aegis.local"
            user_meta = _get_metadata(payload, "user_metadata")
            full_name = user_meta.get("full_name") or email.split("@")[0]
            await db.execute(
                text("""
                    INSERT INTO core.users (id, organization_id, email, full_name, is_active)
                    VALUES (:user_id, :org_id, :email, :full_name, true)
                    ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, is_active = true
                """),
                {"user_id": user_id, "org_id": default_org_id, "email": email, "full_name": full_name},
            )
            await db.execute(
                text("""
                    INSERT INTO core.user_roles (user_id, role_id, organization_id)
                    VALUES (:user_id, :role_id, :org_id)
                    ON CONFLICT (user_id, role_id) DO NOTHING
                """),
                {"user_id": user_id, "role_id": default_role_id, "org_id": default_org_id},
            )
            await db.commit()
            # commit() ended the transaction the set_config above was local
            # to - re-set it so this request's writes are still attributed.
            await db.execute(
                text("SELECT set_config('request.jwt.claim.sub', :actor_sub, true)"),
                {"actor_sub": str(user_id)},
            )
            database_org_id = default_org_id
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is inactive, unassigned, or revoked.",
            )
    else:
        database_org_id = str(identity_row.organization_id)

    if org_id and str(org_id) != database_org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authentication tenant does not match the assigned organization.",
        )
    org_id = database_org_id

    # Token claims cannot restore a revoked assignment, including the last
    # SUPERADMIN role. An unassigned authenticated identity has no role grants.
    if identity_row is not None:
        resolved_role = identity_row.role_name or "authenticated"
        _remember_request_permissions(db, user_id, org_id, identity_row.permission_keys)
    else:
        # Just auto-provisioned above - rare, so the separate lookup is fine.
        resolved_role, _landing_path = await resolve_primary_role(db, user_id, org_id)

    return {
        "user_id": user_id,
        "sub": user_id,  # For backwards compatibility with auto-generated routes
        "org_id": org_id,
        "email": payload.get("email"),
        "role": resolved_role,
    }


def is_self_certification(actor_user_id, subject_creator_id) -> bool:
    """True when the person performing a sign-off action is the same person
    who created the thing being signed off on. Shared by every
    segregation-of-duties check (quotation win decisions, drawing revision
    checklists, SOP reviewer items) so the comparison logic - and its test
    coverage - lives in exactly one place. None on either side means "no
    creator recorded" and is never treated as a match (fail open on missing
    data here, not fail closed - an unattributed record shouldn't block a
    legitimate sign-off)."""
    if actor_user_id is None or subject_creator_id is None:
        return False
    return str(actor_user_id) == str(subject_creator_id)


async def user_has_permission(db: AsyncSession, user: dict, permission_key: str) -> bool:
    """Ad-hoc permission check for business logic that can't be expressed as
    a static route dependency (e.g. a permission requirement that only
    applies to certain rows, not the whole endpoint). Shares the same
    authoritative check as require_permission's dependency so the two never drift
    apart."""
    if user.get("role") == SUPERADMIN_ROLE:
        return True
    if not user.get("org_id"):
        return False
    return await _check_permission(db, user, permission_key)


_REQUEST_PERMISSIONS_KEY = "aegis_request_permission_keys"


def _remember_request_permissions(db: AsyncSession, user_id, org_id, permission_keys) -> None:
    """Stash the grants get_current_user already read on this request's own
    session, so the permission checks that follow in the same request don't
    re-query them. Scoped to the session (one per request via get_db), never
    shared across requests, so a revocation still applies from the very next
    request."""
    info = getattr(db, "info", None)
    if info is None:
        return
    info[_REQUEST_PERMISSIONS_KEY] = (str(user_id), str(org_id), frozenset(permission_keys or ()))


def _request_permissions(db: AsyncSession, user_id, org_id) -> frozenset[str] | None:
    info = getattr(db, "info", None)
    if not info:
        return None
    cached = info.get(_REQUEST_PERMISSIONS_KEY)
    if not cached or cached[0] != str(user_id) or cached[1] != str(org_id):
        return None
    return cached[2]


async def _check_permission(db: AsyncSession, user: dict, permission_key: str) -> bool:
    """Read current grants for every decision; cached grants cannot survive
    revocation. The only reuse is within a single request (see
    _remember_request_permissions)."""
    user_id = user.get("user_id")
    org_id = user.get("org_id")
    granted = _request_permissions(db, user_id, org_id)
    if granted is not None:
        return permission_key in granted
    result = await db.execute(
        text("""
            SELECT 1
            FROM core.permissions p
            JOIN core.role_permissions rp ON p.id = rp.permission_id
            JOIN core.user_roles ur ON rp.role_id = ur.role_id
            JOIN core.roles r ON r.id = ur.role_id AND r.organization_id = :org_id AND r.is_deleted = false
            WHERE ur.user_id = :user_id
              AND ur.organization_id = :org_id
              AND p.key = :permission_key
        """),
        {"user_id": user_id, "org_id": org_id, "permission_key": permission_key},
    )
    return bool(result.scalar())


async def get_user_permission_keys(db: AsyncSession, user: dict) -> set[str]:
    """All permission keys granted to this user, in one query - used to
    authorize a live WebSocket connection once at connect time rather than
    re-querying per event. SUPERADMIN gets every permission key in the
    catalog, matching how the rest of the app treats that role."""
    if user.get("role") == SUPERADMIN_ROLE:
        result = await db.execute(text("SELECT key FROM core.permissions"))
        return {row[0] for row in result.fetchall()}
    if not user.get("org_id"):
        return set()
    result = await db.execute(
        text("""
            SELECT DISTINCT p.key
            FROM core.permissions p
            JOIN core.role_permissions rp ON p.id = rp.permission_id
            JOIN core.user_roles ur ON rp.role_id = ur.role_id
            JOIN core.roles r ON r.id = ur.role_id AND r.organization_id = :org_id AND r.is_deleted = false
            WHERE ur.user_id = :user_id
              AND ur.organization_id = :org_id
        """),
        {"user_id": user.get("user_id"), "org_id": user.get("org_id")},
    )
    return {row[0] for row in result.fetchall()}


def require_permission(permission_key: str):
    """
    Dependency factory to enforce granular RBAC permissions (e.g., 'projects.create').
    Queries the database to check if the current user's role has the requested permission.
    """

    async def permission_checker(
        user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
    ):
        # Allow SUPERADMIN role inherently
        if user.get("role") == SUPERADMIN_ROLE:
            return user

        # Ensure user belongs to an organization
        if not user.get("org_id"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User does not belong to an organization.",
            )

        if not await _check_permission(db, user, permission_key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {permission_key}",
            )

        return user

    return permission_checker


def require_resource_permission(resource: str):
    """Apply a method-specific permission to generated CRUD routers."""
    method_actions = {
        "GET": "read",
        "POST": "create",
        "PUT": "update",
        "PATCH": "update",
        "DELETE": "delete",
    }

    async def resource_checker(
        request: Request,
        user: dict = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        action = method_actions.get(request.method)
        if not action:
            raise HTTPException(
                status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
                detail="Unsupported operation.",
            )
        if user.get("role") == SUPERADMIN_ROLE:
            return user
        permission_key = f"{resource}.{action}"
        if not await _check_permission(db, user, permission_key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {permission_key}",
            )
        return user

    return resource_checker
