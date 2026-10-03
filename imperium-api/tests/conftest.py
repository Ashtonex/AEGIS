"""Test-session bootstrap.

`core.config` builds its `Settings` object at import time and five fields are
required with no default (SECRET_KEY, DATABASE_URL, SUPABASE_URL,
SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY). Importing anything under `core.` or
`routers.` therefore raised a pydantic ValidationError unless those were
already exported, so the test suite could not be collected at all in a clean
environment - which is why nothing in CI ever ran it.

These are deliberately obvious non-secrets. Tests in this suite exercise
request/permission logic against fake sessions and do not open a real
connection; anything that needs a live database should be marked and skipped
rather than pointed at a real host from here.
"""

from __future__ import annotations

import os

_TEST_ENV_DEFAULTS = {
    "SECRET_KEY": "test-secret-key-not-used-for-anything-real",
    "JWT_SECRET_KEY": "test-jwt-secret-key-not-used-for-anything-real",
    # asyncpg driver URL shape, pointed at a host that is never dialled.
    "DATABASE_URL": "postgresql+asyncpg://test:test@127.0.0.1:5432/test",
    "SUPABASE_URL": "https://test.supabase.invalid",
    "SUPABASE_ANON_KEY": "test-anon-key",
    "SUPABASE_SERVICE_KEY": "test-service-key",
    # Keep the shared cache on its in-process tier during tests instead of
    # trying (and waiting) to reach a Redis that isn't running.
    "REDIS_URL": "",
    "AUTH_CACHE_ENABLED": "false",
}

# setdefault so a developer or CI job can still override any of these.
for _key, _value in _TEST_ENV_DEFAULTS.items():
    os.environ.setdefault(_key, _value)
