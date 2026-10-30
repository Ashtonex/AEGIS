"""Build-up template conversion (app/services/quotations/rate_sources.py).
The DB-backed source lookups are covered end to end by
scripts/verify_quotation_rate_sources.py on the isolated database."""

from app.services.quotations import rate_sources as rs
from app.services.quotations.intelligence_engine import DEFAULT_ASSEMBLIES


def test_clean_buildup_drops_invalid_rows_and_keeps_sources():
    rows = rs.clean_buildup([
        {"type": "material", "name": " Cement ", "qty": "7", "unit": "bag", "rate": 12.6, "source_type": "inventory", "source_ref": "abc", "extra": "x"},
        {"type": "material", "name": "", "qty": 1, "rate": 1},
        {"type": "unknown", "name": "Bad", "qty": 1, "rate": 1},
        {"type": "labour", "name": "Neg", "qty": -1, "rate": 1},
        "not a dict",
    ])
    assert rows == [{"type": "material", "name": "Cement", "qty": 7.0, "unit": "bag", "rate": 12.6, "source_type": "inventory", "source_ref": "abc"}]


def test_legacy_recipe_covers_mappable_types_only():
    res = rs.clean_buildup([
        {"type": "material", "name": "Sand", "qty": 0.5, "unit": "m3", "rate": 25},
        {"type": "labour", "name": "Gang", "qty": 3, "unit": "hr", "rate": 4},
        {"type": "equipment", "name": "Mixer", "qty": 0.5, "unit": "hr", "rate": 15},
        {"type": "transport", "name": "Tipper", "qty": 0.1, "unit": "trip", "rate": 140},
    ])
    legacy = rs.buildup_to_legacy_recipe(res)
    assert legacy["material_recipe"] == [{"material": "Sand", "quantity_per_unit": 0.5, "unit": "m3", "unit_cost": 25.0}]
    assert legacy["labour_gang"] == [{"role": "Gang", "hours_per_unit": 3.0, "hourly_rate": 4.0}]
    assert legacy["plant_needs"] == [{"equipment": "Mixer", "hours_per_unit": 0.5, "hourly_rate": 15.0}]


def test_native_resources_round_trip_unchanged():
    res = [{"type": "transport", "name": "Tipper", "qty": 0.1, "unit": "trip", "rate": 140.0}]
    assert rs.assembly_to_buildup({"resources": res, "material_recipe": [{"material": "ignored"}]}) == res


def test_default_recipe_converts_with_wastage_folded_into_quantity():
    a = DEFAULT_ASSEMBLIES["CONC-25MPA"]
    out = rs.assembly_to_buildup(a)
    mats = [r for r in out if r["type"] == "material"]
    assert mats[0]["qty"] == round(6.5 * 1.05, 6) and "5% wastage" in mats[0]["conversion_note"]
    # Same per-unit cost the legacy calculator gives for 1 unit.
    from app.services.quotations.intelligence_engine import AssemblyLibrary
    legacy_rate = AssemblyLibrary.calculate_breakdown("CONC-25MPA", 1.0)["calculated_unit_rate"]
    assert round(sum(r["qty"] * r["rate"] for r in out), 2) == legacy_rate


def test_sources_by_resource_type():
    assert rs._sources_for("labour") == ["site_labour"]
    assert rs._sources_for("equipment") == ["fleet_operating", "fleet_charge"]
    assert set(rs._sources_for(None)) == set(rs.SOURCE_TYPES)
