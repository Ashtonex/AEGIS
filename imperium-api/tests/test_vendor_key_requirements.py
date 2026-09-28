"""Vendor verification keys on the registered company name, the company
registration number, tax clearance and VAT; NSSA and PRAZ are optional."""

import pytest
from pydantic import ValidationError

from app.shared.vendor_verification import (
    VENDOR_PROFILE_SQL,
    missing_profile_fields,
    required_compliance_categories,
    vendor_profile_columns,
)
from routers.public_intake import SupplierPayload

COMPLETE_PROFILE = {
    "name": "Haus of Bricks (Pvt) Ltd",
    "registration_number": "1234/2019",
    "tax_clearance_number": "ITF263-2026",
    "vat_status": "registered",
    "vat_number": "220123456",
    "contact_name": "Tendai",
    "contact_email": "sales@hausofbricks.co.zw",
    "contact_phone": "+263771000000",
    "address": "12 Coventry Road, Workington, Harare",
}


def test_a_complete_profile_is_not_missing_anything():
    assert missing_profile_fields(COMPLETE_PROFILE) == []


def test_nssa_and_praz_are_not_required():
    assert "nssa_number" not in COMPLETE_PROFILE and "praz_number" not in COMPLETE_PROFILE
    assert missing_profile_fields(COMPLETE_PROFILE) == []
    assert "nssa" not in required_compliance_categories("registered")
    assert "praz" not in required_compliance_categories("registered")


@pytest.mark.parametrize("field", ["name", "registration_number", "tax_clearance_number"])
def test_each_key_field_is_required(field):
    assert missing_profile_fields({**COMPLETE_PROFILE, field: "  "}) == [field]


def test_vat_number_is_required_unless_declared_not_registered():
    no_number = {**COMPLETE_PROFILE, "vat_number": None}
    assert missing_profile_fields(no_number) == ["vat_number"]
    assert missing_profile_fields({**no_number, "vat_status": None}) == ["vat_number"]
    assert missing_profile_fields({**no_number, "vat_status": "not_registered"}) == []


def test_vat_certificate_is_required_unless_declared_not_registered():
    assert required_compliance_categories("registered") == ("tax_clearance", "company_registration", "vat")
    assert required_compliance_categories(None) == ("tax_clearance", "company_registration", "vat")
    assert required_compliance_categories("not_registered") == ("tax_clearance", "company_registration")


def test_profile_sql_reads_vat_from_the_vendor_then_its_supplier_record():
    assert "s.vat_number" in VENDOR_PROFILE_SQL["vat_number"]
    assert "ps.vat_registration_number" in VENDOR_PROFILE_SQL["vat_number"]
    assert "ps.vat_status" in VENDOR_PROFILE_SQL["vat_status"]
    columns = vendor_profile_columns("name", "vat_status")
    assert columns.endswith(" AS vat_status") and " AS name," in columns


PUBLIC_FORM = {
    "companyName": "Haus of Bricks (Pvt) Ltd",
    "registrationNumber": "1234/2019",
    "taxClearanceNumber": "ITF263-2026",
    "yearEstablished": 2019,
    "employees": 12,
    "address": "12 Coventry Road, Workington, Harare",
    "contactPerson": "Tendai",
    "email": "sales@hausofbricks.co.zw",
    "phone": "+263771000000",
    "categories": ["Construction Materials"],
    "description": "Bricks and blocks",
    "provinces": ["Harare"],
    "references": "Previous supply to SNC projects",
}


def test_public_registration_requires_a_vat_answer():
    with pytest.raises(ValidationError):
        SupplierPayload(**PUBLIC_FORM)


def test_public_registration_requires_a_vat_number_when_registered():
    with pytest.raises(ValidationError):
        SupplierPayload(**PUBLIC_FORM, vatStatus="registered")
    assert SupplierPayload(**PUBLIC_FORM, vatStatus="registered", vatNumber="220123456").vatNumber == "220123456"


def test_public_registration_drops_a_vat_number_when_not_registered():
    payload = SupplierPayload(**PUBLIC_FORM, vatStatus="not_registered", vatNumber="220123456")
    assert payload.vatNumber is None
