# AEGIS Backend on AWS Lightsail

Use a Lightsail Ubuntu instance for this backend. That keeps the deployment model close to the DigitalOcean VPS setup: Docker, Redis, Caddy, and a normal Git pull update flow.

Lightsail also has a container service, but the instance path is simpler for this app because AEGIS uses Redis and benefits from normal Docker Compose networking.

## Instance size

Use at least 2 GB RAM. For CRM rollout plus document generation, 4 GB RAM is safer.

## Setup

1. Create an Ubuntu 24.04 Lightsail instance.
2. Attach a static IP.
3. Point your backend DNS record to that static IP.
4. SSH into the instance and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Ashtonex/AEGIS/main/deploy/lightsail/bootstrap-ubuntu.sh | bash
```

5. Deploy:

```bash
mkdir -p /opt/aegis
cd /opt/aegis
git clone https://github.com/Ashtonex/AEGIS.git .
cp deploy/lightsail/.env.example deploy/lightsail/.env
nano deploy/lightsail/.env
docker compose -f deploy/lightsail/docker-compose.yml --env-file deploy/lightsail/.env up -d --build
```

## Verify

```bash
curl https://api.example.com/health
docker compose -f deploy/lightsail/docker-compose.yml --env-file deploy/lightsail/.env ps
docker compose -f deploy/lightsail/docker-compose.yml --env-file deploy/lightsail/.env logs -f imperium-api
```

## Frontend cutover

```text
INTERNAL_API_URL=https://api.example.com
NEXT_PUBLIC_API_URL=https://api.example.com
```

Redeploy the frontend after changing those variables.
