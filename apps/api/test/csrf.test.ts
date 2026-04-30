import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import type { Database, Prisma } from '../src/db.js';
import type { Redis } from '../src/redis.js';
import { testConfig } from './_fixtures.js';

const fakeDb = {
  query: async () => ({ rows: [{ ok: 1 }] }),
  end: async () => {},
} as unknown as Database;
const fakeRedis = { ping: async () => 'PONG', disconnect() {} } as unknown as Redis;
const fakePrisma = {} as unknown as Prisma;

describe('S-19 CSRF protection', () => {
  it('blocks cookie-authed POST without the matching header', async () => {
    const app = await buildServer({
      config: testConfig(),
      db: fakeDb,
      redis: fakeRedis,
      prisma: fakePrisma,
      registerSsoRoutes: false,
      registerScans: false,
      registerRateLimitPlugin: false,
    });
    app.post('/state-change', async () => ({ ok: true }));
    // Provide a CSRF cookie but no matching header.
    const res = await app.inject({
      method: 'POST',
      url: '/state-change',
      headers: { cookie: 'a11y_csrf=token-A; a11y_at=fake' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('csrf-token-missing-or-invalid');
    await app.close();
  });

  it('allows cookie-authed POST when cookie + header match', async () => {
    const app = await buildServer({
      config: testConfig(),
      db: fakeDb,
      redis: fakeRedis,
      prisma: fakePrisma,
      registerSsoRoutes: false,
      registerScans: false,
      registerRateLimitPlugin: false,
    });
    app.post('/state-change', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/state-change',
      headers: {
        cookie: 'a11y_csrf=token-A; a11y_at=fake',
        'x-a11y-csrf': 'token-A',
      },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('Bearer-authed POST bypasses the CSRF check entirely (no cookie attached)', async () => {
    const app = await buildServer({
      config: testConfig(),
      db: fakeDb,
      redis: fakeRedis,
      prisma: fakePrisma,
      registerSsoRoutes: false,
      registerScans: false,
      registerRateLimitPlugin: false,
    });
    app.post('/state-change', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/state-change',
      headers: { authorization: 'Bearer fake' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('GET requests pass through without a CSRF check', async () => {
    const app = await buildServer({
      config: testConfig(),
      db: fakeDb,
      redis: fakeRedis,
      prisma: fakePrisma,
      registerSsoRoutes: false,
      registerScans: false,
      registerRateLimitPlugin: false,
    });
    app.get('/anything', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/anything' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('mismatched CSRF token is rejected (constant-time compare)', async () => {
    const app = await buildServer({
      config: testConfig(),
      db: fakeDb,
      redis: fakeRedis,
      prisma: fakePrisma,
      registerSsoRoutes: false,
      registerScans: false,
      registerRateLimitPlugin: false,
    });
    app.post('/x', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/x',
      headers: {
        cookie: 'a11y_csrf=AAAAAAAAAA; a11y_at=fake',
        'x-a11y-csrf': 'BBBBBBBBBB', // same length, different value
      },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
