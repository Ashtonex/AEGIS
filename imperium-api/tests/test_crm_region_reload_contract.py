from pathlib import Path


CRM_ROUTER = Path("routers/crm.py").read_text()
EXECUTIVE_ROUTER = Path("routers/executive.py").read_text()
MIGRATION = Path("migrations/154_crm_project_coordinate_persistence.sql").read_text()
CRM_PAGE = Path("../aegis-web/src/app/dashboard/crm/page.tsx").read_text()


def _list_opportunities_sql() -> str:
    start = CRM_ROUTER.index('@router.get("/opportunities")')
    end = CRM_ROUTER.index('@router.get("/tenders")')
    return CRM_ROUTER[start:end]


def _list_tenders_sql() -> str:
    start = CRM_ROUTER.index('@router.get("/tenders")')
    end = CRM_ROUTER.index('@router.get("/tender-signals")')
    return CRM_ROUTER[start:end]


def test_crm_dashboard_opportunity_reload_returns_region():
    section = _list_opportunities_sql()

    assert "o.region" in section
    assert "o.latitude::float AS latitude" in section
    assert "o.longitude::float AS longitude" in section
    assert "region: Optional[str]" in CRM_ROUTER
    assert "latitude: Optional[float]" in CRM_ROUTER
    assert "longitude: Optional[float]" in CRM_ROUTER
    assert '"region"' in CRM_ROUTER
    assert '"latitude"' in CRM_ROUTER
    assert '"longitude"' in CRM_ROUTER


def test_crm_dashboard_tender_reload_returns_region():
    section = _list_tenders_sql()

    assert "bid_bond_secured," in section
    assert "latitude::float AS latitude" in section
    assert "longitude::float AS longitude" in section
    assert (
        "INSERT INTO crm.tenders (\n            tender_name, stage, bid_amount, region, latitude, longitude, organization_id"
        in CRM_ROUTER
    )


def test_crm_coordinate_schema_and_ui_are_persistent():
    assert "ALTER TABLE crm.opportunities" in MIGRATION
    assert "ALTER TABLE crm.tenders" in MIGRATION
    assert "idx_crm_opportunities_coordinates" in MIGRATION
    assert "idx_crm_tenders_coordinates" in MIGRATION
    assert "REGION_COORDINATES" in CRM_PAGE
    assert "coordinatePayload" in CRM_PAGE
    assert "latitude" in CRM_PAGE
    assert "longitude" in CRM_PAGE


def test_executive_regions_include_project_and_crm_coordinate_sources():
    assert "pp.latitude::float AS latitude" in EXECUTIVE_ROUTER
    assert "regional_crm_opportunities" in EXECUTIVE_ROUTER
    assert "regional_crm_tenders" in EXECUTIVE_ROUTER
    assert "crm_records" in EXECUTIVE_ROUTER
