# PROJECT AEGIS - Enterprise Operations Platform

Project AEGIS is a comprehensive Enterprise Resource Planning (ERP) ecosystem designed specifically for Six Nine Construction (Private) Limited (SNC).

## Project Imperium (Core Platform)

At the heart of AEGIS is **Project Imperium**, the architectural base layer that underpins every subsequent module. It provides identity, RBAC, multi-tenancy, centralized notifications, audit logs, and an API Gateway.

## Architecture

- **Frontend (`aegis-web/`)**: Next.js 15 App Router, React, TypeScript, Tailwind CSS. Acts as the public corporate website and the protected Executive Command Centre.
- **Backend API (`imperium-api/`)**: Python FastAPI. Fully asynchronous, strongly typed with Pydantic v2. Handles all business logic, authorization, and database interaction.
- **Database**: Supabase (PostgreSQL) hosted instance. Enforces data integrity, multi-tenancy via `organization_id`, and security via Row Level Security (RLS).
- **Authentication**: Supabase Auth (JWT) integrated with custom backend RBAC verification.

## Repository Structure

```
project-aegis/
├── README.md                        ← Full architecture guide
├── docker-compose.yml               ← Orchestrates all services for local dev
├── .env.example                     ← Required environment variables
├── imperium-api/                    ← FastAPI Backend
│   └── (core, models, routers, schemas, services, migrations, tests)
├── aegis-web/                       ← Next.js 15 Frontend
│   └── src/ (app, components, lib, hooks, types)
└── docs/                            ← Institutional-grade documentation
```

Please see the `docs/` directory for detailed architecture, database, API, and onboarding guides.
