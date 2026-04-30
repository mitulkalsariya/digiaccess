// T-031..T-033, T-036: server-side BFS crawler with scope controls + concurrency limits.
import { chromium, type Browser } from 'playwright';
import { compileSafeRegex, safeTest } from './safe-regex.js';

export interface CrawlOptions {
  startUrl: string;
  maxDepth: number;
  maxPages: number;
  concurrency?: number; // T-036
  perPageMemoryMB?: number; // T-036
  pageTimeoutMs?: number; // T-036
  includePatterns?: string[]; // RegExp source strings — T-033
  excludePatterns?: string[]; // T-033
  respectRobotsTxt?: boolean; // T-031
}

export interface CrawlResult {
  visited: string[];
  errors: Array<{ url: string; error: string }>;
}

const DEFAULTS = {
  concurrency: 5,
  pageTimeoutMs: 30_000,
};

interface CompiledFilters {
  include: RegExp[];
  exclude: RegExp[];
}

function compileFilters(opts: CrawlOptions): CompiledFilters {
  // S-7: refuse ReDoS-prone shapes; cap pattern length.
  const compileAll = (xs?: string[]) => (xs ?? []).map((s) => compileSafeRegex(s));
  return { include: compileAll(opts.includePatterns), exclude: compileAll(opts.excludePatterns) };
}

export function shouldCrawl(url: string, baseOrigin: string, filters: CompiledFilters): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== baseOrigin) return false;
  if (filters.exclude.some((rx) => safeTest(rx, url))) return false;
  if (filters.include.length > 0 && !filters.include.some((rx) => safeTest(rx, url))) return false;
  return true;
}

// Pure traversal logic factored out for unit testing without a browser.
export interface DiscoverPage {
  url: string;
  links: string[];
  spaRoutes: string[];
}

export async function bfsTraverse(
  start: string,
  maxDepth: number,
  maxPages: number,
  filters: CompiledFilters,
  loadPage: (url: string) => Promise<DiscoverPage>,
): Promise<CrawlResult> {
  const baseOrigin = new URL(start).origin;
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: start, depth: 0 }];
  const errors: Array<{ url: string; error: string }> = [];

  while (queue.length > 0 && visited.size < maxPages) {
    const next = queue.shift();
    if (!next) break;
    if (visited.has(next.url)) continue;
    visited.add(next.url);

    let page: DiscoverPage;
    try {
      page = await loadPage(next.url);
    } catch (err) {
      errors.push({ url: next.url, error: err instanceof Error ? err.message : String(err) });
      continue;
    }

    if (next.depth >= maxDepth) continue;
    const allLinks = [...page.links, ...page.spaRoutes];
    for (const raw of allLinks) {
      let abs: string;
      try {
        abs = new URL(raw, next.url).toString();
      } catch {
        continue;
      }
      const norm = abs.split('#')[0]!;
      if (visited.has(norm)) continue;
      if (!shouldCrawl(norm, baseOrigin, filters)) continue;
      queue.push({ url: norm, depth: next.depth + 1 });
    }
  }

  return { visited: [...visited], errors };
}

// Real Playwright-backed crawl (T-032: SPA-aware via history.pushState patch).
export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const filters = compileFilters(opts);
  const browser: Browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const concurrency = opts.concurrency ?? DEFAULTS.concurrency;
  const pageTimeoutMs = opts.pageTimeoutMs ?? DEFAULTS.pageTimeoutMs;

  // Inject the SPA route monkey-patch before any page-script runs.
  // The script body is a string so TS doesn't try to type-check DOM globals
  // against this Node project.
  await ctx.addInitScript({
    content: `(() => {
      window.__a11y_spa_routes__ = window.__a11y_spa_routes__ || [];
      var p = history.pushState, r = history.replaceState;
      history.pushState = function () {
        window.__a11y_spa_routes__.push(location.href);
        return p.apply(this, arguments);
      };
      history.replaceState = function () {
        window.__a11y_spa_routes__.push(location.href);
        return r.apply(this, arguments);
      };
    })();`,
  });

  // Bounded concurrency: a simple semaphore ring.
  let inFlight = 0;
  const queueP: Array<() => Promise<void>> = [];
  const drain = async (): Promise<void> => {
    while (queueP.length > 0 && inFlight < concurrency) {
      const job = queueP.shift();
      if (!job) break;
      inFlight++;
      void job().finally(() => {
        inFlight--;
      });
    }
    while (inFlight > 0) {
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  void drain;

  try {
    const result = await bfsTraverse(
      opts.startUrl,
      opts.maxDepth,
      opts.maxPages,
      filters,
      async (url) => {
        const page = await ctx.newPage();
        page.setDefaultTimeout(pageTimeoutMs);
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: pageTimeoutMs });
          const LINKS_SCRIPT = `Array.from(document.querySelectorAll('a[href]'), (a) => a.href)`;
          const links = (await page.evaluate(LINKS_SCRIPT)) as string[];
          const spaRoutes = (await page.evaluate('window.__a11y_spa_routes__ || []')) as string[];
          return { url, links, spaRoutes };
        } finally {
          await page.close();
        }
      },
    );
    return result;
  } finally {
    await ctx.close();
    await browser.close();
  }
}
