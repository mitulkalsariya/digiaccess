import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { loadConfig, type AppConfig } from './config.js';
import { createLoggerOptions } from './logger.js';
import { createDb, createPrisma, type Database, type Prisma } from './db.js';
import { createRedis, type Redis } from './redis.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuth } from './auth/plugin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerExtensionAuthRoutes } from './routes/auth-extension.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerCsrfProtection } from './auth/csrf.js';
import { registerScansRoutes } from './routes/scans.js';
import { createScanQueue, type SinglePageScanJob } from './scan/queue.js';
import type { Queue } from 'bullmq';

export interface BuildOptions {
  config?: AppConfig;
  db?: Database;
  redis?: Redis;
  prisma?: Prisma;
  registerSsoRoutes?: boolean; // default true; tests can opt out
  registerRateLimitPlugin?: boolean; // default true
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  scanQueue?: Queue<SinglePageScanJob>; // tests can supply a fake
  registerScans?: boolean; // default true
  registerCsrf?: boolean; // default true; tests using Bearer-only can skip
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const db = opts.db ?? createDb(config);
  const redis = opts.redis ?? createRedis(config);
  const prisma = opts.prisma ?? createPrisma(config);

  const app = Fastify({
    logger: createLoggerOptions(config),
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'request_id',
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  await app.register(sensible);

  if (opts.registerRateLimitPlugin !== false) {
    // Only pass the live redis when running normally; tests/non-prod can fall
    // back to in-memory LRU since they don't span multiple replicas.
    await registerRateLimit(app, {
      redis: config.nodeEnv === 'test' ? undefined : redis,
      defaultMax: opts.rateLimitMax,
      defaultWindowMs: opts.rateLimitWindowMs,
    });
  }

  await registerAuth(app, config);

  if (opts.registerCsrf !== false) {
    await registerCsrfProtection(app);
  }

  app.decorate('db', db);
  app.decorate('redis', redis);
  app.decorate('prisma', prisma);
  app.decorate('appConfig', config);

  // Field-level error responses for schema-validation failures (AC) +
  // status-code-preserving passthrough for thrown errors (rate-limit, sensible, etc.).
  app.setErrorHandler((err, _req, reply) => {
    if (err.validation) {
      reply.code(400).send({
        error: 'validation-failed',
        message: err.message,
        fields: err.validation.map((v) => ({
          path: v.instancePath || v.params?.['missingProperty'] || '',
          message: v.message ?? 'invalid',
        })),
      });
      return;
    }
    const status =
      typeof (err as { statusCode?: number }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    reply.code(status).send(err);
  });

  await registerHealthRoutes(app, { db, redis, version: config.version });

  if (opts.registerSsoRoutes !== false) {
    await registerAuthRoutes(app, { prisma, redis, config });
    await registerExtensionAuthRoutes(app, { prisma, redis, config });
  }

  if (opts.registerScans !== false) {
    const scanQueue = opts.scanQueue ?? createScanQueue(redis);
    await registerScansRoutes(app, {
      prisma,
      scanQueue,
      scanUrlAllowlist: config.scanUrlAllowlist,
    });
  }

  app.addHook('onClose', async () => {
    try {
      await db.end();
    } catch {
      /* ignore */
    }
    try {
      redis.disconnect();
    } catch {
      /* ignore */
    }
    try {
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    redis: Redis;
    prisma: Prisma;
    appConfig: AppConfig;
  }
}
