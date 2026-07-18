from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(
    encoding="utf-8"
)
CRM_ROUTER = (ROOT / "routers" / "crm.py").read_text(encoding="utf-8")


class FrontendApiContractTests(unittest.TestCase):
    """Guard shared frontend API behavior used by operational dashboards."""

    def test_raw_abort_messages_are_normalized_for_operational_pages(self):
        self.assertIn('normalizedMessage.includes("signal is aborted")', WEB_API)
        self.assertIn('normalizedMessage.includes("operation was aborted")', WEB_API)
        self.assertIn('normalizedMessage.includes("aborterror")', WEB_API)
        self.assertIn('normalizedMessage.includes("timeouterror")', WEB_API)
        self.assertIn(
            "The service took too long to respond. Please retry once the connection is ready.",
            WEB_API,
        )

    def test_operational_api_v1_calls_do_not_use_mock_fallback_by_default(self):
        self.assertIn('if (endpoint.startsWith("/api/v1/"))', WEB_API)
        self.assertIn("return false;", WEB_API)

    def test_timeout_abort_has_explicit_reason_and_backend_errors_use_response_body(
        self,
    ):
        self.assertIn("function timeoutReason()", WEB_API)
        self.assertIn(
            'new DOMException("API request timed out", "TimeoutError")', WEB_API
        )
        self.assertIn("controller.abort(timeoutReason())", WEB_API)
        self.assertIn("async function buildApiError(response: Response)", WEB_API)
        self.assertIn("extractApiErrorMessage(parsed)", WEB_API)

    def test_server_side_api_v1_urls_preserve_backend_prefix(self):
        self.assertIn("function resolveBackendOrigin()", WEB_API)
        self.assertIn("function resolveServerInternalEndpoint(endpoint: string)", WEB_API)
        self.assertIn("return isInternal ? resolveServerInternalEndpoint(endpoint)", WEB_API)
        self.assertNotIn('endpoint.replace("/api/", "/")', WEB_API)

    def test_server_side_public_aliases_target_registered_backend_routes(self):
        self.assertIn("const SERVER_ROUTE_ALIASES", WEB_API)
        self.assertIn('"/api/tenders": "/api/v1/public/intake/tenders"', WEB_API)
        self.assertIn('"/api/cms/website-content": "/api/v1/public/intake/website-content"', WEB_API)
        self.assertIn('"/api/cms/broadcast-feeds": "/api/v1/public/intake/broadcast-feeds"', WEB_API)

    def test_enquiry_budget_matches_backend_decimal_contract(self):
        api_types = (ROOT.parent / "aegis-web" / "src" / "types" / "api.ts").read_text(encoding="utf-8")
        validations = (ROOT.parent / "aegis-web" / "src" / "lib" / "validations.ts").read_text(encoding="utf-8")
        form = (ROOT.parent / "aegis-web" / "src" / "components" / "forms" / "EnquiryForm.tsx").read_text(encoding="utf-8")
        self.assertIn("budget?: number;", api_types)
        self.assertIn("z.preprocess", validations)
        self.assertIn('value === "" ? undefined : Number(value)', form)

    def test_workforce_helpers_target_registered_backend_subroutes(self):
        self.assertIn("'/api/v1/hr-records/leave'", WEB_API)
        self.assertIn("'/api/v1/compliance-items/employee-credentials'", WEB_API)
        self.assertNotIn("'/api/v1/hr-records/'", WEB_API)
        self.assertNotIn("'/api/v1/compliance-items/'", WEB_API)

    def test_finance_budget_helper_preserves_single_query_separator(self):
        self.assertIn("`/api/v1/budgets/${query}`", WEB_API)
        self.assertNotIn("`/api/v1/budgets/${query ? `?${search.toString()}` : ''}`", WEB_API)

    def test_subcontractor_write_contract_is_implemented_backend_side(self):
        self.assertIn('fetchApi<ApiResponse<any>>(`/api/v1/crm/subcontractors`', WEB_API)
        self.assertIn('fetchApi<ApiResponse<any>>(`/api/v1/crm/subcontractors/${id}`', WEB_API)
        self.assertIn('@router.post("/subcontractors")', CRM_ROUTER)
        self.assertIn('@router.put("/subcontractors/{subcontractor_id}")', CRM_ROUTER)
        self.assertIn('require_permission("crm.create_subcontractors")', CRM_ROUTER)
        self.assertIn('require_permission("crm.update_subcontractors")', CRM_ROUTER)

if __name__ == "__main__":
    unittest.main()
