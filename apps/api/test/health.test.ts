import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import type { Database, Prisma } from '../src/db.js';
import type { Redis } from '../src/redis.js';
import { testConfig } from './_fixtures.js';

function fakeDb(ok = true): Database {
  return {
    query: async () => (ok ? { rows: [{ ok: 1 }] } : Promise.reject(new Error('down'))),
    end: async () => {},
  } as unknown as Database;
}

function fakeRedis(ok = true): Redis {
  return {
    ping: async () => (ok ? 'PONG' : Promise.reject(new Error('down'))),
    disconnect: () => {},
  } as unknown as Redis;
}

const fakePrisma = {} as unknown as Prisma;

const baseConfig = testConfig({ version: '0.1.0-test' });

describe('health endpoints', () => {
  it('GET /health returns 200 with version', async () => {
    const app = await buildServer({
      config: baseConfig,
      db: fakeDb(),
      redis: fakeRedis(),
      prisma: fakePrisma,
      registerSsoRoutes: false,
      registerScans: false,
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0-test');
    expect(typeof body.timestamp).toBe('string');
    await app.close();
  });

  it('GET /health/ready returns 200 when DB + Redis are up', async () => {
    const app = await buildServer({
      config: baseConfig,
      db: fakeDb(true),
      redis: fakeRedis(true),
      prisma: fakePrisma,
      registerSsoRoutes: false,
      registerScans: false,
    });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.checks).toEqual({ db: true, redis: true });
    await app.close();
  });

  it('GET /health/ready returns 503 when DB is down', async () => {
    const app = await buildServer({
      config: baseConfig,
      db: fakeDb(false),
      redis: fakeRedis(true),
      prisma: fakePrisma,
      registerSsoRoutes: false,
      registerScans: false,
    });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.db).toBe(false);
    await app.close();
  });

  it('GET /health/ready returns 503 when Redis is down', async () => {
    const app = await buildServer({
      config: baseConfig,
      db: fakeDb(true),
      redis: fakeRedis(false),
      prisma: fakePrisma,
      registerSsoRoutes: false,
      registerScans: false,
    });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.redis).toBe(false);
    await app.close();
  });
});
