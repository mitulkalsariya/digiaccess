import { describe, it, expect } from 'vitest';
import { mergeFindings, normalizeSelector } from '../src/scan/merge.js';
import type { RawFinding } from '../src/scan/types.js';

const axeColorContrast: RawFinding = {
  source: 'axe',
  ruleId: 'color-contrast',
  message: 'Element has insufficient contrast',
  selector: 'div > p:nth-child(2)',
  pageUrl: 'https://e.com/',
  severityHint: 'serious',
  helpUrl: 'https://dequeuniversity.com/rules/axe/color-contrast',
};
const pa11yColorContrast: RawFinding = {
  source: 'pa11y',
  ruleId: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
  message: 'This element has insufficient contrast',
  selector: 'div > p:nth-child(2)',
  pageUrl: 'https://e.com/',
};

describe('TC-002 dedup merges identical findings from axe + Pa11y', () => {
  it('produces a single high-confidence violation with both sources', () => {
    const out = mergeFindings([axeColorContrast, pa11yColorContrast]);
    expect(out).toHaveLength(1);
    const [v] = out;
    if (!v) throw new Error('expected one violation');
    expect(v.confidence).toBe('high');
    expect(v.sources.sort()).toEqual(['axe', 'pa11y']);
    expect(v.wcag.sc).toBe('1.4.3');
  });

  it('axe-only finding is medium confidence', () => {
    const [v] = mergeFindings([axeColorContrast]);
    if (!v) throw new Error('expected violation');
    expect(v.confidence).toBe('medium');
    expect(v.sources).toEqual(['axe']);
  });

  it('pa11y-only finding is needs-review confidence', () => {
    const [v] = mergeFindings([pa11yColorContrast]);
    if (!v) throw new Error('expected violation');
    expect(v.confidence).toBe('needs-review');
    expect(v.sources).toEqual(['pa11y']);
  });

  it('different SCs at same selector remain separate violations', () => {
    const out = mergeFindings([
      axeColorContrast,
      { ...axeColorContrast, ruleId: 'image-alt', message: 'no alt' },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((v) => v.wcag.sc).sort()).toEqual(['1.1.1', '1.4.3']);
  });

  it('skips findings without a WCAG mapping rather than crashing', () => {
    const out = mergeFindings([{ ...axeColorContrast, source: 'axe', ruleId: 'wholly-unknown' }]);
    expect(out).toHaveLength(0);
  });
});

describe('selector normalization', () => {
  it('strips :nth-child variations so axe selector noise does not split dedup', () => {
    expect(normalizeSelector('div > p:nth-child(2)')).toBe(
      normalizeSelector('div > p:nth-child(7)'),
    );
  });
});
