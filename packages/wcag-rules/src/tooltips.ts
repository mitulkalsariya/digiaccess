// T-052: educational content for each WCAG SC. Used by the dashboard violation
// detail page tooltips. Hand-curated by the a11y SME (DoD: SME-reviewed).

export interface WcagTooltip {
  sc: string;
  plain: string;
  badExample: string;
  goodExample: string;
  docsUrl: string;
}

export const TOOLTIPS: ReadonlyArray<WcagTooltip> = [
  {
    sc: '1.1.1',
    plain: 'Every meaningful image needs text alternative. Decorative images get alt="".',
    badExample: '<img src="error.png">',
    goodExample: '<img src="error.png" alt="Form submission failed">',
    docsUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content',
  },
  {
    sc: '1.3.1',
    plain: "Use real headings, lists, and landmarks — don't fake them with bold or indents.",
    badExample: '<div style="font-weight:bold;font-size:1.5em">Section</div>',
    goodExample: '<h2>Section</h2>',
    docsUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships',
  },
  {
    sc: '1.4.3',
    plain: 'Body text needs contrast ratio of at least 4.5 to 1 against the background.',
    badExample: '<p style="color:#aaa;background:#fff">Hard to read</p>',
    goodExample: '<p style="color:#444;background:#fff">Easy to read</p>',
    docsUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum',
  },
  {
    sc: '2.1.1',
    plain: 'Every action must be reachable with the keyboard alone.',
    badExample: '<div onClick="open()">Open</div>',
    goodExample: '<button onClick="open()">Open</button>',
    docsUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/keyboard',
  },
  {
    sc: '2.4.7',
    plain:
      'Keyboard focus must always be visibly indicated — never remove the outline without a replacement.',
    badExample: '*:focus { outline: none; }',
    goodExample: '*:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }',
    docsUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-visible',
  },
  {
    sc: '2.4.11',
    plain: 'Sticky headers and other overlays must not entirely cover the focused element.',
    badExample: 'A sticky header that obscures the focused input field below it.',
    goodExample: 'Use scroll-margin-top on focusable elements equal to the sticky header height.',
    docsUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum',
  },
  {
    sc: '2.5.8',
    plain: 'Pointer targets must be at least 24×24 CSS px (with spacing/inline exceptions).',
    badExample: '<button style="width:18px;height:18px">×</button>',
    goodExample: '<button style="width:24px;height:24px">×</button>',
    docsUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum',
  },
  {
    sc: '3.3.2',
    plain: 'Form fields must have visible labels — placeholder text alone is not enough.',
    badExample: '<input type="email" placeholder="Email">',
    goodExample: '<label for="e">Email</label><input id="e" type="email">',
    docsUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions',
  },
  {
    sc: '4.1.2',
    plain: 'Custom controls need name, role, and value exposed to assistive tech.',
    badExample: '<div onClick="...">Open</div>',
    goodExample: '<button aria-expanded="false">Open</button>',
    docsUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value',
  },
];

const BY_SC = new Map(TOOLTIPS.map((t) => [t.sc, t]));
export function lookupTooltip(sc: string): WcagTooltip | undefined {
  return BY_SC.get(sc);
}
