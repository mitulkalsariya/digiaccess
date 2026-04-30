# Docker Compose deploy

The simplest production path. Everything runs in containers via
`docker-compose.prod.yml` at the repo root.

## What you get

| Container | Image | Purpose |
|---|---|---|
| `caddy` | `caddy:2-alpine` | TLS termination + reverse proxy + auto Let's Encrypt |
| `api` | built from `Dockerfile --target api` (distroless) | Fastify API on :3001 |
| `dashboard` | built from `Dockerfile --target dashboard` | Next.js on :3000 |
| `worker` | built from `Dockerfile --target worker` (Playwright base) | scan worker |
| `migrator` | built from `Dockerfile --target migrator` | runs once on `up` to apply migrations |
| `postgres` | `postgres:16-alpine` | DB; data in named volume `pgdata` |
| `redis` | `redis:7-alpine` | queue+session; data in `redisdata` |

## Prereqs on the box

- A Linux VM with public ports 80 + 443 reachable
- A DNS A record pointing at the VM (Caddy needs it for the ACME HTTP-01
  challenge — the same constraint as certbot)

## First deploy

```bash
ssh ubuntu@platform.digisaral.com

# 1. Install Docker (one-time per VM)
curl -fsSL https://raw.githubusercontent.com/mitulkalsariya/digiaccess/main/infra/docker/install-docker.sh \
  | sudo bash

# Re-login so the docker group takes effect:
exit
ssh ubuntu@platform.digisaral.com

# 2. Pull the repo
git clone https://github.com/mitulkalsariya/digiaccess.git ~/a11y
cd ~/a11y

# 3. Generate .env with random per-host secrets
./infra/docker/init-env.sh platform.digisaral.com mitul@digisaral.com

# 4. Build images and start everything
docker compose -f docker-compose.prod.yml up -d --build
```

Step 4 takes 5–10 minutes the first time (Chromium download for the worker is
~200 MB; Next.js + Prisma compilation; image layers from scratch).

## Verify

```bash
docker compose -f docker-compose.prod.yml ps
# All 6 services should be 'Up' and healthy except `migrator` which is 'Exited (0)'.

curl -fsS https://platform.digisaral.com/health
# {"status":"ok","version":"0.1.0",...}

curl -fsS https://platform.digisaral.com/health/ready
# {"status":"ready","checks":{"db":true,"redis":true},...}
```

Open `https://platform.digisaral.com/` in a browser — dashboard.

## Updates

```bash
cd ~/a11y
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

The migrator container re-runs `prisma migrate deploy` (idempotent — only new
migrations are applied). API + dashboard + worker reload with the new image.

## Rollback

```bash
cd ~/a11y
git checkout <previous-sha>
docker compose -f docker-compose.prod.yml up -d --build
```

If a migration is incompatible, run the matching `down.sql` first:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U a11y -d a11y -f /repo/prisma/migrations/<name>/down.sql
```

## Logs

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker
docker compose -f docker-compose.prod.yml logs -f caddy
```

## Backups

Nightly Postgres dump to S3:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U a11y --format=custom a11y \
  | aws s3 cp - s3://your-backups/a11y-$(date +%F).pgdump
```

Add this to root's crontab. The `pgdata` named volume can also be snapshotted
via your VM provider (EBS snapshots if EC2).

## Recovery

Anything's wrong? Stop everything, blow away local state, redeploy:

```bash
cd ~/a11y
docker compose -f docker-compose.prod.yml down              # keeps volumes
docker compose -f docker-compose.prod.yml down -v           # nukes pgdata + redisdata too — destructive
docker compose -f docker-compose.prod.yml up -d --build
```

This is the entire reason to use Docker for this kind of deploy: state is
compartmentalised in named volumes, so "rebuild from scratch" doesn't require
unwinding any host-level config.

## When to graduate to AWS Helm/EKS

This compose stack handles ~50 internal users on a t3.medium. If you need:

- Multi-AZ HA (Postgres failover, multiple API replicas)
- Burstable scan capacity (>10 concurrent Chromium instances)
- Org-policy-driven managed DB / KMS-backed encryption

…use the existing Helm chart at [../helm/a11y/](../helm/a11y/) and the
Terraform modules at [../terraform/](../terraform/). Application code is
identical; only the deploy target changes.
