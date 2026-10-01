"""Emails to staff reach the mailbox behind their Teams account."""

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
    assert asyncio.run(email_module._delivery_address("client@example.com")) == "client@example.com"


def test_send_email_resolves_the_recipient_before_sending():
    source = open(email_module.__file__, encoding="utf-8").read()
    send_body = source[source.index("async def send_email("):]
    assert "to = await _delivery_address(to)" in send_body
