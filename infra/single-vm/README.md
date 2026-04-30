# Single-VM deploy

Production-grade install on one Ubuntu 22.04 / 24.04 box. Targets:

- 2-4 vCPU, 4-8 GB RAM, 40 GB disk (sized for ~50 internal users + a worker fleet of 1)
- One DNS A record pointing at the VM (e.g. `a11y.your-company.internal`)
- SSH access as a sudo-capable user

Components on the box:

| Service                                   | Port (loopback) | Owner    | systemd unit             |
| ----------------------------------------- | --------------- | -------- | ------------------------ |
| nginx (TLS termination + reverse proxy)   | 80, 443         | root     | `nginx.service`          |
| API (Fastify)                             | 3001            | a11y     | `a11y-api.service`       |
| Dashboard (Next.js)                       | 3000            | a11y     | `a11y-dashboard.service` |
| Scan worker (BullMQ + Playwright)         | —               | a11y     | `a11y-worker.service`    |
| Postgres 16                               | 5432 (loopback) | postgres | `postgresql.service`     |
| Redis 7 (TLS-not-needed because loopback) | 6379 (loopback) | redis    | `redis-server.service`   |

The bootstrap script handles all of these — Postgres + Redis stay bound to
127.0.0.1 so the only network surface is HTTPS via nginx.

## Step 1 — bootstrap (run once on the VM)

```bash
sudo bash infra/single-vm/scripts/bootstrap.sh \
  --domain a11y.your-company.internal \
  --email ops@your-company.com
```

What it does:

1. Installs Node 20, pnpm, Postgres 16, Redis 7, nginx, certbot.
2. Locks down the firewall — only 22 (ssh), 80 (certbot http-01), 443 (HTTPS).
3. Creates a dedicated unprivileged `a11y` system user.
4. Generates random passwords for Postgres + Redis + JWT signing + the
   credential-vault key. Writes them to `/etc/a11y/secrets/` with mode 600.
5. Creates the `a11y` Postgres database owned by the `a11y` role.
6. Installs Chromium's system deps (so Playwright can launch).

Re-running is safe — every step is idempotent.

## Step 2 — TLS

Snakeoil certs come pre-installed on Ubuntu, so nginx starts. To swap to a real
certificate:

```bash
sudo certbot --nginx --domain a11y.your-company.internal \
  --email ops@your-company.com --agree-tos --redirect --non-interactive
```

certbot rewrites the nginx config in-place to point at the new certs and adds
the auto-renew cron. Verify with `curl -I https://a11y.your-company.internal/health`.

## Step 3 — install the nginx site

```bash
sudo cp infra/single-vm/nginx/a11y.conf /etc/nginx/sites-available/a11y
sudo sed -i "s/REPLACE_DOMAIN/a11y.your-company.internal/g" /etc/nginx/sites-available/a11y
sudo ln -sf /etc/nginx/sites-available/a11y /etc/nginx/sites-enabled/a11y
sudo nginx -t && sudo systemctl reload nginx
```

## Step 4 — first deploy

```bash
sudo -u a11y env GIT_REPO=https://github.com/<your-org>/a11y.git \
  bash infra/single-vm/scripts/deploy.sh
```

`deploy.sh` clones the repo, installs deps, runs Prisma migrations, copies the
systemd unit files, and starts (or restarts) the three services. It then health-
probes the API and aborts if it doesn't come up.

After this completes:

```bash
curl https://a11y.your-company.internal/health
# {"status":"ok","version":"0.1.0",...}
```

## Step 5 — wire up real SSO

The API still defaults to dev fallbacks for SSO. Set the real values:

```bash
sudo install -o a11y -g a11y -m 600 /dev/stdin /etc/a11y/secrets/sso_issuer        <<< "https://your-org.okta.com"
sudo install -o a11y -g a11y -m 600 /dev/stdin /etc/a11y/secrets/sso_client_id     <<< "..."
sudo install -o a11y -g a11y -m 600 /dev/stdin /etc/a11y/secrets/sso_client_secret <<< "..."
```

Then add the `*_FILE` env vars to `/etc/systemd/system/a11y-api.service` and
restart.

The redirect URI to register at the IdP is:

```
https://a11y.your-company.internal/auth/callback
```

For the Chrome extension force-install flow, additionally register:

```
https://<extension-id>.chromiumapp.org/a11y
```

## Step 6 — ongoing deploys

Every subsequent deploy is just:

```bash
sudo -u a11y bash /opt/a11y/repo/infra/single-vm/scripts/deploy.sh
```

Or scope to a specific tag:

```bash
sudo -u a11y env GIT_REF=v0.2.0 bash /opt/a11y/repo/infra/single-vm/scripts/deploy.sh
```

To roll back:

```bash
sudo -u a11y env GIT_REF=<previous-sha> bash /opt/a11y/repo/infra/single-vm/scripts/deploy.sh
```

## Operational notes

**Logs** — each service writes to `/var/log/a11y/{api,dashboard,worker}.log`. Use
`journalctl -u a11y-api -f` for live tail; `logrotate` is set up by the OS for
`/var/log` automatically.

**Status / restart**:

```bash
sudo systemctl status a11y-api a11y-dashboard a11y-worker
sudo systemctl restart a11y-api
```

**Backups** — set up a nightly `pg_dump` to S3 / your backup host:

```bash
sudo -u postgres pg_dump --format=custom a11y | aws s3 cp - s3://your-backups/a11y-$(date +%F).pgdump
```

The Helm chart's RDS PITR config is the same idea, applied to the managed DB.

**Monitoring** — `/health/ready` returns 503 if Postgres or Redis is down.
Point your uptime tooling at it.

## When to graduate to the AWS Helm path

This single-VM setup handles ~50 users and a scan worker fleet of 1 cleanly. If
you need any of:

- Multi-AZ HA (Postgres failover, multiple API replicas)
- Burstable scan capacity (>10 concurrent scans)
- Org-policy compliance for managed DB / encryption at rest with KMS

…use the existing Helm chart at [infra/helm/a11y/](../helm/a11y/) and the
Terraform modules at [infra/terraform/](../terraform/). The application code is
identical; only the deploy target changes.
