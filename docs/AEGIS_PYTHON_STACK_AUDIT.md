# AEGIS Python Stack Audit and Integration Report

Date: 2026-07-17

## What Was Found

- Backend runtime is `imperium-api/`, served by FastAPI from `imperium-api/main.py`.
- The intended production runtime is Python 3.11 via `imperium-api/Dockerfile`; local host interpreters are Python 3.13/3.14.
- The repository has a legacy top-level backend surface (`core/`, `routers/`, `main.py`) plus a newer `app/` package. Compatibility bridges already redirect `app.core.config` and `app.db.session` into the central top-level implementations.
- PostgreSQL uses SQLAlchemy async with `asyncpg` in `imperium-api/core/database.py`.
- Migrations are SQL files under `imperium-api/migrations/`, executed by custom runners, not Alembic.
- Redis and ARQ are present through `docker-compose.yml` and `imperium-api/app/workers/arq_worker.py`.
- Logging is centralized through structlog with context variables for correlation ID, user ID, worker job ID, and duration.
- Quotation calculator, BOQ importer, and document renderers existed under `imperium-api/app/services/`, but the top-level quotation router did not expose them as integrated API routes.

## What Changed

- Pinned `imperium-api/requirements.txt` for reproducible installs.
- Removed unused `passlib` from the selected security stack.
- Standardized security dependencies around PyJWT plus direct Argon2 via `argon2-cffi`.
- Extended `core.config.Settings` with worker, token, upload, document, report, and logging settings while preserving existing names used by current code.
- Made structured logging setup respect `LOG_LEVEL`.
- Added integrated quotation endpoints to `imperium-api/routers/quotations.py`:
  - `POST /api/v1/quotations/calculate`
  - `POST /api/v1/quotations/boq/import`
  - `POST /api/v1/quotations/exports/pdf`
  - `POST /api/v1/quotations/exports/excel`
- Kept the existing generic CRUD quotation routes intact.
- Updated the ARQ quotation document job to preserve BOQ input lines in generated PDF and Excel outputs.
- Connected ARQ retry and timeout behavior to typed settings.
- Expanded `.env.example` with worker, JWT, logging, upload, document, and report settings.
- Added `imperium-api/tests/test_quotation_stack_contract.py`.
- Generated sample outputs:
  - `imperium-api/generated/quotations/SNC-SAMPLE-001_rev1.pdf`
  - `imperium-api/generated/quotations/SNC-SAMPLE-001_rev1.xlsx`
  - `imperium-api/generated/quotations/SNC-SAMPLE-001_boq_import.json`

## Dependency Decision Matrix

| Package | Current decision | Purpose | Notes |
| --- | --- | --- | --- |
| FastAPI | Keep, pinned | REST API framework | Existing app and routers depend on it. |
| Pydantic Settings | Keep, pinned | Typed environment configuration | Centralized in `core.config`. |
| Uvicorn | Keep, pinned | ASGI server | Used by Docker and compose. |
| HTTPX | Keep, pinned | Async HTTP testing/integrations | Used by test/spoof infrastructure. |
| python-multipart | Keep, pinned | File upload parsing | Required for BOQ upload route. |
| SQLAlchemy | Keep, pinned | Async database access | Existing backend uses SQL text and async sessions. |
| asyncpg | Keep, pinned | PostgreSQL async driver | Matches SQLAlchemy async engine. |
| Supabase | Keep, pinned | Auth and service-role integrations | Existing auth flow validates Supabase users. |
| Redis | Keep, pinned | Cache/event/job backend | Used by event bus and ARQ. |
| ARQ | Keep, pinned | Async background jobs | Existing worker uses it; no Celery added. |
| pandas | Keep, pinned | BOQ import and tabular processing | Used by `BOQImporter`. |
| NumPy | Keep, pinned | Analytics calculations | Used by `core.analytics_ml`. |
| SciPy | Keep, pinned | Monte Carlo/Pert analytics | Used by `core.analytics_ml`; justified optional analytics. |
| openpyxl | Keep, pinned | Excel import | Used by pandas Excel reader. |
| XlsxWriter | Keep, pinned | Formatted Excel export | Used by quotation exporter. |
| ReportLab | Keep, pinned | Controlled PDF generation | Used by quotation PDF renderer. |
| PyMuPDF | Keep, pinned | PDF text extraction/merge | Used by document renderer services. |
| PyJWT | Keep, pinned | JWT validation | Matches current `jwt` imports and PyJWT exceptions. |
| argon2-cffi | Keep, pinned | Password hashing | Used directly in `core.security`. |
| cryptography | Keep, pinned | Crypto primitives | Required by auth/security dependencies. |
| structlog | Keep, pinned | Structured logging | Central logging implementation uses it. |
| pytest / pytest-asyncio / pytest-cov | Keep, pinned | Tests | Existing test suite uses pytest. |
| Ruff / mypy | Keep, pinned | Static quality checks | Config is still pending. |
| passlib | Removed | Duplicate password abstraction | Not imported; Argon2 is used directly. |
| python-jose | Removed | Duplicate JWT library | Current code uses PyJWT semantics. |
| scikit-learn | Removed from core stack | Future AI only | Only mentioned in comments; no runtime import. |
| pypdf/pdfplumber/python-docx | Added, pinned | Document operations | Required for approved document-security and extraction stack. |

## Deliberately Left Unchanged

- No schema changes were made; database schema remains managed by existing SQL migration files.
- No framework replacement was attempted.
- No live production credentials were added or printed.
- Existing top-level router structure remains authoritative for the running API.
- Existing frontend and broad contract test files were not rewritten.

## Verification

- Running API container Python: 3.11.15.
- Focused backend tests:
  - Command: `docker compose exec -T imperium-api python -m pytest tests/test_standardized_stack.py tests/test_quotation_stack_contract.py -q`
  - Result: `9 passed, 1 skipped`.
- App import:
  - Command: `docker compose exec -T imperium-api python -c "from main import app; print(app.title); print(len(app.routes))"`
  - Result: `Project Imperium API`, `276`.
- Sample quotation calculation grand total: `5267.00`.
- Sample PDF, Excel workbook, and BOQ import JSON were generated successfully.

## Known Blockers and Risks

- Full `pytest tests` inside the running API container fails during collection because compose mounts only `imperium-api` at `/app`; many existing contract tests read sibling frontend files from `../aegis-web`, which resolves to `/aegis-web` inside the container.
- The first full `pip install -r requirements.txt` exceeded the command timeout. Installing the heavier runtime packages in smaller groups succeeded.
- Alembic is not present; migrations are custom SQL runners. This is acceptable for the current repo but should be documented as the migration standard or replaced deliberately later.
- Database and Redis health checks requiring live infrastructure were not executed against production data.
- Ruff and mypy were pinned but not fully configured or run across the dirty worktree.

## Recommended Next Phase

- Add a backend test compose profile that mounts the repository root so frontend contract tests can run in the same Python 3.11 container.
- Add explicit health endpoints for database, Redis, and worker readiness.
- Add repository-level CI commands for install, lint, type check, migration dry-run, and focused service tests.
- Convert migration execution into a single documented command with transactional failure behavior.
- Add authorization tests around quotation margin and price modification permissions.
