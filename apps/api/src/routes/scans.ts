import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import type { Prisma } from '../db.js';
import type { SinglePageScanJob } from '../scan/queue.js';
import { checkScanUrl } from '../scan/url-guard.js';

export interface ScansRouteDeps {
  prisma: Prisma;
  scanQueue: Queue<SinglePageScanJob>;
  // S-2: SSRF allowlist (empty array = block private IPs but allow any public host).
  scanUrlAllowlist?: ReadonlyArray<string>;
}

export async function registerScansRoutes(
  app: FastifyInstance,
  { prisma, scanQueue, scanUrlAllowlist }: ScansRouteDeps,
): Promise<void> {
  // POST /v1/scans — enqueue a scan
  app.post<{
    Body: {
      url: string;
      siteId?: string;
      viewports?: Array<'mobile' | 'tablet' | 'desktop'>;
      isPrivate?: boolean;
    };
  }>(
    '/v1/scans',
    {
      preHandler: app.requireAuth,
      schema: {
        body: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', format: 'uri', minLength: 1 },
            siteId: { type: 'string', format: 'uuid' },
            viewports: {
              type: 'array',
              items: { enum: ['mobile', 'tablet', 'desktop'] },
              uniqueItems: true,
            },
            isPrivate: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const { url, siteId, viewports, isPrivate } = req.body;
      const userId = req.user.sub;

      // S-2: SSRF guard — refuse private IPs, blocked schemes, allowlist mismatch.
      // In test mode skip DNS so unit tests don't need network access; the guard
      // still runs the literal-IP and scheme checks.
      const skipDns = process.env['NODE_ENV'] === 'test';
      const guard = await checkScanUrl(url, {
        ...(scanUrlAllowlist ? { allowlist: scanUrlAllowlist } : {}),
        skipDns,
      });
      if (!guard.ok) {
        return reply.code(400).send({ error: 'url-not-allowed', reason: guard.reason });
      }

      // Team ACL: if siteId is supplied, the user must be on the site's team.
      let teamId: string | undefined;
      if (siteId) {
        const site = await prisma.site.findUnique({ where: { id: siteId } });
        if (!site) return reply.code(404).send({ error: 'site-not-found' });
        if (!req.user.teams.includes(site.ownerTeamId)) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        teamId = site.ownerTeamId;
      }

      const scan = await prisma.scan.create({
        data: {
          url,
          ...(siteId ? { siteId } : {}),
          ...(teamId ? { teamId } : {}),
          type: 'single-page',
          status: 'queued',
          createdById: userId,
          isPrivate: isPrivate ?? false,
        },
      });

      await scanQueue.add('scan', {
        scanId: scan.id,
        url,
        ...(siteId ? { siteId } : {}),
        ...(viewports && viewports.length > 0 ? { viewports } : {}),
      });

      reply.code(202).send({ scan });
    },
  );

  // GET /v1/scans/:id — full scan + violations
  app.get<{ Params: { id: string } }>(
    '/v1/scans/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (req, reply) => {
      const scan = await prisma.scan.findUnique({
        where: { id: req.params.id },
        include: { violations: true },
      });
      if (!scan) return reply.code(404).send({ error: 'scan-not-found' });

      // ACL: creator always; team member only if not flagged isPrivate (S-9).
      const isCreator = scan.createdById === req.user.sub;
      const onTeam = scan.teamId ? req.user.teams.includes(scan.teamId) : false;
      const allowed = isCreator || (onTeam && !scan.isPrivate);
      if (!allowed) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      return scan;
    },
  );

  // GET /v1/scans?siteId=&cursor= — list, cursor-paginated
  app.get<{
    Querystring: { siteId?: string; cursor?: string; limit?: number };
  }>(
    '/v1/scans',
    {
      preHandler: app.requireAuth,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            siteId: { type: 'string', format: 'uuid' },
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
        },
      },
    },
    async (req) => {
      const { siteId, cursor, limit = 25 } = req.query;

      // Private scans only show up for the creator (S-9).
      const where: Record<string, unknown> = {
        OR: [{ teamId: { in: req.user.teams }, isPrivate: false }, { createdById: req.user.sub }],
      };
      if (siteId) where['siteId'] = siteId;

      const items = await prisma.scan.findMany({
        where: where as never,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
      });
      const hasMore = items.length > limit;
      const sliced = hasMore ? items.slice(0, limit) : items;
      return {
        items: sliced,
        nextCursor: hasMore ? (sliced[sliced.length - 1]?.id ?? null) : null,
      };
    },
  );
}
