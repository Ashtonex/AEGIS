"""Staff communications: channel planning, message formatting, validation.

The SQL paths are exercised end to end against a real Postgres separately;
these cover the decisions that need no database."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import ValidationError

from app.services.communications import dispatch
from core.config import settings
from routers.communications import SendPayload
from routers.profiles import ProfileUpdate


def person(**overrides):
    values = {
        "id": "u1",
        "email": "tendai@example.test",
        "full_name": "Tendai Moyo",
        "teams_account": None,
        "whatsapp_number": "+263771234567",
        "whatsapp_opt_in": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def plan(channel, someone, teams_webhook_url="https://x.logic.azure.com/hook", whatsapp_ready=True):
    return dispatch._plan(channel, someone, teams_webhook_url=teams_webhook_url, whatsapp_ready=whatsapp_ready)


class PlanTests(unittest.TestCase):
    def test_whatsapp_needs_opt_in(self):
        status, detail, _ = plan("whatsapp", person(whatsapp_opt_in=False))
        self.assertEqual(status, "skipped")
        self.assertIn("opted in", detail)

    def test_whatsapp_needs_international_number(self):
        status, detail, _ = plan("whatsapp", person(whatsapp_number="0771234567"))
        self.assertEqual(status, "skipped")
        self.assertIn("country code", detail)

    def test_whatsapp_needs_backend_config(self):
        status, detail, _ = plan("whatsapp", person(), whatsapp_ready=False)
        self.assertEqual(status, "skipped")
        self.assertIn("not configured", detail)

    def test_whatsapp_ready_person_is_pending_with_digits(self):
        self.assertEqual(plan("whatsapp", person()), ("pending", None, "263771234567"))

    def test_teams_prefers_teams_account_and_needs_org_webhook(self):
        self.assertEqual(plan("teams", person(teams_account="t@ext.test"))[2], "t@ext.test")
        self.assertEqual(plan("teams", person())[2], "tendai@example.test")
        status, detail, _ = plan("teams", person(), teams_webhook_url=None)
        self.assertEqual(status, "skipped")
        self.assertIn("Teams delivery is not set up", detail)

    def test_email_needs_address(self):
        self.assertEqual(plan("email", person(email=None))[0], "skipped")
        self.assertEqual(plan("email", person()), ("pending", None, "tendai@example.test"))


class FormattingTests(unittest.TestCase):
    def test_email_escapes_html_and_keeps_line_breaks(self):
        html_body, text_body = dispatch._email_bodies(
            {"body": "Site <b>closed</b>\nback Monday", "link": "https://app.test/x", "sender_name": "Ops"},
            "Tendai Moyo",
        )
        self.assertIn("Site &lt;b&gt;closed&lt;/b&gt;<br>back Monday", html_body)
        self.assertIn("Hi Tendai,", html_body)
        self.assertIn("https://app.test/x", text_body)
        self.assertIn("Sent by Ops via AEGIS", text_body)

    def test_whatsapp_body_fits_twilio_limit(self):
        message = {"subject": "Notice", "body": "x" * 5000, "link": "https://app.test/dashboard"}
        body = dispatch._whatsapp_body(message)
        self.assertLessEqual(len(body), 1600)
        self.assertTrue(body.startswith("*Notice*"))
        self.assertTrue(body.endswith("https://app.test/dashboard"))

    def test_absolute_link(self):
        with patch.object(settings, "PUBLIC_APP_URL", "https://aegis.test/"):
            self.assertEqual(dispatch.absolute_link("/dashboard/x"), "https://aegis.test/dashboard/x")
            self.assertEqual(dispatch.absolute_link("https://other.test/y"), "https://other.test/y")
            self.assertIsNone(dispatch.absolute_link(None))


class ValidationTests(unittest.TestCase):
    def test_send_payload_rejects_unknown_channel_and_bad_link(self):
        base = {"recipient_user_ids": ["7b0e7f7e-0000-4000-8000-000000000001"], "subject": "Hi", "body": "Hello"}
        with self.assertRaises(ValidationError):
            SendPayload(**base, channels=["sms"])
        with self.assertRaises(ValidationError):
            SendPayload(**base, channels=["email"], action_url="javascript:alert(1)")
        SendPayload(**base, channels=["email", "whatsapp"], action_url="/dashboard/projects")

    def test_profile_whatsapp_number_is_normalised_to_e164(self):
        self.assertEqual(ProfileUpdate(whatsapp_number="+263 77 123-4567").whatsapp_number, "+263771234567")
        with self.assertRaises(ValidationError):
            ProfileUpdate(whatsapp_number="0771234567")
        self.assertIsNone(ProfileUpdate(whatsapp_number="").whatsapp_number)


if __name__ == "__main__":
    unittest.main()
