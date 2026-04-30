// T-041: Excel export — matches the company reference template
// (1_Finance_Accessibility_report.xlsx) exactly.
//
// Sheet shapes:
//   Status                — URL × (8 test categories) matrix; values "Done"/"Pending"/etc.
//   automated testing     — 12 columns including a deliberate blank between
//                           "Failed WCAG 2.2 checkpoint(s)" and "Recommendation"
//   Manual Audit Failures — 12 columns; same row-per-finding shape as automated
//
// Severity in the report is High/Medium/Low (not axe's critical/serious/moderate/minor).
// `Type` is a human-friendly category (Color contrast, Image, Keyboard, …) derived
// from axe rule id or supplied by the manual-entry form.
import ExcelJS from 'exceljs';
import type { Violation } from '@a11y/shared-types';

// ----- Status sheet -----

export type StatusValue = 'Done' | 'Pending' | 'In Progress' | 'N/A';

export const STATUS_CATEGORIES = [
  'Automated Tools',
  'NVDA/Chrome',
  'IOS/ Voice Over',
  'Android / Talk Back',
  'Color Contrast',
  'Keyboard-Only',
  'Browser Zoom',
  'Text-Spacing',
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export interface StatusRow {
  url: string;
  results: Partial<Record<StatusCategory, StatusValue>>;
}

// ----- Per-finding row (used by both findings sheets) -----

export type ReportSeverity = 'High' | 'Medium' | 'Low';

export interface ReportFinding {
  url: string;
  pageName?: string; // manual sheet only — keep optional
  defectSummary: string;
  type: string; // e.g. "Color contrast", "Image", "Keyboard"
  environment: string; // e.g. "Win 11/ NVDA"
  severity: ReportSeverity;
  expectedResult: string;
  actualResult: string;
  userImpact: string;
  instances?: string; // automated only
  wcagCheckpoints: string[]; // joined with newlines in the cell
  screenshotLink?: string; // manual only
  recommendation: string;
}

export interface ExcelReportInput {
  status: StatusRow[];
  automated: ReportFinding[];
  manual: ReportFinding[];
}

// ----- Severity + type derivation from a Violation -----

const AXE_TO_TYPE: Record<string, string> = {
  'color-contrast': 'Color contrast',
  'color-contrast-enhanced': 'Color contrast',
  'image-alt': 'Image',
  'object-alt': 'Image',
  'svg-img-alt': 'Image',
  'role-img-alt': 'Image',
  'input-image-alt': 'Image',
  'area-alt': 'Image',
  label: 'Form field',
  'form-field-multiple-labels': 'Form field',
  'select-name': 'Form field',
  'aria-input-field-name': 'Form field',
  'button-name': 'Form field',
  'link-name': 'Link',
  'heading-order': 'Heading',
  'empty-heading': 'Heading',
  'page-has-heading-one': 'Heading',
  'p-as-heading': 'Heading',
  'document-title': 'Page',
  'html-has-lang': 'Page',
  'html-lang-valid': 'Page',
  'meta-viewport': 'Page',
  'meta-refresh': 'Page',
  'no-autoplay-audio': 'Pause/Play',
  blink: 'Pause/Play',
  marquee: 'Pause/Play',
  'video-caption': 'Pause/Play',
  tabindex: 'Keyboard',
  'frame-focusable-content': 'Keyboard',
  'scrollable-region-focusable': 'Keyboard',
  bypass: 'Keyboard',
  'skip-link': 'Keyboard',
  'aria-allowed-attr': 'ARIA',
  'aria-required-attr': 'ARIA',
  'aria-roles': 'ARIA',
  'aria-valid-attr': 'ARIA',
  'aria-valid-attr-value': 'ARIA',
  'aria-allowed-role': 'ARIA',
  'aria-hidden-body': 'ARIA',
  'aria-hidden-focus': 'ARIA',
  'aria-required-children': 'ARIA',
  'aria-required-parent': 'ARIA',
  list: 'List',
  listitem: 'List',
  'definition-list': 'List',
  dlitem: 'List',
  'a11y-target-size': 'Target size',
  'a11y-focus-not-obscured': 'Keyboard',
};

export function typeForRule(ruleId: string): string {
  const first = ruleId.split(',')[0]?.trim() ?? ruleId;
  return AXE_TO_TYPE[first] ?? 'Other';
}

const SEVERITY_MAP: Record<string, ReportSeverity> = {
  critical: 'High',
  serious: 'High',
  moderate: 'Medium',
  minor: 'Low',
};
export function reportSeverity(s: string): ReportSeverity {
  return SEVERITY_MAP[s] ?? 'Medium';
}

// ----- Templated guidance per WCAG SC -----

interface GuidanceTemplate {
  expected: string;
  actual: string;
  userImpact: string;
  recommendation: string;
}

const GUIDANCE: Record<string, GuidanceTemplate> = {
  '1.1.1': {
    expected:
      'All meaningful images should have descriptive, accurate alternative text. Decorative images should be marked with empty alt or role="presentation".',
    actual: 'The image lacks proper alternative text or has incorrect/non-descriptive alt content.',
    userImpact:
      'Screen reader users cannot identify the image or its purpose, missing important context.',
    recommendation:
      'Provide a concise, meaningful `alt` attribute that describes the image content or function.',
  },
  '1.3.1': {
    expected:
      'Page structure (headings, lists, landmarks) should be conveyed programmatically as well as visually.',
    actual:
      'Visually-styled content does not use the corresponding semantic HTML element, or the structure is malformed.',
    userImpact:
      'Screen reader users rely on programmatic structure to navigate; without it they may miss sections entirely.',
    recommendation:
      'Use real <h1>–<h6>, <ul>/<ol>/<li>, and landmark elements (<main>, <nav>, <header>) instead of styled <div>/<span>.',
  },
  '1.4.3': {
    expected:
      'All text and interactive elements should meet the minimum contrast ratio of 4.5:1 (3:1 for large text) against their background.',
    actual:
      'The automated tool detected at least one element where the foreground/background contrast is below the WCAG 2.2 AA threshold.',
    userImpact:
      'Users with low vision or color-vision deficiencies may struggle to read content, leading to lost information and a poor experience.',
    recommendation:
      'Review flagged elements and adjust color combinations to meet contrast requirements; verify with a tool like axe DevTools or WAVE.',
  },
  '2.1.1': {
    expected: 'All interactive elements should be reachable and operable using the keyboard alone.',
    actual:
      'Keyboard focus does not reach one or more interactive elements, making them unusable without a pointer.',
    userImpact: 'Keyboard-only and screen-reader users cannot access or activate the element.',
    recommendation:
      'Use native HTML controls (<button>, <a href>, <input>) or set tabindex="0" plus a key handler on custom widgets; ensure focus is visible.',
  },
  '2.2.2': {
    expected:
      'Any moving, blinking, or auto-scrolling content should provide a mechanism for users to pause, stop, or hide it.',
    actual: 'A moving element (e.g. carousel, marquee) auto-plays without a pause/stop control.',
    userImpact:
      'Users with cognitive disabilities, low vision, or screen-reader users may find it disorienting and unable to consume the content.',
    recommendation:
      'Provide accessible pause/play controls (e.g. a toggle button next to the carousel) and respect prefers-reduced-motion.',
  },
  '2.4.7': {
    expected: 'Keyboard focus must always be visibly indicated.',
    actual: 'The focus outline has been removed or is not visible against the background.',
    userImpact:
      'Keyboard-only users cannot tell which element currently has focus, making the page effectively unusable.',
    recommendation:
      'Use :focus-visible with a high-contrast outline (e.g. 3px solid #1d4ed8, offset 2px); never set outline:none without a replacement.',
  },
  '2.4.11': {
    expected:
      'When a focusable element receives keyboard focus it must not be entirely hidden by author-created content (e.g. a sticky header).',
    actual: 'A sticky/fixed element fully covers the focused element when scrolled into view.',
    userImpact:
      'Keyboard users tab to an element they cannot see, leading to confusion and loss of context.',
    recommendation:
      'Apply scroll-margin-top to focusable elements equal to the sticky header height, or move the header out of the focus path.',
  },
  '2.5.8': {
    expected:
      'Pointer targets should be at least 24×24 CSS px (with spacing/inline exceptions per WCAG 2.2).',
    actual:
      'A clickable target is smaller than 24×24 px and does not meet the spacing or inline exception.',
    userImpact: 'Users with motor impairments may struggle to activate the target accurately.',
    recommendation:
      'Increase the hit area to at least 24×24 px or ensure adequate spacing between adjacent small targets.',
  },
  '3.3.2': {
    expected:
      'Form fields should have visible, programmatically associated labels or instructions.',
    actual: 'A form field is missing a visible label, or only has placeholder text.',
    userImpact:
      'Screen-reader and cognitive-disability users do not know what to enter; placeholder text disappears on input.',
    recommendation:
      'Pair every input with a <label for>, or aria-label, in addition to (not instead of) any placeholder.',
  },
  '4.1.2': {
    expected: 'Custom UI components must expose their name, role, and value programmatically.',
    actual:
      'A control is rendered as a generic <div>/<span> without ARIA, or has incomplete ARIA attributes.',
    userImpact: 'Screen-reader users hear no role or state and cannot operate the control.',
    recommendation:
      'Use a native HTML element where possible; otherwise apply the correct role and supporting aria-* attributes (aria-expanded, aria-checked, etc.).',
  },
};

const FALLBACK_GUIDANCE: GuidanceTemplate = {
  expected: 'The element should meet the relevant WCAG 2.2 success criterion.',
  actual: 'An automated check flagged a violation of the criterion below.',
  userImpact:
    'Users relying on assistive technology may be unable to consume or operate this content.',
  recommendation: 'Review the linked WCAG documentation and adjust the implementation accordingly.',
};

export function guidanceFor(sc: string): GuidanceTemplate {
  return GUIDANCE[sc] ?? FALLBACK_GUIDANCE;
}

// ----- Mapping a Violation → ReportFinding -----

export interface ToReportFindingOptions {
  environment?: string;
  pageName?: string;
  screenshotLink?: string;
}

export function violationToReportFinding(
  v: Violation,
  opts: ToReportFindingOptions = {},
): ReportFinding {
  const g = guidanceFor(v.wcag.sc);
  return {
    url: v.pageUrl,
    ...(opts.pageName ? { pageName: opts.pageName } : {}),
    defectSummary: v.message,
    type: typeForRule(v.ruleId),
    environment: opts.environment ?? 'Win 11/ NVDA',
    severity: reportSeverity(v.severity),
    expectedResult: g.expected,
    actualResult: g.actual,
    userImpact: g.userImpact,
    instances: v.nodes.length > 0 ? String(v.nodes.length) : '',
    wcagCheckpoints: [v.wcag.sc],
    ...(opts.screenshotLink ? { screenshotLink: opts.screenshotLink } : {}),
    recommendation: g.recommendation,
  };
}

// ----- Workbook builder -----

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2937' },
};
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } } as const;

function styleHeaderRow(sheet: ExcelJS.Worksheet): void {
  const row = sheet.getRow(1);
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
  row.height = 28;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function setColumns(
  sheet: ExcelJS.Worksheet,
  columns: ReadonlyArray<{ header: string; width: number; key?: string }>,
): void {
  sheet.columns = columns.map((c, i) => ({
    header: c.header,
    key: c.key ?? `col${i}`,
    width: c.width,
  }));
}

export async function buildExcelReport(input: ExcelReportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'A11y Audit Tool';
  wb.created = new Date();

  // ---------- 1. Status ----------
  const status = wb.addWorksheet('Status');
  setColumns(status, [
    { header: 'URL', width: 60, key: 'url' },
    ...STATUS_CATEGORIES.map((c) => ({ header: c, width: 18, key: c })),
  ]);
  styleHeaderRow(status);
  for (const r of input.status) {
    const row: Record<string, unknown> = { url: r.url };
    for (const c of STATUS_CATEGORIES) row[c] = r.results[c] ?? '';
    status.addRow(row);
  }

  // ---------- 2. automated testing ----------
  const auto = wb.addWorksheet('automated testing');
  setColumns(auto, [
    { header: 'url', width: 40, key: 'url' },
    { header: 'Defect Summary', width: 40, key: 'defectSummary' },
    { header: 'Type', width: 16, key: 'type' },
    { header: 'Environment', width: 18, key: 'environment' },
    { header: 'Severity', width: 12, key: 'severity' },
    { header: 'Expected Result', width: 50, key: 'expectedResult' },
    { header: 'Actual Result', width: 50, key: 'actualResult' },
    { header: 'User Impact', width: 50, key: 'userImpact' },
    { header: 'Instances', width: 12, key: 'instances' },
    { header: 'Failed WCAG 2.2 checkpoint(s)', width: 22, key: 'wcag' },
    { header: '', width: 4, key: 'spacer' },
    { header: 'Recommendation', width: 50, key: 'recommendation' },
  ]);
  styleHeaderRow(auto);
  for (const f of input.automated) {
    const row = auto.addRow({
      url: f.url,
      defectSummary: f.defectSummary,
      type: f.type,
      environment: f.environment,
      severity: f.severity,
      expectedResult: f.expectedResult,
      actualResult: f.actualResult,
      userImpact: f.userImpact,
      instances: f.instances ?? '',
      wcag: f.wcagCheckpoints.join('\n'),
      spacer: '',
      recommendation: f.recommendation,
    });
    row.alignment = { vertical: 'top', wrapText: true };
  }

  // ---------- 3. Manual Audit Failures ----------
  const manual = wb.addWorksheet('Manual Audit Failures');
  setColumns(manual, [
    { header: 'URL', width: 40, key: 'url' },
    { header: 'Page Name', width: 18, key: 'pageName' },
    { header: 'Defect Summary', width: 40, key: 'defectSummary' },
    { header: 'Type', width: 16, key: 'type' },
    { header: 'Environment', width: 18, key: 'environment' },
    { header: 'Severity', width: 12, key: 'severity' },
    { header: 'Expected Result', width: 50, key: 'expectedResult' },
    { header: 'Actual Result', width: 50, key: 'actualResult' },
    { header: 'User Impact', width: 50, key: 'userImpact' },
    { header: 'Failed WCAG 2.2 checkpoint(s)', width: 22, key: 'wcag' },
    { header: 'Screenshot link', width: 24, key: 'screenshot' },
    { header: 'Recommendation', width: 50, key: 'recommendation' },
  ]);
  styleHeaderRow(manual);
  for (const f of input.manual) {
    const row = manual.addRow({
      url: f.url,
      pageName: f.pageName ?? '',
      defectSummary: f.defectSummary,
      type: f.type,
      environment: f.environment,
      severity: f.severity,
      expectedResult: f.expectedResult,
      actualResult: f.actualResult,
      userImpact: f.userImpact,
      wcag: f.wcagCheckpoints.join('\n'),
      screenshot: f.screenshotLink ?? '',
      recommendation: f.recommendation,
    });
    row.alignment = { vertical: 'top', wrapText: true };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
