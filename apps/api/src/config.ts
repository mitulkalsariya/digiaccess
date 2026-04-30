import { readFileSync } from 'node:fs';

export interface AppConfig {
  port: number;
  host: string;
  logLevel: string;
  nodeEnv: 'development' | 'production' | 'test';
  databaseUrl: string;
  redisUrl: string;
  version: string;
  jwtSecret: string;
  jwtAccessTtlSec: number;
  jwtRefreshTtlSec: number;
  sso: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    groupsClaim: string;
    groupToTeamMap: Record<string, string>;
  };
  credentialEncryptionKey: string; // 32-byte base64
  kmsKeyArn?: string; // when set, the vault uses KMS envelope encryption
  trustProxy: boolean | string | string[]; // explicit list in prod
  rateLimit: { defaultMax: number; defaultWindowMs: number };
  // S-2: SSRF allowlist of permitted scheme + hostname suffixes (empty = allow all public IPs).
  scanUrlAllowlist: string[]; // e.g. ['https://*.company.com']
  // S-23: cap on AuditLog.metadata size to prevent log-bombing.
  auditLogMetadataMaxBytes: number;
}

// Sentinels for development-only fallbacks. If any of these slips into a prod
// boot we fail loudly rather than silently using a known value (S-1).
const DEV_FALLBACK_JWT_SECRET = 'dev-only-jwt-secret-change-me-32bytes';
const DEV_FALLBACK_CRED_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const DEV_FALLBACK_DB_URL = 'postgres://a11y:a11y_dev_only@127.0.0.1:5432/a11y';
const DEV_FALLBACK_REDIS_URL = 'redis://:a11y_dev_only@127.0.0.1:6379';

const PROD_FORBIDDEN_DEFAULTS = new Set<string>([
  DEV_FALLBACK_JWT_SECRET,
  DEV_FALLBACK_CRED_KEY,
  DEV_FALLBACK_DB_URL,
  DEV_FALLBACK_REDIS_URL,
]);

function required(name: string, value: string): string {
  if (value === '') throw new Error(`Missing required env var: ${name}`);
  return value;
}

function readEnvOrDevFallback(name: string, devFallback: string, isProd: boolean): string {
  // S-24: prefer NAME_FILE (read from disk) over NAME (env var). File-mounted
  // secrets don't show up in /proc/<pid>/environ or core dumps.
  const fileVar = process.env[`${name}_FILE`];
  if (fileVar) {
    try {
      return readFileSync(fileVar, 'utf8').trim();
    } catch (err) {
      throw new Error(
        `${name}_FILE points to ${fileVar} but the file is not readable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (isProd) {
    throw new Error(
      `Refusing to start: ${name} is not set and the dev fallback would be ` +
        `used in production. Inject this value from your secrets store before boot.`,
    );
  }
  return devFallback;
}

function parseTrustProxy(raw: string | undefined): boolean | string | string[] {
  // Accepted: empty (default false), "true", "false", or comma-separated CIDRs.
  if (!raw || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env['NODE_ENV'] ?? 'development') as AppConfig['nodeEnv'];
  const isProd = nodeEnv === 'production';

  let groupToTeamMap: Record<string, string> = {};
  const groupRaw = process.env['SSO_GROUP_TEAM_MAP'];
  if (groupRaw) {
    try {
      groupToTeamMap = JSON.parse(groupRaw) as Record<string, string>;
    } catch {
      throw new Error('SSO_GROUP_TEAM_MAP must be valid JSON');
    }
  }

  const jwtSecret = readEnvOrDevFallback('JWT_SECRET', DEV_FALLBACK_JWT_SECRET, isProd);
  const credKey = readEnvOrDevFallback('CRED_ENCRYPTION_KEY', DEV_FALLBACK_CRED_KEY, isProd);
  const databaseUrl = readEnvOrDevFallback('DATABASE_URL', DEV_FALLBACK_DB_URL, isProd);
  const redisUrl = readEnvOrDevFallback('REDIS_URL', DEV_FALLBACK_REDIS_URL, isProd);

  // Belt-and-braces: even if a caller passed in a known dev value via env, refuse.
  if (isProd) {
    for (const v of [jwtSecret, credKey, databaseUrl, redisUrl]) {
      if (PROD_FORBIDDEN_DEFAULTS.has(v)) {
        throw new Error(
          'Refusing to start: a known dev secret is in use in production. ' +
            'Rotate the value and inject from your secrets store.',
        );
      }
    }
    if (jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production');
    }
  }

  const allowlistRaw = process.env['SCAN_URL_ALLOWLIST'] ?? '';
  const scanUrlAllowlist = allowlistRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    port: Number(process.env['PORT'] ?? 3001),
    host: process.env['HOST'] ?? '0.0.0.0',
    logLevel: process.env['LOG_LEVEL'] ?? (isProd ? 'info' : 'debug'),
    nodeEnv,
    databaseUrl: required('DATABASE_URL', databaseUrl),
    redisUrl: required('REDIS_URL', redisUrl),
    version: process.env['APP_VERSION'] ?? '0.1.0-dev',
    jwtSecret,
    jwtAccessTtlSec: Number(process.env['JWT_ACCESS_TTL_SEC'] ?? 8 * 60 * 60),
    jwtRefreshTtlSec: Number(process.env['JWT_REFRESH_TTL_SEC'] ?? 30 * 24 * 60 * 60),
    sso: {
      issuer: process.env['SSO_ISSUER'] ?? '',
      clientId: process.env['SSO_CLIENT_ID'] ?? '',
      clientSecret: process.env['SSO_CLIENT_SECRET'] ?? '',
      redirectUri: process.env['SSO_REDIRECT_URI'] ?? 'http://localhost:3001/auth/callback',
      groupsClaim: process.env['SSO_GROUPS_CLAIM'] ?? 'groups',
      groupToTeamMap,
    },
    credentialEncryptionKey: credKey,
    kmsKeyArn: process.env['KMS_KEY_ARN'] ?? undefined,
    trustProxy: parseTrustProxy(process.env['TRUST_PROXY']), // S-8: explicit, default off
    rateLimit: {
      defaultMax: Number(process.env['RATE_LIMIT_MAX'] ?? 100),
      defaultWindowMs: Number(process.env['RATE_LIMIT_WINDOW_MS'] ?? 60_000),
    },
    scanUrlAllowlist,
    auditLogMetadataMaxBytes: Number(process.env['AUDIT_LOG_METADATA_MAX_BYTES'] ?? 16_384),
  };
}
