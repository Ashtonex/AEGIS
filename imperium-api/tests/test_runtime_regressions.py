"""Pins fixes for crashes found by the 2026-10-24 static sweep (mypy/ruff).

Each of these raised at request time in production code paths.
"""

import inspect
import uuid
from datetime import datetime, timezone

import httpx
import pytest
from pydantic import ValidationError


def test_fleet_emit_event_project_id_is_optional():
    # Shift-log approval calls emit_event without project_id (was a TypeError).
    from routers.fleet import emit_event

    assert inspect.signature(emit_event).parameters["project_id"].default is None


def test_assignment_payload_rejects_unknown_fields_so_dispatch_must_not_pass_them():
    # Plant dispatch passed transport_instructions to a model with extra="forbid".
    from routers.fleet import AssignmentPayload

    base = {"fleet_id": uuid.uuid4(), "starts_at": datetime.now(timezone.utc)}
    AssignmentPayload(**base)
    with pytest.raises(ValidationError):
        AssignmentPayload(**base, transport_instructions="x")
    src = inspect.getsource(__import__("routers.fleet", fromlist=["x"]))
    dispatch_block = src[src.index("assignment = AssignmentPayload("):]
    dispatch_block = dispatch_block[: dispatch_block.index(")\n")]
    assert "transport_instructions" not in dispatch_block


def test_tender_scraper_uses_httpx_proxy_kwarg():
    # httpx 0.28 removed AsyncClient(proxies=...).
    assert "proxy" in inspect.signature(httpx.AsyncClient.__init__).parameters
    from app.services import tender_scraper

    assert "proxies=" not in inspect.getsource(tender_scraper)


def test_crm_subcontractor_compliance_status_is_normalised():
    from routers.crm import SubcontractorCreate

    assert SubcontractorCreate(name="x", compliance_status="Non-Compliant").compliance_status == "non_compliant"
    with pytest.raises(ValidationError):
        SubcontractorCreate(name="x", compliance_status="bogus")
