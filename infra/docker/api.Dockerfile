# Multi-stage build — distroless base, runs as non-root.
# Build context = repo root. Build with: docker build -f infra/docker/api.Dockerfile .
ARG NODE_VERSION=20.19.4

# ---- 1. Pruned source (turbo prune isolates the api workspace + its deps) ----
FROM node:${NODE_VERSION}-alpine AS pruner
WORKDIR /repo
RUN npm install -g pnpm@10 turbo@2
COPY . .
RUN turbo prune @a11y/api --docker

# ---- 2. Build with full deps ----
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --prod=false
COPY --from=pruner /repo/out/full/ ./
RUN pnpm --filter @a11y/api build

# ---- 3. Runtime deps only (S-14: no devDependencies) ----
# Re-install with --prod against the same lockfile so tooling like vitest, tsx,
# typescript, prisma cli, eslint, the entire test framework, etc. NEVER ship.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /repo
RUN npm install -g pnpm@10
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --prod=true --ignore-scripts

# ---- 4. Runtime image (distroless, non-root) ----
FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /repo/apps/api/dist /app/apps/api/dist
COPY --from=builder /repo/apps/api/package.json /app/apps/api/package.json
COPY --from=builder /repo/apps/api/prisma /app/apps/api/prisma
COPY --from=builder /repo/packages /app/packages
# Production node_modules only — comes from the deps stage, not builder.
COPY --from=deps /repo/node_modules /app/node_modules
USER nonroot
EXPOSE 3001
CMD ["apps/api/dist/index.js"]
