#!/usr/bin/env bash
# Generate a fresh .env at the repo root with random per-host secrets.
# Refuses to overwrite an existing .env (so `docker compose up` is stable).
#
# Usage:  ./infra/docker/init-env.sh <domain> <acme-email>
# Example:./infra/docker/init-env.sh platform.digisaral.com mitul@digisaral.com

set -euo pipefail

DOMAIN=${1:?usage: $0 <domain> <acme-email>}
EMAIL=${2:?usage: $0 <domain> <acme-email>}

# Find the repo root from this script's location.
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
ENV_FILE="$ROOT/.env"

if [[ -e "$ENV_FILE" ]]; then
  echo "$ENV_FILE already exists — refusing to overwrite."
  echo "If you really want fresh secrets:  rm '$ENV_FILE' && $0 $DOMAIN $EMAIL"
  exit 1
fi

# Generate cryptographically-strong secrets.
gen() { openssl rand -base64 "$1" | tr -d '/+=' | head -c "$1"; }

cat > "$ENV_FILE" <<EOF
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by infra/docker/init-env.sh.
# Do not commit this file (.gitignore covers it).

DOMAIN=$DOMAIN
ACME_EMAIL=$EMAIL

# Postgres + Redis — used by the api/worker containers via docker-compose.
POSTGRES_PASSWORD=$(gen 32)
REDIS_PASSWORD=$(gen 32)

# JWT signing (S-1: must be >=32 chars in production)
JWT_SECRET=$(gen 48)

# AES-256-GCM master key for the credential vault (S-3 envelope encryption
# falls back to LocalKmsEnvelope when KMS_KEY_ARN isn't set).
CRED_ENCRYPTION_KEY=$(openssl rand -base64 32 | head -c 44)

# Optional: AWS KMS key ARN — when set, the vault uses real AWS KMS instead
# of the local AES key. Requires AWS credentials in the api container.
# KMS_KEY_ARN=arn:aws:kms:...

# Optional: tighten SSRF allowlist (S-2). Empty = allow any public host.
# SCAN_URL_ALLOWLIST=https://*.your-company.com

# Optional: app version surfaced via /health.
APP_VERSION=0.1.0
EOF

chmod 600 "$ENV_FILE"

echo "Wrote $ENV_FILE  (mode 600)"
echo ""
echo "Next:"
echo "  cd $ROOT"
echo "  docker compose -f docker-compose.prod.yml up -d --build"
