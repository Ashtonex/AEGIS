"""Static contract checks for the public website intake boundary.

These tests deliberately do not need database credentials. They ensure that a
website deployment cannot silently point a public form at an obsolete backend
endpoint or omit the idempotency header required by the intake API.
"""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "aegis-web" / "src"
API = ROOT / "imperium-api" / "routers" / "public_intake.py"


class PublicIntakeContractTests(unittest.TestCase):
    def test_proxy_routes_target_public_intake_api(self) -> None:
        routes = {
            WEB / "app" / "api" / "enquiries" / "route.ts": "/public/intake/enquiry",
            WEB / "app" / "api" / "suppliers" / "route.ts": "/public/intake/supplier",
            WEB
            / "app"
            / "api"
            / "careers"
            / "apply"
            / "route.ts": "/public/intake/application",
            WEB
            / "app"
            / "api"
            / "tenders"
            / "[id]"
            / "interest"
            / "route.ts": "/public/intake/tender-interest/${params.id}",
        }
        for route, target in routes.items():
            self.assertIn(target, route.read_text(encoding="utf-8"), route)

    def test_public_content_proxy_routes_target_public_intake_api(self) -> None:
        routes = {
            WEB / "app" / "api" / "cms" / "website-content" / "route.ts": "/public/intake/website-content",
            WEB / "app" / "api" / "cms" / "broadcast-feeds" / "route.ts": "/public/intake/broadcast-feeds",
            WEB / "app" / "api" / "tenders" / "route.ts": "/public/intake/tenders",
            WEB / "app" / "api" / "projects" / "route.ts": "/public/intake/projects",
            WEB / "app" / "api" / "projects" / "[slug]" / "route.ts": "/public/intake/projects/${encodeURIComponent(params.slug)}",
        }
        for route, target in routes.items():
            self.assertIn(target, route.read_text(encoding="utf-8"), route)

    def test_client_submissions_include_idempotency_keys(self) -> None:
        source = (WEB / "lib" / "api.ts").read_text(encoding="utf-8")
        for function in (
            "submitTenderInterest",
            "submitJobApplication",
            "registerSupplier",
            "submitEnquiry",
        ):
            start = source.index(f"export async function {function}")
            end = source.find("\nexport async function", start + 1)
            body = source[start:] if end == -1 else source[start:end]
            self.assertIn('"Idempotency-Key": createIdempotencyKey()', body, function)

    def test_backend_exposes_the_four_public_intake_endpoints(self) -> None:
        source = API.read_text(encoding="utf-8")
        for endpoint in (
            "/enquiry",
            "/supplier",
            "/application",
            "/tender-interest/{tender_id}",
        ):
            self.assertIn(f'@router.post("{endpoint}")', source)
        for endpoint in ("/projects", "/projects/{slug_or_id}"):
            self.assertIn(f'@router.get("{endpoint}")', source)
        self.assertIn('ConfigDict(extra="forbid"', source)
        self.assertIn("A valid Idempotency-Key header is required.", source)

    def test_public_project_boundary_does_not_expose_commercial_terms(self) -> None:
        source = API.read_text(encoding="utf-8")
        start = source.index('@router.get("/projects")')
        end = source.index('@router.get("/projects/{slug_or_id}")')
        list_body = source[start:end]
        detail_body = source[end:]
        for body in (list_body, detail_body):
            self.assertNotIn("p.contract_value", body)
            self.assertNotIn("AS client", body)
            self.assertIn('["client"] = "Client withheld"', body)

        dossiers = (WEB / "lib" / "projectsDossiers.ts").read_text(encoding="utf-8")
        self.assertNotIn("Mega Market (Pvt) Ltd", dossiers)
        self.assertNotIn("Surrey Group (Pvt) Ltd", dossiers)
        self.assertNotIn("Mimosa Mining Corporation", dossiers)
        self.assertNotIn("value: 12400000", dossiers)

    def test_current_tenant_resolution_is_explicitly_single_tenant(self) -> None:
        """Public intake must fail closed until host-to-tenant mapping is added."""
        source = API.read_text(encoding="utf-8")
        self.assertIn("LIMIT 2", source)
        self.assertIn("if len(rows) != 1:", source)
        self.assertIn("Public intake is not configured for this tenant.", source)


if __name__ == "__main__":
    unittest.main()
