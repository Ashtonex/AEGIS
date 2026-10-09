from pathlib import Path

import pytest
from fastapi import HTTPException

import core.project_scope as scope

ROOT = Path(__file__).resolve().parents[1]


def test_unrestricted_users_get_no_filter():
    assert scope.project_scope_sql("p.id", None) == ("TRUE", {})


def test_scoped_users_filter_by_their_project_ids():
    sql, params = scope.project_scope_sql("mr.project_id", ["a", "b"])
    assert "mr.project_id" in sql and ":scope_project_ids" in sql
    assert params == {"scope_project_ids": ["a", "b"]}


@pytest.mark.asyncio
async def test_unassigned_project_is_not_found(monkeypatch):
    async def visible(db, user):
        return ["assigned-project"]

    monkeypatch.setattr(scope, "visible_project_ids", visible)
    await scope.require_project_access(None, {}, "assigned-project")
    with pytest.raises(HTTPException) as exc:
        await scope.require_project_access(None, {}, "someone-elses-project")
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_read_all_users_reach_any_project(monkeypatch):
    async def visible(db, user):
        return None

    monkeypatch.setattr(scope, "visible_project_ids", visible)
    await scope.require_project_access(None, {}, "any-project")


def test_site_routers_apply_project_scope():
    for router in ("projects.py", "site_reports.py"):
        source = (ROOT / "routers" / router).read_text(encoding="utf-8")
        assert "APIRouter(dependencies=[Depends(enforce_project_path_scope)])" in source
    site_reports = (ROOT / "routers" / "site_reports.py").read_text(encoding="utf-8")
    for alias in ("mr", "wb", "v", "g", "r", "s"):
        assert f'project_scope_sql("{alias}.project_id"' in site_reports
    site_day = (ROOT / "routers" / "site_day.py").read_text(encoding="utf-8")
    assert "await require_project_access(db, user, row[\"project_id\"])" in site_day
    migration = (ROOT / "migrations" / "255_projects_read_all_scope.sql").read_text(encoding="utf-8")
    assert "'projects.read_all'" in migration
    assert "'Site Agent', 'Site Engineer', 'FOREMAN', 'Site Clerk', 'Site Manager', 'Storekeeper'" in migration
