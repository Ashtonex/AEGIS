import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import core.email as email
from core.config import settings


def sent_to(address: str) -> list[str]:
    response = MagicMock(status_code=200)
    client = MagicMock()
    client.post = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    with patch.object(settings, "RESEND_API_KEY", "re_test"), \
         patch.object(settings, "EMAIL_FROM_ADDRESS", "AEGIS <noreply@sixnineconstruction.com>"), \
         patch.object(settings, "EMAIL_REDIRECTS", "Ashton@Admin.com = admin@sixnineconstruction.com"), \
         patch("core.email.httpx.AsyncClient", return_value=client):
        assert asyncio.run(email.send_email(address, "Subject", "<p>Hi</p>"))
    return client.post.await_args.kwargs["json"]["to"]


def test_login_only_address_goes_to_its_real_mailbox():
    assert sent_to("ashton@admin.com") == ["admin@sixnineconstruction.com"]
    assert sent_to(" ASHTON@admin.com") == ["admin@sixnineconstruction.com"]


def test_other_addresses_are_untouched():
    assert sent_to("nyasha@sixnineconstruction.com") == ["nyasha@sixnineconstruction.com"]
