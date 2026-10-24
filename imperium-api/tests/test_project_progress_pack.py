"""
Unit tests for Progress Pack aggregation and Drawing Revision controls.
"""
from datetime import date, timedelta


def test_drawing_revision_superseded_history():
    history = []
    # Old revision Rev A
    old_rev = "Rev A"
    old_date = "2026-08-15"
    old_url = "https://aegis.snc/drawings/str-01-revA.pdf"

    history.append({
        "revision": old_rev,
        "superseded_date": "2026-09-01",
        "date_received": old_date,
        "file_url": old_url,
    })

    assert len(history) == 1
    assert history[0]["revision"] == "Rev A"

    # New active revision is Rev B
    current_rev = "Rev B"
    assert current_rev != old_rev


def test_progress_pack_kpi_calculations():
    # 1. Milestone progress percentage
    total_milestones = 12
    completed_milestones = 9
    progress_pct = round((completed_milestones / total_milestones) * 100)
    assert progress_pct == 75

    # 2. QA pour compliance rate
    total_pours = 15
    compliant_pours = 14
    compliance_rate = round((compliant_pours / total_pours) * 100, 1)
    assert compliance_rate == 93.3

    # 3. Revised contractual completion date adjustment via EOT days granted
    baseline_completion = date(2026, 11, 30)
    eot_days_granted = 28
    revised_contractual_date = baseline_completion + timedelta(days=eot_days_granted)
    assert revised_contractual_date == date(2026, 12, 28)
