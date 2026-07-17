# AEGIS Python Technology Stack Audit

Date: 2026-07-17
Scope: Project AEGIS / Project Imperium backend (`imperium-api`) for Six Nine Construction (Private) Limited.

## Executive decision

AEGIS now has a coherent Python backend foundation: FastAPI, async SQLAlchemy, Supabase/PostgreSQL, Alembic-compatible migration configuration, database-backed RBAC, raw SQL migrations, Redis/Arq workers, structlog application logging, typed quotation/BOQ services, Excel import/export, PDF rendering, PyMuPDF document extraction, direct Argon2 password hashing, and PyJWT for local JWT decoding where required.

The stack intentionally avoids duplicate technologies for the same responsibility. The only database migration authority remains raw SQL because the project relies heavily on Supabase/PostgreSQL schemas, RLS, grants, functions, and triggers.

## Evidence inspected

- Backend entrypoint: `imperium-api/main.py`.
- Active core modules: `imperium-api/core/config.py`, `imperium-api/core/database.py`, `imperium-api/core/security.py`, `imperium-api/core/compliance.py`, `imperium-api/core/analytics_ml.py`, `imperium-api/core/logging.py`.
- Active routers: `imperium-api/routers/*.py`.
- Shared operational utilities: `imperium-api/app/shared/events.py`, `imperium-api/app/shared/pagination.py`, `imperium-api/app/shared/sequences.py`, `imperium-api/app/shared/validation.py`.
- Quotation and document services: `imperium-api/app/services/quotations/*`, `imperium-api/app/services/documents/*`.
- Worker runtime: `imperium-api/app/workers/arq_worker.py`.
- Migrations: `imperium-api/migrations/*.sql`.
- Tests: `imperium-api/tests/*.py`, including `test_standardized_stack.py` and `test_quotation_stack_contract.py`.
- Runtime orchestration: root `docker-compose.yml` and `imperium-api/Dockerfile`.
- Documentation: `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`.

## Installed versus declared packages

The local `venv` is not aligned with `imperium-api/requirements.txt`.

The project virtual environment has been synced with the approved dependency file, including runtime, document, worker, security and development-assurance packages.

Decision: `imperium-api/requirements.txt` is the source of truth for builds. The local virtualenv has been synced from that file and the installed runtime has been captured in `imperium-api/requirements.lock.txt`.

## Standardized stack

| Capability | Library or approach | Current evidence |
| --- | --- | --- |
| REST API | FastAPI | `main.py`, `routers/*.py` |
| ASGI runtime | Uvicorn | Dockerfile and Compose command |
| Settings and validation | Pydantic v2, pydantic-settings | `core/config.py`, route models |
| PostgreSQL persistence | SQLAlchemy 2 async, asyncpg | `core/database.py` |
| Supabase integration | supabase-py | Auth verification and service-role client |
| Authentication | Supabase token verification plus PyJWT local decoder support | `core/security.py` |
| Password hashing | argon2-cffi | `hash_password`, `verify_password` |
| RBAC | Database permission matrix | `require_permission`, `require_resource_permission` |
| Migrations | Raw SQL migration files plus Alembic offline/SQL configuration | `imperium-api/migrations`, `imperium-api/alembic` |
| Audit logging | PostgreSQL triggers into `core.audit_log` | migrations 001, 002, 004, 009, 010 |
| Domain events | Database `core.domain_events` plus shared emitters | migration 021, shared event utilities |
| Background jobs | Redis and Arq | `app/workers/arq_worker.py`, Compose Redis/worker services |
| Structured logging | structlog with context variables and middleware | `core/logging.py`, `app/core/logging.py`, `app/middleware/logging_middleware.py` |
| Quotations | Decimal-based custom service | `app/services/quotations/calculator.py` |
| BOQ import | pandas plus openpyxl | `app/services/quotations/boq_importer.py` |
| Excel export | XlsxWriter | `app/services/documents/renderers.py` |
| PDF generation | ReportLab | `app/services/documents/renderers.py` |
| PDF extraction/merge | PyMuPDF | `app/services/documents/renderers.py` |
| Analytics | numpy, scipy, pandas | `core/analytics_ml.py`, stack tests |
| Testing | pytest, pytest-asyncio, pytest-cov | `tests/` and requirements |
| Static quality | ruff, mypy | requirements |

## Deliberate non-choices

- Alembic is configured for compatibility and verification, but raw SQL remains the authoritative migration approach for this codebase because RLS, grants, triggers, functions, schemas, and policy hardening are central to the data model.
- Celery is not adopted. Arq is the standard worker framework because the backend is async-first and Redis is sufficient for current background jobs.
- python-jose is not part of the production stack. The standardized security stack uses PyJWT directly and Argon2 directly; contract tests explicitly reject `python-jose` and Passlib in requirements.
- Passlib is not adopted. Direct `argon2-cffi` avoids an extra abstraction for the selected password hashing algorithm.
- Multiple PDF extraction libraries are not adopted. PyMuPDF is the standard extraction and merge tool; ReportLab is the standard generation tool.
- Polars is not adopted. pandas is sufficient for BOQ and reporting imports at this stage.

## Remaining gaps

1. The active backend still has two package layouts: top-level `core`/`routers` and the `app` package. Current code bridges them, but a future cleanup should consolidate layout or formalize the split.
2. Migration execution is now deterministic through `run_aegis_migrations.py`, but live migration execution still depends on the target Supabase environment and should be run deliberately per environment.
3. Some legacy generic CRUD routers remain. New business workflows should follow the typed quotation, procurement, workforce, fleet, and site-report patterns.
4. Alembic currently has no revision files; offline `upgrade head --sql` succeeds, but the real migration corpus still lives under `imperium-api/migrations`.
5. Report and document outputs are now service-backed, but production storage policy, retention, and signed-download flows still need to be finalized.

## Module development policy

For new AEGIS backend modules:

- Use FastAPI routers under `imperium-api/routers` unless the package layout is formally consolidated.
- Use Pydantic models with strict request validation for workflow endpoints.
- Use `core.database.get_db` and SQLAlchemy async execution.
- Use `require_permission("resource.action")` for business workflows.
- Emit durable domain events to `core.domain_events` in the same database transaction as authoritative state changes.
- Use Arq for asynchronous side effects: PDF rendering, Excel exports, email/webhook notifications, scheduled reporting, and external API synchronization.
- Use pandas/openpyxl for BOQ and Excel intake, XlsxWriter for workbook exports, ReportLab for generated PDFs, and PyMuPDF for PDF extraction or merge operations.
- Keep analytics dependencies limited to the declared stack until a concrete AI workflow justifies expansion.
