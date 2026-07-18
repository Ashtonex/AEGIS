import pytest
import httpx
from main import app
from core.security import get_current_user

@pytest.fixture(autouse=True)
def setup_dependencies():
    from fastapi.middleware.trustedhost import TrustedHostMiddleware
    # Whitelist all hosts in TrustedHostMiddleware options for tests
    for middleware in app.user_middleware:
        if middleware.cls == TrustedHostMiddleware:
            middleware.kwargs["allowed_hosts"] = ["*"]
    app.middleware_stack = None

    # Override get_current_user to return a Superadmin user which bypasses permission checks inherently
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "00000000-0000-0000-0000-000000000001",
        "org_id": "00000000-0000-0000-0000-000000000001",
        "email": "executive@sixnine.co.zw",
        "role": "SUPERADMIN"
    }

    yield

    # Clean up overrides after test
    app.dependency_overrides.pop(get_current_user, None)

@pytest.mark.asyncio
async def test_materials_forecast_alerts():
    """Tests that the materials inflation forecasting endpoint executes successfully."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/v1/executive/materials/forecast-alerts")
        assert response.status_code == 200
        json_data = response.json()
        assert json_data["success"] is True
        assert len(json_data["data"]) > 0
        assert "material" in json_data["data"][0]
        assert "trend" in json_data["data"][0]

@pytest.mark.asyncio
async def test_pending_approvals():
    """Tests retrieval of high-value and override approvals in the queue."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/v1/executive/approvals/pending")
        assert response.status_code == 200
        json_data = response.json()
        assert json_data["success"] is True
        assert isinstance(json_data["data"], list)

@pytest.mark.asyncio
async def test_financial_runway():
    """Tests the financial burn rate and runway indicator analysis."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/v1/executive/financial-runway")
        assert response.status_code == 200
        json_data = response.json()
        assert json_data["success"] is True
        assert "runway_months" in json_data["data"]

@pytest.mark.asyncio
async def test_hse_safety_index():
    """Tests the rolling Lost Time Injury Frequency Rate (LTIFR) index calculation."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/v1/executive/hse/ltifr")
        assert response.status_code == 200
        json_data = response.json()
        assert json_data["success"] is True
        assert "ltifr" in json_data["data"]
        assert "status" in json_data["data"]

@pytest.mark.asyncio
async def test_project_schedule_risk_not_found():
    """Tests schedule risk simulation returns 404 for non-existent projects."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/v1/executive/projects/00000000-0000-0000-0000-deadbeef9999/schedule-risk")
        assert response.status_code == 404
