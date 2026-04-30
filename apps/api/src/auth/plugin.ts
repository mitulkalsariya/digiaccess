import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import jwtPlugin from '@fastify/jwt';
import cookiePlugin from '@fastify/cookie';
import type { JwtClaims } from '@a11y/shared-types';
import type { AppConfig } from '../config.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtClaims;
    user: JwtClaims;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: JwtClaims;
  }
}

export async function registerAuth(app: FastifyInstance, config: AppConfig): Promise<void> {
  await app.register(cookiePlugin);
  await app.register(jwtPlugin, {
    secret: config.jwtSecret,
    sign: { expiresIn: `${config.jwtAccessTtlSec}s` },
    verify: { extractToken: (req) => extractToken(req) },
  });

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      const message =
        code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' || code === 'FAST_JWT_EXPIRED'
          ? 'token-expired'
          : 'unauthorized';
      reply.code(401).send({ error: message });
    }
  });
}

function extractToken(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  const cookie = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies?.[
    'a11y_at'
  ];
  return cookie;
}
