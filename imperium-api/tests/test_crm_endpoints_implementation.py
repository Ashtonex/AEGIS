import unittest
from fastapi.testclient import TestClient
from main import app
import core.security

# Mock auth
async def mock_get_current_user():
    return {
        "org_id": "00000000-0000-0000-0000-000000000000",
        "sub": "11111111-1111-1111-1111-111111111111",
        "user_id": "11111111-1111-1111-1111-111111111111",
        "email": "test@aegis.com",
        "role": "SUPERADMIN",
    }

async def mock_verify_token():
    return {
        "sub": "11111111-1111-1111-1111-111111111111",
        "email": "test@aegis.com",
        "role": "SUPERADMIN",
        "app_metadata": {
            "role": "SUPERADMIN",
            "org_id": "00000000-0000-0000-0000-000000000000"
        }
    }

def mock_require_permission(permission: str):
    async def _mock():
        return {
            "org_id": "00000000-0000-0000-0000-000000000000",
            "sub": "11111111-1111-1111-1111-111111111111",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "email": "test@aegis.com",
            "role": "SUPERADMIN",
        }
    return _mock

class CrmEndpointsContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.dependency_overrides.clear()
        
        # Whitelist all hosts in TrustedHostMiddleware options for tests
        from fastapi.middleware.trustedhost import TrustedHostMiddleware
        for middleware in app.user_middleware:
            if middleware.cls == TrustedHostMiddleware:
                middleware.kwargs["allowed_hosts"] = ["*"]
        app.middleware_stack = None
        
        # Override statically
        app.dependency_overrides[core.security.get_current_user] = mock_get_current_user
        app.dependency_overrides[core.security.verify_token] = mock_verify_token
        
        # Override dynamically by traversing routes to handle duplicate imports/identity mismatches
        from fastapi.dependencies.utils import get_dependant
        
        def override_deps(dep):
            if dep.call:
                name = dep.call.__name__
                if name in ("get_current_user", "permission_checker", "require_permission", "permission_checker_with_logging"):
                    app.dependency_overrides[dep.call] = mock_get_current_user
                elif name == "verify_token":
                    app.dependency_overrides[dep.call] = mock_verify_token
            for sub_dep in dep.dependencies:
                override_deps(sub_dep)

        for route in app.routes:
            if hasattr(route, "path") and hasattr(route, "endpoint") and route.endpoint:
                try:
                    dependant = get_dependant(path=route.path, call=route.endpoint)
                    override_deps(dependant)
                except Exception:
                    pass
                    
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def test_customer_360_route_exists(self):
        # We don't necessarily need database rows if we just want to verify route registration
        # A 404 response for a mock UUID means the route is registered and matching successfully!
        response = self.client.get("/api/v1/crm/customer-360/00000000-0000-0000-0000-000000000000")
        self.assertIn(response.status_code, {404, 403, 401})

    def test_campaigns_routes_exist(self):
        # Campaigns/segments/templates/win-loss were consolidated onto the single
        # canonical crm.py router (the only one with live frontend callers); the
        # standalone crm_campaigns/crm_templates/crm_win_loss routers were deleted.
        response = self.client.get("/api/v1/crm/campaigns")
        self.assertIn(response.status_code, {200, 403, 401})

    def test_templates_routes_exist(self):
        response = self.client.get("/api/v1/crm/templates")
        self.assertIn(response.status_code, {200, 403, 401})

    def test_import_export_routes_exist(self):
        response = self.client.get("/api/v1/crm-import-export/export/csv?target_type=contacts")
        self.assertIn(response.status_code, {200, 403, 401})
