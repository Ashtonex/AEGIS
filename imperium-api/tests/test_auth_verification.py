from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import security


@dataclass
class _Creds:
    credentials: str


class _Response:
    def __init__(self, status_code: int, body: dict[str, object]):
        self.status_code = status_code
        self._body = body

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> dict[str, object]:
        return self._body


class _Client:
    def __init__(self, response: _Response):
        self.response = response

    def __enter__(self) -> "_Client":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def get(self, *args, **kwargs) -> _Response:
        return self.response


def test_verify_token_uses_supabase_auth_payload(monkeypatch):
    response = _Response(
        200,
        {
            "id": "user-123",
            "email": "ashton@admin.com",
            "app_metadata": {"org_id": "org-1", "role": "SUPERADMIN"},
            "user_metadata": {"full_name": "Ashton"},
        },
    )
    monkeypatch.setattr(security.httpx, "Client", lambda timeout: _Client(response))

    payload = security.verify_token(_Creds("real-token"))

    assert payload == {
        "sub": "user-123",
        "email": "ashton@admin.com",
        "app_metadata": {"org_id": "org-1", "role": "SUPERADMIN"},
        "user_metadata": {"full_name": "Ashton"},
        "role": "authenticated",
    }
