import { describe, it, expect } from 'vitest';
import { mapAxeRule, mapHtmlcsCode, htmlcsCodeToSc } from '../src/index.js';

describe('TC-001 WCAG mapping returns correct SC for axe rule', () => {
  it('color-contrast → 1.4.3 AA 2.0', () => {
    const r = mapAxeRule('color-contrast');
    expect(r).toEqual(expect.objectContaining({ sc: '1.4.3', level: 'AA', version: '2.0' }));
  });
  it('returns undefined for unknown rule', () => {
    expect(mapAxeRule('not-a-real-rule')).toBeUndefined();
  });
  it('maps WCAG 2.2 custom rules', () => {
    expect(mapAxeRule('a11y-target-size')?.sc).toBe('2.5.8');
    expect(mapAxeRule('a11y-focus-not-obscured')?.sc).toBe('2.4.11');
  });
});

describe('Pa11y HTMLCS code parsing', () => {
  it('parses standard HTMLCS code shape', () => {
    expect(htmlcsCodeToSc('WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail')).toBe('1.4.3');
  });
  it('maps to a real criterion', () => {
    expect(mapHtmlcsCode('WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail')?.title).toMatch(
      /Contrast/,
    );
  });
});
