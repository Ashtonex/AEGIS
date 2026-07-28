# AEGIS Backend on DigitalOcean VPS

This runs the FastAPI backend on an Ubuntu droplet with Docker, Redis, and Caddy HTTPS.

## 1. Create the droplet

Use Ubuntu 24.04 LTS, at least 2 GB RAM for launch testing. Choose a region near users or near Supabase. Add your SSH key.

## 2. Point DNS

Create an `A` record for the backend hostname, for example:

```text
api.example.com -> DROPLET_PUBLIC_IP
```

Caddy will issue HTTPS automatically after DNS resolves.

If you do not have a domain ready today, use a temporary hostname in this format:

```text
api.DROPLET_PUBLIC_IP.sslip.io
```

For example, if the droplet IP is `203.0.113.10`, use `api.203.0.113.10.sslip.io` as `API_HOSTNAME` and `ALLOWED_HOSTS`.

## 3. Bootstrap the server

SSH into the droplet as root and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Ashtonex/AEGIS/main/deploy/digitalocean/bootstrap-ubuntu.sh | bash
```

## 4. Deploy the backend

```bash
mkdir -p /opt/aegis
cd /opt/aegis
git clone https://github.com/Ashtonex/AEGIS.git .
cp deploy/digitalocean/.env.example deploy/digitalocean/.env
nano deploy/digitalocean/.env
docker compose -f deploy/digitalocean/docker-compose.yml --env-file deploy/digitalocean/.env up -d --build
```

Use the real Supabase/database values in `.env`. Do not commit `.env`.

## 5. Verify

```bash
curl https://api.example.com/health
docker compose -f deploy/digitalocean/docker-compose.yml --env-file deploy/digitalocean/.env ps
docker compose -f deploy/digitalocean/docker-compose.yml --env-file deploy/digitalocean/.env logs -f imperium-api
```

## 6. Point the frontend at the VPS

Set the frontend environment variables to the backend URL:

```text
INTERNAL_API_URL=https://api.example.com
NEXT_PUBLIC_API_URL=https://api.example.com
```

Redeploy the frontend after changing these values.

## Updates

```bash
cd /opt/aegis
git pull
docker compose -f deploy/digitalocean/docker-compose.yml --env-file deploy/digitalocean/.env up -d --build
```
