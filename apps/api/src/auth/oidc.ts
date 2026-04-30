import { Issuer, type Client, generators } from 'openid-client';
import type { AppConfig } from '../config.js';

export interface OidcDeps {
  client: Client;
  buildAuthUrl: (state: string, codeChallenge: string, nonce: string) => string;
}

export async function discoverOidc(config: AppConfig['sso']): Promise<OidcDeps> {
  if (!config.issuer) {
    throw new Error('SSO_ISSUER not configured');
  }
  const issuer = await Issuer.discover(config.issuer);
  const client = new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.redirectUri],
    response_types: ['code'],
  });

  return {
    client,
    buildAuthUrl(state, codeChallenge, nonce) {
      return client.authorizationUrl({
        scope: 'openid profile email groups',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
    },
  };
}

export const generateState = (): string => generators.state();
export const generateNonce = (): string => generators.nonce();
export const generateCodeVerifier = (): string => generators.codeVerifier();
export const codeChallengeFromVerifier = (v: string): string => generators.codeChallenge(v);
