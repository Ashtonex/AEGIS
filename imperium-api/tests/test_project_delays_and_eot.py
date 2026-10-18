"""
Unit tests for Contractual Delays & EOT claims time-bar and determination logic.
"""
from datetime import date, timedelta


def test_delay_notice_time_bar_evaluation():
    occurred = date(2026, 9, 1)
    notice_window_days = 28
    deadline = occurred + timedelta(days=notice_window_days)
    assert deadline == date(2026, 9, 29)

    # Compliant notice served on day 20
    served_valid = date(2026, 9, 21)
    is_time_barred_valid = served_valid > deadline
    assert is_time_barred_valid is False

    # Non-compliant notice served on day 35 (Late -> Time-Barred under FIDIC 20.1)
    served_late = date(2026, 10, 6)
    is_time_barred_late = served_late > deadline
    assert is_time_barred_late is True


def test_eot_claim_determination_calculations():
    days_requested = 45
    prolongation_cost_claimed = 67500.00  # $1,500/day indirect overheads

    # Engineer grants 30 days with approved prolongation
    days_granted = 30
    daily_prelim_rate = prolongation_cost_claimed / days_requested
    approved_prolongation = round(days_granted * daily_prelim_rate, 2)

    assert daily_prelim_rate == 1500.00
    assert approved_prolongation == 45000.00

    # Test revised completion date calculation
    contractual_completion = date(2026, 12, 15)
    revised_completion = contractual_completion + timedelta(days=days_granted)
    assert revised_completion == date(2027, 1, 14)
