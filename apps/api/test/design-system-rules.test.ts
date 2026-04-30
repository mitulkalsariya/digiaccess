import { describe, it, expect } from 'vitest';
import {
  evaluateIconOnlyButtonLabel,
  evaluateFormErrorAnnouncement,
  evaluateModalFocusTrap,
  evaluateCardHeading,
  evaluateToastPoliteness,
  DESIGN_SYSTEM_RULES,
} from '../src/scan/rules/design-system.js';
import { canTransition } from '../src/triage/index.js';

describe('T-049 design-system custom rules (5 rules with fixtures)', () => {
  it('ships at least 5 rules', () => {
    expect(DESIGN_SYSTEM_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it('icon-only CompanyButton without aria-label is flagged', () => {
    const out = evaluateIconOnlyButtonLabel([
      { selector: 'a', iconOnly: true }, // missing label/text
      { selector: 'b', iconOnly: true, ariaLabel: 'Close' }, // OK
      { selector: 'c', iconOnly: false, visibleText: 'Save' }, // text-bearing
    ]);
    expect(out.map((b) => b.selector)).toEqual(['a']);
  });

  it('CompanyForm with errors but no live region is flagged', () => {
    const out = evaluateFormErrorAnnouncement([
      { selector: 'a', hasLiveRegion: false, errorElementCount: 1 },
      { selector: 'b', hasLiveRegion: true, errorElementCount: 1 },
      { selector: 'c', hasLiveRegion: false, errorElementCount: 0 },
    ]);
    expect(out.map((f) => f.selector)).toEqual(['a']);
  });

  it('CompanyModal that does not trap focus is flagged', () => {
    const out = evaluateModalFocusTrap([
      { selector: 'a', focusableCount: 3, trapsFocus: false },
      { selector: 'b', focusableCount: 3, trapsFocus: true },
      { selector: 'c', focusableCount: 0, trapsFocus: false }, // empty modal — fine
    ]);
    expect(out.map((m) => m.selector)).toEqual(['a']);
  });

  it('interactive CompanyCard without heading is flagged', () => {
    const out = evaluateCardHeading([
      { selector: 'a', hasHeading: false, hasInteractiveDescendant: true },
      { selector: 'b', hasHeading: true, hasInteractiveDescendant: true },
      { selector: 'c', hasHeading: false, hasInteractiveDescendant: false },
    ]);
    expect(out.map((c) => c.selector)).toEqual(['a']);
  });

  it('CompanyToast without aria-live is flagged', () => {
    const out = evaluateToastPoliteness([
      { selector: 'a', politeness: null },
      { selector: 'b', politeness: 'polite' },
      { selector: 'c', politeness: 'off' },
    ]);
    expect(out.map((t) => t.selector)).toEqual(['a', 'c']);
  });
});

describe('T-050 triage state machine', () => {
  it('allows untriaged → confirmed', () => {
    expect(canTransition('untriaged', 'confirmed')).toBe(true);
  });
  it('allows confirmed → false-positive (mistakes happen)', () => {
    expect(canTransition('confirmed', 'false-positive')).toBe(true);
  });
  it('disallows untriaged → untriaged (no-op transitions blocked)', () => {
    expect(canTransition('untriaged', 'untriaged')).toBe(false);
  });
  it('disallows false-positive → false-positive', () => {
    expect(canTransition('false-positive', 'false-positive')).toBe(false);
  });
});
