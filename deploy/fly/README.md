# AEGIS Backend on Fly.io

Fly.io can deploy the backend from `imperium-api/fly.toml`. The config keeps one machine running so the API does not suspend during CRM use.

## Setup

Install and sign in to `flyctl`, then run from the repository root:

```bash
cd imperium-api
fly apps create aegis-backend-api
fly secrets set \
  DATABASE_URL="postgresql+asyncpg://USER:PASSWORD@HOST:5432/postgres" \
  SUPABASE_URL="https://your-project.supabase.co" \
  SUPABASE_ANON_KEY="..." \
  SUPABASE_SERVICE_KEY="..." \
  SECRET_KEY="..." \
  JWT_SECRET_KEY="..." \
  ALLOWED_ORIGINS="https://aegis-frontend-isbu.onrender.com" \
  ALLOWED_HOSTS="aegis-backend-api.fly.dev" \
  FRONTEND_HOSTNAME="aegis-frontend-isbu.onrender.com" \
  REDIS_URL="redis://default:PASSWORD@HOST:PORT" \
  BACKGROUND_JOBS_ENABLED="false"
fly deploy
```

Use a unique Fly app name if `aegis-backend-api` is already taken, and update `app` plus `ALLOWED_HOSTS` accordingly.

## Frontend cutover

```text
INTERNAL_API_URL=https://YOUR-FLY-APP.fly.dev
NEXT_PUBLIC_API_URL=https://YOUR-FLY-APP.fly.dev
```

Redeploy the frontend after changing those variables.
