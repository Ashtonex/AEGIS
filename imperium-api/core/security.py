from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import jwt
import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from core.database import get_db
from core.config import settings
from core.resilience import CircuitBreaker, CircuitBreakerOpen

security = HTTPBearer()

# Tracks the Supabase Auth API specifically (the network fallback path in
# verify_token below) so a struggling/unreachable Supabase fails fast for a
# cooldown period instead of every single request blocking for the full
# retry+timeout duration during an outage.
_supabase_auth_breaker = CircuitBreaker(
    "supabase_auth", failure_threshold=5, reset_timeout_seconds=30.0
)


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


def verify_token(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    """Validate bearer token via local signature verification first, falling
    back to the Supabase Auth API. The token's signature is always verified
    by one of these two paths before any claim in it is trusted."""
    token = credentials.credentials
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
        return {
            "sub": str(authenticated_user.get("id")),
            "email": authenticated_user.get("email"),
            "app_metadata": authenticated_user.get("app_metadata") or {},
            "user_metadata": authenticated_user.get("user_metadata") or {},
            "role": "authenticated",
        }
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        # Every retry attempt hit a 5xx from Supabase itself - a genuine
        # service failure, not a rejected token.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable. Please retry.",
        ) from exc
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        # The token itself was never rejected here - Supabase's auth API
        # couldn't be reached in time even after retrying. Reporting this as
        # 401 would make a transient network blip look like an invalid
        # session, prompting a needless sign-out. 503 lets callers retry.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable. Please retry.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication credentials.",
        ) from exc


async def get_current_user(
    payload: dict = Depends(verify_token), db: AsyncSession = Depends(get_db)
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

    identity = await db.execute(
        text("""
        SELECT organization_id, is_active, is_deleted FROM core.users
        WHERE id = :user_id
    """),
        {"user_id": user_id},
    )
    identity_row = identity.fetchone()

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

    # The role assignment in core is authoritative. Nothing keeps Supabase's
    # app_metadata.role claim in sync with core.user_roles once an admin
    # assigns a functional role via Settings, so the actual role name is
    # looked up here rather than trusted from the token.
    assigned_roles = await db.execute(
        text("""
        SELECT r.name FROM core.user_roles ur
        JOIN core.roles r ON r.id = ur.role_id
        WHERE ur.user_id = :user_id AND ur.organization_id = :org_id
          AND r.organization_id = :org_id AND r.is_deleted = false
        ORDER BY (r.name = :superadmin) DESC, (r.name = 'EMPLOYEE') ASC, r.name
    """),
        {"user_id": user_id, "org_id": org_id, "superadmin": SUPERADMIN_ROLE},
    )
    # A user commonly holds both the default EMPLOYEE assignment from
    # auto-provisioning and a specific functional role granted afterwards -
    # the functional role should win. The ORDER BY above already puts any
    # non-EMPLOYEE role ahead of EMPLOYEE, so the first row is correct.
    role_names = [row.name for row in assigned_roles]
    if SUPERADMIN_ROLE in role_names:
        resolved_role = SUPERADMIN_ROLE
    elif role_names:
        resolved_role = role_names[0]
    else:
        resolved_role = role

    # Makes the acting user visible to core.process_audit_log() (the DB
    # trigger backing core.audit_log) for the rest of this request's
    # transaction. Every write across the app already goes through this same
    # `db` session (FastAPI caches Depends(get_db) per-request), so setting
    # this once here - rather than once per router - covers every module.
    # Without it, every audit_log row's created_by is silently NULL: the
    # trigger reads this session variable and nothing ever set it.
    await db.execute(text("SELECT set_config('request.jwt.claim.sub', :uid, true)"), {"uid": str(user_id)})

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
        {"user_id": user.get("user_id"), "org_id": user.get("org_id"), "permission_key": permission_key},
    )
    return bool(result.scalar())


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

        # Execute query to verify permission link: users -> user_roles -> roles -> role_permissions -> permissions
        # Table names qualified with 'core.' schema prefix
        query = text("""
            SELECT 1 
            FROM core.permissions p
            JOIN core.role_permissions rp ON p.id = rp.permission_id
            JOIN core.user_roles ur ON rp.role_id = ur.role_id
            JOIN core.roles r ON r.id = ur.role_id AND r.organization_id = :org_id AND r.is_deleted = false
            WHERE ur.user_id = :user_id 
              AND ur.organization_id = :org_id 
              AND p.key = :permission_key
        """)

        result = await db.execute(
            query,
            {
                "user_id": user.get("user_id"),
                "org_id": user.get("org_id"),
                "permission_key": permission_key,
            },
        )

        if not result.scalar():
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
        result = await db.execute(
            text("""
            SELECT 1 FROM core.permissions p
            JOIN core.role_permissions rp ON rp.permission_id = p.id
            JOIN core.user_roles ur ON ur.role_id = rp.role_id AND ur.user_id = :user_id AND ur.organization_id = :org_id
            JOIN core.roles r ON r.id = ur.role_id AND r.organization_id = :org_id AND r.is_deleted = false
            WHERE p.key = :permission_key
        """),
            {
                "user_id": user["user_id"],
                "org_id": user["org_id"],
                "permission_key": permission_key,
            },
        )
        if not result.scalar():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {permission_key}",
            )
        return user

    return resource_checker
