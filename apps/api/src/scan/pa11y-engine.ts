import pa11y from 'pa11y';
import type { EngineResult, RawFinding } from './types.js';

export interface Pa11yRunOptions {
  standard?: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
  timeout?: number;
  // CDP endpoint of the same Playwright browser so we share the page (T-010).
  browserWSEndpoint?: string;
  cookies?: Array<{ name: string; value: string; domain: string }>;
}

export async function runPa11yOnUrl(
  url: string,
  opts: Pa11yRunOptions = {},
): Promise<EngineResult> {
  const start = Date.now();
  // Pa11y owns its own headless Chrome by default — slower than reusing the
  // Playwright browser but more robust across versions. We can reuse via
  // chromeLaunchConfig if needed (T-010 follow-up).
  const result = await pa11y(url, {
    standard: opts.standard ?? 'WCAG2AA',
    timeout: opts.timeout ?? 30_000,
    runners: ['htmlcs'],
    includeWarnings: false,
  });

  const findings: RawFinding[] = result.issues
    .filter((i) => i.type === 'error')
    .map((i) => ({
      source: 'pa11y' as const,
      ruleId: i.code,
      message: i.message,
      selector: i.selector,
      pageUrl: url,
    }));

  return { pageUrl: url, engine: 'pa11y', findings, durationMs: Date.now() - start };
}
