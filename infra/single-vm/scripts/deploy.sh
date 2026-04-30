#!/usr/bin/env bash
# Pull/build/restart on the production VM. Run via sudo (or as root).
#
# First-time use:
#   sudo env GIT_REPO=https://github.com/<org>/<repo>.git bash deploy.sh
# Subsequent deploys:
#   sudo bash deploy.sh                  # tracks GIT_REF (default: main)
#   sudo env GIT_REF=v0.2.0 bash deploy.sh
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "must be root (try: sudo bash $0)"; exit 1
fi

APP_DIR=/opt/a11y/repo
GIT_REF=${GIT_REF:-main}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3001/health/ready}

# As-a11y helper.
asA11y() { runuser -u a11y -- "$@"; }

if [[ ! -d "$APP_DIR/.git" ]]; then
  if [[ -z "${GIT_REPO:-}" ]]; then
    echo "First run: set GIT_REPO=https://github.com/<org>/<repo>.git"; exit 2
  fi
  install -d -o a11y -g a11y "$APP_DIR"
  asA11y git clone "$GIT_REPO" "$APP_DIR"
fi

cd "$APP_DIR"
echo "==> Fetching $GIT_REF"
asA11y git fetch --all --tags --prune
asA11y git checkout "$GIT_REF"
asA11y git reset --hard "origin/$GIT_REF" || asA11y git reset --hard "$GIT_REF"

# Make sure pnpm is on a11y's PATH (we activate it system-wide via corepack
# in bootstrap.sh; this re-runs in case the version changed in the lockfile).
asA11y bash -lc 'corepack prepare pnpm@10 --activate >/dev/null'

echo "==> Installing dependencies"
asA11y bash -lc "cd '$APP_DIR' && pnpm install --frozen-lockfile"

echo "==> Building"
# DATABASE_URL is needed for `prisma generate` during build, but the value here
# is just for codegen — real migrations happen in the next step using the
# secrets-mounted URL.
asA11y bash -lc "cd '$APP_DIR' && DATABASE_URL='postgres://x' pnpm build"

echo "==> Applying database migrations"
asA11y bash -lc "cd '$APP_DIR/apps/api' && \
  DATABASE_URL=\$(cat /etc/a11y/secrets/database_url) \
  pnpm exec prisma migrate deploy"

echo "==> Installing systemd units"
install -m 644 \
  "$APP_DIR/infra/single-vm/systemd/a11y-api.service" \
  "$APP_DIR/infra/single-vm/systemd/a11y-worker.service" \
  "$APP_DIR/infra/single-vm/systemd/a11y-dashboard.service" \
  /etc/systemd/system/
systemctl daemon-reload

echo "==> Restarting services"
systemctl enable --now a11y-api a11y-worker a11y-dashboard
systemctl restart a11y-api a11y-worker a11y-dashboard

echo "==> Health check"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    echo "    ✓ API ready"
    break
  fi
  sleep 2
  if [[ $i -eq 12 ]]; then
    echo "    ✗ API did not come up. Last 50 log lines:"
    journalctl -u a11y-api -n 50 --no-pager
    exit 1
  fi
done

echo "==> Deployed $(asA11y git rev-parse --short HEAD)"
