"""Automated tests for Subcontractor Commercial Controls, Payment Certification, Retentions & Back-Charges."""

from decimal import Decimal
import unittest


class TestSubcontractorCommercialCalculations(unittest.TestCase):
    def test_incremental_gross_and_retention(self):
        """Tests that retention is calculated accurately on incremental gross work value up to retention cap."""
        award_val = Decimal("100000.00")
        ret_pct = Decimal("0.10")  # 10%
        ret_cap = Decimal("5000.00")  # 5% max cap on contract

        # IPC 01: Gross Certified $30,000
        prev_gross = Decimal("0.00")
        cert_gross_1 = Decimal("30000.00")
        incremental_1 = cert_gross_1 - prev_gross
        retention_1 = incremental_1 * ret_pct  # $3,000
        self.assertEqual(retention_1, Decimal("3000.00"))
        net_payable_1 = incremental_1 - retention_1
        self.assertEqual(net_payable_1, Decimal("27000.00"))

        # IPC 02: Gross Certified $60,000 (incremental $30,000)
        # Raw retention would be $3,000, but cap is $5,000 and $3,000 already held -> max $2,000!
        prev_gross = cert_gross_1
        cert_gross_2 = Decimal("60000.00")
        incremental_2 = cert_gross_2 - prev_gross
        raw_ret_2 = incremental_2 * ret_pct  # $3,000
        total_held_so_far = retention_1
        retention_2 = min(raw_ret_2, max(Decimal("0"), ret_cap - total_held_so_far))
        self.assertEqual(retention_2, Decimal("2000.00"))
        self.assertEqual(retention_1 + retention_2, ret_cap)

    def test_contra_charge_deduction(self):
        """Tests that approved site back-charges deduct cleanly from certified valuation."""
        incremental_gross = Decimal("25000.00")
        retention_deducted = Decimal("2500.00")
        approved_back_charges = [
            {"charge_number": "BC-01", "amount": Decimal("1200.00"), "reason": "defective_work_rectification"},
            {"charge_number": "BC-02", "amount": Decimal("450.00"), "reason": "site_cleaning_penalty"},
        ]
        total_contra = sum(c["amount"] for c in approved_back_charges)
        self.assertEqual(total_contra, Decimal("1650.00"))

        # Net payable = Gross - Retention - Contra Charges
        net_payable = incremental_gross - retention_deducted - total_contra
        self.assertEqual(net_payable, Decimal("20850.00"))


if __name__ == "__main__":
    unittest.main()
