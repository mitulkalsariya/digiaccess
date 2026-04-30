#!/usr/bin/env bash
# One-shot bootstrap for an Ubuntu 22.04 / 24.04 server.
# Run as root on a fresh VM. Idempotent — safe to re-run.
#
# What it installs:
#   - Node.js 20 (NodeSource)
#   - pnpm 10 (corepack)
#   - PostgreSQL 16 (pinned, hardened defaults)
#   - Redis 7 (with requirepass + appendonly)
#   - Nginx + certbot
#   - Playwright browser deps + Chromium
#   - A non-root `a11y` system user the services run as
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<your-org>/a11y/main/infra/single-vm/scripts/bootstrap.sh \
#     | sudo bash -s -- --domain a11y.your-company.internal --email ops@your-company.com

set -euo pipefail

DOMAIN=""
EMAIL=""
DB_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
REDIS_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
JWT_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)"
CRED_KEY="$(openssl rand -base64 32 | head -c 44)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email)  EMAIL="$2";  shift 2 ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "usage: $0 --domain <fqdn> --email <ops@example.com>"; exit 2
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "must be root"; exit 1
fi

echo "==> apt update + base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw nginx python3-certbot-nginx jq

echo "==> firewall — allow only SSH + HTTPS"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp     # certbot http-01
ufw allow 443/tcp
ufw --force enable

echo "==> Node.js 20 (NodeSource)"
if ! node --version 2>/dev/null | grep -q '^v20'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@10 --activate

echo "==> PostgreSQL 16"
if ! command -v psql >/dev/null; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
    https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y postgresql-16
fi
systemctl enable --now postgresql

echo "==> Postgres: harden — local-only, dedicated DB + role"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='a11y'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE a11y LOGIN PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='a11y'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE a11y OWNER a11y;"

echo "==> Redis with auth + AOF"
apt-get install -y redis-server
# DON'T overwrite Ubuntu's redis.conf (it sets pidfile/dir/supervised that
# systemd needs). Append our overrides — redis takes the LAST occurrence of
# each directive, so this safely overrides the package defaults. Idempotent:
# strip any prior a11y block before re-appending.
sed -i '/# --- a11y deploy overrides BEGIN ---/,/# --- a11y deploy overrides END ---/d' /etc/redis/redis.conf
cat >> /etc/redis/redis.conf <<EOF
# --- a11y deploy overrides BEGIN ---
bind 127.0.0.1 ::1
requirepass $REDIS_PASSWORD
appendonly yes
maxmemory-policy allkeys-lru
protected-mode yes
# --- a11y deploy overrides END ---
EOF
systemctl enable --now redis-server
systemctl restart redis-server
# Confirm it's actually up — redis takes a couple seconds to bind sometimes.
for i in 1 2 3 4 5; do
  if redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping 2>/dev/null | grep -q PONG; then
    echo "    ✓ Redis up"
    break
  fi
  sleep 1
  if [[ $i -eq 5 ]]; then
    echo "    ✗ Redis didn't come up. Last log:"
    journalctl -u redis-server -n 30 --no-pager
    exit 1
  fi
done

echo "==> Service user"
id -u a11y >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin a11y
install -d -o a11y -g a11y /opt/a11y
install -d -o a11y -g a11y /var/log/a11y
install -d -o a11y -g a11y /etc/a11y/secrets

echo "==> Secrets — generated on this host, never leave it"
umask 077
echo -n "postgresql://a11y:${DB_PASSWORD}@127.0.0.1:5432/a11y" > /etc/a11y/secrets/database_url
echo -n "redis://:${REDIS_PASSWORD}@127.0.0.1:6379"          > /etc/a11y/secrets/redis_url
echo -n "$JWT_SECRET"                                         > /etc/a11y/secrets/jwt_secret
echo -n "$CRED_KEY"                                           > /etc/a11y/secrets/cred_key
chown -R a11y:a11y /etc/a11y/secrets
chmod 700 /etc/a11y/secrets
chmod 600 /etc/a11y/secrets/*

echo "==> Playwright system deps for Chromium"
apt-get install -y libnss3 libxkbcommon0 libgbm1 libasound2t64 libpango-1.0-0 \
  libcairo2 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libatspi2.0-0 \
  || apt-get install -y libnss3 libxkbcommon0 libgbm1 libasound2 libpango-1.0-0 \
       libcairo2 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libatspi2.0-0

echo "==> Done."
echo ""
echo "    Domain:        $DOMAIN"
echo "    DB role:       a11y / [generated, in /etc/a11y/secrets/database_url]"
echo "    Redis pwd:     [generated, in /etc/a11y/secrets/redis_url]"
echo "    JWT secret:    [generated, in /etc/a11y/secrets/jwt_secret]"
echo ""
echo "Next steps:"
echo "  # 1. Drop in the nginx site"
echo "  curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/infra/single-vm/nginx/a11y.conf \\"
echo "    | sudo sed \"s/REPLACE_DOMAIN/$DOMAIN/g\" | sudo tee /etc/nginx/sites-available/a11y >/dev/null"
echo "  sudo ln -sf /etc/nginx/sites-available/a11y /etc/nginx/sites-enabled/a11y"
echo "  sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "  # 2. (optional, only if DNS for \$DOMAIN points at this VM)"
echo "  sudo certbot --nginx --domain $DOMAIN --email $EMAIL --agree-tos --redirect --non-interactive"
echo ""
echo "  # 3. Pull the app and start the services"
echo "  sudo env GIT_REPO=https://github.com/<org>/<repo>.git \\"
echo "    bash -c 'curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/infra/single-vm/scripts/deploy.sh | bash'"
