// S-4: extension auth using OAuth 2.1 code+PKCE.
//
// Flow:
//   1. Extension calls chrome.identity.launchWebAuthFlow() with the URL
//      `/auth/extension/start?redirect_uri=<chrome-extension-url>`
//   2. We redirect to the IdP with PKCE just like the cookie flow.
//   3. /auth/extension/callback receives the IdP's `code`, completes the
//      token exchange server-side, then redirects to the extension's
//      redirect_uri carrying a *one-time exchange code* in the fragment.
//   4. Extension's launchWebAuthFlow callback receives the redirect URL,
//      pulls the exchange code, and POSTs it to /auth/extension/exchange to
//      receive a JWT bearer token.
//
// This is OAuth 2.1 BCP-compliant: no implicit-flow tokens in fragments, no
// long-lived secrets in extension storage. The one-time exchange code lives
// 60 seconds in Redis.
import { randomUUID } from 'node:crypto';
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

export interface ExtensionAuthDeps {
  prisma: Prisma;
  redis: Redis;
  config: AppConfig;
}

const EXT_STATE_TTL = 10 * 60;
const EXT_EXCHANGE_TTL = 60; // one-time code lives 60s

// Strict allowlist for extension redirect URIs. Only chrome-extension:// URIs
// for the configured extension id, never anything else.
function isAllowedExtensionRedirect(redirectUri: string, extensionIdAllowlist: string[]): boolean {
  if (extensionIdAllowlist.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'chrome-extension:') return false;
  return extensionIdAllowlist.includes(parsed.hostname);
}

export async function registerExtensionAuthRoutes(
  app: FastifyInstance,
  { prisma, redis, config }: ExtensionAuthDeps,
): Promise<void> {
  let oidc: OidcDeps | null = null;
  const getOidc = async (): Promise<OidcDeps> => {
    if (!oidc) oidc = await discoverOidc(config.sso);
    return oidc;
  };

  const ROUTE_LIMIT = { rateLimit: { max: 10, timeWindow: 60_000 } };
  const allowed = (process.env['EXT_ID_ALLOWLIST'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // GET /auth/extension/start?redirect_uri=chrome-extension://<id>/...
  app.get<{ Querystring: { redirect_uri?: string } }>(
    '/auth/extension/start',
    { config: ROUTE_LIMIT },
    async (req, reply) => {
      const redirectUri = req.query.redirect_uri ?? '';
      if (!isAllowedExtensionRedirect(redirectUri, allowed)) {
        return reply.code(400).send({ error: 'redirect-uri-not-allowed' });
      }
      const state = generateState();
      const nonce = generateNonce();
      const verifier = generateCodeVerifier();
      const challenge = codeChallengeFromVerifier(verifier);
      await redis.set(
        `auth:ext:state:${state}`,
        JSON.stringify({ verifier, nonce, redirectUri }),
        'EX',
        EXT_STATE_TTL,
      );
      const o = await getOidc();
      reply.redirect(o.buildAuthUrl(state, challenge, nonce));
    },
  );

  // GET /auth/extension/callback?code=...&state=...
  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/auth/extension/callback',
    { config: ROUTE_LIMIT },
    async (req, reply) => {
      const { code, state } = req.query;
      if (!code || !state) return reply.code(400).send({ error: 'missing-code-or-state' });
      const stash = await redis.get(`auth:ext:state:${state}`);
      if (!stash) return reply.code(400).send({ error: 'invalid-or-expired-state' });
      await redis.del(`auth:ext:state:${state}`);
      const { verifier, nonce, redirectUri } = JSON.parse(stash) as {
        verifier: string;
        nonce: string;
        redirectUri: string;
      };
      // Re-validate redirect URI before sending the exchange code anywhere.
      if (!isAllowedExtensionRedirect(redirectUri, allowed)) {
        return reply.code(400).send({ error: 'redirect-uri-not-allowed' });
      }

      const o = await getOidc();
      const tokenSet = await o.client.callback(
        config.sso.redirectUri,
        { code, state },
        { state, nonce, code_verifier: verifier },
      );
      const claims = tokenSet.claims();
      const sub = String(claims['sub']);
      const email = String(claims['email'] ?? '');
      const name = String(claims['name'] ?? email);
      const groups = (claims[config.sso.groupsClaim] as string[] | undefined) ?? [];
      const user = await prisma.user.upsert({
        where: { ssoSubject: sub },
        update: { email, name, lastLoginAt: new Date() },
        create: { email, name, ssoSubject: sub, lastLoginAt: new Date() },
      });
      const teamIds = mapGroupsToTeams(groups, config.sso.groupToTeamMap);
      for (const teamId of teamIds) {
        await prisma.teamMembership.upsert({
          where: { teamId_userId: { teamId, userId: user.id } },
          update: {},
          create: { teamId, userId: user.id, role: 'member' },
        });
      }

      // Stash a single-use exchange code that maps to the issued JWT. Never put
      // the JWT itself in the URL fragment — that would re-introduce implicit-
      // flow risks (history, referer leakage on re-redirects, etc.).
      const exchangeCode = randomUUID();
      const accessToken = app.jwt.sign(
        buildClaims({ userId: user.id, email, name, teamIds }, config.jwtAccessTtlSec),
      );
      await redis.set(
        `auth:ext:exchange:${exchangeCode}`,
        JSON.stringify({ accessToken, userId: user.id }),
        'EX',
        EXT_EXCHANGE_TTL,
      );

      // The fragment carries only the *exchange code*, never the JWT.
      reply.redirect(`${redirectUri}#code=${encodeURIComponent(exchangeCode)}`);
    },
  );

  // POST /auth/extension/exchange { code }
  app.post<{ Body: { code: string } }>(
    '/auth/extension/exchange',
    {
      config: ROUTE_LIMIT,
      schema: {
        body: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', minLength: 16, maxLength: 128 } },
        },
      },
    },
    async (req, reply) => {
      const key = `auth:ext:exchange:${req.body.code}`;
      const raw = await redis.get(key);
      if (!raw) return reply.code(401).send({ error: 'invalid-or-used-code' });
      // Single-use: delete immediately.
      await redis.del(key);
      const { accessToken } = JSON.parse(raw) as { accessToken: string };
      return { accessToken };
    },
  );
}
