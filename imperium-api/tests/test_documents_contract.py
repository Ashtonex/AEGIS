from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
DOC_ROUTER = (ROOT / "routers" / "documents.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
DOC_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "documents" / "page.tsx"
).read_text(encoding="utf-8")


class DocumentsContractTests(unittest.TestCase):
    """Guard controlled document repository behavior used across AEGIS."""

    def test_router_is_registered_under_api_v1_documents(self):
        self.assertIn(
            'include_router(documents.router, prefix="/api/v1/documents"', MAIN
        )

    def test_document_routes_use_explicit_document_permissions(self):
        self.assertIn('require_permission("documents.read")', DOC_ROUTER)
        self.assertIn('require_permission("documents.create")', DOC_ROUTER)
        self.assertIn('require_permission("documents.update")', DOC_ROUTER)
        self.assertIn('Depends(require_permission("documents.read"))', DOC_ROUTER)
        self.assertIn('Depends(require_permission("documents.create"))', DOC_ROUTER)
        self.assertIn('Depends(require_permission("documents.update"))', DOC_ROUTER)

    def test_document_payloads_are_strict_and_whitespace_normalized(self):
        self.assertIn(
            'ConfigDict(extra="forbid", str_strip_whitespace=True)', DOC_ROUTER
        )
        self.assertIn("class DocumentCreate(BaseModel):", DOC_ROUTER)
        self.assertIn("class StatusUpdate(BaseModel):", DOC_ROUTER)

    def test_document_versions_are_source_backed_not_synthetic_history(self):
        self.assertIn("FROM core.documents d", DOC_ROUTER)
        self.assertIn("FROM core.audit_log a", DOC_ROUTER)
        self.assertIn('"source": "core.documents"', DOC_ROUTER)
        self.assertIn('"source": "core.audit_log"', DOC_ROUTER)
        self.assertNotIn("Systems Engineer", DOC_ROUTER)
        self.assertNotIn("Initial drawing release", DOC_ROUTER)
        self.assertNotIn("2026-07-15T10:00:00", DOC_ROUTER)

    def test_frontend_surfaces_document_api_failures_and_uses_backend_metadata(self):
        self.assertIn("Document data could not be loaded.", DOC_PAGE)
        self.assertIn(
            "The document feed is still synchronizing. Please retry once the connection is ready.",
            DOC_PAGE,
        )
        self.assertIn("Promise.allSettled", DOC_PAGE)
        self.assertIn("Document repository could not be loaded.", DOC_PAGE)
        self.assertIn("Project register could not be loaded.", DOC_PAGE)
        self.assertIn("documentFileSize(docDetail)", DOC_PAGE)
        self.assertIn("file_size_bytes", DOC_PAGE)
        self.assertNotIn("drawing_v1.pdf", DOC_PAGE)
        self.assertNotIn("2450000", DOC_PAGE)
        self.assertNotIn("DOC-2026-00001", DOC_PAGE)
        self.assertNotIn('d.doc_number || "DOC-001"', DOC_PAGE)
        self.assertNotIn('docDetail.version || "1.0"', DOC_PAGE)
        self.assertNotIn("getDocumentVersions(id).catch", DOC_PAGE)
        self.assertNotIn("getDocumentLinks(id).catch", DOC_PAGE)


if __name__ == "__main__":
    unittest.main()
