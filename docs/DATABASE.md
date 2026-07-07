# DATABASE STANDARDS

## Schema Overview

The database is built on Supabase PostgreSQL. It heavily utilizes PostgreSQL's advanced features, including Triggers and Row Level Security (RLS).

### Core Table Relationships (ASCII)

```
[organizations] 1 ----- * [users]
      |                      |
      |                      +-- * [user_roles] * -- [roles]
      |                                                |
      |                                                +-- * [role_permissions] * -- [permissions]
      |
      +-- 1 [system_modules]
      +-- * [audit_log] (Linked to specific module tables)
      +-- * [notifications]
      +-- * [MODULE STUBS (e.g., projects, fleet, hr_records)]
```

## Row Level Security (RLS)

Every table MUST have RLS enabled. This guarantees tenant isolation (`organization_id`).

**Standard RLS Policy Pattern:**
```sql
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant Isolation Policy" ON my_table
FOR ALL
USING (organization_id = (select auth.jwt()->>'org_id')::uuid);
```
*Note: Service role interactions (from the FastAPI backend using `SUPABASE_SERVICE_KEY`) bypass RLS naturally.*

## Migrations Guide

We use raw SQL migrations applied via the Supabase CLI (or Alembic for complex SQLAlchemy schema tracking) to ensure that RLS policies, PostgreSQL functions, and triggers are tracked.

**To create a migration:**
1. Generate the file: `imperium-api/migrations/00X_migration_name.sql`.
2. Write raw SQL (Table creation, RLS policies, audit triggers).
3. Apply via CI/CD or local CLI to the Supabase instance.
