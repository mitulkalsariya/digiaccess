import IORedis from 'ioredis';
import type { AppConfig } from './config.js';

export type Redis = InstanceType<typeof IORedis>;

export function createRedis(config: AppConfig): Redis {
  return new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

export async function pingRedis(redis: Redis): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
