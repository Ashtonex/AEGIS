"""Twilio WhatsApp channel: send, inbound and status webhooks, signatures.

No database or network: the DB session is a recording fake and Twilio's API
is an httpx.MockTransport."""

import asyncio
import hashlib
import hmac
import json
import unittest
from base64 import b64encode
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from core.config import settings
from core.database import get_db
from routers import crm_communications as comms

ORG_ID = str(uuid4())
SENDER = "+14155238886"
BASE_URL = "https://api.example.test"


class _Result:
    def __init__(self, scalar=None, rowcount=0):
        self._scalar = scalar
        self.rowcount = rowcount

    def scalar(self):
        return self._scalar


class FakeDb:
    def __init__(self, scalar=None, rowcount=1):
        self.statements: list[tuple[str, dict]] = []
        self.commits = 0
        self._scalar = scalar
        self._rowcount = rowcount

    async def execute(self, statement, params=None):
        self.statements.append((str(statement), params or {}))
        return _Result(self._scalar, self._rowcount)

    async def commit(self):
        self.commits += 1


def _sign(url: str, params: dict[str, str], token: str) -> str:
    signed = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    return b64encode(hmac.new(token.encode(), signed.encode(), hashlib.sha1).digest()).decode()


def _twilio_settings(**extra):
    values = {
        "WHATSAPP_PROVIDER": "twilio",
        "TWILIO_ACCOUNT_SID": "AC" + "0" * 32,
        "TWILIO_AUTH_TOKEN": "test-token",
        "TWILIO_WHATSAPP_FROM": SENDER,
        "TWILIO_WEBHOOK_BASE_URL": BASE_URL,
    }
    values.update(extra)
    return patch.multiple(settings, **values)


class SignatureTests(unittest.TestCase):
    def test_matches_twilio_documented_example(self):
        params = {
            "CallSid": "CA1234567890ABCDE",
            "Caller": "+12349013030",
            "Digits": "1234",
            "From": "+12349013030",
            "To": "+18005551212",
        }
        with patch.object(settings, "TWILIO_AUTH_TOKEN", "12345"):
            self.assertTrue(
                comms._validate_twilio_signature(
                    "https://mycompany.com/myapp.php?foo=1&bar=2", params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ="
                )
            )

    def test_fails_closed_without_auth_token(self):
        with patch.object(settings, "TWILIO_AUTH_TOKEN", None):
            self.assertFalse(comms._validate_twilio_signature("https://x", {}, ""))

    def test_rejects_tampered_params(self):
        url = f"{BASE_URL}/hook"
        params = {"Body": "hello"}
        with patch.object(settings, "TWILIO_AUTH_TOKEN", "test-token"):
            sig = _sign(url, params, "test-token")
            self.assertTrue(comms._validate_twilio_signature(url, params, sig))
            self.assertFalse(comms._validate_twilio_signature(url, {"Body": "hacked"}, sig))


class PayloadTests(unittest.TestCase):
    def test_requires_body_or_template(self):
        with self.assertRaises(ValidationError):
            comms.WhatsAppMessagePayload(to_phone="263771234567")

    def test_template_only_is_valid(self):
        payload = comms.WhatsAppMessagePayload(
            to_phone="263771234567", content_sid="HX" + "a" * 32, content_variables={"1": "Tendai"}
        )
        self.assertIsNone(payload.body)

    def test_variables_need_template(self):
        with self.assertRaises(ValidationError):
            comms.WhatsAppMessagePayload(to_phone="263771234567", body="hi", content_variables={"1": "x"})


class SendTests(unittest.TestCase):
    def _send(self, payload, handler):
        real_client = httpx.AsyncClient
        transport = httpx.MockTransport(handler)
        db = FakeDb()
        insert = AsyncMock(return_value=uuid4())
        with patch.object(comms.httpx, "AsyncClient", lambda **kw: real_client(transport=transport, **kw)), \
                patch.object(comms, "_insert_communication", insert):
            result = asyncio.run(
                comms.send_whatsapp_message(payload, user={"org_id": ORG_ID, "user_id": str(uuid4())}, db=db)
            )
        return result, insert, db

    def test_text_message_goes_to_twilio_and_is_logged(self):
        captured = {}

        def handler(request: httpx.Request):
            captured["url"] = str(request.url)
            captured["auth"] = request.headers["authorization"]
            captured["form"] = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            return httpx.Response(201, json={"sid": "SM123", "status": "queued", "body": "Hello"})

        with _twilio_settings():
            result, insert, db = self._send(
                comms.WhatsAppMessagePayload(to_phone="+263 77 123 4567", body="Hello"), handler
            )
        self.assertIn("/Accounts/AC", captured["url"])
        self.assertTrue(captured["auth"].startswith("Basic "))
        self.assertEqual(captured["form"]["From"], "whatsapp:+14155238886")
        self.assertEqual(captured["form"]["To"], "whatsapp:+263771234567")
        self.assertEqual(captured["form"]["Body"], "Hello")
        self.assertEqual(
            captured["form"]["StatusCallback"],
            f"{BASE_URL}/api/v1/crm-communications/webhooks/twilio/whatsapp/status",
        )
        values = insert.call_args.kwargs["values"]
        self.assertEqual(values["external_provider"], "twilio_whatsapp")
        self.assertEqual(values["external_message_id"], "SM123")
        self.assertEqual(values["status"], "queued")
        self.assertEqual(db.commits, 1)
        self.assertEqual(result["data"]["external_message_id"], "SM123")

    def test_template_message_sends_content_sid(self):
        captured = {}

        def handler(request: httpx.Request):
            captured["form"] = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            return httpx.Response(201, json={"sid": "SM9", "status": "queued"})

        sid = "HX" + "b" * 32
        with _twilio_settings():
            self._send(
                comms.WhatsAppMessagePayload(to_phone="263771234567", content_sid=sid, content_variables={"1": "Q-17"}),
                handler,
            )
        self.assertEqual(captured["form"]["ContentSid"], sid)
        self.assertEqual(json.loads(captured["form"]["ContentVariables"]), {"1": "Q-17"})
        self.assertNotIn("Body", captured["form"])

    def test_twilio_error_message_is_surfaced(self):
        def handler(request):
            return httpx.Response(400, json={"code": 63007, "message": "Twilio could not find a Channel with the specified From address"})

        with _twilio_settings(), self.assertRaises(HTTPException) as ctx:
            self._send(comms.WhatsAppMessagePayload(to_phone="263771234567", body="x"), handler)
        self.assertEqual(ctx.exception.status_code, 502)
        self.assertIn("could not find a Channel", ctx.exception.detail)

    def test_unconfigured_twilio_is_503(self):
        with _twilio_settings(TWILIO_AUTH_TOKEN=None), self.assertRaises(HTTPException) as ctx:
            self._send(comms.WhatsAppMessagePayload(to_phone="263771234567", body="x"), lambda r: None)
        self.assertEqual(ctx.exception.status_code, 503)

    def test_meta_provider_rejects_templates(self):
        with patch.object(settings, "WHATSAPP_PROVIDER", "meta"), self.assertRaises(HTTPException) as ctx:
            self._send(
                comms.WhatsAppMessagePayload(to_phone="263771234567", content_sid="HX" + "c" * 32),
                lambda r: None,
            )
        self.assertEqual(ctx.exception.status_code, 422)


class WebhookTests(unittest.TestCase):
    def _client(self, db):
        app = FastAPI()
        app.include_router(comms.router, prefix="/api/v1/crm-communications")

        async def _db():
            yield db

        app.dependency_overrides[get_db] = _db
        return TestClient(app, base_url=BASE_URL)

    def _post(self, db, path, params, signature=None):
        url = f"{BASE_URL}/api/v1/crm-communications{path}"
        sig = signature if signature is not None else _sign(url, params, "test-token")
        return self._client(db).post(
            f"/api/v1/crm-communications{path}", data=params, headers={"X-Twilio-Signature": sig}
        )

    def test_inbound_message_is_logged_and_acked_with_twiml(self):
        db = FakeDb(scalar=None)
        insert = AsyncMock(return_value=uuid4())
        params = {
            "MessageSid": "SMin1",
            "From": "whatsapp:+263771234567",
            "To": f"whatsapp:{SENDER}",
            "Body": "Is the quote ready?",
            "ProfileName": "Tendai",
            "WaId": "263771234567",
            "NumMedia": "1",
            "MediaUrl0": "https://api.twilio.com/media/ME1",
            "MediaContentType0": "image/jpeg",
        }
        with _twilio_settings(), \
                patch.object(comms, "_org_for_twilio_number", AsyncMock(return_value=ORG_ID)) as org_lookup, \
                patch.object(comms, "_contact_for_phone", AsyncMock(return_value=None)), \
                patch.object(comms, "_insert_communication", insert):
            response = self._post(db, "/webhooks/twilio/whatsapp", params)
        self.assertEqual(response.status_code, 200)
        self.assertIn("<Response></Response>", response.text)
        self.assertEqual(org_lookup.call_args.args[1], f"whatsapp:{SENDER}")
        self.assertTrue(org_lookup.call_args.kwargs["whatsapp"])
        values = insert.call_args.kwargs["values"]
        self.assertEqual(values["direction"], "inbound")
        self.assertEqual(values["external_provider"], "twilio_whatsapp")
        self.assertEqual(values["external_message_id"], "SMin1")
        self.assertEqual(values["from_address"], "263771234567")
        self.assertEqual(values["metadata"]["media"][0]["content_type"], "image/jpeg")
        self.assertEqual(db.commits, 1)

    def test_retried_inbound_message_is_not_logged_twice(self):
        db = FakeDb(scalar=uuid4())
        insert = AsyncMock()
        with _twilio_settings(), \
                patch.object(comms, "_org_for_twilio_number", AsyncMock(return_value=ORG_ID)), \
                patch.object(comms, "_insert_communication", insert):
            response = self._post(db, "/webhooks/twilio/whatsapp", {"MessageSid": "SMin1", "To": SENDER})
        self.assertEqual(response.status_code, 200)
        insert.assert_not_called()

    def test_bad_signature_is_rejected(self):
        with _twilio_settings():
            response = self._post(FakeDb(), "/webhooks/twilio/whatsapp", {"MessageSid": "SM1"}, signature="nope")
        self.assertEqual(response.status_code, 403)

    def test_status_update_never_moves_backwards(self):
        db = FakeDb(rowcount=1)
        with _twilio_settings(), \
                patch.object(comms, "_org_for_twilio_number", AsyncMock(return_value=ORG_ID)):
            response = self._post(
                db,
                "/webhooks/twilio/whatsapp/status",
                {"MessageSid": "SM123", "MessageStatus": "sent", "From": f"whatsapp:{SENDER}"},
            )
        self.assertEqual(response.status_code, 200)
        (crm_sql, crm_params), (staff_sql, staff_params) = db.statements[-2:]
        self.assertIn("UPDATE crm.communication_events", crm_sql)
        self.assertIn("UPDATE core.communication_deliveries", staff_sql)
        for params in (crm_params, staff_params):
            self.assertEqual(params["status"], "sent")
            self.assertEqual(params["later_statuses"], ["delivered", "read"])
        self.assertIsNone(crm_params["outcome"])
        self.assertIsNone(staff_params["detail"])
        self.assertEqual(response.json()["data"]["processed"], 2)

    def test_failed_status_records_error_code(self):
        db = FakeDb(rowcount=1)
        with _twilio_settings(), \
                patch.object(comms, "_org_for_twilio_number", AsyncMock(return_value=ORG_ID)):
            self._post(
                db,
                "/webhooks/twilio/whatsapp/status",
                {"MessageSid": "SM123", "MessageStatus": "undelivered", "ErrorCode": "63016", "From": SENDER},
            )
        crm_params, staff_params = db.statements[-2][1], db.statements[-1][1]
        self.assertEqual(crm_params["status"], "undelivered")
        self.assertEqual(crm_params["later_statuses"], [])
        self.assertEqual(crm_params["outcome"], "Twilio error 63016")
        self.assertEqual(staff_params["status"], "undelivered")
        self.assertIn("24-hour window", staff_params["detail"])


class OrgLookupTests(unittest.TestCase):
    def test_whatsapp_lookup_falls_back_to_whatsapp_sender(self):
        class NoConnections(FakeDb):
            async def execute(self, statement, params=None):
                class R:
                    def mappings(self_inner):
                        class M:
                            def all(self_m):
                                return []
                        return M()
                return R()

        with _twilio_settings(TWILIO_FROM_NUMBER="+263242000000"), \
                patch.object(comms, "_single_tenant_org_id", AsyncMock(return_value=ORG_ID)):
            whatsapp_org = asyncio.run(
                comms._org_for_twilio_number(NoConnections(), f"whatsapp:{SENDER}", whatsapp=True)
            )
            voice_org = asyncio.run(comms._org_for_twilio_number(NoConnections(), SENDER))
        self.assertEqual(whatsapp_org, ORG_ID)
        self.assertIsNone(voice_org)


if __name__ == "__main__":
    unittest.main()
