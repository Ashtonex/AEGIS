"""Phase 1 of the HR & Workforce re-engineering: automatic worker numbers and
catalogue codes, the person card API, and leavers dropping off pick lists."""

from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.services.workforce_foundation import code_stem
from routers import hr_people
from schemas.workforce_foundation import CatalogueCreate, PersonCreate

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "249_people_foundation.sql").read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "name, expected",
    [
        ("Quantity Surveyor", "QS"),
        ("Engineering", "ENG"),
        ("Health, Safety & Environment", "HSE"),
        ("Head of Projects and Planning", "HPP"),
        ("Land Surveyor", "LS"),
    ],
)
def test_catalogue_code_is_derived_from_name(name, expected):
    assert code_stem(name) == expected


def test_catalogue_code_is_optional():
    assert CatalogueCreate(name="Land Surveyor").code is None
    with pytest.raises(ValidationError):
        CatalogueCreate(name="Bad", code="has spaces")


def test_register_ignores_client_worker_number_and_needs_a_discipline():
    payload = PersonCreate(employee_name="Tariro Moyo", employee_number="HAND-TYPED", position_id=uuid4())
    assert "employee_number" not in payload.model_dump()
    with pytest.raises(ValidationError):
        PersonCreate(employee_name="No Discipline")


def test_migration_issues_permanent_numbers_only_to_working_logins():
    assert "CREATE OR REPLACE FUNCTION hr.next_worker_number" in MIGRATION
    assert "'SNC-' || lpad" in MIGRATION
    assert "e.linked_user_id IS NULL OR u.is_active = true" in MIGRATION
    assert "e.employment_status <> 'terminated'" in MIGRATION


def test_person_card_routes_and_section_permissions():
    paths = {(route.path, tuple(sorted(route.methods))) for route in hr_people.router.routes}
    for expected in [
        ("/summary", ("GET",)),
        ("/register", ("GET",)),
        ("/catalogue", ("GET",)),
        ("/me", ("GET",)),
        ("/me/personal", ("PATCH",)),
        ("/{employee_id}", ("GET",)),
        ("/{employee_id}/employment", ("PATCH",)),
        ("/{employee_id}/personal", ("PATCH",)),
        ("/{employee_id}/pay", ("PUT",)),
        ("/{employee_id}/psychometrics", ("POST",)),
        ("/{employee_id}/leave-organisation", ("POST",)),
        ("/{employee_id}/reinstate", ("POST",)),
    ]:
        assert expected in paths
    source = (ROOT / "routers" / "hr_people.py").read_text(encoding="utf-8")
    assert 'require_permission("hr.people.offboard")' in source
    assert 'require_permission("hr.people.personal.manage")' in source
    # Leaving never touches the SUPERADMIN login.
    assert "r.name = 'SUPERADMIN'" in source


def test_bank_numbers_are_masked_for_readers():
    assert hr_people._mask("1234567890") == "••••••7890"
    assert hr_people._mask(None) is None


def test_completeness_lists_what_is_missing():
    person = {"position_id": None, "department_id": "d", "start_date": None, "employment_type": "permanent",
              "position_code": None, "national_id": "63-1", "date_of_birth": "1990-01-01", "personal_phone": "077",
              "emergency_contact": {"name": "Rudo"}}
    result = hr_people._completeness(person, {"line_manager": None, "pay": None})
    assert result["missing"] == ["Role", "Start date", "Line manager", "Pay profile"]


def test_pick_lists_exclude_leavers_by_default():
    workforce = (ROOT / "routers" / "workforce.py").read_text(encoding="utf-8")
    assert "CAST(:status AS text) IS NULL AND e.employment_status <> 'terminated'" in workforce
    foundation = (ROOT / "app" / "services" / "workforce_foundation.py").read_text(encoding="utf-8")
    assert "CAST(:status AS text) IS NULL AND e.employment_status<>'terminated'" in foundation
