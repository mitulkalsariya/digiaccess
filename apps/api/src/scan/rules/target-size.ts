// WCAG 2.2 SC 2.5.8 (Target Size — Minimum, AA): pointer targets are at least
// 24×24 CSS px. Exceptions per the spec:
//  - Spacing exception: an undersized target is OK if a 24px-radius circle
//    centered on the target does not intersect another target's bbox.
//  - Inline exception: targets in a sentence or block of text are exempt.
//  - User-agent: targets sized by the user agent (e.g. native scrollbars) are
//    exempt — we don't try to detect this.
//  - Equivalent: an alternative single-pointer trigger of the same action that
//    meets the minimum is provided — we can't detect this automatically.
//
// We implement spacing + inline. The rest are flagged for manual review.

export interface TargetCandidate {
  selector: string;
  width: number;
  height: number;
  x: number;
  y: number;
  isInline: boolean;
  html?: string;
}

export interface TargetSizeViolation {
  selector: string;
  reason: 'too-small';
  width: number;
  height: number;
  html?: string;
}

const MIN_TARGET = 24;

// Pure function — exposed so we can unit-test without a browser.
export function evaluateTargets(candidates: ReadonlyArray<TargetCandidate>): TargetSizeViolation[] {
  const violations: TargetSizeViolation[] = [];

  for (const c of candidates) {
    const tooSmall = c.width < MIN_TARGET || c.height < MIN_TARGET;
    if (!tooSmall) continue;
    if (c.isInline) continue; // inline-link exception

    // Spacing exception: any other candidate within MIN_TARGET/2 of the centre
    // of c "absorbs" the violation only when there are NO other targets nearby
    // — i.e., spacing test passes when c is isolated.
    const cx = c.x + c.width / 2;
    const cy = c.y + c.height / 2;
    const conflict = candidates.some((other) => {
      if (other === c) return false;
      const ox = other.x + other.width / 2;
      const oy = other.y + other.height / 2;
      const dx = cx - ox;
      const dy = cy - oy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist < MIN_TARGET;
    });
    if (!conflict) continue;

    violations.push({
      selector: c.selector,
      reason: 'too-small',
      width: c.width,
      height: c.height,
      ...(c.html ? { html: c.html } : {}),
    });
  }

  return violations;
}

// Browser-side collection runs inside Playwright's evaluate context.
// Returned array is the input to evaluateTargets above.
export const COLLECT_CANDIDATES_SCRIPT = `
  (() => {
    const SEL = 'a[href], button, [role="button"], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
    const out = [];
    const elements = Array.from(document.querySelectorAll(SEL));
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const styleParent = el.closest('p, li, td, th, span, blockquote, h1, h2, h3, h4, h5, h6');
      const isInline = !!styleParent && getComputedStyle(el).display === 'inline';
      // CSS selector for the element — fall back to tag if no id/class is unique enough.
      let sel = el.tagName.toLowerCase();
      if (el.id) sel += '#' + el.id;
      else if (el.className && typeof el.className === 'string') sel += '.' + el.className.trim().split(/\\s+/).join('.');
      out.push({
        selector: sel,
        width: r.width, height: r.height, x: r.x, y: r.y,
        isInline,
        html: el.outerHTML.slice(0, 200),
      });
    }
    return out;
  })()
`;
