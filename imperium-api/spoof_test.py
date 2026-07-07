import asyncio
from fastapi.testclient import TestClient
from main import app
from core.security import get_current_user, require_permission

# Mock user for testing
async def mock_get_current_user():
    return {"org_id": "00000000-0000-0000-0000-000000000000", "sub": "11111111-1111-1111-1111-111111111111"}

# Override dependencies
app.dependency_overrides[get_current_user] = mock_get_current_user

# Mock the require_permission factory
def mock_require_permission(permission: str):
    async def _mock():
        return {"org_id": "00000000-0000-0000-0000-000000000000", "sub": "11111111-1111-1111-1111-111111111111"}
    return _mock

# Note: Since require_permission is a factory, overriding it natively in FastAPI requires iterating routes.
# But for our auto-generated routes, we used `get_current_user`.
# Let's override it directly if possible.

client = TestClient(app)

def run_spoof_test():
    print("="*50)
    print("SPOOF TESTING ALL AUTO-GENERATED API ENDPOINTS")
    print("="*50)
    
    success_count = 0
    fail_count = 0
    
    # We will spoof GET requests to the root of all API routers
    # Since we know the router paths, we can iterate them
    routes_to_test = []
    for route in app.routes:
        path = getattr(route, 'path', '')
        # Only test GET requests
        if getattr(route, 'methods', None) and 'GET' in route.methods:
            # Skip routes requiring path parameters like {item_id}
            if '{' not in path and path.startswith('/api/v1/'):
                routes_to_test.append(path)
                
    # De-duplicate
    routes_to_test = list(set(routes_to_test))
    routes_to_test.sort()
    
    for path in routes_to_test:
        # Avoid hitting auth/login or heavy endpoints
        if 'auth' in path: continue
        
        response = client.get(path)
        status = response.status_code
        
        if status == 200:
            print(f"[SUCCESS] {status} | GET {path}")
            success_count += 1
        elif status == 403 or status == 401:
            print(f"[AUTH_ERR] {status} | GET {path} (Dependency mock missed?)")
            fail_count += 1
        else:
            print(f"[FAIL] {status} | GET {path}")
            print(f"       -> {response.text}")
            fail_count += 1
            
    print("="*50)
    print(f"RESULTS: {success_count} Passed | {fail_count} Failed")
    print("="*50)

if __name__ == "__main__":
    # Ensure any async DB setup is done if needed, but TestClient handles simple cases.
    run_spoof_test()
