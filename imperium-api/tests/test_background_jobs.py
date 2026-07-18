import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import AsyncMock, MagicMock
from app.workers.arq_worker import (
    generate_quotation_documents_job,
    send_notification_job,
    compliance_check_reminder_job,
    exponential_backoff_retry,
)


class BackgroundWorkersIntegrationTests(unittest.TestCase):
    def test_exponential_backoff_retry_policy(self):
        """Verifies exponential retry delays: 5s, 10s, and limit of 3 tries."""
        ctx_try_1 = {"job_try": 1}
        ctx_try_2 = {"job_try": 2}
        ctx_try_3 = {"job_try": 3}

        self.assertEqual(exponential_backoff_retry(ctx_try_1), 5)
        self.assertEqual(exponential_backoff_retry(ctx_try_2), 10)
        self.assertIsNone(exponential_backoff_retry(ctx_try_3))

    def test_send_notification_job_execution(self):
        """Tests email notification execution inside arq worker context."""
        ctx = MagicMock()
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                send_notification_job(
                    ctx, "test@sixnine.co.zw", "HSE Alert", "Safety briefing required."
                )
            )
            self.assertTrue(result)
        finally:
            loop.close()

    def test_compliance_check_reminder_job_execution(self):
        """Tests compliance reminders log successfully inside arq worker context."""
        ctx = MagicMock()
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                compliance_check_reminder_job(
                    ctx, "doc-999", "NSSA clearance certificate", "2026-08-31"
                )
            )
            self.assertTrue(result)
        finally:
            loop.close()

    def test_generate_quotation_documents_job_mocked(self):
        """Tests document generation job using mocked Redis context to prove dispatch logic safety."""
        # Setup mock Redis pool client
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None  # Idempotency safety check passes
        mock_redis.setex = AsyncMock()

        ctx = {"job_id": "test-job-uuid", "redis": mock_redis}

        payload = {
            "quotation_id": "SNC-QT-TEST",
            "revision_number": 2,
            "project_title": "Concrete Slab Pour",
            "client_name": "Ashton Civils Ltd",
            "preliminaries": 200,
            "items": [
                {
                    "description": "Fine aggregate sand",
                    "quantity": 5,
                    "unit": "m3",
                    "rate": 45,
                }
            ],
        }

        with TemporaryDirectory() as tmp_dir:
            pdf_path = str(Path(tmp_dir) / "test_arq_output.pdf")
            excel_path = str(Path(tmp_dir) / "test_arq_output.xlsx")

            loop = asyncio.new_event_loop()
            try:
                result = loop.run_until_complete(
                    generate_quotation_documents_job(
                        ctx, payload, pdf_path, excel_path
                    )
                )
                self.assertTrue(result)

                # Verify output files were actually created by our renderers
                self.assertTrue(Path(pdf_path).exists())
                self.assertTrue(Path(excel_path).exists())

                # Verify Redis idempotency key was saved
                mock_redis.setex.assert_called_once()
            finally:
                loop.close()


if __name__ == "__main__":
    unittest.main()
