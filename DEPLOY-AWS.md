# Deploy to AWS EC2 — end-to-end

Targets: a single t3.medium Ubuntu 22.04 VM (≈ $30/mo on-demand, ≈ $15/mo
reserved). Two paths, pick one:

| Path | What runs on the host | When to use |
|---|---|---|
| **A. Docker Compose** *(recommended)* | Just Docker. App + DB + Redis + Caddy all in containers. | Default. Simpler bootstrap, simpler recovery. |
| B. Native systemd | Node, Postgres, Redis, nginx, certbot installed on the host directly | Strict policy disallows Docker, or you want zero container overhead. |

Both end up serving the same code on the same VM with TLS via Let's Encrypt;
only the operational shape differs. For HA later, both lift-and-shift to the
existing [Helm chart](infra/helm/a11y/) without app changes.

---

## Path A — Docker Compose (recommended)

### A.1 — Push (laptop, one-time)

```bash
cd /Users/mitulkalsariya/Desktop/Digiaccess
git push -u origin main
```

### A.2 — Provision the VM (AWS console)

- EC2 → Launch instance
- AMI: **Ubuntu Server 22.04 LTS** (or 24.04)
- Instance type: **t3.medium** (2 vCPU / 4 GB)
- Key pair: select **`digiaccess`** (the one whose .pem you have)
- Security group, inbound:
  - SSH (22) from **My IP**
  - HTTP (80) — Anywhere
  - HTTPS (443) — Anywhere
- Storage: **30 GB gp3**
- Launch.

Note the public IPv4 — call it `<EC2_IP>`.

### A.3 — DNS

In Cloudflare (digisaral.com is delegated there):

- DNS → Records → **Add record**
- Type: **A**, Name: `platform`, IPv4: `<EC2_IP>`
- Proxy status: **DNS only** (grey cloud — needed for Let's Encrypt's HTTP-01
  challenge to reach the box)
- Save.

Verify from your laptop:

```bash
dig +short A platform.digisaral.com
# Should print <EC2_IP>
```

### A.4 — SSH and deploy

```bash
ssh -i ~/.ssh/digiaccess.pem ubuntu@platform.digisaral.com

# 1. Install Docker (one-time per VM)
curl -fsSL https://raw.githubusercontent.com/mitulkalsariya/digiaccess/main/infra/docker/install-docker.sh \
  | sudo bash

# 2. Re-login so the docker group takes effect
exit
ssh -i ~/.ssh/digiaccess.pem ubuntu@platform.digisaral.com

# 3. Pull the repo
git clone https://github.com/mitulkalsariya/digiaccess.git ~/a11y
cd ~/a11y

# 4. Generate .env with random secrets
./infra/docker/init-env.sh platform.digisaral.com mitul@digisaral.com

# 5. Build and start (5–10 min: Chromium download + Next.js build + image layers)
docker compose -f docker-compose.prod.yml up -d --build

# 6. Verify
docker compose -f docker-compose.prod.yml ps
curl -fsS https://platform.digisaral.com/health
```

Caddy provisions the TLS certificate automatically on first start — no
certbot, no cron, no nginx config to babysit.

### A.5 — Updates

```bash
cd ~/a11y
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

The `migrator` container re-runs `prisma migrate deploy` (idempotent); api,
worker, dashboard reload with the new image.

### A.6 — Logs / rollback / recovery

Full ops notes are in [infra/docker/README.md](infra/docker/README.md).

Quick reference:
```bash
# Logs
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker
docker compose -f docker-compose.prod.yml logs -f caddy

# Status
docker compose -f docker-compose.prod.yml ps

# Rollback
git checkout <previous-sha>
docker compose -f docker-compose.prod.yml up -d --build

# Nuclear recovery (data preserved — pgdata/redisdata are volumes)
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Path B — Native systemd (alternative)

This is the original guide. Use Path A unless you have a reason not to.

Full step-by-step in [infra/single-vm/README.md](infra/single-vm/README.md).
Two scripts (`bootstrap.sh` + `deploy.sh`) install Node, Postgres 16, Redis 7,
nginx, and certbot on the host directly, then run the API/worker/dashboard as
systemd services.

---

## Phase 3 — make it usable (both paths)

### Real SSO

Register the tool at your IdP with the redirect URI:
```
https://platform.digisaral.com/auth/callback
```

For the Docker path, append the values to `~/a11y/.env` and restart:

```env
SSO_ISSUER=https://your-org.okta.com
SSO_CLIENT_ID=0oa...
SSO_CLIENT_SECRET=...
```

Then `docker compose -f docker-compose.prod.yml up -d`. The api container
picks up the new env vars on restart.

For the systemd path, add `*_FILE` env vars to the api unit (see
`infra/single-vm/README.md` for details).

### Seed your team + sites

Docker:
```bash
cd ~/a11y
docker compose -f docker-compose.prod.yml exec migrator \
  pnpm exec tsx prisma/seed.ts
```

Edit `apps/api/prisma/seed.ts` for your real org, push, redeploy.

---

## When to graduate to AWS EKS

If you need any of:
- Multi-AZ HA (Postgres failover, multiple API replicas)
- Burstable scan capacity (>10 concurrent scans)
- Org-policy compliance for managed DB / KMS encryption at rest

…the existing [Helm chart](infra/helm/a11y/) and
[Terraform modules](infra/terraform/) are the upgrade. Same application code,
different deploy target.

## Cost (Path A)

| Item | Monthly |
|---|---|
| t3.medium on-demand | ≈ $30 |
| 30 GB gp3 | ≈ $3 |
| Data transfer (light internal use) | ≈ $1 |
| Let's Encrypt cert (via Caddy) | $0 |
| **Total** | **≈ $34** |
