# AEGIS Mobile & Offline System Architecture

```
+------------------------------------------------------------------------+
|                          AEGIS Client Surface                          |
|   - Mobile Bottom Dock (Thumb Zone) / Desktop Mini-Rail               |
|   - Adaptive Card/Table Views                                          |
|   - 48px Field Controls with Specialized Input Modes                   |
+------------------------------------------------------------------------+
                                    |
                                    v
+------------------------------------------------------------------------+
|                        Client Persistence Layer                        |
|   IndexedDB Database (`aegis_offline_store_v1`):                       |
|     - `references` (Cached project list, cost codes, items)           |
|     - `drafts` (Autosaved forms, keyed by user + project + entity)     |
|     - `outbox` (Immutable queued operations with UUID operation_id)    |
|     - `attachments` (Binary blobs / photos queued for upload)          |
+------------------------------------------------------------------------+
                                    |
                       [Sync Manager / Network State]
                                    |
                                    v
+------------------------------------------------------------------------+
|                        Backend Sync & API Gateway                      |
|   FastAPI (`imperium-api`)                                             |
|     - Operation Idempotency Cache / Table                              |
|     - Atomic DB Transaction Boundary                                   |
|     - Domain Services (Site Ops, Daily Reports, Stock, Fleet)          |
+------------------------------------------------------------------------+
                                    |
                                    v
+------------------------------------------------------------------------+
|                    Authoritative System of Record                      |
|   Supabase PostgreSQL (RLS, Multi-tenant, Auditing)                    |
+------------------------------------------------------------------------+
```
