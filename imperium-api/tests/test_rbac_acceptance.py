import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from core.security import (
    SUPERADMIN_ROLE,
    get_current_user,
    require_permission,
    require_resource_permission,
)


ROOT = Path(__file__).resolve().parents[1]


class FakeResult:
    def __init__(self, *, scalar_value=None, row=None):
        self.scalar_value = scalar_value
        self.row = row

    def scalar(self):
        return self.scalar_value

    def fetchone(self):
        return self.row


class FakeDb:
    def __init__(self, *results: FakeResult):
        self.results = list(results)
        self.calls = []

    async def execute(self, query, params=None):
        self.calls.append({"query": str(query), "params": params or {}})
        if not self.results:
            raise AssertionError("Unexpected database query.")
        return self.results.pop(0)


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
    db = FakeDb(FakeResult(row=None))

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
async def test_get_current_user_rejects_token_tenant_mismatch():
    db = FakeDb(FakeResult(row=SimpleNamespace(organization_id="org-1")))

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
    db = FakeDb(
        FakeResult(row=SimpleNamespace(organization_id="org-1")),
        FakeResult(scalar_value=1),
    )

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
        keys.update(re.findall(r"'([a-z_]+(?:[._][a-z_]+)+)'", path.read_text()))

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
