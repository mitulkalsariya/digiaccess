import type { FastifyInstance } from 'fastify';
import type { Database } from '../db.js';
import type { Redis } from '../redis.js';
import { pingDb } from '../db.js';
import { pingRedis } from '../redis.js';

export interface HealthDeps {
  db: Database;
  redis: Redis;
  version: string;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  { db, redis, version }: HealthDeps,
): Promise<void> {
  // Liveness — process is up; doesn't depend on backends.
  app.get('/health', async () => ({
    status: 'ok',
    version,
    timestamp: new Date().toISOString(),
  }));

  // Readiness — degrades to 503 if any required backend is unavailable.
  app.get('/health/ready', async (_req, reply) => {
    const [dbOk, redisOk] = await Promise.all([pingDb(db), pingRedis(redis)]);
    const ready = dbOk && redisOk;
    reply.code(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not-ready',
      version,
      checks: { db: dbOk, redis: redisOk },
      timestamp: new Date().toISOString(),
    };
  });
}
