import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../src/server.js';
import type { Database, Prisma } from '../src/db.js';
import type { Redis } from '../src/redis.js';
import type { Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { SinglePageScanJob } from '../src/scan/queue.js';
import { testConfig } from './_fixtures.js';

const fakeDb = {
  query: async () => ({ rows: [{ ok: 1 }] }),
  end: async () => {},
} as unknown as Database;
const fakeRedis = { ping: async () => 'PONG', disconnect() {} } as unknown as Redis;

const baseConfig = testConfig();

// Stub Prisma — just enough to hit our route handlers.
function makePrisma(
  scans: Map<string, Record<string, unknown>>,
  site: { id: string; ownerTeamId: string },
): Prisma {
  return {
    scan: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const s = { id: randomUUID(), ...data, violations: [] } as Record<string, unknown>;
        scans.set(s['id'] as string, s);
        return s;
      },
      findUnique: async ({ where }: { where: { id: string } }) => scans.get(where.id) ?? null,
      findMany: async () => [...scans.values()],
    },
    site: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === site.id ? site : null,
    },
  } as unknown as Prisma;
}

const fakeQueue = { add: async () => ({ id: 'job-1' }) } as unknown as Queue<SinglePageScanJob>;

const SITE_ID = '00000000-0000-0000-0000-000000000001';
const TEAM_OWNER = 'team-1';
const TEAM_OUTSIDER = 'team-2';

let prismaState: { scans: Map<string, Record<string, unknown>> };
beforeEach(() => {
  prismaState = { scans: new Map() };
});

function tokenFor(app: FastifyInstance, sub: string, teams: string[]): string {
  return app.jwt.sign({
    sub,
    email: `${sub}@e.com`,
    name: sub,
    teams,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
  });
}

describe('TC-008 scan results respect team ACL', () => {
  it('user A creates a scan; user B (different team) gets 403 reading it', async () => {
    const prisma = makePrisma(prismaState.scans, { id: SITE_ID, ownerTeamId: TEAM_OWNER });
    const app = await buildServer({
      config: baseConfig,
      db: fakeDb,
      redis: fakeRedis,
      prisma,
      registerSsoRoutes: false,
      registerRateLimitPlugin: false,
      scanQueue: fakeQueue,
    });

    // User A creates scan tied to siteId/team-1
    const tokA = tokenFor(app, 'userA', [TEAM_OWNER]);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/scans',
      headers: { authorization: `Bearer ${tokA}`, 'content-type': 'application/json' },
      payload: { url: 'https://e.com/', siteId: SITE_ID },
    });
    expect(create.statusCode).toBe(202);
    const scanId = create.json().scan.id;

    // User B (team-2) tries to read it → 403
    const tokB = tokenFor(app, 'userB', [TEAM_OUTSIDER]);
    const read = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId}`,
      headers: { authorization: `Bearer ${tokB}` },
    });
    expect(read.statusCode).toBe(403);

    // User A can read their own scan
    const readA = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId}`,
      headers: { authorization: `Bearer ${tokA}` },
    });
    expect(readA.statusCode).toBe(200);

    await app.close();
  });

  it('rejects scan creation when user is not on the site team', async () => {
    const prisma = makePrisma(prismaState.scans, { id: SITE_ID, ownerTeamId: TEAM_OWNER });
    const app = await buildServer({
      config: baseConfig,
      db: fakeDb,
      redis: fakeRedis,
      prisma,
      registerSsoRoutes: false,
      registerRateLimitPlugin: false,
      scanQueue: fakeQueue,
    });
    const tokB = tokenFor(app, 'userB', [TEAM_OUTSIDER]);
    const r = await app.inject({
      method: 'POST',
      url: '/v1/scans',
      headers: { authorization: `Bearer ${tokB}`, 'content-type': 'application/json' },
      payload: { url: 'https://e.com/', siteId: SITE_ID },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('S-9 private scan blocks teammate read but creator still has access', async () => {
    const prisma = makePrisma(prismaState.scans, { id: SITE_ID, ownerTeamId: TEAM_OWNER });
    const app = await buildServer({
      config: baseConfig,
      db: fakeDb,
      redis: fakeRedis,
      prisma,
      registerSsoRoutes: false,
      registerRateLimitPlugin: false,
      scanQueue: fakeQueue,
    });
    const tokA = tokenFor(app, 'userA', [TEAM_OWNER]);
    const tokC = tokenFor(app, 'userC', [TEAM_OWNER]); // teammate of A
    const create = await app.inject({
      method: 'POST',
      url: '/v1/scans',
      headers: { authorization: `Bearer ${tokA}`, 'content-type': 'application/json' },
      payload: { url: 'https://e.com/', siteId: SITE_ID, isPrivate: true },
    });
    expect(create.statusCode).toBe(202);
    const scanId = create.json().scan.id;

    // Teammate is on the same team but not the creator — must be blocked.
    const teammateRead = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId}`,
      headers: { authorization: `Bearer ${tokC}` },
    });
    expect(teammateRead.statusCode).toBe(403);

    // Creator can still read.
    const ownerRead = await app.inject({
      method: 'GET',
      url: `/v1/scans/${scanId}`,
      headers: { authorization: `Bearer ${tokA}` },
    });
    expect(ownerRead.statusCode).toBe(200);
    await app.close();
  });

  it('rejects malformed url with field-level error (T-007 hookup)', async () => {
    const prisma = makePrisma(prismaState.scans, { id: SITE_ID, ownerTeamId: TEAM_OWNER });
    const app = await buildServer({
      config: baseConfig,
      db: fakeDb,
      redis: fakeRedis,
      prisma,
      registerSsoRoutes: false,
      registerRateLimitPlugin: false,
      scanQueue: fakeQueue,
    });
    const tokA = tokenFor(app, 'userA', [TEAM_OWNER]);
    const r = await app.inject({
      method: 'POST',
      url: '/v1/scans',
      headers: { authorization: `Bearer ${tokA}`, 'content-type': 'application/json' },
      payload: { url: 'not-a-url' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('validation-failed');
    await app.close();
  });
});
