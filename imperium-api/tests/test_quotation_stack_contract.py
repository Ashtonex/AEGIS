from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
QUOTATION_ROUTER = (ROOT / "routers" / "quotations.py").read_text(encoding="utf-8")
WORKER = (ROOT / "app" / "workers" / "arq_worker.py").read_text(encoding="utf-8")
REQUIREMENTS = (ROOT / "requirements.txt").read_text(encoding="utf-8")
ENV_EXAMPLE_PATH = ROOT.parent / ".env.example"
ENV_EXAMPLE = ENV_EXAMPLE_PATH.read_text(encoding="utf-8") if ENV_EXAMPLE_PATH.exists() else ""


class QuotationStackContractTests(unittest.TestCase):
    def test_quotation_router_exposes_integrated_service_endpoints(self):
        self.assertIn('@router.post("/calculate")', QUOTATION_ROUTER)
        self.assertIn('@router.post("/boq/import")', QUOTATION_ROUTER)
        self.assertIn('@router.post("/exports/pdf")', QUOTATION_ROUTER)
        self.assertIn('@router.post("/exports/excel")', QUOTATION_ROUTER)
        self.assertIn("QuotationCalculator.calculate", QUOTATION_ROUTER)
        self.assertIn("BOQImporter.import_boq", QUOTATION_ROUTER)
        self.assertIn("QuotationPDFRenderer().render_pdf", QUOTATION_ROUTER)
        self.assertIn("QuotationExcelExporter().export_to_excel", QUOTATION_ROUTER)

    def test_worker_keeps_real_quotation_document_job_registered(self):
        self.assertIn("async def generate_quotation_documents_job", WORKER)
        self.assertIn("generate_quotation_documents_job", WORKER)
        self.assertIn("idempotency_key", WORKER)
        self.assertIn("settings.WORKER_JOB_MAX_TRIES", WORKER)
        self.assertIn("settings.WORKER_JOB_TIMEOUT_SECONDS", WORKER)

    def test_security_stack_uses_single_jwt_library_and_direct_argon2(self):
        self.assertIn("PyJWT==", REQUIREMENTS)
        self.assertIn("argon2-cffi==", REQUIREMENTS)
        self.assertNotIn("python-jose", REQUIREMENTS)
        self.assertNotIn("passlib", REQUIREMENTS)

    def test_environment_example_documents_operational_settings(self):
        if not ENV_EXAMPLE:
            self.skipTest("Repository-root .env.example is not mounted in this runtime.")
        for key in [
            "WORKER_JOB_TIMEOUT_SECONDS",
            "WORKER_JOB_MAX_TRIES",
            "FILE_STORAGE_MAX_BYTES",
            "GENERATED_DOCUMENT_DIR",
            "JWT_ISSUER",
            "JWT_AUDIENCE",
        ]:
            self.assertIn(key, ENV_EXAMPLE)


if __name__ == "__main__":
    unittest.main()
