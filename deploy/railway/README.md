# AEGIS Backend on Railway

Railway can deploy the backend directly from `imperium-api` because the service already has a `Dockerfile`. The included `imperium-api/railway.toml` pins Dockerfile builds and sets the health check to `/health`.

## Setup

1. Create a new Railway project from GitHub.
2. Select this repository.
3. Set the service root directory to:

```text
imperium-api
```

4. Add the environment variables from `deploy/railway/.env.example`.
5. Deploy the service.

## Required variables

Use production values for:

```text
DATABASE_URL
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY
SECRET_KEY
JWT_SECRET_KEY
ALLOWED_ORIGINS
ALLOWED_HOSTS
FRONTEND_HOSTNAME
```

If you do not attach Railway Redis, keep:

```text
BACKGROUND_JOBS_ENABLED=false
```

## Frontend cutover

After Railway deploys, set the frontend backend URLs to the Railway public URL:

```text
INTERNAL_API_URL=https://YOUR-RAILWAY-BACKEND.up.railway.app
NEXT_PUBLIC_API_URL=https://YOUR-RAILWAY-BACKEND.up.railway.app
```

Then redeploy the frontend.
