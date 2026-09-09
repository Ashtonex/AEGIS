"""Create an isolated localhost-only PostgreSQL database for Workforce integration tests.

Uses the repository's real base tables and HR migrations; no production DSN is read.
The selected prerequisite DDL is a fixture, not proof of full production-ledger upgrade.
"""

import asyncio
from pathlib import Path
import re
import time

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
BASE = "postgresql://workforce_test_admin@127.0.0.1:55439/"


def create_table(filename: str, table: str) -> str:
    source = (ROOT / "migrations" / filename).read_text()
    pattern = r"CREATE TABLE (?:IF NOT EXISTS )?" + re.escape(table) + r"\s*\("
    found = re.search(pattern, source)
    if not found:
        raise RuntimeError(f"Missing prerequisite {table}")
    return source[found.start() : source.index(";", found.end()) + 1]


async def main():
    admin = await asyncpg.connect(BASE + "postgres")
    name = f"aegis_workforce_test_{int(time.time())}"
    try:
        for role in (
            "anon",
            "authenticated",
            "service_role",
            "aegis_workforce_runtime",
        ):
            if not await admin.fetchval(
                "SELECT 1 FROM pg_roles WHERE rolname=$1", role
            ):
                await admin.execute(
                    f"CREATE ROLE {role} NOLOGIN NOSUPERUSER NOBYPASSRLS"
                )
        await admin.execute(f"CREATE DATABASE {name}")
    finally:
        await admin.close()
    db = await asyncpg.connect(BASE + name)
    try:
        await db.execute(
            "CREATE SCHEMA core; CREATE SCHEMA hr; CREATE SCHEMA finance; CREATE SCHEMA projects; CREATE SCHEMA compliance;"
        )
        # Extract exact table declarations from historical migrations, retaining
        # their constraints. Schema placement follows migration 002.
        for source, target in [
            ("organizations", "core.organizations"),
            ("users", "core.users"),
            ("roles", "core.roles"),
            ("permissions", "core.permissions"),
            ("role_permissions", "core.role_permissions"),
            ("user_roles", "core.user_roles"),
            ("audit_log", "core.audit_log"),
            ("file_attachments", "core.file_attachments"),
            ("documents", "core.documents"),
            ("projects", "projects.projects"),
            ("workforce", "hr.employees"),
        ]:
            sql = create_table("001_imperium_foundation.sql", source)
            sql = re.sub(
                r"CREATE TABLE " + source + r"\b", "CREATE TABLE " + target, sql
            )
            for old, new in {
                "organizations": "core.organizations",
                "users": "core.users",
                "roles": "core.roles",
                "permissions": "core.permissions",
                "projects": "projects.projects",
                "file_attachments": "core.file_attachments",
            }.items():
                sql = re.sub(r"REFERENCES " + old + r"\b", "REFERENCES " + new, sql)
            await db.execute(sql)
        source = (ROOT / "migrations/002_imperium_schemas.sql").read_text()
        start = source.index("CREATE OR REPLACE FUNCTION core.process_audit_log()")
        end = source.index("$$ LANGUAGE plpgsql SECURITY DEFINER;", start) + len(
            "$$ LANGUAGE plpgsql SECURITY DEFINER;"
        )
        await db.execute(source[start:end])
        await db.execute(
            (ROOT / "migrations/069_fix_user_roles_audit_trigger.sql").read_text()
        )
        await db.execute(
            (ROOT / "migrations/016_workforce_delivery_controls.sql").read_text()
        )
        for table in [
            "core.domain_events",
            "core.approval_instances",
            "core.approval_steps",
            "projects.sites",
        ]:
            await db.execute(
                create_table("021_daily_site_report_vertical_slice.sql", table)
            )
        await db.execute(
            create_table("077_finance_departments.sql", "finance.departments")
        )
        for table in ["hr.attendance_records", "hr.leave_requests"]:
            await db.execute(create_table("023_finance_and_hr_domain.sql", table))
        for table in [
            "hr.employee_documents",
            "hr.employee_medicals",
            "hr.employee_asset_assignments",
            "hr.training_requirements",
            "hr.training_records",
            "hr.reporting_lines",
        ]:
            await db.execute(
                create_table("162_hr_operating_layer_self_service_leave.sql", table)
            )
        # Minimal Storage metadata contract for ownership checks. This exercises
        # the SQL policy boundary, not the external Supabase Storage service.
        await db.execute(
            "CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text NOT NULL,name text NOT NULL,owner_id text,updated_at timestamptz NOT NULL DEFAULT now(),metadata jsonb NOT NULL DEFAULT '{}'::jsonb,UNIQUE(bucket_id,name)); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE POLICY \"Authenticated users can update their document uploads\" ON storage.objects FOR UPDATE TO authenticated USING(bucket_id='documents') WITH CHECK(bucket_id='documents');"
        )
        async with db.transaction():
            await db.execute(
                (ROOT / "migrations/176_workforce_foundation_controls.sql").read_text()
            )
        path = ROOT / ".aegis-runtime/workforce-test/database-name.txt"
        path.write_text(name)
        print(f"Isolated database created: {name}; migration 176 applied successfully.")
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
