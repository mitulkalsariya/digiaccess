import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../db.js';
import type { Redis } from '../redis.js';
import type { AppConfig } from '../config.js';
import {
  discoverOidc,
  generateState,
  generateNonce,
  generateCodeVerifier,
  codeChallengeFromVerifier,
  type OidcDeps,
} from '../auth/oidc.js';
import { buildClaims, mapGroupsToTeams } from '../auth/jwt.js';
import { createRefreshTokenStore } from '../auth/refresh-tokens.js';

export interface AuthRouteDeps {
  prisma: Prisma;
  redis: Redis;
  config: AppConfig;
}

const SSO_STATE_TTL = 10 * 60; // 10 min

export async function registerAuthRoutes(
  app: FastifyInstance,
  { prisma, redis, config }: AuthRouteDeps,
): Promise<void> {
  const refreshStore = createRefreshTokenStore(redis, config.credentialEncryptionKey);

  let oidc: OidcDeps | null = null;
  const getOidc = async (): Promise<OidcDeps> => {
    if (!oidc) oidc = await discoverOidc(config.sso);
    return oidc;
  };

  // S-6: per-route override on auth endpoints — much tighter than the global
  // limit. Defends against IdP loop abuse, brute-force on stolen refresh ids,
  // and credential-stuffing via the form-auth endpoint.
  const AUTH_ROUTE_LIMIT = { rateLimit: { max: 10, timeWindow: 60_000 } };

  // GET /auth/login → redirect to IdP
  app.get('/auth/login', { config: AUTH_ROUTE_LIMIT }, async (_req, reply) => {
    const o = await getOidc();
    const state = generateState();
    const nonce = generateNonce();
    const verifier = generateCodeVerifier();
    const challenge = codeChallengeFromVerifier(verifier);

    await redis.set(
      `auth:state:${state}`,
      JSON.stringify({ verifier, nonce }),
      'EX',
      SSO_STATE_TTL,
    );

    const url = o.buildAuthUrl(state, challenge, nonce);
    reply.redirect(url);
  });

  // GET /auth/callback?code=...&state=...
  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/auth/callback',
    { config: AUTH_ROUTE_LIMIT },
    async (req, reply) => {
      const { code, state } = req.query;
      if (!code || !state) return reply.code(400).send({ error: 'missing-code-or-state' });

      const stash = await redis.get(`auth:state:${state}`);
      if (!stash) return reply.code(400).send({ error: 'invalid-or-expired-state' });
      await redis.del(`auth:state:${state}`);
      const { verifier, nonce } = JSON.parse(stash) as { verifier: string; nonce: string };

      const o = await getOidc();
      const tokenSet = await o.client.callback(
        config.sso.redirectUri,
        { code, state },
        { state, nonce, code_verifier: verifier },
      );
      const claimsRaw = tokenSet.claims();

      const email = String(claimsRaw['email'] ?? '');
      const name = String(claimsRaw['name'] ?? email);
      const sub = String(claimsRaw['sub']);
      const groups = (claimsRaw[config.sso.groupsClaim] as string[] | undefined) ?? [];

      // Upsert user
      const user = await prisma.user.upsert({
        where: { ssoSubject: sub },
        update: { email, name, lastLoginAt: new Date() },
        create: { email, name, ssoSubject: sub, lastLoginAt: new Date() },
      });

      const teamIds = mapGroupsToTeams(groups, config.sso.groupToTeamMap);
      // Sync membership: add missing, leave existing alone (admins manage manually).
      for (const teamId of teamIds) {
        await prisma.teamMembership.upsert({
          where: { teamId_userId: { teamId, userId: user.id } },
          update: {},
          create: { teamId, userId: user.id, role: 'member' },
        });
      }

      const accessClaims = buildClaims(
        { userId: user.id, email, name, teamIds },
        config.jwtAccessTtlSec,
      );
      const accessToken = app.jwt.sign(accessClaims);
      // S-5: open a fresh refresh-token family on every login.
      const { id: refreshId } = await refreshStore.issueNewFamily(
        user.id,
        config.jwtRefreshTtlSec,
        tokenSet.refresh_token ?? '',
      );

      reply.setCookie('a11y_at', accessToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: config.jwtAccessTtlSec,
      });
      reply.setCookie('a11y_rt', refreshId, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        path: '/auth',
        maxAge: config.jwtRefreshTtlSec,
      });

      return { ok: true };
    },
  );

  // POST /auth/refresh — exchange refresh ID for a new access token.
  // S-5: replaying a previously-consumed token returns 401 *and* revokes the
  // entire family + every other family for that user. JWT sessions expire on
  // their own (8h); refresh families being revoked means no new access tokens.
  app.post('/auth/refresh', { config: AUTH_ROUTE_LIMIT }, async (req, reply) => {
    const r = req as typeof req & { cookies?: Record<string, string> };
    const id = r.cookies?.['a11y_rt'];
    if (!id) return reply.code(401).send({ error: 'no-refresh-token' });

    const consumed = await refreshStore.consume(id);
    if (!consumed.ok) {
      if (consumed.reason === 'reuse-detected') {
        // Hard sign-out everywhere for this user.
        await refreshStore.revokeAllForUser(consumed.userId);
        app.log.warn(
          { userId: consumed.userId, familyId: consumed.familyId },
          'refresh-token reuse detected; all sessions revoked',
        );
        return reply.code(401).send({ error: 'session-revoked' });
      }
      return reply.code(401).send({ error: 'invalid-refresh-token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: consumed.userId },
      include: { memberships: true },
    });
    if (!user) return reply.code(401).send({ error: 'user-not-found' });

    const teamIds = user.memberships.map((m) => m.teamId);
    const claims = buildClaims(
      { userId: user.id, email: user.email, name: user.name, teamIds },
      config.jwtAccessTtlSec,
    );
    const accessToken = app.jwt.sign(claims);
    // Issue a new token within the same family (continue the session).
    const newRefreshId = await refreshStore.issueInFamily(
      consumed.userId,
      consumed.familyId,
      config.jwtRefreshTtlSec,
      consumed.value,
    );

    reply.setCookie('a11y_at', accessToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: config.jwtAccessTtlSec,
    });
    reply.setCookie('a11y_rt', newRefreshId, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/auth',
      maxAge: config.jwtRefreshTtlSec,
    });

    return { ok: true, accessToken };
  });

  // POST /auth/logout
  app.post('/auth/logout', async (req, reply) => {
    const r = req as typeof req & { cookies?: Record<string, string> };
    const id = r.cookies?.['a11y_rt'];
    if (id) await refreshStore.revoke(id);
    reply.clearCookie('a11y_at', { path: '/' });
    reply.clearCookie('a11y_rt', { path: '/auth' });
    return { ok: true };
  });

  // GET /auth/me — auth check + claims echo
  app.get('/auth/me', { preHandler: app.requireAuth }, async (req) => req.user);
}
