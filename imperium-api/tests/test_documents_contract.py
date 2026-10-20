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

    def test_opportunity_document_scoping_supported(self):
        self.assertIn("opportunity_id: Optional[UUID] = None", DOC_ROUTER)
        self.assertIn("d.opportunity_id = :opportunity_id", DOC_ROUTER)
        self.assertIn("dl.entity_type = 'opportunity'", DOC_ROUTER)
        self.assertIn(":entity_type = 'opportunity' AND d.opportunity_id = :entity_id", DOC_ROUTER)

    def test_document_for_entity_validates_tenant_ownership(self):
        self.assertIn('"opportunity": "crm.opportunities"', DOC_ROUTER)
        self.assertIn("SELECT 1 FROM {entity_table} WHERE id = :id AND organization_id = :org_id AND is_deleted = false", DOC_ROUTER)
        self.assertIn('detail=f"{entity_type} not found."', DOC_ROUTER)

    def test_document_unlink_endpoint_preserves_source_document(self):
        self.assertIn('@router.delete("/{document_id}/links/{entity_type}/{entity_id}"', DOC_ROUTER)
        self.assertIn("UPDATE core.document_links", DOC_ROUTER)
        self.assertIn("SET is_deleted = true", DOC_ROUTER)
        self.assertIn("SET opportunity_id = NULL", DOC_ROUTER)

    def test_document_multi_link_safety_and_permission_enforcement(self):
        # Permission gate requires documents.delete
        self.assertIn('user: dict = Depends(require_permission("documents.delete"))', DOC_ROUTER)
        # Targeted soft-delete applies only to the requested entity association, preserving other entity links
        self.assertIn("WHERE document_id = :document_id", DOC_ROUTER)
        self.assertIn("AND entity_type = :entity_type", DOC_ROUTER)
        self.assertIn("AND entity_id = :entity_id", DOC_ROUTER)
        self.assertIn("AND organization_id = :org_id", DOC_ROUTER)
        # Clears opportunity legacy foreign key only when opportunity_id matches entity_id, leaving source intact
        self.assertIn("SET opportunity_id = NULL, updated_at = NOW()", DOC_ROUTER)
        self.assertIn("AND opportunity_id = :entity_id", DOC_ROUTER)


if __name__ == "__main__":
    unittest.main()


