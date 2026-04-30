# Running locally

Verified flow on macOS with Homebrew Postgres + Redis. Linux works the same;
Windows users should use WSL2.

## Prerequisites

- Node 20+ and pnpm 10+ (`node --version`, `pnpm --version`)
- Postgres 14+ (`brew install postgresql@14 && brew services start postgresql@14`)
- Redis 7+ (`brew install redis && brew services start redis`)
- (optional, for the worker) Playwright browsers — installed on first scan via
  `pnpm exec playwright install chromium`

## One-time setup

```bash
make install         # pnpm install
make db.create       # create database 'a11y' on local postgres
make db.migrate      # apply all 3 prisma migrations (init + S-3 + S-18 RLS)
make db.seed         # 1 team, 2 users (alice, bob), 1 site
```

To wipe and start over: `make db.reset`.

## Run the API

```bash
make api.dev
# →  api listening at http://0.0.0.0:3001
```

In another terminal, sanity check it:

```bash
curl http://localhost:3001/health
# {"status":"ok","version":"0.1.0-dev","timestamp":"..."}

curl http://localhost:3001/health/ready
# {"status":"ready","checks":{"db":true,"redis":true},...}
```

## Hit a protected endpoint without standing up an IdP

The API expects JWT bearer tokens. For local testing, mint one signed with the
same dev secret the API trusts:

```bash
TOKEN=$(pnpm --filter @a11y/api exec tsx scripts/dev-token.ts alice@example.com)

# List scans (empty on first run)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/v1/scans

# Submit a scan
curl -X POST -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"url":"https://example.com/"}' \
  http://localhost:3001/v1/scans

# Try to scan an internal target — the SSRF guard blocks it
curl -X POST -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"url":"http://169.254.169.254/latest/meta-data/"}' \
  http://localhost:3001/v1/scans
# →  {"error":"url-not-allowed","reason":"private-or-reserved-ip"}
```

The dev-token script reads the user from the DB so the `sub` claim is a real
user UUID; FK constraints on `scans.created_by_id` are satisfied.

## Run the dashboard

```bash
make dashboard.dev
# →  http://localhost:3000
```

Pages of interest:

- `/` — sites registry
- `/scans/<id>` — scan detail with violations grouped by severity
- `/scans/<id>/export.xlsx` — Excel report (1Finance template)

## Build the Chrome extension

```bash
make extension.build       # → apps/extension/dist
make extension.package     # → apps/extension/package/a11y-extension-<version>.zip
```

Sideload into Chrome for manual testing:

1. Open `chrome://extensions`
2. Toggle "Developer mode" (top-right)
3. "Load unpacked" → pick `apps/extension/dist`

For enterprise force-install (the production distribution path) see
[apps/extension/SIDELOAD.md](apps/extension/SIDELOAD.md).

## Run a real scan end-to-end

The API enqueues scans into a BullMQ queue but the worker isn't started by
default. To run a scan locally you need the worker process — start it with:

```bash
DATABASE_URL=postgresql://$USER@localhost:5432/a11y \
REDIS_URL=redis://localhost:6379 \
pnpm --filter @a11y/api exec tsx -e \
  "import { createPrisma } from './src/db.js'; \
   import { createRedis } from './src/redis.js'; \
   import { loadConfig } from './src/config.js'; \
   import { createScanWorker } from './src/scan/queue.js'; \
   import { makeSinglePageProcessor } from './src/scan/processor.js'; \
   const cfg = loadConfig(); \
   const w = createScanWorker(createRedis(cfg), makeSinglePageProcessor(createPrisma(cfg))); \
   console.log('worker up'); \
   process.on('SIGINT', () => w.close().then(() => process.exit(0)));"
```

(First run downloads Chromium — `pnpm exec playwright install chromium`.)

## Verify everything

```bash
make verify
# → runs build, type-check, all 105 tests, lint, format:check
```

## What CAN'T run locally without setup

- **Real SSO** — needs an Okta / Azure AD / Google Workspace tenant and matching
  `SSO_*` env vars. Until then, use the `dev-token` script.
- **AWS KMS envelope encryption (S-3)** — without `KMS_KEY_ARN` the vault uses a
  local 32-byte AES key (functionally identical, just no HSM guarantees).
- **Production deploy** — Helm chart needs an EKS cluster + the AWS OIDC
  trust policies set up; see [infra/terraform/README.md](infra/terraform/README.md).
