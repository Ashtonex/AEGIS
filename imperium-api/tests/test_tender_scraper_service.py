import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.tender_scraper import _extract_from_html, _extract_from_json_payload


class TenderScraperServiceTests(unittest.TestCase):
    def test_json_feed_items_are_normalized_into_tender_signals(self):
        payload = [
            {
                "title": "Road Rehabilitation Tender",
                "source": "PRAZ",
                "sector": "Roads",
                "budget": 250000,
                "ref": "PRZ-2026-041",
                "deadline": "2026-08-01",
                "rationale": "Structured procurement feed",
            }
        ]

        signals = _extract_from_json_payload(payload, "praz.gov.zw", "https://example.com/feed.json")

        self.assertEqual(len(signals), 1)
        signal = signals[0]
        self.assertEqual(signal.title, "Road Rehabilitation Tender")
        self.assertEqual(signal.source, "praz.gov.zw")
        self.assertEqual(signal.sector, "Roads")
        self.assertEqual(signal.budget, 250000.0)
        self.assertEqual(signal.ref, "PRZ-2026-041")
        self.assertGreaterEqual(signal.score, 40)
        self.assertEqual(signal.source_url, "https://example.com/feed.json")
        self.assertEqual(signal.compliance[0].label, "Reference Trace")

    def test_html_card_with_tender_keywords_is_scraped(self):
        html = """
        <html>
          <body>
            <article class="tender-card">
              <h3>Water Supply Procurement Notice</h3>
              <div>Reference: WAT-7781</div>
              <div>Deadline: 2026-08-15</div>
              <div>Budget USD 180,000</div>
            </article>
          </body>
        </html>
        """

        import asyncio
        signals = asyncio.run(_extract_from_html(html, "example.org", "https://example.org/tenders"))

        self.assertEqual(len(signals), 1)
        signal = signals[0]
        self.assertEqual(signal.title, "Water Supply Procurement Notice")
        self.assertEqual(signal.ref, "WAT-7781")
        self.assertEqual(signal.source, "example.org")
        self.assertEqual(signal.source_url, "https://example.org/tenders")
        self.assertEqual(signal.sector, "Utilities")
        self.assertGreater(signal.budget, 0)


if __name__ == "__main__":
    unittest.main()
