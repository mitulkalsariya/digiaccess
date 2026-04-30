import { randomUUID } from 'node:crypto';
import type { Violation, ViolationSource, Severity, Confidence } from '@a11y/shared-types';
import { mapAxeRule, mapHtmlcsCode } from '@a11y/axe-mapping';
import type { RawFinding } from './types.js';

// Normalise selectors so axe's :nth-child(N) variations don't break dedup.
export function normalizeSelector(sel: string): string {
  return sel
    .replace(/:nth-child\(\d+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function severityFromHint(s?: 'critical' | 'serious' | 'moderate' | 'minor'): Severity {
  return s ?? 'moderate';
}

function bestSeverity(a: Severity, b: Severity): Severity {
  const order: Severity[] = ['critical', 'serious', 'moderate', 'minor'];
  return order.indexOf(a) < order.indexOf(b) ? a : b;
}

interface MapResult {
  sc: string;
  level: 'A' | 'AA' | 'AAA';
  version: '2.0' | '2.1' | '2.2';
}

function mapFinding(f: RawFinding): MapResult | undefined {
  if (f.source === 'axe' || f.source === 'custom') {
    const c = mapAxeRule(f.ruleId);
    if (c) return { sc: c.sc, level: c.level, version: c.version };
  }
  if (f.source === 'pa11y') {
    const c = mapHtmlcsCode(f.ruleId);
    if (c) return { sc: c.sc, level: c.level, version: c.version };
  }
  return undefined;
}

export interface MergeOptions {
  viewport?: 'mobile' | 'tablet' | 'desktop';
}

// Merge raw findings from any engines into a single deduplicated Violation list.
// Dedup key: (wcagSc, normalisedSelector, pageUrl). When a finding matches both
// engines it's tagged confidence='high'; single-engine findings are
// confidence='medium' (axe alone) or 'needs-review' (pa11y alone, often noisier).
export function mergeFindings(
  findingsBatch: ReadonlyArray<RawFinding>,
  opts: MergeOptions = {},
): Violation[] {
  type Acc = {
    key: string;
    ruleIds: Set<string>;
    sources: Set<ViolationSource>;
    sc: string;
    level: 'A' | 'AA' | 'AAA';
    version: '2.0' | '2.1' | '2.2';
    severity: Severity;
    message: string;
    helpUrl?: string;
    pageUrl: string;
    selector: string;
    html?: string;
  };

  const accMap = new Map<string, Acc>();

  for (const f of findingsBatch) {
    const mapped = mapFinding(f);
    if (!mapped) continue;
    const sel = normalizeSelector(f.selector);
    const key = `${mapped.sc}|${sel}|${f.pageUrl}`;
    const existing = accMap.get(key);
    if (existing) {
      existing.sources.add(f.source);
      existing.ruleIds.add(f.ruleId);
      existing.severity = bestSeverity(existing.severity, severityFromHint(f.severityHint));
      if (!existing.html && f.html) existing.html = f.html;
      if (!existing.helpUrl && f.helpUrl) existing.helpUrl = f.helpUrl;
    } else {
      accMap.set(key, {
        key,
        ruleIds: new Set([f.ruleId]),
        sources: new Set([f.source]),
        sc: mapped.sc,
        level: mapped.level,
        version: mapped.version,
        severity: severityFromHint(f.severityHint),
        message: f.message,
        ...(f.helpUrl ? { helpUrl: f.helpUrl } : {}),
        pageUrl: f.pageUrl,
        selector: sel,
        ...(f.html ? { html: f.html } : {}),
      });
    }
  }

  const violations: Violation[] = [];
  for (const acc of accMap.values()) {
    const hasAxe = acc.sources.has('axe') || acc.sources.has('custom');
    const hasPa11y = acc.sources.has('pa11y');
    let confidence: Confidence;
    if (hasAxe && hasPa11y) confidence = 'high';
    else if (hasAxe) confidence = 'medium';
    else confidence = 'needs-review';

    violations.push({
      id: randomUUID(),
      ruleId: [...acc.ruleIds].join(','),
      sources: [...acc.sources],
      confidence,
      severity: acc.severity,
      wcag: { sc: acc.sc, level: acc.level, version: acc.version },
      message: acc.message,
      ...(acc.helpUrl ? { helpUrl: acc.helpUrl } : {}),
      pageUrl: acc.pageUrl,
      ...(opts.viewport ? { viewport: opts.viewport } : {}),
      nodes: [{ selector: acc.selector, ...(acc.html ? { html: acc.html } : {}) }],
    });
  }

  return violations;
}
