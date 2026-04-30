import { describe, it, expect } from 'vitest';
import { bfsTraverse, shouldCrawl } from '../src/scan/crawler.js';
import { diffViolations } from '../src/scan/diff.js';

describe('TC-010 crawler discovers all linked pages within depth', () => {
  it('crawls index + 3 sub-pages at depth 2; skips depth-3 page', async () => {
    const PAGES: Record<string, { links: string[]; spaRoutes: string[] }> = {
      'https://e.com/': {
        links: ['https://e.com/a', 'https://e.com/b', 'https://e.com/c'],
        spaRoutes: [],
      },
      'https://e.com/a': { links: ['https://e.com/a/deeper'], spaRoutes: [] },
      'https://e.com/b': { links: [], spaRoutes: [] },
      'https://e.com/c': { links: [], spaRoutes: [] },
      'https://e.com/a/deeper': { links: [], spaRoutes: [] },
    };
    const result = await bfsTraverse(
      'https://e.com/',
      1,
      100,
      { include: [], exclude: [] },
      async (url) => ({
        url,
        links: PAGES[url]?.links ?? [],
        spaRoutes: PAGES[url]?.spaRoutes ?? [],
      }),
    );
    expect(result.visited.sort()).toEqual([
      'https://e.com/',
      'https://e.com/a',
      'https://e.com/b',
      'https://e.com/c',
    ]);
  });

  it('respects maxPages cap', async () => {
    const result = await bfsTraverse(
      'https://e.com/',
      99,
      2,
      { include: [], exclude: [] },
      async (url) => ({ url, links: ['https://e.com/' + Math.random()], spaRoutes: [] }),
    );
    expect(result.visited.length).toBe(2);
  });

  it('discovers SPA routes alongside <a href> links', async () => {
    const result = await bfsTraverse(
      'https://e.com/',
      2,
      50,
      { include: [], exclude: [] },
      async (url) => {
        if (url === 'https://e.com/')
          return { url, links: [], spaRoutes: ['https://e.com/spa-route'] };
        return { url, links: [], spaRoutes: [] };
      },
    );
    expect(result.visited).toContain('https://e.com/spa-route');
  });
});

describe('T-033 scope filters', () => {
  const filters = { include: [], exclude: [/\/admin\//, /\/logout$/] };
  it('skips excluded URLs', () => {
    expect(shouldCrawl('https://e.com/admin/foo', 'https://e.com', filters)).toBe(false);
    expect(shouldCrawl('https://e.com/logout', 'https://e.com', filters)).toBe(false);
  });
  it('keeps non-excluded URLs', () => {
    expect(shouldCrawl('https://e.com/dashboard', 'https://e.com', filters)).toBe(true);
  });
  it('rejects cross-origin URLs even without exclude pattern', () => {
    expect(shouldCrawl('https://other.com/', 'https://e.com', filters)).toBe(false);
  });
});

describe('TC-011 new vs existing violation diff', () => {
  it('classifies new / persisting / fixed', () => {
    const baseline = [
      { ruleId: 'image-alt', selector: 'img.logo', pageUrl: 'https://e.com/' },
      { ruleId: 'image-alt', selector: 'img.hero', pageUrl: 'https://e.com/' },
      { ruleId: 'color-contrast', selector: 'p.lede', pageUrl: 'https://e.com/' },
      { ruleId: 'label', selector: '#email', pageUrl: 'https://e.com/login' },
      { ruleId: 'label', selector: '#pwd', pageUrl: 'https://e.com/login' },
    ];
    const current = [
      // 3 persisting (logo, color-contrast, email)
      { ruleId: 'image-alt', selector: 'img.logo', pageUrl: 'https://e.com/' },
      { ruleId: 'color-contrast', selector: 'p.lede', pageUrl: 'https://e.com/' },
      { ruleId: 'label', selector: '#email', pageUrl: 'https://e.com/login' },
      // 1 new
      { ruleId: 'button-name', selector: 'button.signup', pageUrl: 'https://e.com/' },
    ];
    const r = diffViolations(current, baseline);
    expect(r.persisting.length).toBe(3);
    expect(r.fixed.length).toBe(2);
    expect(r.newViolations.length).toBe(1);
    expect(r.newViolations[0]?.ruleId).toBe('button-name');
  });
});
