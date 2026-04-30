import { randomBytes } from 'node:crypto';
import type { AppConfig } from '../src/config.js';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    logLevel: 'silent',
    nodeEnv: 'test',
    databaseUrl: 'postgres://x',
    redisUrl: 'redis://x',
    version: 't',
    jwtSecret: 'a'.repeat(32),
    jwtAccessTtlSec: 60,
    jwtRefreshTtlSec: 3600,
    sso: {
      issuer: '',
      clientId: '',
      clientSecret: '',
      redirectUri: '',
      groupsClaim: 'groups',
      groupToTeamMap: {},
    },
    credentialEncryptionKey: randomBytes(32).toString('base64'),
    trustProxy: false,
    rateLimit: { defaultMax: 100, defaultWindowMs: 60_000 },
    scanUrlAllowlist: [],
    auditLogMetadataMaxBytes: 16_384,
    ...overrides,
  };
}
