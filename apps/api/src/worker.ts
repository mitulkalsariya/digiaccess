// Standalone scan-worker process. Same code as the API uses for processing,
// but in its own systemd unit so worker crashes don't kill the API.
//
// Run via: node dist/worker.js  (production)
//          tsx src/worker.ts    (dev)
import { loadConfig } from './config.js';
import { createPrisma } from './db.js';
import { createRedis } from './redis.js';
import { createScanWorker } from './scan/queue.js';
import { makeSinglePageProcessor } from './scan/processor.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = createPrisma(config);
  const redis = createRedis(config);
  const concurrency = Number(process.env['WORKER_CONCURRENCY'] ?? 5);

  const worker = createScanWorker(redis, makeSinglePageProcessor(prisma), concurrency);

  worker.on('completed', (job) => {
    // eslint-disable-next-line no-console
    console.info(`[worker] job ${job.id} completed`);
  });
  worker.on('failed', (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[worker] job ${job?.id} failed:`, err.message);
  });
  // eslint-disable-next-line no-console
  console.info(`[worker] up, concurrency=${concurrency}`);

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      // eslint-disable-next-line no-console
      console.info(`[worker] ${sig} — draining`);
      await worker.close();
      await prisma.$disconnect();
      redis.disconnect();
      process.exit(0);
    });
  }
}

void main();
