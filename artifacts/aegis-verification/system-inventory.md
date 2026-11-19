# AEGIS system inventory (verification run 2026-11-19)

Revision: `972ab608addd7222d936a5eb160eac72762d8c3d` on branch `feat/ui-dialog`, with uncommitted user
changes (listed in final-report.md §2). Discovered from the repository; nothing here is assumed from
older `AEGIS_*` / `assurance/` documents, which are treated as claims, not evidence.

## Components

| Component | Path | Stack | Entry points | Notes |
|---|---|---|---|---|
| Backend API ("Imperium") | `imperium-api/` | Python 3.14 (local venv) / 3.13 (CI), FastAPI 0.139, SQLAlchemy async + asyncpg, Pydantic v2 | `main.py:create_app()` → `app`; uvicorn (Dockerfile) | 94 router modules, **1,182 HTTP+WS operations** mounted (enumerated in `evidence/routes.json`) |
| Background worker / jobs | `imperium-api/app/workers`, `app/services/jobs` | asyncio | worker process (deploy compose) | Reviewed only (not executed) |
| Domain/services | `imperium-api/app/services/**` (155 `.py` under `app/`), `core/` (16), `schemas/` (4) | | | Exercised indirectly by unit/contract tests |
| Migrations | `imperium-api/migrations/` (308 entries, raw SQL + runner), `supabase/migrations/` (146) | PostgreSQL 17 (Supabase) | `migrations/run_aegis_migrations.py` | **Not executed** (no isolated DB this run, see coverage-gaps) |
| Frontend | `aegis-web/` | Next.js 16, React 19, TypeScript | `npm run build/dev`; 28 top-level app routes | Unit tests + typecheck only |
| CI | `.github/workflows/*.yml` | GitHub Actions | backend-tests, frontend-ci, deploy-backend, sql-health-check, … | Read only; nothing triggered |
| Deploy | `deploy/digitalocean/`, `imperium-api/Dockerfile` | Docker + Caddy on a droplet | | Reviewed only |

## External destinations found in configuration (values redacted)

`imperium-api/.env` (gitignored) holds **production** settings: `DATABASE_URL` (the single Supabase
production database — there is no dev database), `SUPABASE_*` keys, `REDIS_URL`, `JWT_SECRET_KEY`,
Microsoft Graph client secret, OpenAI key, Twilio credentials. **None of these were used.** All execution
happened in a sandbox copy without any `.env`, with dummy settings, dead loopback ports for DB/Redis/
Supabase/proxy, and a socket-level guard (`harness/netguard.py`) refusing every non-loopback
connection/DNS lookup. The guard logged **zero** blocked attempts across all runs.

Other external services referenced in code: Supabase Auth (JWKS + `/auth/v1/user`), Resend (email),
Twilio + Meta WhatsApp (webhooks in, API out), Microsoft Graph (Teams/SharePoint), OpenAI/Perplexity,
the Zimbabwe e-GP portal (tender scraper). All were BLOCKED_EXTERNAL_DEPENDENCY for live testing; their
adapters are covered only by mocked unit tests.

## Module accounting

| Group | Status | Evidence |
|---|---|---|
| `core/security.py` (auth, RBAC) | Tested directly (existing `test_auth_verification.py`, `test_rbac_*`) + HTTP boundary sweep (this run) + reviewed | baseline, auth sweep |
| `core/rate_limit.py`, `routers/auth.py`, `routers/public_intake.py` | Tested directly (new `test_public_rate_limit_keying.py`) | F-02 |
| `routers/crm_communications.py` webhooks | Tested directly (new `test_whatsapp_webhook_signature.py`, existing `test_twilio_whatsapp.py`) | F-01 |
| All 94 routers | Auth boundary exercised over HTTP for every authenticated operation (no token / junk token / alg=none); business logic exercised indirectly by existing contract tests | auth sweep, baseline |
| `app/services/**`, `core/*` other | Exercised indirectly by the 1,726-test baseline (mocked DB) | baseline |
| Postgres-dependent tests (`test_compliance_foundation_postgres.py`, `test_workforce_foundation_postgres.py`) | Blocked: need opt-in isolated Postgres | 30 skips |
| SQL text in routers (raw `text()` queries) | Reviewed only; not executed against a schema this run | coverage-gaps |
| Migrations | Reviewed only (existing ledger/governance contract tests passed) | baseline |
| `aegis-web/src/**` | 3 unit-test files executed; typecheck run; no build, no browser tests | baseline-results |
| `imperium-api/scripts/**`, `qa_*_suite.py` | Excluded: operational scripts, several commit to the configured DB; not safe to run without an isolated DB | — |
| `.venv`, `node_modules`, `.aegis-runtime`, `generated/` | Excluded: vendored / generated | — |
