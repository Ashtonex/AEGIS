"""Provision the restricted Workforce role; no credentials or personnel are created.

Requires an explicit --database-url-env naming a privileged DSN. Never defaults
to the application's production .env. Run before migration 176.
"""

import argparse
import asyncio
import os

import asyncpg


async def provision(url: str) -> None:
    db = await asyncpg.connect(url.replace("postgresql+asyncpg://", "postgresql://"))
    try:
        async with db.transaction():
            await db.execute("""DO $$ BEGIN
                IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aegis_workforce_runtime') THEN
                    CREATE ROLE aegis_workforce_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
                END IF;
                IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aegis_workforce_runtime' AND (rolsuper OR rolbypassrls)) THEN
                    RAISE EXCEPTION 'Existing role is privileged; refusing to reuse it';
                END IF;
                EXECUTE format('GRANT aegis_workforce_runtime TO %I',session_user);
            END $$""")
        print(
            "Restricted Workforce role provisioned for the specified database principal."
        )
    finally:
        await db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url-env", required=True)
    args = parser.parse_args()
    asyncio.run(provision(os.environ[args.database_url_env]))
