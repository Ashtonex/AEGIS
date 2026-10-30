"""Quotation workspace domain: revisions diff, client schedule, markup vs
margin, line identity and the materials schedule - pure functions, no DB."""

import io
import unittest
from decimal import Decimal

from app.services.documents.quotation_documents import (
    client_schedule,
    render_client_quotation_pdf,
    render_internal_estimate_xlsx,
)
from app.services.quotations import workspace as qws
from app.services.quotations.calculator import QuotationCalculationResult, build_calc_input_from_metadata


def _meta(items, **kw):
    base = {
        "reference_number": "SNC-QT-TEST",
        "quote_date": "2026-10-01",
        "currency": "USD",
        "preliminaries": 1000,
        "overhead_pct": 5,
        "contingency_pct": 5,
        "profit_pct": 12,
        "apply_vat": True,
        "vat_rate": "0.155",
        "items": items,
    }
    base.update(kw)
    return base


ITEMS = [
    {"line_id": "a", "section": "Bill 1", "item_no": "1.1", "description": "Excavate trenches", "qty": 120, "unit": "m3", "rate": 12.35},
    {"line_id": "b", "section": "Bill 1", "item_no": "1.2", "description": "Concrete 25MPa", "qty": 33.3, "unit": "m3", "rate": 187.17},
    {"line_id": "c", "section": "Bill 2", "item_no": "2.1", "description": "Brickwork", "qty": 412, "unit": "m2", "rate": 41.07},
]


class LineIdentityTests(unittest.TestCase):
    def test_missing_and_duplicate_ids_are_assigned_existing_kept(self):
        items = qws.ensure_line_ids([{"line_id": "x"}, {"line_id": "x"}, {}])
        self.assertEqual(items[0]["line_id"], "x")
        self.assertNotEqual(items[1]["line_id"], "x")
        self.assertTrue(items[2]["line_id"])
        self.assertEqual(len({i["line_id"] for i in items}), 3)


class CalculatorMappingTests(unittest.TestCase):
    def test_frozen_vat_rate_is_used_and_legacy_default_kept(self):
        self.assertEqual(build_calc_input_from_metadata("q", _meta(ITEMS, vat_rate="0.15"))["tax_rate"], "0.15")
        legacy = _meta(ITEMS)
        legacy.pop("vat_rate")
        self.assertEqual(build_calc_input_from_metadata("q", legacy)["tax_rate"], 0.155)
        self.assertEqual(build_calc_input_from_metadata("q", _meta(ITEMS, apply_vat=False))["tax_rate"], 0)

    def test_note_lines_carry_no_price(self):
        priced = qws.calculate("q", _meta(ITEMS))
        with_note = qws.calculate("q", _meta(ITEMS + [{"item_type": "note", "description": "Excludes rock", "qty": 5, "rate": 999}]))
        self.assertEqual(priced.direct_costs, with_note.direct_costs)


class CommercialBreakdownTests(unittest.TestCase):
    def test_markup_and_margin_use_the_right_bases(self):
        meta = _meta(ITEMS, discount=0, provisional_sums=0)
        b = qws.commercial_breakdown("q", meta)
        cost = Decimal(b["cost_total"])
        selling = Decimal(b["selling_ex_tax"])
        profit = Decimal(b["profit_realised"])
        self.assertEqual(profit, selling - cost)
        self.assertAlmostEqual(b["markup_pct"], float(profit / cost * 100), places=2)
        self.assertAlmostEqual(b["margin_pct"], float(profit / selling * 100), places=2)
        self.assertGreater(b["markup_pct"], b["margin_pct"])
        steps = {s["key"]: Decimal(s["amount"]) for s in b["steps"]}
        base = steps["direct_costs"] + steps["preliminaries"]
        # Overhead, contingency and profit are each a % of the same base - not compounded.
        self.assertEqual(steps["overhead"], (base * Decimal("0.05")).quantize(Decimal("0.01")))
        self.assertEqual(steps["profit"], (base * Decimal("0.12")).quantize(Decimal("0.01")))

    def test_discount_reduces_realised_profit(self):
        no_disc = qws.commercial_breakdown("q", _meta(ITEMS))
        disc = qws.commercial_breakdown("q", _meta(ITEMS, discount=500))
        self.assertEqual(Decimal(no_disc["profit_realised"]) - Decimal(disc["profit_realised"]), Decimal("500.00"))


class RevisionCompareTests(unittest.TestCase):
    def _calc(self, meta):
        return qws.calculate("q", meta)

    def test_variance_reconciles_to_direct_cost_delta(self):
        base = _meta(ITEMS)
        target_items = [
            {**ITEMS[0], "qty": 131.5, "rate": 13.1},             # qty + rate change
            {**ITEMS[1], "description": "Concrete 30MPa"},        # text-only change
            {"line_id": "d", "section": "Bill 2", "item_no": "2.2", "description": "Plaster", "qty": 800, "unit": "m2", "rate": 9.45},
        ]                                                          # c removed, d added
        target = _meta(target_items)
        result = qws.compare_snapshots(base, target, self._calc(base), self._calc(target))
        v = {k: Decimal(x) for k, x in result["variance"].items()}
        self.assertEqual(Decimal(result["rounding"]), 0)
        total = sum(v.values())
        self.assertEqual(total, Decimal(result["direct_cost_delta"]))
        self.assertEqual(result["counts"], {"added": 1, "removed": 1, "changed": 2})
        line_a = next(line for line in result["lines"] if line["line_id"] == "a")
        parts = Decimal(line_a["qty_effect"]) + Decimal(line_a["rate_effect"]) + Decimal(line_a["interaction"])
        self.assertEqual(parts, Decimal(line_a["amount_delta"]))

    def test_identical_snapshots_have_no_lines(self):
        base = _meta(ITEMS)
        result = qws.compare_snapshots(base, _meta(ITEMS), self._calc(base), self._calc(base))
        self.assertEqual(result["lines"], [])
        self.assertEqual(Decimal(result["direct_cost_delta"]), 0)

    def test_legacy_lines_without_ids_match_on_code_and_description(self):
        legacy = [{k: v for k, v in i.items() if k != "line_id"} for i in ITEMS]
        base, target = _meta(legacy), _meta(qws.ensure_line_ids([dict(i) for i in legacy]))
        result = qws.compare_snapshots(base, _meta(legacy), self._calc(base), self._calc(target))
        self.assertEqual(result["counts"]["added"] + result["counts"]["removed"], 0)


class LineFlagTests(unittest.TestCase):
    def test_flags_point_at_lines(self):
        flags = qws.line_flags([
            {"line_id": "z", "description": "Unpriced", "qty": 1, "unit": "m", "rate": 0},
            {"line_id": "y", "description": "Zero by design", "qty": 1, "unit": "m", "rate": 0, "zero_rate_reason": "client supply"},
            {"line_id": "x", "description": "No qty", "qty": 0, "unit": "m", "rate": 5},
            {"line_id": "w", "description": "Mismatch", "qty": 1, "unit": "m", "rate": 10,
             "buildup": [{"type": "material", "qty": 1, "rate": 7}]},
            {"line_id": "v", "item_type": "note", "description": "Excludes rock"},
        ])
        by_code = {(f["code"], f["line_id"]) for f in flags}
        self.assertIn(("unpriced", "z"), by_code)
        self.assertIn(("zero_rate_explained", "y"), by_code)
        self.assertIn(("missing_quantity", "x"), by_code)
        self.assertIn(("buildup_mismatch", "w"), by_code)
        self.assertFalse(any(f["line_id"] == "v" for f in flags))


class ClientDocumentTests(unittest.TestCase):
    def _revision(self, **kw):
        meta = _meta(ITEMS + [{"line_id": "n", "item_type": "note", "section": "Bill 2", "description": "Rock excavation excluded"}], **kw)
        calc = qws.calculate("q", meta)
        return {"revision_number": 2, "snapshot": meta, "calculation": calc.model_dump(mode="json"), "currency": "USD"}

    def test_schedule_reconciles_to_calculator_total(self):
        for kw in ({}, {"discount": 1234.56}, {"preliminaries": 0}, {"provisional_sums": 5000}, {"apply_vat": False}):
            rev = self._revision(**kw)
            schedule = client_schedule(rev["snapshot"], rev["calculation"])
            self.assertTrue(schedule["reconciles"], kw)
            self.assertEqual(schedule["schedule_total"] - schedule["discount"], Decimal(rev["calculation"]["taxable_amount"]))
            self.assertEqual(schedule["grand_total"], Decimal(rev["calculation"]["grand_total"]))

    def test_client_rates_are_selling_rates_not_costs(self):
        rev = self._revision()
        schedule = client_schedule(rev["snapshot"], rev["calculation"])
        first = schedule["sections"][0]["lines"][0]
        self.assertEqual(first["rate"], (Decimal("12.35") * Decimal("1.22")).quantize(Decimal("0.01")))

    def test_client_pdf_has_no_internal_figures(self):
        rev = self._revision()
        pdf = render_client_quotation_pdf(revision=rev, client_name="Test Client")
        self.assertTrue(pdf.startswith(b"%PDF"))
        from pypdf import PdfReader

        text = "".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)
        for leaked in ("12.35", "187.17", "Overhead", "Contingency", "Profit", "margin", "Markup"):
            self.assertNotIn(leaked, text)
        self.assertIn("SNC-QT-TEST", text)
        self.assertIn("Rev 2", text)
        total = Decimal(rev["calculation"]["grand_total"])
        self.assertIn(f"{total:,.2f}", text)

    def test_long_bill_paginates(self):
        long_items = [
            {"line_id": str(i), "section": f"Bill {i // 100}", "item_no": str(i), "description": "Long description " * 12,
             "qty": 3, "unit": "m", "rate": 10}
            for i in range(400)
        ]
        meta = _meta(long_items)
        rev = {"revision_number": 1, "snapshot": meta, "calculation": qws.calculate("q", meta).model_dump(mode="json")}
        from pypdf import PdfReader

        pages = PdfReader(io.BytesIO(render_client_quotation_pdf(revision=rev, client_name="X"))).pages
        self.assertGreater(len(pages), 5)

    def test_internal_workbook_renders(self):
        rev = self._revision()
        data = render_internal_estimate_xlsx(revision=rev, client_name="X", breakdown=qws.commercial_breakdown("q", rev["snapshot"]))
        self.assertTrue(data.startswith(b"PK"))


class MaterialsScheduleTests(unittest.TestCase):
    def test_aggregates_only_compatible_units_and_keeps_trace(self):
        snapshot = {"items": [
            {"line_id": "a", "item_no": "1", "description": "Wall A", "qty": 10, "unit": "m2", "rate": 30,
             "buildup": [{"type": "material", "name": "Cement", "unit": "bag", "qty": 0.5, "rate": 12},
                         {"type": "labour", "name": "Mason", "unit": "hr", "qty": 1, "rate": 5}]},
            {"line_id": "b", "item_no": "2", "description": "Wall B", "qty": 4, "unit": "m2", "rate": 30,
             "buildup": [{"type": "material", "name": " cement ", "unit": "BAG", "qty": 1, "rate": 12},
                         {"type": "material", "name": "Cement", "unit": "kg", "qty": 2, "rate": 0.3}]},
            {"line_id": "c", "item_no": "3", "description": "Prelim", "qty": 1, "unit": "sum", "rate": 100},
        ]}
        result = qws.build_materials_schedule(snapshot)
        bags = next(line for line in result["lines"] if line["unit"].lower() == "bag")
        kgs = next(line for line in result["lines"] if line["unit"] == "kg")
        self.assertEqual(Decimal(bags["quantity"]), Decimal("9"))  # 10*0.5 + 4*1
        self.assertEqual({s["line_id"] for s in bags["sources"]}, {"a", "b"})
        self.assertEqual(Decimal(kgs["quantity"]), Decimal("8"))
        self.assertEqual(result["summary"]["boq_lines_without_material_buildup"], 1)


class StoredCalculationRoundTripTests(unittest.TestCase):
    def test_stored_calculation_rebuilds(self):
        calc = qws.calculate("q", _meta(ITEMS))
        rebuilt = QuotationCalculationResult(**calc.model_dump(mode="json"))
        self.assertEqual(rebuilt.grand_total, calc.grand_total)


if __name__ == "__main__":
    unittest.main()
