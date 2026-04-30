import pg from 'pg';
// @prisma/client is published as CommonJS. Node's ESM loader can't extract its
// named exports directly — `import { PrismaClient } from '@prisma/client'`
// throws "Named export 'PrismaClient' not found" at runtime under ESM.
// Default-import + destructure is the documented workaround.
import prismaPkg from '@prisma/client';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import type { AppConfig } from './config.js';

const { PrismaClient } = prismaPkg;

export type Database = pg.Pool;
export type Prisma = PrismaClientType;

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
  }) as PrismaClientType;
}

export async function pingDb(db: Database): Promise<boolean> {
  try {
    const r = await db.query('SELECT 1 AS ok');
    return r.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}
