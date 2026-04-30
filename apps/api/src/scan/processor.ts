import type { Job } from 'bullmq';
import type { Prisma } from '../db.js';
import { runSinglePageScan } from './runner.js';
import type { SinglePageScanJob } from './queue.js';

export function makeSinglePageProcessor(prisma: Prisma) {
  return async (job: Job<SinglePageScanJob>): Promise<{ violations: number }> => {
    const { scanId, url, viewports } = job.data;

    await prisma.scan.update({
      where: { id: scanId },
      data: { status: 'running', startedAt: new Date() },
    });

    try {
      const result = await runSinglePageScan({
        url,
        ...(viewports && viewports.length > 0 ? { viewports } : {}),
      });

      await prisma.$transaction(async (tx) => {
        for (const v of result.violations) {
          await tx.violation.create({
            data: {
              scanId,
              ruleId: v.ruleId,
              wcagSc: v.wcag.sc,
              wcagLevel: v.wcag.level,
              wcagVersion: v.wcag.version,
              severity: v.severity,
              confidence: v.confidence,
              sources: v.sources,
              message: v.message,
              ...(v.helpUrl ? { helpUrl: v.helpUrl } : {}),
              pageUrl: v.pageUrl,
              selector: v.nodes[0]?.selector ?? '',
              ...(v.nodes[0]?.html ? { htmlSnippet: v.nodes[0].html } : {}),
              ...(v.viewport ? { viewport: v.viewport } : {}),
            },
          });
        }
        await tx.scan.update({
          where: { id: scanId },
          data: {
            status: 'completed',
            completedAt: new Date(),
            pagesScanned: result.pagesScanned,
          },
        });
      });

      return { violations: result.violations.length };
    } catch (err) {
      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  };
}
