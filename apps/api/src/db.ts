import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config.js';

export type Database = pg.Pool;
export type Prisma = PrismaClient;

export function createDb(config: AppConfig): Database {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function createPrisma(config: AppConfig): Prisma {
  return new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
    log: config.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export async function pingDb(db: Database): Promise<boolean> {
  try {
    const r = await db.query('SELECT 1 AS ok');
    return r.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}
