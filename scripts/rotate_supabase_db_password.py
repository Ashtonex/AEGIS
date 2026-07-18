#!/usr/bin/env python
"""Rotate the Supabase Postgres password via the Management API.

Required environment:
  SUPABASE_ACCESS_TOKEN - Supabase Management API PAT or OAuth token.
  NEW_DB_PASSWORD       - Already-generated replacement database password.

Optional environment:
  SUPABASE_PROJECT_REF  - Defaults to the AEGIS_SNC project ref.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


PROJECT_REF = os.getenv("SUPABASE_PROJECT_REF", "mzwwkwokpakdweyyscef")
API_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/password"


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def main() -> int:
    token = require_env("SUPABASE_ACCESS_TOKEN")
    new_password = require_env("NEW_DB_PASSWORD")

    if len(new_password) < 32:
        raise SystemExit("NEW_DB_PASSWORD must be at least 32 characters.")

    payload = json.dumps({"password": new_password}).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=payload,
        method="PATCH",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status != 200:
                raise SystemExit(f"Supabase returned unexpected status {response.status}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Supabase password rotation failed: HTTP {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"Supabase password rotation failed: {exc.reason}")

    print(
        "Supabase database password rotated for project "
        f"{PROJECT_REF}. Update DATABASE_URL everywhere before redeploying."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
