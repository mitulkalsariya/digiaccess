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
RUN apk add --no-cache openssl
RUN npm install -g pnpm@10
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --prod=false
COPY --from=pruner /repo/out/full/ ./
# Root-level config files the workspaces' tsconfigs extend from. `turbo prune`
# doesn't include these, so each package's `tsc -p tsconfig.json` fails with
# TS5083 "Cannot read file '/repo/tsconfig.base.json'".
COPY --from=pruner /repo/tsconfig.base.json /repo/tsconfig.json /repo/turbo.json ./
# DATABASE_URL is needed for `prisma generate` during the api build; the
# value here is just for codegen — real migrations run in the migrator container.
RUN DATABASE_URL="postgres://x" pnpm build

# ---- 3a. Self-contained api bundle via `pnpm deploy --prod`. The output at
#         /out has a flat node_modules with every transitive prod dep as a
#         real directory (no symlinks), so it survives a COPY into a runtime
#         image with a different filesystem layout.
FROM builder AS api-bundle
RUN pnpm --filter=@a11y/api --prod deploy /out

# ---- 3b. Same treatment for the dashboard. ----
FROM builder AS dashboard-bundle
RUN pnpm --filter=@a11y/dashboard --prod deploy /out

# ---- 4a. API runtime: distroless, non-root, smallest possible attack surface
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=api-bundle --chown=nonroot:nonroot /out /app
USER nonroot
EXPOSE 3001
CMD ["dist/index.js"]

# ---- 4b. Worker runtime: needs Chromium for Playwright. Reuses the api
#         bundle (worker.js lives next to index.js in the api workspace).
FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS worker
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=api-bundle /out /app
USER pwuser
CMD ["node", "dist/worker.js"]

# ---- 4c. Migrator: ships the prisma CLI (a devDep) so it can run
#         `migrate deploy`. We use the builder stage as the base — it has
#         every package + dev dep needed for the CLI to work.
FROM builder AS migrator
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---- 4d. Dashboard runtime: Next.js production server.
FROM node:${NODE_VERSION}-alpine AS dashboard
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S -G app app
COPY --from=dashboard-bundle --chown=app:app /out /app
USER app
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
