import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimitPlugin from '@fastify/rate-limit';
import type { Redis } from '../redis.js';

export interface RateLimitOptions {
  redis?: Redis; // omit to use in-memory LRU (single-node fallback)
  defaultMax?: number;
  defaultWindowMs?: number;
}

export async function registerRateLimit(
  app: FastifyInstance,
  { redis, defaultMax = 100, defaultWindowMs = 60_000 }: RateLimitOptions,
): Promise<void> {
  await app.register(rateLimitPlugin, {
    ...(redis ? { redis } : {}),
    max: defaultMax,
    timeWindow: defaultWindowMs,
    keyGenerator: (req: FastifyRequest) => {
      const u = (req as FastifyRequest & { user?: { sub: string } }).user;
      return u?.sub ?? req.ip;
    },
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry in ${Math.ceil(ctx.ttl / 1000)}s.`,
      retryAfter: Math.ceil(ctx.ttl / 1000),
    }),
  });
}
