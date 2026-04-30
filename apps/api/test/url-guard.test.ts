import { describe, it, expect } from 'vitest';
import { checkScanUrl } from '../src/scan/url-guard.js';

describe('S-2 SSRF guard', () => {
  it('allows public https hosts (skipDns to keep tests offline)', async () => {
    const r = await checkScanUrl('https://example.com/path', { skipDns: true });
    expect(r.ok).toBe(true);
  });

  it('rejects unsupported schemes', async () => {
    expect((await checkScanUrl('file:///etc/passwd', { skipDns: true })).ok).toBe(false);
    expect((await checkScanUrl('ftp://example.com', { skipDns: true })).ok).toBe(false);
    expect((await checkScanUrl('javascript:alert(1)', { skipDns: true })).ok).toBe(false);
    expect((await checkScanUrl('gopher://internal:9000', { skipDns: true })).ok).toBe(false);
  });

  it('rejects URLs with embedded credentials', async () => {
    const r = await checkScanUrl('http://internal:9200@public.example.com/', {
      skipDns: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('credentials-in-url-not-allowed');
  });

  it('rejects literal IPv4 in private/reserved ranges', async () => {
    const cases = [
      'http://127.0.0.1/',
      'http://0.0.0.0/',
      'http://10.0.0.5/',
      'http://172.16.0.1/',
      'http://192.168.1.1/',
      'http://100.64.0.1/', // CGNAT
      // AWS / GCP / Azure instance metadata:
      'http://169.254.169.254/latest/meta-data/',
      'http://169.254.169.253/',
    ];
    for (const u of cases) {
      const r = await checkScanUrl(u, { skipDns: true });
      expect(r.ok, u).toBe(false);
      expect(r.reason, u).toBe('private-or-reserved-ip');
    }
  });

  it('rejects literal IPv6 loopback / link-local / unique-local', async () => {
    const cases = ['http://[::1]/', 'http://[fe80::1]/', 'http://[fd00::1]/'];
    for (const u of cases) {
      const r = await checkScanUrl(u, { skipDns: true });
      expect(r.ok, u).toBe(false);
    }
  });

  it('rejects IPv4-mapped IPv6 pointing at private ranges', async () => {
    const r = await checkScanUrl('http://[::ffff:127.0.0.1]/', { skipDns: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('private-or-reserved-ip');
  });

  it('honors the allowlist when supplied', async () => {
    const allow = ['https://*.company.com'];
    expect(
      (await checkScanUrl('https://app.company.com/', { allowlist: allow, skipDns: true })).ok,
    ).toBe(true);
    expect(
      (await checkScanUrl('https://company.com/', { allowlist: allow, skipDns: true })).ok,
    ).toBe(true);
    const blocked = await checkScanUrl('https://evil.com/', {
      allowlist: allow,
      skipDns: true,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('host-not-on-allowlist');
  });

  it('exact-host allowlist matches only the host, not subdomains', async () => {
    const allow = ['https://exact.company.com'];
    expect(
      (await checkScanUrl('https://exact.company.com/', { allowlist: allow, skipDns: true })).ok,
    ).toBe(true);
    expect(
      (await checkScanUrl('https://other.company.com/', { allowlist: allow, skipDns: true })).ok,
    ).toBe(false);
  });

  it('rejects garbage strings', async () => {
    const r = await checkScanUrl('not a url', { skipDns: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid-url');
  });
});
