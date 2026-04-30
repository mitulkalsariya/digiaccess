ARG NODE_VERSION=20.19.4

FROM node:${NODE_VERSION}-alpine AS pruner
WORKDIR /repo
RUN npm install -g pnpm@10 && npm install -g turbo@2
COPY . .
RUN turbo prune @a11y/dashboard --docker

FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --prod=false
COPY --from=pruner /repo/out/full/ ./
RUN pnpm --filter @a11y/dashboard build

FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /repo/apps/dashboard/dist /app/apps/dashboard/dist
COPY --from=builder /repo/apps/dashboard/package.json /app/apps/dashboard/package.json
COPY --from=builder /repo/packages /app/packages
COPY --from=builder /repo/node_modules /app/node_modules
USER nonroot
EXPOSE 3000
CMD ["apps/dashboard/dist/index.js"]
