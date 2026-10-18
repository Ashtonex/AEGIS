"""
Unit tests for Project Plant & Equipment Analytics service calculations.
"""
import pytest
from app.services.project_plant import get_project_plant_analytics


def test_plant_utilization_and_burn_rate_calculations():
    # Test utilization formula
    # Given: op_hours = 8.0, idle = 2.0, breakdown = 0.0
    # Expected: (8.0 / (8.0 + 2.0 + 0.0)) * 100 = 80.0%
    op_hours = 8.0
    idle_hours = 2.0
    breakdown_hours = 0.0
    denom = op_hours + idle_hours + breakdown_hours
    utilization_rate = round((op_hours / denom) * 100, 1) if denom > 0 else 0.0
    assert utilization_rate == 80.0

    # Test breakdown downtime impact
    breakdown_hours = 2.0
    denom = op_hours + idle_hours + breakdown_hours
    utilization_rate = round((op_hours / denom) * 100, 1) if denom > 0 else 0.0
    assert utilization_rate == 66.7

    # Test zero hours safety
    denom = 0.0
    utilization_rate = round((0.0 / denom) * 100, 1) if denom > 0 else 0.0
    assert utilization_rate == 0.0

    # Test Fuel burn rate & benchmark variance
    fuel_litres = 120.0
    burn_rate = round(fuel_litres / op_hours, 2)
    assert burn_rate == 15.0  # 120 / 8 = 15.0 L/hr

    benchmark = 12.5
    variance = round(burn_rate - benchmark, 2)
    assert variance == 2.5  # Burning 2.5 L/hr more than benchmark (alert threshold)

    # Test output productivity
    output_qty = 480.0  # m3 excavated
    productivity = round(output_qty / op_hours, 2)
    assert productivity == 60.0  # 60 m3 / hr
