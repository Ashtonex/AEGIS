import asyncio
from httpx import AsyncClient
import core.security


# Mock user for testing
async def mock_get_current_user():
    return {
        "org_id": "00000000-0000-0000-0000-000000000000",
        "sub": "11111111-1111-1111-1111-111111111111",
        "user_id": "11111111-1111-1111-1111-111111111111",
        "email": "test@aegis.com",
        "role": "SUPERADMIN",
    }


# Mock the require_permission factory
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


# Inject mocks before importing main to override in routing definitions
core.security.get_current_user = mock_get_current_user
core.security.require_permission = mock_require_permission

# Now import the app
from main import app  # noqa: E402
from fastapi.routing import APIRoute  # noqa: E402

# Register overrides on the app
app.dependency_overrides[core.security.get_current_user] = mock_get_current_user
app.dependency_overrides[core.security.verify_token] = mock_get_current_user


def get_all_api_routes(app_or_router, prefix=""):
    routes_to_test = []
    routes = getattr(app_or_router, "routes", [])
    for r in routes:
        if isinstance(r, APIRoute):
            full_path = (prefix + r.path).replace("//", "/")
            routes_to_test.append((full_path, r.methods))
        elif type(r).__name__ == "_IncludedRouter":
            inc_prefix = getattr(r.include_context, "prefix", "") or ""
            sub_routes = get_all_api_routes(r.original_router, prefix + inc_prefix)
            routes_to_test.extend(sub_routes)
        else:
            path = getattr(r, "path", "")
            if path:
                full_path = (prefix + path).replace("//", "/")
                routes_to_test.append((full_path, getattr(r, "methods", None)))
    return routes_to_test


async def run_spoof_test_async():
    print("=" * 50)
    print("SPOOF TESTING ALL AUTO-GENERATED API ENDPOINTS (ASYNC)")
    print("=" * 50)

    success_count = 0
    fail_count = 0

    all_routes = get_all_api_routes(app)
    routes_to_test = []

    for path, methods in all_routes:
        if methods and "GET" in methods:
            # Skip routes requiring path parameters like {item_id} or {id}
            if "{" not in path and path.startswith("/api/v1/"):
                routes_to_test.append(path)

    # De-duplicate
    routes_to_test = list(set(routes_to_test))
    routes_to_test.sort()

    # Use AsyncClient with ASGITransport
    from httpx import ASGITransport

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as ac:
        for path in routes_to_test:
            # Avoid hitting auth/login or heavy endpoints
            if "auth" in path:
                continue

            try:
                response = await ac.get(path)
                status = response.status_code

                if status == 200:
                    print(f"[SUCCESS] {status} | GET {path}")
                    success_count += 1
                elif status in [403, 401]:
                    print(f"[AUTH_ERR] {status} | GET {path}")
                    fail_count += 1
                else:
                    print(f"[FAIL] {status} | GET {path}")
                    print(f"       -> {response.text}")
                    fail_count += 1
            except Exception as e:
                print(f"[ERROR] Could not hit {path}: {str(e)}")
                fail_count += 1

    print("=" * 50)
    print(f"RESULTS: {success_count} Passed | {fail_count} Failed")
    print("=" * 50)


if __name__ == "__main__":
    asyncio.run(run_spoof_test_async())
