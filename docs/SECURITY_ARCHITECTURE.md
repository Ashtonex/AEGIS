# AEGIS Security Architecture

Date: 2026-07-17

## Security Boundaries

AEGIS uses a FastAPI backend, Next.js frontend, Supabase PostgreSQL, Redis and Arq. The backend is the enforcement boundary for authentication, permissions, workflow decisions, document access, financial controls and audit events. Frontend hiding of controls is not treated as security.

## Authentication

Authentication uses Supabase token verification for platform users, with PyJWT available for local token decoding and validation where AEGIS issues or verifies application tokens. Password hashing utilities use `argon2-cffi` for Argon2id-compatible hashes. Token settings are typed through `core.config.Settings`, including issuer, audience and expiry configuration.

## Authorisation

Protected routers use central dependencies from `core.security`, including resource permission enforcement. New privileged workflows must use explicit permissions such as `compliance.gate.override` and must avoid route-local role string checks. Deny-by-default remains the operating rule for protected resources.

## Separation Of Duties

Sensitive workflows are modelled as separate create, submit, approve, override and payment-evidence actions. Procurement, compliance and payment gates store evidence and actor metadata in database records and emit durable domain events where implemented.

## Database Protections

PostgreSQL remains the authoritative record. The project uses async SQLAlchemy/asyncpg for application access and raw SQL migrations for schemas, RLS policies, triggers, functions and grants. The deterministic migration runner records applied SQL files in `core.aegis_migration_log`.

## File And Document Protections

Document generation is centralised in document services. Approved document and upload libraries include ReportLab, PyMuPDF, pypdf, pdfplumber, python-docx, Pillow, defusedxml, bleach and puremagic. New upload flows must validate extension, size, signature, MIME, storage name and authorisation before persistence or download.

## Logging And Audit

Application logging is configured through `structlog` with correlation, user, worker job and duration context. Business audit logs remain separate from application logs and are persisted through database tables/triggers and domain events.

## Background Jobs

Arq workers use Redis settings from typed configuration. Jobs must validate payloads, use idempotency keys, set bounded retries/timeouts and recheck current record state for high-risk side effects.

## Secrets

Real secrets must stay out of version control. `.env.example` contains placeholders only. `detect-secrets` is the required local scanner, and any discovered credential must be rotated because removing it from a file does not remove it from Git history.

## Known Limitations

Full production verification still depends on live Supabase, Redis and deployment credentials. The codebase still has both top-level `core`/`routers` and package-level `app` layouts; future cleanup should consolidate that split without changing runtime behaviour.
