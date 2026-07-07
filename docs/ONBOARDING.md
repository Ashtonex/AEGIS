# ONBOARDING

## Local Development Setup

### 1. Prerequisites
- Docker & Docker Compose
- Node.js (v18 or higher) for Next.js 14
- Python 3.11+
- Supabase CLI (Optional, for local DB development)

### 2. Environment Variables
Copy the `.env.example` file to `.env` in the root folder. You will need your Supabase project keys to continue.

### 3. Database Migrations
Since we rely heavily on Supabase RLS and Triggers, migrations are handled via SQL.
1. Connect to your Supabase instance via SQL Editor or psql.
2. Execute the contents of `imperium-api/migrations/001_imperium_foundation.sql`.

### 4. Running the Stack locally
Run the entire stack via Docker Compose:
```bash
docker-compose up --build
```

- **Backend (FastAPI)**: Running on `http://localhost:8000`. Swagger docs at `http://localhost:8000/docs`.
- **Frontend (Next.js)**: Running on `http://localhost:3000`. 
