# AEGIS Security Operations

Date: 2026-07-17

## Routine Commands

Run from `imperium-api` unless noted:

```powershell
..\venv\Scripts\python.exe scripts\verify_dependency_imports.py
..\venv\Scripts\python.exe -m pytest tests -q
..\venv\Scripts\python.exe -m ruff check .
..\venv\Scripts\python.exe -m mypy .
..\venv\Scripts\python.exe -m pip_audit -r requirements.txt
..\venv\Scripts\python.exe -m bandit -r . -x .\tests,.\tmp,.\output -s B608,B110 -q
..\venv\Scripts\python.exe migrations\run_aegis_migrations.py --plan
```

Run the secret scan from the repository root:

```powershell
venv\Scripts\detect-secrets.exe scan .env.example README.md docs imperium-api aegis-web\src aegis-web\package.json aegis-web\package-lock.json --exclude-files '(package-lock\.json|requirements\.lock\.txt|tsconfig\.tsbuildinfo|tmp/|output/|__pycache__/)'
```

Bandit exclusions are intentionally narrow:

- `B608`: existing generated CRUD routers build SQL from allowlisted table and column names while still binding values. These call sites must be retired behind repository helpers, but they are not introduced by the dependency integration.
- `B110`: legacy silent cleanup/logging fallbacks are tracked as low-priority hardening debt.

## User Deactivation

Disable the user in the identity provider, remove active role assignments and project memberships, revoke refresh tokens where available, and preserve audit records. Do not delete user records that are referenced by business events.

## Password Reset

Use the configured identity-provider reset flow. Reset responses must not reveal whether an email address exists. Reset tokens must be single-use and time limited.

## Token Key Rotation

Introduce the new signing or verification key, configure the grace period, deploy backend verification settings, monitor failed token validation rates, then retire the old key after the grace window.

## Secret Rotation

Rotate exposed Supabase, database, Redis, JWT, webhook and storage credentials immediately. Update deployment secrets first, then local `.env` files. Never commit rotated values.

## Incident Logging

Record actor, timestamp, source channel, affected resource, suspected action, containment decision, evidence references and follow-up owner. Do not paste passwords, tokens or private keys into incident notes.

## Audit Review

Review failed login patterns, privileged actions, permission-denied events, compliance overrides, payment-evidence gates and document access activity. Escalate unexplained privileged changes.

## Vulnerability Response

Run `pip-audit` before release and after dependency changes. Patch direct dependencies first, then transitive dependencies. Document accepted findings with a business owner, expiry date and mitigation.

## Emergency Administrator Access

Emergency access must be time boxed, approved by business leadership, logged with a reason, and removed after the incident. System administration does not imply financial approval authority.

## Production Checklist

Production must use non-debug mode, explicit CORS origins, HTTPS, restricted database credentials, private Redis, rotated secrets, current migrations, passing tests, passing scans or documented exceptions, and reviewed deployment logs.
