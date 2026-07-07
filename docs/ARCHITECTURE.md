# ARCHITECTURE

## System Overview

PROJECT IMPERIUM serves as the central foundation for the AEGIS ecosystem. It is designed as a Modular Monolith with clean boundaries, ensuring future microservice extraction is possible.

### ASCII Architecture Diagram

```
[ Browser / Next.js (aegis-web) ]
       |
       | (REST / JSON over HTTPS)
       v
[ API Gateway & Middleware (FastAPI) ]
       |
       +--> Authentication / JWT Validation
       +--> Rate Limiting & Tenant Resolution
       |
       v
[ Routers / Controllers (routers/) ]
       |
       v
[ Services / Business Logic (services/) ]
       |
       v
[ Repositories / Data Access (models/schemas) ]
       |
       | (asyncpg + SQLAlchemy)
       v
[ Database (Supabase PostgreSQL) ]
       |
       +--> Row Level Security (RLS)
       +--> Realtime & Storage
```

## Technology Decisions

1. **Next.js 14 (App Router) + React Server Components**: Chosen for SEO optimization, fast initial loads, and secure data fetching that hides API keys from the browser.
2. **Python FastAPI (Async)**: Selected for its Pydantic v2 validation speed, high-performance async capabilities, and auto-generated Swagger documentation.
3. **Supabase (PostgreSQL)**: Provides a robust hosted relational database with built-in JWT authentication, Row Level Security (enforcing multi-tenancy at the DB level), and native storage solutions.

## How to Add a New AEGIS Module

Adding a new module (e.g., `inventory`) requires following the strict boundaries of the architecture:
1. **Schema Definition**: Create a stub table in a SQL migration, ensuring `id`, `organization_id`, `created_by`, `created_at`, `updated_at`, and `is_deleted` exist.
2. **SQLAlchemy Model**: Create `models/inventory.py`.
3. **Pydantic Schema**: Create `schemas/inventory.py` for request validation.
4. **Router**: Create `routers/inventory.py` encapsulating standard CRUD operations wrapped in the `{ success, data, message, meta }` envelope.
5. **Registration**: Register the router in `main.py` under the `/api/v1/` prefix.
6. **Frontend Integration**: Create `src/app/(dashboard)/inventory/page.tsx` and integrate fetching via the API client wrapper.
