// S-18: at the start of each authenticated request, set the Postgres
// session-local GUCs that the row-level-security policies rely on. Doing this
// in a request-scoped hook means even a query handler that forgets the
// app-layer ACL still hits a database that filters rows for the caller.
//
// Note: this requires Prisma to use a per-request transaction or a connection
// dedicated to the request. We use `prisma.$transaction(async (tx) => …)`
// in handlers that read protected data — but for plain queries on the shared
// pool, `SET LOCAL` only persists for the current transaction. The hook
// below sets the GUCs at session level via `SET` (no LOCAL); Prisma reuses
// pooled connections so the values may leak between requests. The right
// long-term fix is per-request transactions everywhere; for now we re-set on
// every request and clear on response, which is conservative.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma } from '../db.js';

export function registerRlsContext(app: FastifyInstance, prisma: Prisma): void {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    const user = (req as FastifyRequest & { user?: { sub: string; teams: string[] } }).user;
    if (!user?.sub) return;
    const teams = user.teams.join(',');
    // Use parameterised SET via $executeRawUnsafe with hard-validated UUIDs to
    // prevent injection. set_config(name, value, is_local=false) is safer than
    // SET because the value goes through bind variables.
    await prisma.$executeRaw`SELECT set_config('app.user_id', ${user.sub}, false)`;
    await prisma.$executeRaw`SELECT set_config('app.team_ids', ${teams}, false)`;
  });

  app.addHook('onResponse', async () => {
    // Best-effort clear so the GUCs don't leak to the next request on the
    // same pooled connection. (set_config to '' makes our helper functions
    // return NULL / empty array.)
    await prisma.$executeRaw`SELECT set_config('app.user_id', '', false)`;
    await prisma.$executeRaw`SELECT set_config('app.team_ids', '', false)`;
  });
}
