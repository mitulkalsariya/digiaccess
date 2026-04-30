import { describe, it, expect } from 'vitest';
import { compileSafeRegex, UnsafeRegexError, safeTest } from '../src/scan/safe-regex.js';

describe('S-7 ReDoS-safe regex compiler', () => {
  it('compiles benign patterns', () => {
    const rx = compileSafeRegex('^/admin/');
    expect(rx.test('/admin/x')).toBe(true);
    expect(rx.test('/public')).toBe(false);
  });

  it('refuses classic catastrophic-backtracking shapes', () => {
    const evil = ['(a+)+$', '(a*)*$', '(.+)+$', '(a|a)+$', '(a|aa)+$'];
    for (const e of evil) {
      expect(() => compileSafeRegex(e), e).toThrow(UnsafeRegexError);
    }
  });

  it('refuses backreferences', () => {
    expect(() => compileSafeRegex('(a)\\1')).toThrow(UnsafeRegexError);
  });

  it('refuses overlong patterns', () => {
    expect(() => compileSafeRegex('a'.repeat(1024))).toThrow(/too long/);
  });

  it('safeTest caps input length to bound CPU', () => {
    const rx = compileSafeRegex('^[a-z]+$');
    // Even with a 100k-char input, this returns quickly.
    const start = Date.now();
    safeTest(rx, 'a'.repeat(100_000));
    expect(Date.now() - start).toBeLessThan(100);
  });
});
