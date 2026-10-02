"""Emails to staff reach their login address and the mailbox behind their Teams account."""

import asyncio

import pytest

import core.database
from core import email as email_module
from core.email import real_address_from_teams_account


@pytest.mark.parametrize(
    "teams_account, expected",
    [
        # Real SNC guest identities.
        ("ekowimbeah5_gmail.com#EXT#@SixNineConstruction.onmicrosoft.com", "ekowimbeah5@gmail.com"),
        ("kamutemberemcdonald83_gmail.com#EXT#@SixNineConstruction.onmicrosoft.com", "kamutemberemcdonald83@gmail.com"),
        # Underscores in the local part: only the LAST "_" is the "@".
        ("first_last_gmail.com#EXT#@tenant.onmicrosoft.com", "first_last@gmail.com"),
        # Case-insensitive #EXT# marker.
        ("someone_outlook.com#ext#@tenant.onmicrosoft.com", "someone@outlook.com"),
        # A member identity is already an address.
        ("admin@sixnineconstruction.com", "admin@sixnineconstruction.com"),
        # Nothing usable.
        (None, None),
        ("", None),
        ("not-an-address", None),
        ("nounderscore#EXT#@tenant.onmicrosoft.com", None),
        ("trailing_#EXT#@tenant.onmicrosoft.com", None),
    ],
)
def test_real_address_from_teams_account(teams_account, expected):
    assert real_address_from_teams_account(teams_account) == expected


def test_lookup_failure_falls_back_to_the_original_address(monkeypatch):
    class Boom:
        def __call__(self, *args, **kwargs):
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(core.database, "AsyncSessionLocal", Boom())
    assert asyncio.run(email_module._delivery_addresses("client@example.com")) == ["client@example.com"]


class _FakeSession:
    def __init__(self, teams_account):
        self.teams_account = teams_account

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, *args, **kwargs):
        teams_account = self.teams_account

        class Result:
            def scalar(self):
                return teams_account

        return Result()


def test_staff_with_teams_account_get_both_mailboxes(monkeypatch):
    monkeypatch.setattr(
        core.database, "AsyncSessionLocal",
        lambda: _FakeSession("cossiemudekwa_gmail.com#EXT#@SixNineConstruction.onmicrosoft.com"),
    )
    assert asyncio.run(email_module._delivery_addresses("cosmas@sixnineconstruction.com")) == [
        "cosmas@sixnineconstruction.com", "cossiemudekwa@gmail.com",
    ]


def test_no_teams_account_sends_to_the_address_only(monkeypatch):
    monkeypatch.setattr(core.database, "AsyncSessionLocal", lambda: _FakeSession(None))
    assert asyncio.run(email_module._delivery_addresses("client@example.com")) == ["client@example.com"]


def test_each_mailbox_is_a_separate_send_and_one_success_counts(monkeypatch):
    sent = []

    async def fake_addresses(to):
        return [to, "personal@gmail.com"]

    async def fake_send_one(to, subject, html, text):
        sent.append(to)
        return to == "personal@gmail.com"  # work address bounces

    monkeypatch.setattr(email_module, "_delivery_addresses", fake_addresses)
    monkeypatch.setattr(email_module, "_send_one", fake_send_one)
    monkeypatch.setattr(email_module.settings, "RESEND_API_KEY", "key")
    monkeypatch.setattr(email_module.settings, "EMAIL_FROM_ADDRESS", "AEGIS <a@b.com>")
    ok = asyncio.run(email_module.send_email("work@sixnineconstruction.com", "s", "<p>h</p>"))
    assert ok is True
    assert sent == ["work@sixnineconstruction.com", "personal@gmail.com"]
