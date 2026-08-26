from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILDER = (ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "quotations" / "builder" / "page.tsx").read_text(encoding="utf-8")


def test_qs_builder_has_sectioned_boq_rows_and_summary_rollup():
    assert "section?: string;" in BUILDER
    assert "item_no?: string;" in BUILDER
    assert "boqSectionSummaries" in BUILDER
    assert "Add Section" in BUILDER
    assert "boq_sections: boqSectionSummaries" in BUILDER


def test_qs_printed_quotation_uses_section_summary_not_flat_lines():
    assert "printBoqSectionSummaries" in BUILDER
    assert "BILL OF QUANTITIES" in BUILDER
    assert "section.itemCount" in BUILDER
