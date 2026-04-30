import { describe, it, expect } from 'vitest';
import { evaluateTargets, type TargetCandidate } from '../src/scan/rules/target-size.js';
import { evaluateFocusObscured } from '../src/scan/rules/focus-not-obscured.js';

function tc(over: Partial<TargetCandidate>): TargetCandidate {
  return {
    selector: 'button',
    width: 24,
    height: 24,
    x: 0,
    y: 0,
    isInline: false,
    ...over,
  };
}

describe('TC-003 target-size flags 20x20 button', () => {
  it('flags a 20x20 button when another target is within the 24px spacing exception radius', () => {
    // centers must be < 24px apart to defeat the spacing exception
    const violations = evaluateTargets([
      tc({ selector: 'a', width: 20, height: 20, x: 0, y: 0 }),
      tc({ selector: 'b', width: 24, height: 24, x: 15, y: 0 }),
    ]);
    expect(violations.find((v) => v.selector === 'a')).toBeDefined();
  });
  it('does NOT flag a 20x20 button when no other target is within 24px (spacing exception)', () => {
    const violations = evaluateTargets([
      tc({ selector: 'a', width: 20, height: 20, x: 0, y: 0 }),
      tc({ selector: 'b', width: 24, height: 24, x: 200, y: 0 }),
    ]);
    expect(violations).toHaveLength(0);
  });
});

describe('TC-004 target-size respects inline link exception', () => {
  it('does not flag inline links smaller than 24px', () => {
    const violations = evaluateTargets([
      tc({ selector: 'a', width: 16, height: 16, isInline: true }),
      tc({ selector: 'b', width: 16, height: 16, isInline: true }),
    ]);
    expect(violations).toHaveLength(0);
  });
});

describe('TC-005 focus-obscured detects sticky-header overlap', () => {
  it('flags focused element entirely contained in a sticky header bbox', () => {
    const v = evaluateFocusObscured({
      focusedSelector: '#email',
      focusedBBox: { x: 100, y: 20, width: 200, height: 30 },
      obscurerBBoxes: [{ x: 0, y: 0, width: 1440, height: 80 }],
    });
    expect(v).toBeDefined();
    expect(v?.focusedSelector).toBe('#email');
  });
  it('does not flag when focused element is partially visible', () => {
    expect(
      evaluateFocusObscured({
        focusedSelector: '#email',
        focusedBBox: { x: 100, y: 60, width: 200, height: 30 }, // peeks below header
        obscurerBBoxes: [{ x: 0, y: 0, width: 1440, height: 80 }],
      }),
    ).toBeUndefined();
  });
});
