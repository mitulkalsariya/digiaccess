import { Queue, Worker, type Processor, type JobsOptions } from 'bullmq';
import type { Redis } from '../redis.js';
import type { Viewport } from './runner.js';

export const SCAN_QUEUE = 'scan';
export const CRAWL_QUEUE = 'crawl';

export interface SinglePageScanJob {
  scanId: string;
  url: string;
  siteId?: string;
  viewports?: Viewport[];
  authProfileId?: string;
}

export interface CrawlScanJob {
  scanId: string;
  baseUrl: string;
  siteId: string;
  maxDepth: number;
  maxPages: number;
  includePatterns?: string[];
  excludePatterns?: string[];
}

const DEFAULT_JOB_OPTS: JobsOptions = {
  // Per AC: failed jobs retry 3x with exponential backoff.
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
  removeOnFail: { count: 1000, age: 7 * 24 * 60 * 60 },
};

export function createScanQueue(redis: Redis): Queue<SinglePageScanJob> {
  return new Queue<SinglePageScanJob>(SCAN_QUEUE, {
    connection: redis,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  });
}

export function createCrawlQueue(redis: Redis): Queue<CrawlScanJob> {
  return new Queue<CrawlScanJob>(CRAWL_QUEUE, {
    connection: redis,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  });
}

export function createScanWorker(
  redis: Redis,
  processor: Processor<SinglePageScanJob>,
  concurrency = 5,
): Worker<SinglePageScanJob> {
  return new Worker<SinglePageScanJob>(SCAN_QUEUE, processor, {
    connection: redis,
    concurrency,
  });
}

export function createCrawlWorker(
  redis: Redis,
  processor: Processor<CrawlScanJob>,
  concurrency = 2,
): Worker<CrawlScanJob> {
  return new Worker<CrawlScanJob>(CRAWL_QUEUE, processor, {
    connection: redis,
    concurrency,
  });
}
