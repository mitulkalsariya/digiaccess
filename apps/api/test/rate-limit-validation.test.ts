import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import type { Database, Prisma } from '../src/db.js';
import type { Redis } from '../src/redis.js';
import { testConfig } from './_fixtures.js';

const fakeDb = {
  query: async () => ({ rows: [{ ok: 1 }] }),
  end: async () => {},
} as unknown as Database;
const fakePrisma = {} as unknown as Prisma;

// In-memory Redis stand-in. @fastify/rate-limit uses redis.eval / pipelined incr — handle minimum surface.
function memRedis(): Redis {
  const store = new Map<string, { v: number; expireAt: number }>();
  const now = () => Date.now();
  const get = (k: string) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.expireAt && e.expireAt < now()) {
      store.delete(k);
      return null;
    }
    return e;
  };
  return {
    async ping() {
      return 'PONG';
    },
    disconnect() {},
    async get(k: string) {
      return get(k)?.v?.toString() ?? null;
    },
    async set(k: string, v: string, _mode?: string, ttlSec?: number) {
      store.set(k, { v: Number(v), expireAt: ttlSec ? now() + ttlSec * 1000 : 0 });
      return 'OK';
    },
    async del(k: string) {
      return store.delete(k) ? 1 : 0;
    },
    async incr(k: string) {
      const e = get(k);
      const v = (e?.v ?? 0) + 1;
      store.set(k, { v, expireAt: e?.expireAt ?? 0 });
      return v;
    },
    async pexpire(k: string, ms: number) {
      const e = get(k);
      if (!e) return 0;
      e.expireAt = now() + ms;
      return 1;
    },
    async pttl(k: string) {
      const e = get(k);
      if (!e || !e.expireAt) return -1;
      return Math.max(0, e.expireAt - now());
    },
    async eval(_script: string, _numKeys: number, k: string, ...args: string[]) {
      // Match the script @fastify/rate-limit ships with: increment + set TTL on first hit, return [count, ttl_ms].
      const ttlMs = Number(args[0] ?? 60_000);
      const e = get(k);
      const v = (e?.v ?? 0) + 1;
      const expireAt = e?.expireAt ?? now() + ttlMs;
      store.set(k, { v, expireAt });
      return [v, Math.max(0, expireAt - now())];
    },
    pipeline() {
      const cmds: Array<['incr' | 'pexpire', string, number?]> = [];
      const self = {
        incr(k: string) {
          cmds.push(['incr', k]);
          return self;
        },
        pexpire(k: string, ms: number) {
          cmds.push(['pexpire', k, ms]);
          return self;
        },
        async exec() {
          const out: Array<[Error | null, unknown]> = [];
          for (const c of cmds) {
            if (c[0] === 'incr') {
              const e = get(c[1]);
              const v = (e?.v ?? 0) + 1;
              store.set(c[1], { v, expireAt: e?.expireAt ?? 0 });
              out.push([null, v]);
            } else {
              const e = get(c[1]);
              if (e) e.expireAt = now() + (c[2] ?? 0);
              out.push([null, 1]);
            }
          }
          return out;
        },
      };
      return self;
    },
  } as unknown as Redis;
}

const baseConfig = testConfig();

describe('TC-020 rate limiting', () => {
  it('returns 429 with Retry-After when limit exceeded', async () => {
    const app = await buildServer({
      config: baseConfig,
      db: fakeDb,
      redis: memRedis(),
      prisma: fakePrisma,
      registerSsoRoutes: false,
      registerScans: false,
      rateLimitMax: 3,
      rateLimitWindowMs: 60_000,
    });
    app.get('/x', async () => ({ ok: true }));

    const opts = { method: 'GET' as const, url: '/x', remoteAddress: '10.0.0.1' };
    for (let i = 0; i < 3; i++) {
      const r = await app.inject(opts);
      expect(r.statusCode, `req ${i}`).toBe(200);
    }
    const blocked = await app.inject(opts);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    await app.close();
  });
});

describe('schema validation', () => {
  it('returns 400 with field-level errors on invalid body', async () => {
    const app = await buildServer({
      config: baseConfig,
      db: fakeDb,
      redis: memRedis(),
      prisma: fakePrisma,
      registerSsoRoutes: false,
      registerScans: false,
      registerRateLimitPlugin: false,
    });
    app.post(
      '/widgets',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name', 'count'],
            properties: {
              name: { type: 'string', minLength: 1 },
              count: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
      async () => ({ ok: true }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/widgets',
      payload: { name: '', count: -1 },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('validation-failed');
    expect(Array.isArray(body.fields)).toBe(true);
    expect(body.fields.length).toBeGreaterThan(0);
    await app.close();
  });
});
