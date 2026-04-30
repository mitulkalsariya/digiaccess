// WCAG 2.2 SC 2.4.11 (Focus Not Obscured — Minimum, AA):
// When a UI component receives keyboard focus, it should not be entirely
// hidden by author-created content (e.g., a sticky header).

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FocusObscuredInput {
  focusedSelector: string;
  focusedBBox: BBox;
  // bboxes of position:sticky / position:fixed elements at this scroll position
  obscurerBBoxes: BBox[];
}

export interface FocusObscuredViolation {
  focusedSelector: string;
  obscuredBy: BBox;
}

// "Entirely obscured" = the focused element's full bbox is contained within
// some sticky/fixed element's bbox.
function entirelyContains(outer: BBox, inner: BBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function evaluateFocusObscured(
  input: FocusObscuredInput,
): FocusObscuredViolation | undefined {
  for (const o of input.obscurerBBoxes) {
    if (entirelyContains(o, input.focusedBBox)) {
      return { focusedSelector: input.focusedSelector, obscuredBy: o };
    }
  }
  return undefined;
}

// Playwright runs Tab in a loop and feeds focused element bbox + collected
// sticky bboxes through evaluateFocusObscured for each focus position.
export const COLLECT_OBSCURERS_SCRIPT = `
  (() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.position === 'sticky' || cs.position === 'fixed') {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          out.push({ x: r.x, y: r.y, width: r.width, height: r.height });
        }
      }
    }
    return out;
  })()
`;
