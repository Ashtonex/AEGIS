from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import jwt
import httpx
import hashlib
import time
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from core.database import get_db
from core.config import settings
from core.cache import cache_delete, cache_delete_prefix, cache_get_json, cache_set_json
from core.resilience import CircuitBreaker, CircuitBreakerOpen

security = HTTPBearer()

# ---------------------------------------------------------------------------
# Authorization context cache
# ---------------------------------------------------------------------------
# Resolving who the caller is and what they may do used to cost four
# sequential database round trips on *every* authenticated request:
#   1. SELECT ... FROM core.users            (identity + tenant)
#   2. resolve_primary_role()                (role precedence)
#   3. SELECT set_config('request.jwt...')   (audit trigger plumbing)
#   4. require_permission/_resource_permission (the actual check)
# At the ~220ms RTT to Supabase in eu-west-1 that is ~0.9s of authorization
# latency per call, on pages that fire 10-15 calls - and it held the pooled
# connection for that whole time, which is what exhausted the pool.
#
# Steps 1, 2 and 4 are now a single query (_AUTH_CONTEXT_SQL) whose result is
# cached per user, so a warm request spends zero round trips on authorization.
# Step 3 is only issued for state-changing methods, since the audit trigger it
# feeds only fires on writes.
#
# Staleness: a cached permission set means a revoked role stays effective
# until the entry expires. Two things bound that - a short TTL
# (settings.AUTH_CACHE_TTL_SECONDS, default 60s) and explicit invalidation
# from every code path that changes roles, permissions or account status
# (invalidate_user_auth / invalidate_all_auth). Anything that mutates
# core.users, core.user_roles, core.roles, core.role_permissions or
# core.permissions MUST call one of those.
_AUTH_CACHE_PREFIX = "aegis:authctx:v1:"


def _auth_cache_key(user_id: str) -> str:
    return f"{_AUTH_CACHE_PREFIX}{user_id}"


async def invalidate_user_auth(user_id: str | None) -> None:
    """Drop one user's cached authorization context. Call this immediately
    after changing that user's roles, permissions, organization or active/
    deleted status, so the change takes effect on their next request instead
    of up to AUTH_CACHE_TTL_SECONDS later."""
    if not user_id:
        return
    await cache_delete(_auth_cache_key(str(user_id)))


async def invalidate_all_auth() -> None:
    """Drop every cached authorization context. Use for changes whose blast
    radius isn't a single user - editing a role's permission set, deleting a
    role, or changing the permission catalogue. These are rare admin actions,
    so clearing the whole prefix is cheaper to reason about than working out
    which users were affected, and it cannot under-invalidate."""
    await cache_delete_prefix(_AUTH_CACHE_PREFIX)


# One round trip for identity, role precedence and the full permission key
# set. The role ordering is applied inside json_agg (not in the CTE) because
# a CTE's ORDER BY is not guaranteed to survive aggregation. It mirrors
# resolve_primary_role() exactly: SUPERADMIN first, then any functional role,
# then EMPLOYEE last, then alphabetical.
_AUTH_CONTEXT_SQL = text("""
WITH u AS (
    SELECT organization_id, is_active, is_deleted
    FROM core.users
    WHERE id = :user_id
),
r AS (
    SELECT r.name AS name,
           r.default_landing_path AS path,
           (r.name = :superadmin) AS is_super,
           (r.name = 'EMPLOYEE') AS is_employee
    FROM core.user_roles ur
    JOIN core.roles r ON r.id = ur.role_id
    WHERE ur.user_id = :user_id
      AND ur.organization_id = (SELECT organization_id FROM u)
      AND r.organization_id = (SELECT organization_id FROM u)
      AND r.is_deleted = false
),
p AS (
    SELECT DISTINCT perm.key AS key
    FROM core.permissions perm
    JOIN core.role_permissions rp ON rp.permission_id = perm.id
    JOIN core.user_roles ur ON ur.role_id = rp.role_id
    JOIN core.roles r ON r.id = ur.role_id
    WHERE ur.user_id = :user_id
      AND ur.organization_id = (SELECT organization_id FROM u)
      AND r.organization_id = (SELECT organization_id FROM u)
      AND r.is_deleted = false
)
SELECT
    (SELECT EXISTS (SELECT 1 FROM u))                        AS user_exists,
    (SELECT organization_id FROM u)                          AS organization_id,
    COALESCE((SELECT is_active FROM u), false)               AS is_active,
    COALESCE((SELECT is_deleted FROM u), false)              AS is_deleted,
    COALESCE((
        SELECT json_agg(json_build_object('name', name, 'path', path)
                        ORDER BY is_super DESC, is_employee ASC, name)
        FROM r
    ), '[]'::json)                                           AS roles,
    COALESCE((SELECT json_agg(key ORDER BY key) FROM p), '[]'::json) AS permission_keys
""")

# Tracks the Supabase Auth API specifically (the network fallback path in
# verify_token below) so a struggling/unreachable Supabase fails fast for a
# cooldown period instead of every single request blocking for the full
# retry+timeout duration during an outage.
_supabase_auth_breaker = CircuitBreaker(
    "supabase_auth", failure_threshold=5, reset_timeout_seconds=30.0
)
_verified_token_cache: dict[str, tuple[float, dict]] = {}
_VERIFIED_TOKEN_CACHE_MAX_SECONDS = 300


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
    with httpx.Client(timeout=10.0) as client:
        response = client.get(
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
    if ttl_expiry <= now:
        return
    _verified_token_cache[_token_cache_key(token)] = (ttl_expiry, authenticated_user)


def _read_verified_token_cache(token: str) -> dict | None:
    key = _token_cache_key(token)
    cached = _verified_token_cache.get(key)
    if not cached:
        return None
    expires_at, authenticated_user = cached
    if expires_at <= time.time():
        _verified_token_cache.pop(key, None)
        return None
    return authenticated_user


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
) -> dict:
    """Validate bearer token via local signature verification first, falling
    back to the Supabase Auth API. The token's signature is always verified
    by one of these two paths before any claim in it is trusted."""
    return verify_token_str(credentials.credentials)


def verify_token_str(token: str) -> dict:
    """Same validation as verify_token, taking a raw token string directly -
    for callers that can't supply it via the Authorization header, e.g. a
    WebSocket handshake, where the token arrives as a query parameter."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    # 1. Fast path: local signature verification against known keys/issuers.
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

    # 2. Fallback to Supabase Auth verification endpoint. This call has the
    # Supabase service validate the token's signature server-side, so it
    # remains secure even when local verification above can't confirm it.
    # Transient failures are retried (tenacity, up to 3 attempts) and a
    # circuit breaker fails fast for a cooldown period if Supabase itself is
    # struggling, rather than every request blocking for the full
    # retry+timeout duration during an outage.
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
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired authentication credentials.",
            )
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


_EMPTY_AUTH_CONTEXT: dict = {
    "user_exists": False,
    "org_id": None,
    "is_active": False,
    "is_deleted": False,
    "role": None,
    "landing_path": None,
    "permissions": [],
}


async def _fetch_auth_context(db: AsyncSession, user_id: str) -> dict:
    """Identity, role precedence and the full permission key set in a single
    round trip. Returns the raw shape; callers decide what to do about a
    missing/inactive user."""
    result = await db.execute(
        _AUTH_CONTEXT_SQL, {"user_id": user_id, "superadmin": SUPERADMIN_ROLE}
    )
    row = result.fetchone()

    # No row at all is the same situation as a row saying the user doesn't
    # exist: nothing usable to authorize with. Returning the empty shape here
    # rather than indexing into None keeps the not-provisioned path in
    # get_current_user as the single place that decides what to do about it.
    if row is None:
        return _EMPTY_AUTH_CONTEXT.copy()

    roles = row.roles if isinstance(row.roles, list) else []
    permission_keys = row.permission_keys if isinstance(row.permission_keys, list) else []
    primary = roles[0] if roles else None
    return {
        "user_exists": bool(row.user_exists),
        "org_id": str(row.organization_id) if row.organization_id else None,
        "is_active": bool(row.is_active),
        "is_deleted": bool(row.is_deleted),
        "role": primary["name"] if primary else None,
        "landing_path": primary.get("path") if primary else None,
        "permissions": permission_keys,
    }


async def get_auth_context(
    db: AsyncSession, user_id: str, *, allow_cache: bool = True
) -> dict | None:
    """Cached wrapper around _fetch_auth_context.

    Returns None when the user has no usable record, leaving the
    auto-provisioning decision to get_current_user. A cache hit costs zero
    database round trips, which is the entire point of this module - see the
    block comment at the top of the file.

    Only *usable* contexts are cached. An inactive, deleted or unprovisioned
    user is never written to the cache, so a revocation can't be masked by a
    stale positive entry and a freshly provisioned account isn't shadowed by a
    cached negative one.
    """
    cache_enabled = allow_cache and settings.AUTH_CACHE_ENABLED and settings.AUTH_CACHE_TTL_SECONDS > 0

    if cache_enabled:
        hit, cached = await cache_get_json(_auth_cache_key(user_id))
        if hit and isinstance(cached, dict):
            return cached

    context = await _fetch_auth_context(db, user_id)
    if not context["user_exists"] or not context["org_id"]:
        return None
    if not context["is_active"] or context["is_deleted"]:
        # Surfaced to the caller as a revoked account, and deliberately not
        # cached - see the docstring.
        return context

    if cache_enabled:
        await cache_set_json(
            _auth_cache_key(user_id), context, settings.AUTH_CACHE_TTL_SECONDS
        )
    return context


# Methods that can write, and therefore need request.jwt.claim.sub set for
# core.process_audit_log(). GET/HEAD/OPTIONS never fire the audit trigger, so
# issuing the set_config round trip for them was pure latency.
_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


async def get_current_user(
    request: Request,
    payload: dict = Depends(verify_token),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Extracts user identity and organization from the verified token payload."""
    user_id = payload.get("sub")

    app_metadata = _get_metadata(payload, "app_metadata")

    # Authorization claims must come from app_metadata; user_metadata is user-editable in Supabase.
    org_id = app_metadata.get("org_id") or app_metadata.get("organization_id")
    app_role = app_metadata.get("role")
    role = app_role or payload.get("role", "authenticated")
    if app_role != SUPERADMIN_ROLE and role == SUPERADMIN_ROLE:
        role = "authenticated"

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User ID not found in token.",
        )

    # One cached lookup replaces the identity SELECT, the role-resolution
    # query and the permission query. On a warm cache this costs no database
    # round trips at all.
    auth_context = await get_auth_context(db, str(user_id))

    # A row that exists but is deactivated/soft-deleted was deliberately
    # revoked - reject it outright. Falling through to the auto-provisioning
    # block below would silently reactivate it, since that block can't tell
    # "revoked" apart from "never existed".
    if auth_context and (not auth_context["is_active"] or auth_context["is_deleted"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive, unassigned, or revoked.",
        )

    if not auth_context:
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
            # Re-resolve after provisioning so role and permissions reflect
            # the freshly inserted EMPLOYEE assignment. allow_cache=False
            # because the pre-provisioning state must not be read back here.
            auth_context = await get_auth_context(db, str(user_id), allow_cache=False)
            if not auth_context:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account is inactive, unassigned, or revoked.",
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is inactive, unassigned, or revoked.",
            )

    database_org_id = auth_context["org_id"]

    if org_id and str(org_id) != database_org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authentication tenant does not match the assigned organization.",
        )
    org_id = database_org_id

    # The role assignment in core is authoritative. Nothing keeps Supabase's
    # app_metadata.role claim in sync with core.user_roles once an admin
    # assigns a functional role via Settings, so the actual role name comes
    # from the resolved context rather than the token. Falls back to the
    # token-derived role only when the user holds no role assignment at all,
    # matching resolve_primary_role's fallback_role behaviour.
    resolved_role = auth_context["role"] or role

    # Makes the acting user visible to core.process_audit_log() (the DB
    # trigger backing core.audit_log) for the rest of this request's
    # transaction. Every write across the app already goes through this same
    # `db` session (FastAPI caches Depends(get_db) per-request), so setting
    # this once here - rather than once per router - covers every module.
    # Without it, every audit_log row's created_by is silently NULL: the
    # trigger reads this session variable and nothing ever set it.
    #
    # Only issued for methods that can write. The audit trigger fires on
    # INSERT/UPDATE/DELETE only, so spending a ~220ms round trip on this for
    # every GET bought nothing - and GETs are the overwhelming majority of
    # traffic on a dashboard that fires 10-15 reads per page.
    if request.method in _MUTATING_METHODS:
        await db.execute(
            text("SELECT set_config('request.jwt.claim.sub', :uid, true)"),
            {"uid": str(user_id)},
        )

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
    query as require_permission's dependency so the two never drift apart."""
    if user.get("role") == SUPERADMIN_ROLE:
        return True
    if not user.get("org_id"):
        return False
    # Reads the same cached authorization context get_current_user resolved
    # earlier in this request, so this is a set membership test rather than a
    # database round trip.
    context = await get_auth_context(db, str(user.get("user_id")))
    if not context:
        return False
    return permission_key in set(context.get("permissions") or [])


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
    context = await get_auth_context(db, str(user.get("user_id")))
    if not context:
        return set()
    return set(context.get("permissions") or [])


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

        # Verifies the same link the old query walked (users -> user_roles ->
        # roles -> role_permissions -> permissions) but against the permission
        # set already resolved and cached by get_current_user for this
        # request, so the check costs no additional round trip.
        context = await get_auth_context(db, str(user.get("user_id")))
        granted = set(context.get("permissions") or []) if context else set()

        if permission_key not in granted:
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
        # Cached permission set - the fourth and last of the four per-request
        # authorization round trips this refactor removed.
        context = await get_auth_context(db, str(user["user_id"]))
        granted = set(context.get("permissions") or []) if context else set()
        if permission_key not in granted:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {permission_key}",
            )
        return user

    return resource_checker
