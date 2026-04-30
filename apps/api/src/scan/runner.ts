import { chromium } from 'playwright';
import type { Violation } from '@a11y/shared-types';
import { runAxeOnPage } from './axe-engine.js';
import { runPa11yOnUrl } from './pa11y-engine.js';
import { mergeFindings } from './merge.js';
import { evaluateTargets, COLLECT_CANDIDATES_SCRIPT } from './rules/target-size.js';
import {
  evaluateFocusObscured,
  COLLECT_OBSCURERS_SCRIPT,
  type BBox,
} from './rules/focus-not-obscured.js';
import type { RawFinding } from './types.js';

export type Viewport = 'mobile' | 'tablet' | 'desktop';

export const VIEWPORT_SIZES: Record<Viewport, { width: number; height: number }> = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

export interface RunSinglePageOptions {
  url: string;
  viewports?: Viewport[];
  cookies?: Array<{ name: string; value: string; domain: string; path?: string }>;
  timeoutMs?: number;
  customRules?: { targetSize?: boolean; focusNotObscured?: boolean };
}

export interface RunSinglePageResult {
  violations: Violation[];
  pagesScanned: number;
  durationMs: number;
}

export async function runSinglePageScan(opts: RunSinglePageOptions): Promise<RunSinglePageResult> {
  const { url, viewports = ['desktop'], timeoutMs = 30_000 } = opts;
  const start = Date.now();

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const allViolations: Violation[] = [];

    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: VIEWPORT_SIZES[vp] });
      if (opts.cookies?.length) {
        await ctx.addCookies(
          opts.cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path ?? '/',
          })),
        );
      }
      const page = await ctx.newPage();
      page.setDefaultTimeout(timeoutMs);

      const findings: RawFinding[] = [];

      await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });

      // axe
      const axeResult = await runAxeOnPage(page, url);
      findings.push(...axeResult.findings);

      // custom: target size
      if (opts.customRules?.targetSize !== false) {
        const targetFindings = await runTargetSizeRule(page, url);
        findings.push(...targetFindings);
      }
      // custom: focus not obscured
      if (opts.customRules?.focusNotObscured !== false) {
        const focusFindings = await runFocusObscuredRule(page, url);
        findings.push(...focusFindings);
      }

      await ctx.close();

      // pa11y opens its own browser; share URL only.
      try {
        const pa11yResult = await runPa11yOnUrl(url);
        findings.push(...pa11yResult.findings);
      } catch (err) {
        // Pa11y-only failures shouldn't kill the scan.
        // eslint-disable-next-line no-console
        console.warn('[scan] pa11y failed', err);
      }

      const merged = mergeFindings(findings, { viewport: vp });
      allViolations.push(...merged);
    }

    return {
      violations: allViolations,
      pagesScanned: viewports.length,
      durationMs: Date.now() - start,
    };
  } finally {
    await browser.close();
  }
}

async function runTargetSizeRule(
  page: import('playwright').Page,
  url: string,
): Promise<RawFinding[]> {
  type Cand = {
    selector: string;
    width: number;
    height: number;
    x: number;
    y: number;
    isInline: boolean;
    html?: string;
  };
  const candidates = (await page.evaluate(COLLECT_CANDIDATES_SCRIPT)) as Cand[];
  const violations = evaluateTargets(candidates);
  return violations.map((v) => ({
    source: 'custom' as const,
    ruleId: 'a11y-target-size',
    message: `Target ${v.width}×${v.height}px is below the 24×24 minimum (WCAG 2.5.8).`,
    selector: v.selector,
    pageUrl: url,
    severityHint: 'serious' as const,
    ...(v.html ? { html: v.html } : {}),
  }));
}

async function runFocusObscuredRule(
  page: import('playwright').Page,
  url: string,
): Promise<RawFinding[]> {
  const obscurers = (await page.evaluate(COLLECT_OBSCURERS_SCRIPT)) as BBox[];
  if (obscurers.length === 0) return [];

  const findings: RawFinding[] = [];
  await page.keyboard.press('Tab');
  const FOCUS_SCRIPT = `(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const r = el.getBoundingClientRect();
    const sel = el.id ? '#' + el.id : el.tagName.toLowerCase();
    return { selector: sel, x: r.x, y: r.y, width: r.width, height: r.height };
  })()`;
  for (let i = 0; i < 50; i++) {
    const focused = (await page.evaluate(FOCUS_SCRIPT)) as {
      selector: string;
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    if (!focused) break;

    const v = evaluateFocusObscured({
      focusedSelector: focused.selector,
      focusedBBox: { x: focused.x, y: focused.y, width: focused.width, height: focused.height },
      obscurerBBoxes: obscurers,
    });
    if (v) {
      findings.push({
        source: 'custom',
        ruleId: 'a11y-focus-not-obscured',
        message: 'Focused element is entirely obscured by sticky/fixed content (WCAG 2.4.11).',
        selector: v.focusedSelector,
        pageUrl: url,
        severityHint: 'serious',
      });
    }
    await page.keyboard.press('Tab');
  }
  return findings;
}
