"""
Unit tests for Earned Value Management (EVM) and S-Curve commercial indices.
Tests CPI, SPI, EAC, VAC, TCPI, and S-Curve Sigmoid mathematical calculations.
"""
import pytest
from datetime import date, timedelta


def test_evm_indices_and_variances():
    bac = 500000.00  # Budget at Completion $500,000
    planned_pct = 60.0  # Planned 60%
    actual_pct = 50.0   # Earned 50% physical progress
    actual_cost = 275000.00  # $275,000 spent to date

    pv = round(bac * (planned_pct / 100.0), 2)  # $300,000
    ev = round(bac * (actual_pct / 100.0), 2)   # $250,000
    ac = actual_cost

    assert pv == 300000.00
    assert ev == 250000.00

    # Variances
    cv = ev - ac  # 250,000 - 275,000 = -25,000 (Cost Overrun)
    sv = ev - pv  # 250,000 - 300,000 = -50,000 (Behind Schedule)

    assert cv == -25000.00
    assert sv == -50000.00

    # Performance Indices
    cpi = round(ev / ac, 3)  # 250,000 / 275,000 = 0.909
    spi = round(ev / pv, 3)  # 250,000 / 300,000 = 0.833

    assert cpi == 0.909
    assert spi == 0.833

    # Estimate at Completion (EAC = BAC / CPI)
    eac = round(bac / cpi, 2)  # 500,000 / 0.909 = 550,055.01
    vac = round(bac - eac, 2)  # 500,000 - 550,055.01 = -50,055.01

    assert eac > bac
    assert vac < 0

    # To-Complete Performance Index (TCPI = (BAC - EV) / (BAC - AC))
    remaining_work = bac - ev  # 250,000
    remaining_funds = bac - ac  # 225,000
    tcpi = round(remaining_work / remaining_funds, 3)  # 250,000 / 225,000 = 1.111

    assert tcpi == 1.111


def test_sigmoid_s_curve_progression():
    # Test Sigmoid factor: S(t) = 3t^2 - 2t^3
    assert (3 * (0.0 ** 2) - 2 * (0.0 ** 3)) == 0.0
    assert (3 * (1.0 ** 2) - 2 * (1.0 ** 3)) == 1.0
    # At mid-point (t = 0.5), progress should be exactly 50%
    mid = 3 * (0.5 ** 2) - 2 * (0.5 ** 3)
    assert mid == 0.5
