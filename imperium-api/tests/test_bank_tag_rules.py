"""Auto-tagging rules: matching / planning logic (pure, no database) and the
wiring guarantees (only empty fields, same tagging path, import hook)."""
from datetime import date
from decimal import Decimal
from pathlib import Path
import unittest

from app.services.finance.bank_rules import Rule, normalise, plan

ROOT = Path(__file__).resolve().parents[1]
RULES = (ROOT / "app" / "services" / "finance" / "bank_rules.py").read_text(encoding="utf-8")
ROUTER = (ROOT / "routers" / "bank_transactions.py").read_text(encoding="utf-8")


def line(line_id, description, amount, on=date(2026, 3, 1), **tags):
    row = {"id": line_id, "description": description, "reference": "REF", "amount": Decimal(str(amount)),
           "transaction_date": on, "category": None, "project_id": None, "counterparty_name": None, "notes": None}
    row.update(tags)
    row["_haystack"] = normalise(f"{row['description']} {row['reference']}")
    return row


def rule(rule_id, match_text, priority=100, **values):
    return Rule({"id": rule_id, "match_text": match_text, "priority": priority, "direction": "any", **values})


class RuleMatchingTests(unittest.TestCase):
    def test_match_ignores_spaces_and_case(self):
        r = rule("r1", "gold coast properties", set_category="client_receipt")
        self.assertTrue(r.matches(line("a", "RTGS //GOLD COAST PROPERTIES PVT LTD//", 1000)))
        # the bank sometimes breaks words: "AFRI CAN SUN"
        self.assertTrue(rule("r2", "african sun", set_category="client_receipt").matches(line("b", "//AFRI CAN SUN//", 50)))

    def test_direction_amount_and_date_filters(self):
        r = rule("r1", "zimra", direction="out", amount_min=100, amount_max=5000,
                 date_from=date(2026, 1, 1), date_to=date(2026, 6, 30), set_category="tax_statutory")
        self.assertTrue(r.matches(line("a", "Zimra Deposit", -600)))
        self.assertFalse(r.matches(line("b", "Zimra Deposit", 600)))                          # money in
        self.assertFalse(r.matches(line("c", "Zimra Deposit", -15)))                          # below min
        self.assertFalse(r.matches(line("d", "Zimra Deposit", -600, on=date(2025, 12, 31))))  # before range


class RulePlanningTests(unittest.TestCase):
    def test_rules_never_overwrite_an_existing_tag(self):
        lines = [line("hand", "LEDGER FEE", -30, category="other"), line("empty", "LEDGER FEE", -30)]
        changes = plan([rule("fees", "ledger fee", set_category="bank_charges", set_counterparty="BancABC")], lines)
        self.assertEqual(changes["empty"]["updates"], {"category": "bank_charges", "counterparty_name": "BancABC"})
        # the hand-tagged line only gets the field that was still empty
        self.assertEqual(changes["hand"]["updates"], {"counterparty_name": "BancABC"})

    def test_first_rule_by_priority_wins_a_field(self):
        lines = [line("x", "Cash Withdrawal Charge", -200)]
        fee = rule("fee", "cash withdrawal charge", priority=10, set_category="bank_charges")
        cash = rule("cash", "cash withdrawal", priority=20, set_category="cash_withdrawal")
        changes = plan([fee, cash], lines)   # callers pass rules already sorted by priority
        self.assertEqual(changes["x"]["updates"]["category"], "bank_charges")
        self.assertEqual(changes["x"]["rule_id"], "fee")

    def test_lines_with_nothing_to_fill_are_left_out(self):
        lines = [line("done", "LEDGER FEE", -30, category="bank_charges")]
        self.assertEqual(plan([rule("fees", "ledger fee", set_category="bank_charges")], lines), {})


class RuleWiringContractTests(unittest.TestCase):
    def test_applying_uses_the_normal_tagging_path(self):
        body = RULES.split("async def apply(")[1].split("\nasync def ")[0]
        self.assertIn("reconciliation.tag_lines(", body)
        self.assertIn("bank_books.sync(", body)
        self.assertIn("tag_rule_id", body)

    def test_new_statement_imports_are_auto_tagged_and_journaled(self):
        body = ROUTER.split("async def create_bank_statement_import(")[1].split("\n@router")[0]
        self.assertIn("bank_rules.apply(", body)
        self.assertIn("bank_books.sync(", body)
        self.assertLess(body.find("await db.commit()"), body.find("bank_rules.apply("))  # import committed first

    def test_rule_endpoints_have_permissions(self):
        for fn, perm in (("async def create_tag_rule", "finance.reconciliation.match"),
                         ("async def apply_tag_rules", "finance.reconciliation.match"),
                         ("async def delete_tag_rule", "finance.reconciliation.match"),
                         ("async def list_tag_rules", "finance.reconciliation.read")):
            self.assertIn(f'require_permission("{perm}")', ROUTER.split(fn)[1].split("\n@router")[0])


if __name__ == "__main__":
    unittest.main()
