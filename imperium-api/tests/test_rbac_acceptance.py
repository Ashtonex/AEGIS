import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from core.security import (
    SUPERADMIN_ROLE,
    get_current_user,
    require_permission,
    require_resource_permission,
)


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def warm_authorization_cache(monkeypatch):
    from core import cache

    redis = SimpleNamespace(
        get=AsyncMock(return_value='{"organization_id":"org-1","role":"SUPERADMIN"}'),
        set=AsyncMock(),
    )
    monkeypatch.setattr(cache, "_async_client", redis)
    return redis


@pytest.mark.asyncio
@pytest.mark.parametrize("active,deleted", [(False, False), (True, True)])
async def test_warm_identity_cache_cannot_override_account_revocation(warm_authorization_cache, active, deleted):
    db = FakeDb(FakeResult(row=identity(is_active=active, is_deleted=deleted, role_name="SUPERADMIN")))
    with pytest.raises(HTTPException) as exc:
        await get_current_user({"sub": "user-1", "app_metadata": {"org_id": "org-1", "role": "SUPERADMIN"}}, db)
    assert exc.value.status_code == 403
    assert len(db.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("assigned,expected", [(None, "authenticated"), ("EMPLOYEE", "EMPLOYEE"), ("SUPERADMIN", "SUPERADMIN")])
async def test_current_assignments_override_warm_cache_and_stale_admin_claim(warm_authorization_cache, assigned, expected):
    db = FakeDb(FakeResult(row=identity(role_name=assigned)))
    resolved = await get_current_user({"sub": "user-1", "app_metadata": {"org_id": "org-1", "role": "SUPERADMIN"}}, db)
    assert resolved["role"] == expected
    # Identity, role, permissions and the audit-actor set_config: one round trip.
    assert len(db.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("granted", [None, 1])
@pytest.mark.parametrize("entrypoint", ["permission", "resource", "business"])
async def test_current_permission_grants_override_warm_cache(warm_authorization_cache, granted, entrypoint):
    from core.security import user_has_permission

    warm_authorization_cache.get.return_value = "true"
    db = FakeDb(FakeResult(scalar_value=granted))
    if entrypoint == "business":
        assert await user_has_permission(db, user(), "workforce.update") is bool(granted)
    else:
        async def check():
            if entrypoint == "permission":
                return await require_permission("workforce.update")(user(), db)
            return await require_resource_permission("workforce")(FakeRequest("PATCH"), user(), db)

        if granted:
            assert (await check())["user_id"] == "user-1"
        else:
            with pytest.raises(HTTPException) as exc:
                await check()
            assert exc.value.status_code == 403
    assert len(db.calls) == 1


class FakeResult:
    def __init__(self, *, scalar_value=None, row=None, rows=None):
        self.scalar_value = scalar_value
        self.row = row
        self.rows = rows or []

    def scalar(self):
        return self.scalar_value

    def fetchone(self):
        return self.row

    def __iter__(self):
        return iter(self.rows)


class FakeDb:
    def __init__(self, *results: FakeResult):
        self.results = list(results)
        self.calls = []

    async def execute(self, query, params=None):
        self.calls.append({"query": str(query), "params": params or {}})
        if not self.results:
            raise AssertionError("Unexpected database query.")
        return self.results.pop(0)


class InfoFakeDb(FakeDb):
    """A FakeDb with a per-session info dict, like a real AsyncSession."""

    def __init__(self, *results: FakeResult):
        super().__init__(*results)
        self.info = {}


def identity(*, organization_id="org-1", is_active=True, is_deleted=False, role_name=None, permission_keys=()):
    return SimpleNamespace(
        actor_sub="user-1",
        user_exists=True,
        organization_id=organization_id,
        is_active=is_active,
        is_deleted=is_deleted,
        role_name=role_name,
        permission_keys=list(permission_keys),
    )


class FakeRequest:
    def __init__(self, method: str):
        self.method = method


def user(role: str = "authenticated") -> dict[str, str]:
    return {
        "user_id": "user-1",
        "sub": "user-1",
        "org_id": "org-1",
        "email": "user@example.com",
        "role": role,
    }


@pytest.mark.asyncio
async def test_get_current_user_rejects_inactive_or_unassigned_identity():
    db = FakeDb(FakeResult(row=None), FakeResult(row=None))

    with pytest.raises(HTTPException) as exc:
        await get_current_user(
            {
                "sub": "user-1",
                "email": "user@example.com",
                "app_metadata": {"org_id": "org-1"},
            },
            db,
        )

    assert exc.value.status_code == 403
    assert "inactive" in exc.value.detail


@pytest.mark.asyncio
async def test_get_current_user_rejects_deactivated_identity_without_reprovisioning():
    # Only one FakeResult is queued: if get_current_user fell through to the
    # auto-provisioning branch (as it used to, since that branch can't
    # distinguish "deactivated" from "never existed"), it would try to
    # INSERT/UPDATE the user back to is_active=true and raise
    # AssertionError("Unexpected database query.") here instead.
    db = FakeDb(FakeResult(row=identity(is_active=False)))

    with pytest.raises(HTTPException) as exc:
        await get_current_user(
            {
                "sub": "user-1",
                "email": "user@example.com",
                "app_metadata": {"org_id": "org-1"},
            },
            db,
        )

    assert exc.value.status_code == 403
    assert "inactive" in exc.value.detail
    assert len(db.calls) == 1


@pytest.mark.asyncio
async def test_get_current_user_rejects_token_tenant_mismatch():
    db = FakeDb(FakeResult(row=identity()))

    with pytest.raises(HTTPException) as exc:
        await get_current_user(
            {
                "sub": "user-1",
                "email": "user@example.com",
                "app_metadata": {"org_id": "org-2"},
            },
            db,
        )

    assert exc.value.status_code == 403
    assert "tenant" in exc.value.detail


@pytest.mark.asyncio
async def test_get_current_user_resolves_superadmin_from_database_role():
    db = FakeDb(FakeResult(row=identity(role_name=SUPERADMIN_ROLE)))

    resolved = await get_current_user(
        {
            "sub": "user-1",
            "email": "user@example.com",
            "role": "authenticated",
            "app_metadata": {"org_id": "org-1"},
        },
        db,
    )

    assert resolved["role"] == SUPERADMIN_ROLE
    assert resolved["org_id"] == "org-1"


@pytest.mark.asyncio
async def test_identity_query_sets_audit_actor_in_same_round_trip():
    db = FakeDb(FakeResult(row=identity(role_name="EMPLOYEE")))

    await get_current_user({"sub": "user-1", "app_metadata": {"org_id": "org-1"}}, db)

    assert len(db.calls) == 1
    assert "set_config('request.jwt.claim.sub', :actor_sub, true)" in db.calls[0]["query"]
    assert db.calls[0]["params"]["actor_sub"] == "user-1"


@pytest.mark.asyncio
async def test_unknown_identity_row_from_left_join_is_not_treated_as_revoked():
    # The anchor LEFT JOIN always returns a row; with no core.users match it
    # must fall into provisioning (here: default org missing -> 403 via the
    # org check, i.e. a second query), not the "revoked" early rejection.
    missing = SimpleNamespace(user_exists=False, organization_id=None, is_active=None, is_deleted=None,
                              role_name=None, permission_keys=[])
    db = FakeDb(FakeResult(row=missing), FakeResult(row=None))

    with pytest.raises(HTTPException) as exc:
        await get_current_user({"sub": "user-1", "app_metadata": {}}, db)

    assert exc.value.status_code == 403
    assert len(db.calls) == 2
    assert "core.organizations" in db.calls[1]["query"]


@pytest.mark.asyncio
@pytest.mark.parametrize("entrypoint", ["permission", "resource", "business"])
async def test_permission_checks_reuse_grants_read_by_this_request(entrypoint):
    from core.security import user_has_permission

    db = InfoFakeDb(FakeResult(row=identity(role_name="QS", permission_keys=["workforce.update"])))
    current = await get_current_user({"sub": "user-1", "app_metadata": {"org_id": "org-1"}}, db)

    if entrypoint == "business":
        assert await user_has_permission(db, current, "workforce.update") is True
        assert await user_has_permission(db, current, "workforce.delete") is False
    elif entrypoint == "permission":
        assert (await require_permission("workforce.update")(current, db))["user_id"] == "user-1"
        with pytest.raises(HTTPException) as exc:
            await require_permission("workforce.delete")(current, db)
        assert exc.value.status_code == 403
    else:
        assert (await require_resource_permission("workforce")(FakeRequest("PATCH"), current, db))["user_id"] == "user-1"
        with pytest.raises(HTTPException):
            await require_resource_permission("workforce")(FakeRequest("DELETE"), current, db)

    # Only the identity query ran - no per-check permission round trips.
    assert len(db.calls) == 1


@pytest.mark.asyncio
async def test_request_grants_are_not_reused_for_a_different_user():
    db = InfoFakeDb(
        FakeResult(row=identity(role_name="QS", permission_keys=["workforce.update"])),
        FakeResult(scalar_value=None),
    )
    await get_current_user({"sub": "user-1", "app_metadata": {"org_id": "org-1"}}, db)

    other = {**user(), "user_id": "user-2", "sub": "user-2"}
    with pytest.raises(HTTPException):
        await require_permission("workforce.update")(other, db)
    assert len(db.calls) == 2


@pytest.mark.asyncio
async def test_require_permission_allows_superadmin_without_permission_query():
    db = FakeDb()
    checker = require_permission("settings.update")

    resolved = await checker(user(SUPERADMIN_ROLE), db)

    assert resolved["role"] == SUPERADMIN_ROLE
    assert db.calls == []


@pytest.mark.asyncio
async def test_require_permission_allows_granted_role_permission():
    db = FakeDb(FakeResult(scalar_value=1))
    checker = require_permission("fleet.create")

    resolved = await checker(user(), db)

    assert resolved["user_id"] == "user-1"
    assert db.calls[0]["params"]["permission_key"] == "fleet.create"


@pytest.mark.asyncio
async def test_require_permission_denies_missing_role_permission():
    db = FakeDb(FakeResult(scalar_value=None))
    checker = require_permission("fleet.delete")

    with pytest.raises(HTTPException) as exc:
        await checker(user(), db)

    assert exc.value.status_code == 403
    assert exc.value.detail == "Missing required permission: fleet.delete"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "permission",
    [
        "crm.support.read",
        "crm.support.create",
        "crm.support.update",
        "crm.automations.execute",
        "crm.import",
        "crm.export",
        "crm.reports.read",
        "crm.marketing.read",
        "crm.marketing.create",
        "crm.customer360.read",
        "crm.opportunities.quote",
        "crm.opportunities.close",
        "crm.opportunities.close_won",
    ],
)
async def test_require_permission_gates_consolidated_crm_permissions(permission: str):
    """Phase 12 direct-coverage: the Phase 7-11 CRM work consolidated/introduced these
    exact permission keys (support tickets, automation execution, import/export,
    reports, marketing, customer-360, opportunity quote/close). Each must be
    independently grantable and independently deniable through require_permission."""
    allow_db = FakeDb(FakeResult(scalar_value=1))
    allow_checker = require_permission(permission)
    resolved = await allow_checker(user(), allow_db)
    assert resolved["user_id"] == "user-1"
    assert allow_db.calls[0]["params"]["permission_key"] == permission

    deny_db = FakeDb(FakeResult(scalar_value=None))
    deny_checker = require_permission(permission)
    with pytest.raises(HTTPException) as exc:
        await deny_checker(user(), deny_db)
    assert exc.value.status_code == 403
    assert exc.value.detail == f"Missing required permission: {permission}"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "permission"),
    [
        ("GET", "projects.read"),
        ("POST", "projects.create"),
        ("PUT", "projects.update"),
        ("PATCH", "projects.update"),
        ("DELETE", "projects.delete"),
    ],
)
async def test_require_resource_permission_maps_http_methods_to_actions(
    method: str, permission: str
):
    db = FakeDb(FakeResult(scalar_value=1))
    checker = require_resource_permission("projects")

    resolved = await checker(FakeRequest(method), user(), db)

    assert resolved["user_id"] == "user-1"
    assert db.calls[0]["params"]["permission_key"] == permission


@pytest.mark.asyncio
async def test_require_resource_permission_rejects_unsupported_methods():
    checker = require_resource_permission("projects")

    with pytest.raises(HTTPException) as exc:
        await checker(FakeRequest("OPTIONS"), user(), FakeDb())

    assert exc.value.status_code == 405


def _router_permission_keys() -> set[str]:
    keys = set()
    for path in (ROOT / "routers").glob("*.py"):
        keys.update(re.findall(r'require_permission\("([^"]+)"\)', path.read_text()))
    return keys


def _seeded_permission_keys() -> set[str]:
    keys = set()
    migration_dir = ROOT / "migrations"
    for path in migration_dir.glob("*.sql"):
        keys.update(re.findall(r"'([a-z0-9_]+(?:[._][a-z0-9_]+)+)'", path.read_text()))

    generated = (migration_dir / "011_resource_action_permissions.sql").read_text()
    resource_array = re.search(r"ARRAY\[(.*?)\]\) AS resource", generated, re.S)
    assert resource_array is not None
    resources = re.findall(r"'([^']+)'", resource_array.group(1))
    for resource in resources:
        for action in ("read", "create", "update", "delete"):
            keys.add(f"{resource}.{action}")
    return keys


def test_all_router_permission_keys_are_seeded_by_migrations():
    missing = _router_permission_keys() - _seeded_permission_keys()

    assert missing == set()
