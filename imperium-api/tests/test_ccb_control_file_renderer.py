import os
import tempfile
import unittest

import pdfplumber

from app.services.documents.renderers import CommercialControlPDFRenderer


class CCBControlFileRendererTest(unittest.TestCase):
    def _render(self, data):
        fd, path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        self.addCleanup(os.remove, path)
        self.assertTrue(CommercialControlPDFRenderer().render_pdf(data, path))
        with pdfplumber.open(path) as pdf:
            text = "\n".join(page.extract_text() or "" for page in pdf.pages)
            words = [w for page in pdf.pages for w in page.extract_words(extra_attrs=["non_stroking_color"])]
        return text, words

    def test_table_headers_are_drawn_in_white_on_the_dark_header_row(self):
        # Header text used to inherit the dark cell style, so it was drawn
        # navy-on-navy: present in the text layer but invisible on the page.
        _, words = self._render({
            "quotation_id": "QT-1",
            "project_title": "Test",
            "mandatory_approvals": ["MD Approval"],
            "flags": [{"severity": "high", "title": "Thin margin", "detail": "x", "action": "y"}],
        })
        for header in ("Metric", "Severity", "Required"):
            colours = [tuple(w["non_stroking_color"] or ()) for w in words if w["text"] == header]
            self.assertTrue(colours, f"header {header!r} not rendered")
            self.assertTrue(all(c in ((1, 1, 1), (1.0, 1.0, 1.0), (1,)) for c in colours), f"{header!r} drawn in {colours}")

    def test_markup_characters_in_cell_text_do_not_break_rendering(self):
        text, _ = self._render({
            "quotation_id": "QT-2",
            "project_title": "Test",
            "flags": [{"severity": "high", "title": "Steel & <mesh> rate", "detail": "a < b", "action": "c & d"}],
        })
        self.assertIn("Steel & <mesh> rate", text)


if __name__ == "__main__":
    unittest.main()
