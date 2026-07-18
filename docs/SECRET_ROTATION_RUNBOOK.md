# Secret Rotation Runbook

Date: 2026-07-17

## Scope

Project: `AEGIS_SNC`
Supabase ref: `mzwwkwokpakdweyyscef`

The previously committed scratch database connection string must be treated as exposed. Rotate the Supabase database password before the next production deploy, then update deployment secrets and local operator `.env` files.

## Rotation Order

1. Put the site/API in a maintenance window if active traffic cannot tolerate a short database reconnect.
2. Generate a new 32+ character database password in the approved password manager.
3. Rotate the Supabase database password.
4. Update `DATABASE_URL` in Render and any other deployment secret store.
5. Update local `.env` files used by operators.
6. Redeploy the backend and worker.
7. Confirm `/health` and one authenticated database-backed endpoint.
8. Remove the old password from password managers, shell history, tickets, and incident notes.

## Supabase Rotation

Dashboard path:

1. Open Supabase project `AEGIS_SNC`.
2. Go to `Database > Settings`.
3. Reset the database password.
4. Build the replacement async SQLAlchemy URL:

```text
postgresql+asyncpg://postgres.mzwwkwokpakdweyyscef:<NEW_PASSWORD>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres
```

Management API path:

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<supabase-management-token>"
$env:NEW_DB_PASSWORD = "<32-plus-character-password-from-password-manager>"
$env:SUPABASE_PROJECT_REF = "mzwwkwokpakdweyyscef"
python scripts\rotate_supabase_db_password.py
```

The helper does not print or persist the new password.

## Supabase API/JWT Keys

If the exposed `.env` also contained `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, or JWT signing material, rotate those too. For legacy anon/service/JWT secrets, Supabase recommends migrating to new API keys/asymmetric signing. If already on JWT signing keys, rotate the current key and revoke the previously used key after the deployment is healthy.

## Deployment Secret Updates

Render backend must have these runtime-managed values:

```text
DATABASE_URL
SECRET_KEY
JWT_SECRET_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY
REDIS_URL
ALLOWED_ORIGINS
ALLOWED_HOSTS
```

Production values must satisfy the backend guardrails:

```text
ENVIRONMENT=production
DEBUG=false
ALLOWED_ORIGINS=https://<frontend-domain>
ALLOWED_HOSTS=<api-domain>
REDIS_URL=rediss://...
```

## Verification

Run from the repository root:

```powershell
venv\Scripts\detect-secrets.exe scan .env.example README.md docs imperium-api aegis-web\src aegis-web\package.json aegis-web\package-lock.json --exclude-files '(package-lock\.json|requirements\.lock\.txt|tsconfig\.tsbuildinfo|tmp[\\/]|output[\\/]|generated[\\/]|__pycache__[\\/])'
```

Run from `imperium-api`:

```powershell
..\venv\Scripts\python.exe -m pytest tests\test_production_hardening_contract.py tests\test_standardized_stack.py tests\test_quotation_stack_contract.py -q
```

## References

- Supabase database password reset: https://supabase.com/docs/guides/troubleshooting/how-do-i-reset-my-supabase-database-password-oTs5sB
- Supabase anon, service, and JWT rotation: https://supabase.com/docs/guides/troubleshooting/rotating-anon-service-and-jwt-secrets-1Jq6yd
- Supabase Management API database password endpoint: https://supabase.com/docs/reference/api/introduction
