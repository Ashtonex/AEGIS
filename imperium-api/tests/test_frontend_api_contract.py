from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(
    encoding="utf-8"
)


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


if __name__ == "__main__":
    unittest.main()
