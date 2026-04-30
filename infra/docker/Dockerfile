# Multi-target Dockerfile.
# Build context = repo root.
#
#   docker build -f infra/docker/Dockerfile --target api       -t a11y-api .
#   docker build -f infra/docker/Dockerfile --target worker    -t a11y-worker .
#   docker build -f infra/docker/Dockerfile --target migrator  -t a11y-migrator .
#   docker build -f infra/docker/Dockerfile --target dashboard -t a11y-dashboard .
#
# docker-compose.prod.yml uses the `target:` directive to pick the right one.

ARG NODE_VERSION=20.19.4

# ---- 1. Pruned source (turbo prune isolates each workspace + its deps) ----
FROM node:${NODE_VERSION}-alpine AS pruner
WORKDIR /repo
RUN npm install -g pnpm@10 turbo@2
COPY . .
RUN turbo prune @a11y/api @a11y/dashboard --docker

# ---- 2. Build with full deps ----
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --prod=false
COPY --from=pruner /repo/out/full/ ./
# Root-level config files the workspaces' tsconfigs extend from. `turbo prune`
# doesn't include these by default, so each package's `tsc -p tsconfig.json`
# fails with TS5083 "Cannot read file '/repo/tsconfig.base.json'".
COPY --from=pruner /repo/tsconfig.base.json /repo/tsconfig.json /repo/turbo.json ./
# DATABASE_URL is needed for `prisma generate` during the api build; the value
# here is just for codegen — real migrations happen in the migrator container.
RUN DATABASE_URL="postgres://x" pnpm build

# ---- 3. Runtime deps only (no dev tooling, no test framework) ----
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /repo
RUN npm install -g pnpm@10
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --prod=true --ignore-scripts

# ---- 4a. API runtime: distroless, non-root, smallest possible attack surface
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /repo/apps/api/dist /app/apps/api/dist
COPY --from=builder /repo/apps/api/package.json /app/apps/api/package.json
COPY --from=builder /repo/apps/api/prisma /app/apps/api/prisma
COPY --from=builder /repo/packages /app/packages
COPY --from=deps    /repo/node_modules /app/node_modules
USER nonroot
EXPOSE 3001
CMD ["apps/api/dist/index.js"]

# ---- 4b. Worker runtime: needs Chromium for Playwright. Use the official
#        Playwright image which has Chromium + system deps pre-installed.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS worker
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=builder /repo/apps/api/dist /app/apps/api/dist
COPY --from=builder /repo/apps/api/package.json /app/apps/api/package.json
COPY --from=builder /repo/apps/api/prisma /app/apps/api/prisma
COPY --from=builder /repo/packages /app/packages
COPY --from=deps    /repo/node_modules /app/node_modules
USER pwuser
CMD ["node", "apps/api/dist/worker.js"]

# ---- 4c. Migrator: ships the prisma CLI so it can run `migrate deploy`.
#        Runs once on `compose up`, then exits with success. The api and
#        worker containers wait for this to complete before they start.
FROM node:${NODE_VERSION}-alpine AS migrator
WORKDIR /app
RUN apk add --no-cache openssl && npm install -g pnpm@10
COPY --from=builder /repo /repo
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---- 4d. Dashboard runtime: Next.js production server.
FROM node:${NODE_VERSION}-alpine AS dashboard
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S -G app app
COPY --from=builder --chown=app:app /repo/apps/dashboard /app/apps/dashboard
COPY --from=builder --chown=app:app /repo/packages /app/packages
COPY --from=deps    --chown=app:app /repo/node_modules /app/node_modules
USER app
EXPOSE 3000
WORKDIR /app/apps/dashboard
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
