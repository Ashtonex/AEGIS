import os
import httpx
import jwt
from datetime import datetime, timedelta

# Extract secret key manually to avoid loading DB drivers that crash DNS
SECRET_KEY = os.environ.get("SECRET_KEY", "dummy_secret_key_for_testing")


def create_spoof_token():
    payload = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "aud": "authenticated",
        "role": "SUPERADMIN",
        "app_metadata": {"org_id": "00000000-0000-0000-0000-000000000000"},
        "exp": datetime.utcnow() + timedelta(hours=1),
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    return token


ROUTES = [
    "/api/v1/projects/",
    "/api/v1/site-operations/",
    "/api/v1/workforce/",
    "/api/v1/fleet/",
    "/api/v1/equipment-assets/",
    "/api/v1/procurement-orders/",
    "/api/v1/inventory-items/",
    "/api/v1/budgets/",
    "/api/v1/financial-performance/",
    "/api/v1/quotations/",
    "/api/v1/hr-records/",
    "/api/v1/compliance-items/",
    "/api/v1/hse-incidents/",
    "/api/v1/documents/",
    "/api/v1/crm-contacts/",
    "/api/v1/crm-leads/",
    "/api/v1/client-portal-tickets/",
    "/api/v1/supplier-records/",
    "/api/v1/internal-messages/",
    "/api/v1/kpi-metrics/",
    "/api/v1/bi-reports/",
    "/api/v1/risk-register/",
    "/api/v1/tender-bids/",
    "/api/v1/maintenance-schedules/",
    "/api/v1/automated-reports/",
    "/api/v1/website-enquiries/",
]


def run_tests():
    token = create_spoof_token()
    headers = {"Authorization": f"Bearer {token}"}

    print("=" * 50)
    print("SPOOF TESTING AUTO-GENERATED APIS VIA HTTP")
    print("=" * 50)

    success = 0
    fail = 0

    with httpx.Client(base_url="http://localhost:8000") as client:
        for route in ROUTES:
            try:
                res = client.get(route, headers=headers)
                status = res.status_code
                if status == 200:
                    print(f"[SUCCESS] {status} | GET {route}")
                    success += 1
                else:
                    print(f"[FAIL] {status} | GET {route}")
                    print(f"       -> {res.text}")
                    fail += 1
            except Exception as e:
                print(f"[ERROR] Could not hit {route}: {str(e)}")
                fail += 1

    print("=" * 50)
    print(f"RESULTS: {success} Passed | {fail} Failed")
    print("=" * 50)


if __name__ == "__main__":
    run_tests()
