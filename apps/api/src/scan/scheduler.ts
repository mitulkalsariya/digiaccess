// T-034: BullMQ repeatable jobs for scheduled scans. Cron-driven.
import type { Queue, JobsOptions } from 'bullmq';
import type { Prisma } from '../db.js';
import type { CrawlScanJob } from './queue.js';

export interface ScheduleInput {
  siteId: string;
  cron: string;
  timezone?: string;
  maxDepth?: number;
  maxPages?: number;
}

export async function upsertScheduledScan(
  prisma: Prisma,
  crawlQueue: Queue<CrawlScanJob>,
  input: ScheduleInput,
): Promise<{ id: string }> {
  const existing = await prisma.scheduledScan.findFirst({ where: { siteId: input.siteId } });
  const sched = existing
    ? await prisma.scheduledScan.update({
        where: { id: existing.id },
        data: { cron: input.cron, timezone: input.timezone ?? 'UTC', enabled: true },
      })
    : await prisma.scheduledScan.create({
        data: { siteId: input.siteId, cron: input.cron, timezone: input.timezone ?? 'UTC' },
      });

  const opts: JobsOptions = {
    repeat: { pattern: input.cron, tz: input.timezone ?? 'UTC' },
    jobId: `scheduled-${sched.id}`,
  };
  const site = await prisma.site.findUnique({ where: { id: input.siteId } });
  if (!site) throw new Error('site-not-found');

  await crawlQueue.add(
    'scheduled-crawl',
    {
      scanId: '',
      baseUrl: site.baseUrl,
      siteId: site.id,
      maxDepth: input.maxDepth ?? 3,
      maxPages: input.maxPages ?? 500,
      includePatterns: site.includePatterns,
      excludePatterns: site.excludePatterns,
    },
    opts,
  );

  return { id: sched.id };
}

// AC: alert if scan misses 2 consecutive runs.
export async function recordRun(
  prisma: Prisma,
  scheduleId: string,
  status: 'success' | 'failed',
): Promise<void> {
  if (status === 'failed') {
    const s = await prisma.scheduledScan.findUnique({ where: { id: scheduleId } });
    const next = (s?.consecutiveFailures ?? 0) + 1;
    await prisma.scheduledScan.update({
      where: { id: scheduleId },
      data: { consecutiveFailures: next, lastRunAt: new Date() },
    });
    if (next >= 2) {
      // Caller hooks notifications here (Slack/Teams via T-046).
      console.warn(`[scheduler] schedule ${scheduleId} failed ${next} times in a row`);
    }
  } else {
    await prisma.scheduledScan.update({
      where: { id: scheduleId },
      data: { consecutiveFailures: 0, lastRunAt: new Date() },
    });
  }
}
