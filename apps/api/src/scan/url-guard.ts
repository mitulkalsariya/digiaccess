// S-2: SSRF guard. Run on every URL the worker is about to fetch on behalf of
// a user (POST /v1/scans, crawler seeds). Three layers:
//   1. Scheme allowlist — only http/https.
//   2. Private-network block — refuse loopback, RFC1918, link-local, IPv6 ULAs,
//      cloud metadata endpoints (169.254.169.254 + IMDSv2 + GCP/Azure variants).
//   3. Optional config-driven allowlist — when SCAN_URL_ALLOWLIST is set the
//      hostname must match one of the patterns (suffix or wildcard).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface UrlGuardResult {
  ok: boolean;
  reason?: string;
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

// IPv4 ranges to block (CIDR strings).
const BLOCKED_IPV4: ReadonlyArray<[number, number]> = [
  cidrToRange('0.0.0.0/8'), // "this network"
  cidrToRange('10.0.0.0/8'), // RFC1918
  cidrToRange('100.64.0.0/10'), // CGNAT
  cidrToRange('127.0.0.0/8'), // loopback
  cidrToRange('169.254.0.0/16'), // link-local + cloud metadata
  cidrToRange('172.16.0.0/12'), // RFC1918
  cidrToRange('192.0.0.0/24'), // IETF
  cidrToRange('192.0.2.0/24'), // TEST-NET
  cidrToRange('192.168.0.0/16'), // RFC1918
  cidrToRange('198.18.0.0/15'), // benchmarking
  cidrToRange('198.51.100.0/24'), // TEST-NET-2
  cidrToRange('203.0.113.0/24'), // TEST-NET-3
  cidrToRange('224.0.0.0/4'), // multicast
  cidrToRange('240.0.0.0/4'), // reserved
];

function cidrToRange(cidr: string): [number, number] {
  const [ip, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const base = ipv4ToNumber(ip!);
  // Bitwise ops on 32-bit ints can produce signed values for high-bit
  // addresses; force unsigned with `>>> 0` so the [lo, hi] range stays in the
  // 0..2^32-1 number space that callers compare against.
  const blockSize = bits === 32 ? 1 : 2 ** (32 - bits);
  const mask = bits === 0 ? 0 : ~((1 << (32 - bits)) - 1) >>> 0;
  const lo = (base & mask) >>> 0;
  const hi = lo + blockSize - 1;
  return [lo, hi];
}

function ipv4ToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToNumber(ip);
  return BLOCKED_IPV4.some(([lo, hi]) => n >= lo && n <= hi);
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Loopback / unspecified
  if (lower === '::1' || lower === '::') return true;
  // Link-local fe80::/10 — first 10 bits 1111 1110 10xx → first hextet 0xfe80–0xfebf.
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true;
  // Unique-local fc00::/7 → first hextet 0xfc.. or 0xfd..
  if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return true;
  // IPv4-mapped, decimal form: ::ffff:127.0.0.1
  const decForm = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (decForm) return isBlockedIPv4(decForm[1]!);
  // IPv4-mapped, canonical hex form: ::ffff:7f00:1 (what new URL() emits).
  const hexForm = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hexForm) {
    const hi = parseInt(hexForm[1]!, 16);
    const lo = parseInt(hexForm[2]!, 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    return isBlockedIPv4(`${a}.${b}.${c}.${d}`);
  }
  return false;
}

// Pattern is "https://*.foo.com" or "https://exact.host.com"; suffix-match the
// hostname after the scheme. Empty patterns array = allow any public host.
function matchesAllowlist(parsed: URL, patterns: ReadonlyArray<string>): boolean {
  if (patterns.length === 0) return true;
  for (const raw of patterns) {
    let p: URL;
    try {
      p = new URL(raw.replace('*.', 'wildcard.'));
    } catch {
      continue;
    }
    if (p.protocol !== parsed.protocol) continue;
    const patternHost = p.hostname;
    if (raw.includes('://*.')) {
      // suffix match (e.g. "https://*.company.com" matches "a.company.com" + "company.com")
      const suffix = patternHost.replace(/^wildcard\./, '');
      if (parsed.hostname === suffix || parsed.hostname.endsWith('.' + suffix)) return true;
    } else if (parsed.hostname === patternHost) {
      return true;
    }
  }
  return false;
}

export interface CheckOptions {
  allowlist?: ReadonlyArray<string>;
  // When true, skip DNS resolution (used in tests). Production callers should
  // always leave this false so the IP-range check has its inputs.
  skipDns?: boolean;
}

export async function checkScanUrl(url: string, opts: CheckOptions = {}): Promise<UrlGuardResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, reason: 'scheme-not-allowed' };
  }

  // Reject embedded credentials in the URL — these are routinely abused for
  // SSRF (http://internal:9200@public.example/...) and the page they actually
  // load is the value of `username` not `host`.
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials-in-url-not-allowed' };
  }

  // Hostname must not itself be a blocked literal IP. Node's URL parser keeps
  // the brackets on bracketed IPv6 hostnames, so strip them before isIP().
  const hostNoBrackets =
    parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
  const ipKind = isIP(hostNoBrackets);
  if (ipKind === 4 && isBlockedIPv4(hostNoBrackets)) {
    return { ok: false, reason: 'private-or-reserved-ip' };
  }
  if (ipKind === 6 && isBlockedIPv6(hostNoBrackets)) {
    return { ok: false, reason: 'private-or-reserved-ip' };
  }

  // For hostnames, resolve and check every record.
  if (ipKind === 0 && !opts.skipDns) {
    let addresses: { address: string; family: number }[];
    try {
      addresses = await lookup(hostNoBrackets, { all: true });
    } catch {
      return { ok: false, reason: 'dns-resolution-failed' };
    }
    for (const a of addresses) {
      if (a.family === 4 && isBlockedIPv4(a.address)) {
        return { ok: false, reason: 'private-or-reserved-ip' };
      }
      if (a.family === 6 && isBlockedIPv6(a.address)) {
        return { ok: false, reason: 'private-or-reserved-ip' };
      }
    }
  }

  if (opts.allowlist && opts.allowlist.length > 0 && !matchesAllowlist(parsed, opts.allowlist)) {
    return { ok: false, reason: 'host-not-on-allowlist' };
  }

  return { ok: true };
}
