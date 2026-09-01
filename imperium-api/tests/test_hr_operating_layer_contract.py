from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web"

HR_RECORDS = (ROOT / "routers" / "hr_records.py").read_text(encoding="utf-8")
HR_OPERATIONS = (ROOT / "routers" / "hr_operations.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
API = (WEB_ROOT / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
HR_PAGE = (WEB_ROOT / "src" / "app" / "dashboard" / "hr" / "page.tsx").read_text(encoding="utf-8")
PROFILE_PAGE = (WEB_ROOT / "src" / "app" / "dashboard" / "profile" / "page.tsx").read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "162_hr_operating_layer_self_service_leave.sql").read_text(encoding="utf-8")


def test_hr_operating_layer_schema_and_permissions_exist():
    for marker in [
        "hr.recruitment_candidates",
        "hr.onboarding_tasks",
        "hr.employee_documents",
        "hr.employee_medicals",
        "hr.employee_performance_reviews",
        "hr.employee_disciplinary_records",
        "hr.employee_asset_assignments",
        "hr.training_requirements",
        "hr.reporting_lines",
        "hr.workforce_plans",
        "hr.payroll_adjustments",
        "hr.leave.self_service",
        "hr.operations.read",
    ]:
        assert marker in MIGRATION


def test_self_service_leave_is_not_blocked_by_router_resource_gate():
    assert 'app.include_router(hr_records.router, prefix="/api/v1/hr-records", tags=["Hr Records"])' in MAIN
    assert "async def create_my_leave_request" in HR_RECORDS
    assert "resolve_own_employee_id" in HR_RECORDS
    assert 'Depends(require_permission("hr.leave.create"))' in HR_RECORDS
    assert "calendar_status" in HR_RECORDS


def test_hr_operations_api_and_ui_are_wired():
    assert "async def hr_operations_summary" in HR_OPERATIONS
    assert '@router.get("/leave-calendar")' in HR_OPERATIONS
    assert "getHROperationsSummary" in API
    assert "createMyHRLeaveRequest" in API
    for marker in [
        "Recruitment and onboarding pipeline",
        "Employee contracts and document expiry tracking",
        "Certifications, medicals, inductions and license alerts",
        "Performance reviews and disciplinary records",
        "PPE, tools, vehicle and asset assignments",
        "Training matrix by role and project",
        "Org chart and reporting lines",
        "Workforce planning by project and site",
        "Payroll statutory compliance",
        "LeaveCalendar",
    ]:
        assert marker in HR_PAGE
    assert "Submit leave from your account" in PROFILE_PAGE


def test_hr_leave_permissions_and_robustness():
    migration_174 = (ROOT / "migrations" / "174_hr_leave_and_attendance_permission_repair.sql").read_text(encoding="utf-8")
    for role_grant in [
        "('Executive (Admin)', 'hr.leave.create')",
        "('Executive (Admin)', 'hr.leave.approve')",
        "('Executive (Admin)', 'hr.attendance.record')",
        "('Managing Director', 'hr.leave.create')",
        "('Managing Director', 'hr.leave.approve')",
        "('Managing Director', 'hr.attendance.record')",
        "('HR Manager', 'hr.leave.create')",
        "('Project Manager', 'hr.leave.create')",
    ]:
        assert role_grant in migration_174

    assert "Days requested must be greater than zero." in HR_RECORDS
    assert "End date must be on or after start date." in HR_RECORDS
    assert "CAST(:org_id AS uuid)" in HR_RECORDS
    assert "CAST(:user_id AS uuid)" in HR_RECORDS

    assert "clean || fallback" in HR_PAGE
    assert "End date must be on or after start date." in HR_PAGE
    assert "Days requested must be greater than zero." in HR_PAGE
