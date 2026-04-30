import type { Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import type { EngineResult, RawFinding } from './types.js';

export interface AxeRunOptions {
  // Subset of axe rule tags to run. Defaults to WCAG 2.2 A+AA + the 'best-practice' bucket.
  tags?: string[];
  rules?: Record<string, { enabled: boolean }>;
}

const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

export async function runAxeOnPage(
  page: Page,
  pageUrl: string,
  opts: AxeRunOptions = {},
): Promise<EngineResult> {
  const start = Date.now();
  const builder = new AxeBuilder({ page }).withTags(opts.tags ?? DEFAULT_TAGS);
  if (opts.rules) builder.options({ rules: opts.rules });

  const results = await builder.analyze();

  const findings: RawFinding[] = [];
  for (const v of results.violations) {
    const sev = (['critical', 'serious', 'moderate', 'minor'] as const).find((s) => s === v.impact);
    for (const node of v.nodes) {
      findings.push({
        source: 'axe',
        ruleId: v.id,
        message: v.help,
        helpUrl: v.helpUrl,
        selector: Array.isArray(node.target) ? node.target.join(' > ') : String(node.target),
        html: node.html,
        pageUrl,
        ...(sev ? { severityHint: sev } : {}),
      });
    }
  }

  return { pageUrl, engine: 'axe', findings, durationMs: Date.now() - start };
}
