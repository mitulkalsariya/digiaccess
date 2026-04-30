// S-19: defence-in-depth CSRF protection.
//
// Threat model: even with `sameSite: 'lax'` cookies, GET-with-side-effects and
// some HTML form quirks can still drive cross-site requests with the user's
// cookie attached. Anything cookie-authenticated that mutates state must
// additionally present a header that an attacker on a third-party origin
// cannot set without CORS — `x-a11y-csrf` matched against a per-session token.
//
// Bearer-authenticated requests skip the check entirely (Authorization headers
// can't be forged from another origin without CORS).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const CSRF_COOKIE = 'a11y_csrf';
const CSRF_HEADER = 'x-a11y-csrf';
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function registerCsrfProtection(app: FastifyInstance): Promise<void> {
  // Issue a CSRF cookie on every request that doesn't already have one. The
  // cookie is readable to JavaScript (NOT httpOnly) so the dashboard can copy
  // it into the header — that's the whole double-submit pattern.
  app.addHook('onRequest', async (req, reply) => {
    const r = req as FastifyRequest & { cookies?: Record<string, string> };
    if (!r.cookies?.[CSRF_COOKIE]) {
      const token = newToken();
      reply.setCookie(CSRF_COOKIE, token, {
        httpOnly: false,
        secure: req.protocol === 'https',
        sameSite: 'lax',
        path: '/',
      });
    }
  });

  // Enforce on state-changing methods that aren't using a Bearer token.
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!STATE_CHANGING_METHODS.has(req.method)) return;
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return; // Bearer can't be set cross-origin
    const r = req as FastifyRequest & { cookies?: Record<string, string> };
    const cookie = r.cookies?.[CSRF_COOKIE];
    const header = req.headers[CSRF_HEADER] as string | undefined;
    if (!cookie || !header || !tokensMatch(cookie, header)) {
      reply.code(403).send({ error: 'csrf-token-missing-or-invalid' });
    }
  });
}
