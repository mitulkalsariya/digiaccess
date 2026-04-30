# Makefile — local dev convenience. Each target is also a documented commands
# you can copy + paste; the Makefile just bundles the env vars in one place.

DATABASE_URL ?= postgresql://$(USER)@localhost:5432/a11y
REDIS_URL    ?= redis://localhost:6379
PORT_API     ?= 3001
PORT_DASH    ?= 3000

# Make sure all `pnpm --filter @a11y/api ...` commands see the same env.
export DATABASE_URL
export REDIS_URL
export NODE_ENV=development

.PHONY: help install db.create db.migrate db.seed db.reset \
        api.dev dashboard.dev extension.build extension.package \
        verify clean

help:
	@echo "Common targets:"
	@echo "  make install         pnpm install workspace deps"
	@echo "  make db.create       create local Postgres database 'a11y'"
	@echo "  make db.migrate      apply Prisma migrations"
	@echo "  make db.seed         insert dev fixtures (1 team, 2 users, 1 site)"
	@echo "  make db.reset        drop + recreate + migrate + seed"
	@echo "  make api.dev         run the API on :$(PORT_API) with hot reload"
	@echo "  make dashboard.dev   run the dashboard on :$(PORT_DASH)"
	@echo "  make extension.build build the Chrome extension"
	@echo "  make extension.package zip + updates.xml for sideload"
	@echo "  make verify          full workspace gate (build + tests + lint)"

install:
	pnpm install

db.create:
	@psql -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'a11y'" | grep -q 1 \
	  || psql -d postgres -c "CREATE DATABASE a11y;"

db.migrate:
	pnpm --filter @a11y/api exec prisma migrate deploy

db.seed:
	pnpm --filter @a11y/api exec tsx prisma/seed.ts

db.reset:
	psql -d postgres -c "DROP DATABASE IF EXISTS a11y;"
	$(MAKE) db.create db.migrate db.seed

api.dev:
	pnpm --filter @a11y/api exec tsx watch src/index.ts

dashboard.dev:
	API_BASE=http://localhost:$(PORT_API) pnpm --filter @a11y/dashboard dev

extension.build:
	pnpm --filter @a11y/extension build

extension.package: extension.build
	pnpm --filter @a11y/extension exec node scripts/package.mjs

verify:
	pnpm build
	pnpm type-check
	pnpm test
	pnpm lint
	pnpm format:check

clean:
	pnpm -r exec rm -rf dist .next .turbo node_modules
	rm -rf node_modules
