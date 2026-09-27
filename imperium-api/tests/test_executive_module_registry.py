import time

import pytest

import routers.executive as executive
from main import app


def test_route_table_walk_matches_openapi_exactly():
    """_walk_route_tags reads FastAPI internals (_IncludedRouter.include_context /
    original_router) to avoid building the ~9s OpenAPI schema. If a FastAPI
    upgrade changes those internals, this must fail loudly rather than let the
    Module Gateway silently drift or empty out."""
    walked = executive._group_by_path(executive._walk_route_tags(app.routes))
    from_openapi = executive._openapi_route_tags(app)

    assert walked, "route walk found nothing - FastAPI internals changed?"
    # Same pairs in the same order, so every module keeps the same "route".
    assert walked == from_openapi


def test_route_table_walk_is_cheap():
    started = time.perf_counter()
    executive._walk_route_tags(app.routes)
    assert time.perf_counter() - started < 0.5


@pytest.mark.asyncio
async def test_registry_falls_back_to_openapi_when_walk_is_empty(monkeypatch):
    monkeypatch.setattr(executive, "_route_tags_cache", None)
    monkeypatch.setattr(executive, "_walk_route_tags", lambda routes: [])
    monkeypatch.setattr(executive, "_openapi_route_tags", lambda app: [("/api/v1/x", "X")])

    assert await executive._registered_route_tags(app) == [("/api/v1/x", "X")]
