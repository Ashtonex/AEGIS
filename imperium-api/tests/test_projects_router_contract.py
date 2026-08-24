from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PROJECTS_ROUTER = (ROOT / "routers" / "projects.py").read_text(encoding="utf-8")
EXECUTIVE_ROUTER = (ROOT / "routers" / "executive.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
WEB_API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(
    encoding="utf-8"
)
PROJECTS_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "projects" / "page.tsx"
).read_text(encoding="utf-8")
EXECUTIVE_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "executive" / "page.tsx"
).read_text(encoding="utf-8")
PROJECT_DETAIL_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "projects" / "[slug]" / "page.tsx"
).read_text(encoding="utf-8")


class ProjectsRouterContractTests(unittest.TestCase):
    """Guard the tenancy and RBAC invariants of the projects lifecycle API."""

    def test_projects_router_is_behind_action_level_rbac(self):
        self.assertIn(
            'app.include_router(projects.router, prefix="/api/v1/projects", tags=["Projects"], '
            'dependencies=[Depends(require_resource_permission("projects"))])',
            MAIN,
        )

    def test_read_and_write_queries_scope_records_to_the_current_tenant(self):
        # The list, detail, update and soft-delete paths must all constrain the
        # record by organization.  This remains important even when database RLS
        # is enabled because the API uses a service-role database connection.
        self.assertGreaterEqual(PROJECTS_ROUTER.count("organization_id=:org_id"), 4)
        self.assertIn("organization_id, created_by", PROJECTS_ROUTER)
        self.assertIn('"org_id": user["org_id"]', PROJECTS_ROUTER)
        self.assertIn('"user_id": user["user_id"]', PROJECTS_ROUTER)

    def test_read_paths_exclude_soft_deleted_projects(self):
        self.assertGreaterEqual(PROJECTS_ROUTER.count("is_deleted=false"), 3)
        self.assertIn("SET is_deleted=true", PROJECTS_ROUTER)

    def test_client_payload_cannot_override_tenant_or_audit_identity(self):
        self.assertIn("class ProjectCreate(BaseModel):", PROJECTS_ROUTER)
        self.assertIn("class ProjectUpdate(BaseModel):", PROJECTS_ROUTER)
        self.assertIn("payload.model_dump(exclude_unset=True)", PROJECTS_ROUTER)
        self.assertNotIn("payload: dict", PROJECTS_ROUTER)

    def test_project_detail_lookup_accepts_canonical_refs_without_mock_fallback(self):
        self.assertIn("OR project_code = :project_ref", EXECUTIVE_ROUTER)
        self.assertIn("OR lower(name) = lower(:project_ref)", EXECUTIVE_ROUTER)
        self.assertIn("encodeURIComponent(projectId)", WEB_API)
        self.assertIn("allowFallback: false", WEB_API)
        self.assertIn(
            "function projectDetailRefs(project: Project): string[]", PROJECTS_PAGE
        )
        self.assertIn("for (const ref of refs)", PROJECTS_PAGE)
        self.assertIn("notFound();", PROJECT_DETAIL_PAGE)
        self.assertNotIn("mock for demonstration", PROJECT_DETAIL_PAGE)
        self.assertNotIn('id: "proj-001"', PROJECT_DETAIL_PAGE)
        self.assertNotIn(
            "In reality we would `notFound()` if not found", PROJECT_DETAIL_PAGE
        )

    def test_project_financial_tab_does_not_generate_fallback_finance_values(self):
        self.assertNotIn("Fallback: $6.0M to $13.0M", PROJECTS_PAGE)
        self.assertNotIn("Math.round(contractVal * (0.72", PROJECTS_PAGE)
        self.assertNotIn("Math.round(budgetedCost * 0.62", PROJECTS_PAGE)
        self.assertNotIn("Math.round(budgetedCost * 0.16", PROJECTS_PAGE)
        self.assertNotIn("62% cash progress", PROJECTS_PAGE)
        self.assertNotIn("Simulated revenue", PROJECTS_PAGE)
        self.assertNotIn("Adjust Simulated Overhead", PROJECTS_PAGE)
        self.assertIn("No fallback financial figures are generated.", PROJECTS_PAGE)
        self.assertIn("const hasFinanceEvidence =", PROJECTS_PAGE)
        self.assertIn("disabled", PROJECTS_PAGE)

    def test_project_material_tab_uses_source_backed_daily_report_materials(self):
        self.assertIn('"material_records": await _rows', EXECUTIVE_ROUTER)
        self.assertIn("projects.daily_report_materials", EXECUTIVE_ROUTER)
        self.assertIn("material_records?: Record<string, unknown>[]", PROJECTS_PAGE)
        self.assertIn(
            "const materialRecords = useMemo(() => detail?.material_records ?? []",
            PROJECTS_PAGE,
        )
        self.assertIn("Daily site report material consumption", PROJECTS_PAGE)
        self.assertIn("No material evidence recorded", PROJECTS_PAGE)
        self.assertNotIn("concreteBaseTarget", PROJECTS_PAGE)
        self.assertNotIn("steelBaseTarget", PROJECTS_PAGE)
        self.assertNotIn("Math.random().toString()", PROJECTS_PAGE)
        self.assertNotIn("simulate API roundtrip", PROJECTS_PAGE)
        self.assertNotIn("Log accepted and recalculated.", PROJECTS_PAGE)
        self.assertNotIn("blockchain hashes", PROJECTS_PAGE)

    def test_pre_mobilisation_gate_blocks_active_delivery_until_approved(self):
        self.assertIn("PRE_MOBILISATION_GATES", PROJECTS_ROUTER)
        self.assertIn("Project cannot become active until the pre-mobilisation readiness gate is approved.", PROJECTS_ROUTER)
        self.assertIn("SET status = 'pre_mobilisation'", PROJECTS_ROUTER)
        self.assertIn("project.pre_mobilisation_opened.v1", PROJECTS_ROUTER)
        self.assertIn("project.mobilisation_authorised.v1", PROJECTS_ROUTER)
        self.assertIn("mobilisation_authorisation_number", PROJECTS_ROUTER)
        self.assertIn('"mandatory_evidence"', PROJECTS_ROUTER)
        self.assertIn("pre-mobilisation", WEB_API)
        self.assertIn("PreMobilisationPanel", PROJECTS_PAGE)
        self.assertIn("Authorise Mobilisation", PROJECTS_PAGE)
        self.assertIn("Mobilisation is blocked until all required gates have evidence", PROJECTS_PAGE)

    def test_project_coordinates_persist_to_profile_and_feed_executive_map(self):
        self.assertIn("PROFILE_COLUMNS = {\"region\", \"latitude\", \"longitude\"}", PROJECTS_ROUTER)
        self.assertIn("pp.region, pp.latitude::float AS latitude, pp.longitude::float AS longitude", PROJECTS_ROUTER)
        self.assertIn("tenant_upsert_sql(", PROJECTS_ROUTER)
        self.assertIn("updated_project = await _project_ref_or_404", PROJECTS_ROUTER)
        self.assertIn("pp.latitude::float AS latitude", EXECUTIVE_ROUTER)
        self.assertIn("coordinateValue", EXECUTIVE_PAGE)
        self.assertIn("onProjectUpdated", PROJECTS_PAGE)
        self.assertIn("updateInternalProject(project.id, { latitude: latNum, longitude: longNum })", PROJECTS_PAGE)


if __name__ == "__main__":
    unittest.main()
