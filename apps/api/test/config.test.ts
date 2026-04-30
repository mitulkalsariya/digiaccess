import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { loadConfig } from '../src/config.js';

const ENV_KEYS = [
  'NODE_ENV',
  'JWT_SECRET',
  'CRED_ENCRYPTION_KEY',
  'DATABASE_URL',
  'REDIS_URL',
  'TRUST_PROXY',
  'SCAN_URL_ALLOWLIST',
  'SSO_GROUP_TEAM_MAP',
];

describe('S-1 production secrets fail-fast', () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('refuses to boot in production when JWT_SECRET is unset', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CRED_ENCRYPTION_KEY'] = 'b'.repeat(44);
    process.env['DATABASE_URL'] = 'postgres://prod';
    process.env['REDIS_URL'] = 'rediss://prod';
    expect(() => loadConfig()).toThrow(/JWT_SECRET/);
  });

  it('refuses to boot in production when known dev fallback is in use', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'dev-only-jwt-secret-change-me-32bytes';
    process.env['CRED_ENCRYPTION_KEY'] = 'b'.repeat(44);
    process.env['DATABASE_URL'] = 'postgres://prod';
    process.env['REDIS_URL'] = 'rediss://prod';
    expect(() => loadConfig()).toThrow(/known dev secret/);
  });

  it('refuses to boot in production with too-short JWT_SECRET', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'short';
    process.env['CRED_ENCRYPTION_KEY'] = 'b'.repeat(44);
    process.env['DATABASE_URL'] = 'postgres://prod';
    process.env['REDIS_URL'] = 'rediss://prod';
    expect(() => loadConfig()).toThrow(/at least 32/);
  });

  it('boots fine in development with no env set (uses dev fallbacks)', () => {
    process.env['NODE_ENV'] = 'development';
    const c = loadConfig();
    expect(c.jwtSecret.length).toBeGreaterThan(0);
    expect(c.databaseUrl).toContain('127.0.0.1');
  });

  it('parses TRUST_PROXY into boolean / cidr list', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['TRUST_PROXY'] = 'true';
    expect(loadConfig().trustProxy).toBe(true);
    process.env['TRUST_PROXY'] = '10.0.0.0/8, 192.168.0.0/16';
    expect(loadConfig().trustProxy).toEqual(['10.0.0.0/8', '192.168.0.0/16']);
    delete process.env['TRUST_PROXY'];
    expect(loadConfig().trustProxy).toBe(false);
  });

  it('parses SCAN_URL_ALLOWLIST into trimmed entries', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['SCAN_URL_ALLOWLIST'] = 'https://*.company.com, https://staging.example.com';
    expect(loadConfig().scanUrlAllowlist).toEqual([
      'https://*.company.com',
      'https://staging.example.com',
    ]);
  });
});
