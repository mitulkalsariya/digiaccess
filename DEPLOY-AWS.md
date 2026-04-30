# Deploy to AWS EC2 — end-to-end

Targets: a single t3.medium Ubuntu 22.04 VM. Cheapest production path (≈ $30/mo
on-demand, ≈ $15/mo with a 1-year reservation). All three services + Postgres +
Redis run on the same box; for HA later, lift-and-shift to the existing
[Helm chart](infra/helm/a11y/).

Two phases: ① push → GitHub, ② AWS provision → bootstrap → deploy.

---

## Phase 1 — push the code

(Run these on your laptop, in `/Users/mitulkalsariya/Desktop/Digiaccess`.)

```bash
git push -u origin main
```

If GitHub rejects the password prompt, either install [GitHub CLI](https://cli.github.com)
and run `gh auth login`, or create a Personal Access Token at
<https://github.com/settings/tokens?type=beta>, give it `repo` scope, and use
the token instead of the password. Once the push succeeds, the rest of this doc
runs on the EC2 box.

---

## Phase 2 — AWS

### 2.1  Provision the VM

**Console path:**

1. EC2 → Launch instance.
2. **Name**: `a11y`.
3. **AMI**: Ubuntu Server 22.04 LTS (or 24.04 LTS), 64-bit (x86).
4. **Instance type**: `t3.medium` (2 vCPU / 4 GB RAM). Anything smaller will
   thrash when Chromium spawns; bigger if you need >5 concurrent scans.
5. **Key pair**: create one named `a11y` and download the `.pem`. `chmod 400`
   it on your laptop.
6. **Security group** — create new, inbound rules:
   - SSH (22) from **My IP** (NOT 0.0.0.0/0)
   - HTTP (80) from anywhere — needed only for Let's Encrypt's HTTP-01
   - HTTPS (443) from anywhere
7. **Storage**: 30 GB gp3.
8. Launch.

**CLI path** (alternative):
```bash
aws ec2 run-instances \
  --image-id ami-0c7217cdde317cfec  \  # ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*
  --instance-type t3.medium \
  --key-name a11y \
  --security-group-ids sg-xxxxxxxx \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=a11y}]'
```

Note the public IPv4 address — you'll use it as `<EC2_IP>` below.

### 2.2  (Optional) DNS

If you have a domain, add an `A` record pointing
`a11y.your-company.com` → `<EC2_IP>`. Without a domain, you can still run on
HTTP using the EC2 public hostname — TLS via Let's Encrypt requires a real DNS
name though.

### 2.3  SSH in

```bash
ssh -i ~/.ssh/a11y.pem ubuntu@<EC2_IP>
```

### 2.4  Bootstrap the box (one-time)

This installs Node, Postgres 16, Redis 7, nginx, certbot, generates random
secrets, and sets up the firewall. Run it directly from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/mitulkalsariya/digiaccess/main/infra/single-vm/scripts/bootstrap.sh \
  | sudo bash -s -- \
      --domain a11y.your-company.com \
      --email you@your-company.com
```

If you don't have a domain yet, pass `--domain $(curl -s ifconfig.me)` to use
the EC2 public IP — you can swap to a real domain later by re-running the
script (idempotent).

### 2.5  Wire up the nginx site

```bash
curl -fsSL https://raw.githubusercontent.com/mitulkalsariya/digiaccess/main/infra/single-vm/nginx/a11y.conf \
  | sudo sed "s/REPLACE_DOMAIN/a11y.your-company.com/g" \
  | sudo tee /etc/nginx/sites-available/a11y > /dev/null

sudo ln -sf /etc/nginx/sites-available/a11y /etc/nginx/sites-enabled/a11y
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 2.6  TLS (only if you have a real DNS name pointing at the box)

```bash
sudo certbot --nginx \
  --domain a11y.your-company.com \
  --email you@your-company.com \
  --agree-tos --redirect --non-interactive
```

certbot rewrites the nginx config in-place to use the new cert and adds the
auto-renewal cron. **Skip this step if you're testing on the bare EC2 IP** —
nginx will serve via the snake-oil cert and the browser will warn (acceptable
for first verification).

### 2.7  Pull the app + start the services

```bash
sudo env GIT_REPO=https://github.com/mitulkalsariya/digiaccess.git \
  bash -c 'curl -fsSL https://raw.githubusercontent.com/mitulkalsariya/digiaccess/main/infra/single-vm/scripts/deploy.sh | bash'
```

What this does:

1. Clones the repo into `/opt/a11y/repo` (owned by the unprivileged `a11y` user).
2. `pnpm install --frozen-lockfile` (locked deps, reproducible).
3. `pnpm build` — TypeScript compile, Prisma client generate, dashboard build.
4. `prisma migrate deploy` — applies all 3 migrations against the local DB.
5. Installs the three systemd unit files.
6. Starts (or restarts) `a11y-api`, `a11y-worker`, `a11y-dashboard`.
7. Polls `/health/ready` for ≤ 24s, fails the deploy if it doesn't come up.

Expected duration: 3–6 minutes (Playwright downloads Chromium on the first
worker start — about 200 MB).

### 2.8  Verify

```bash
# On the VM:
sudo systemctl status a11y-api a11y-worker a11y-dashboard
curl -s http://127.0.0.1:3001/health/ready

# From your laptop:
curl https://a11y.your-company.com/health
# {"status":"ok","version":"0.1.0",...}
```

Open `https://a11y.your-company.com/` in a browser — you should see the
dashboard's "Sites" page.

---

## Phase 3 — make it usable

The fresh deploy boots with dev SSO defaults. Two more things before real use:

### 3.1  Real SSO

Register your tool at the IdP with the redirect URI:
```
https://a11y.your-company.com/auth/callback
```

Then put the issuer + credentials into the secrets directory:

```bash
sudo install -o a11y -g a11y -m 600 /dev/stdin \
  /etc/a11y/secrets/sso_issuer        <<< "https://your-org.okta.com"
sudo install -o a11y -g a11y -m 600 /dev/stdin \
  /etc/a11y/secrets/sso_client_id     <<< "0oa..."
sudo install -o a11y -g a11y -m 600 /dev/stdin \
  /etc/a11y/secrets/sso_client_secret <<< "..."
```

Add the `*_FILE` env vars to the API systemd unit and reload:

```bash
sudo systemctl edit a11y-api
# In the editor, add:
#   [Service]
#   Environment=SSO_ISSUER_FILE=/etc/a11y/secrets/sso_issuer
#   Environment=SSO_CLIENT_ID_FILE=/etc/a11y/secrets/sso_client_id
#   Environment=SSO_CLIENT_SECRET_FILE=/etc/a11y/secrets/sso_client_secret

sudo systemctl restart a11y-api
```

### 3.2  Seed your team + sites

```bash
sudo -u a11y bash -c 'cd /opt/a11y/repo/apps/api && \
  DATABASE_URL=$(cat /etc/a11y/secrets/database_url) \
  pnpm exec tsx prisma/seed.ts'
```

That creates a `platform` team with two test users. Edit
`apps/api/prisma/seed.ts` for your real org, push, and re-deploy — `db.seed`
is idempotent.

---

## Ongoing — push & deploy

Every subsequent change:

```bash
# On your laptop:
git push origin main

# On the VM (or via your favorite CI/CD trigger):
sudo bash /opt/a11y/repo/infra/single-vm/scripts/deploy.sh
```

To deploy a tagged release: `sudo env GIT_REF=v0.2.0 bash /opt/a11y/repo/infra/single-vm/scripts/deploy.sh`.
To roll back: same command with `GIT_REF=<previous-sha>`.

## Logs / debugging

| Command | What |
|---|---|
| `sudo journalctl -u a11y-api -f` | live API log |
| `sudo journalctl -u a11y-worker -f` | live worker log (scan jobs) |
| `sudo journalctl -u a11y-dashboard -f` | Next.js |
| `sudo systemctl status a11y-api` | running state + last 10 lines |
| `tail -f /var/log/a11y/api.log` | append-only file (logrotate compresses daily) |
| `sudo nginx -t` | validate nginx config before reload |

## Backups

Set up a nightly `pg_dump` to S3 (or wherever):

```bash
sudo crontab -u postgres -e
# 0 3 * * *  pg_dump --format=custom a11y | aws s3 cp - s3://your-backups/a11y-$(date +\%F).pgdump
```

For point-in-time recovery (RPO < 1 day), graduate to RDS via the existing
[infra/terraform/](infra/terraform/) modules.

## Cost

| Item | Monthly |
|---|---|
| t3.medium on-demand | ≈ $30 |
| 30 GB gp3 storage | ≈ $3 |
| Data transfer out (light internal use) | ≈ $1 |
| Let's Encrypt cert | $0 |
| **Total** | **≈ $34** |

A 1-year reserved t3.medium drops the EC2 line to ≈ $15/mo.
