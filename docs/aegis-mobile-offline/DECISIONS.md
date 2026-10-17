# AEGIS Architectural Decision Records (ADRs)

## ADR-001: Local Persistence Technology Selection
- **Status**: ACCEPTED
- **Context**: Mobile field operations require local caching of reference data, autosaved drafts, immutable queued submissions, and photo attachments. `localStorage` is synchronous, limited to ~5MB, cannot store binary Blobs, and blocks UI thread.
- **Decision**: Use standard browser `IndexedDB` with a lightweight, zero-dependency async wrapper partitioned by `tenant_id:user_id:project_id`.
- **Consequences**: Fast asynchronous operations, 100MB+ storage capacity for photo attachments, zero main thread jank.

## ADR-002: Idempotent Submission Protocol
- **Status**: ACCEPTED
- **Context**: Cellular connections on construction sites drop frequently mid-request, leading to retried submissions that could create duplicate daily reports or double-count inventory movements.
- **Decision**: Every mutation queued offline or submitted from mobile assigns a client-generated UUID `operation_id`. The backend checks idempotency before executing within an atomic transaction. Retries return the committed result.
- **Consequences**: Safe at-least-once delivery; zero duplicate records.

## ADR-003: Push Notifications / VAPID Key Resiliency
- **Status**: ACCEPTED
- **Context**: Push notification setup was failing with "Push notifications are not configured on this deployment" when environment variables were empty or when `pywebpush` was missing from the runtime.
- **Decision**: Ensure default fallback subject in `core/config.py`, default fallback in `docker-compose.yml`, resilient VAPID key loading with `cryptography`, and proper status handling in `PwaPushButton.tsx`.
