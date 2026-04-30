// Generates a sample report mimicking the company reference (1Finance) so it
// can be diffed against `1_Finance_Accessibility_report.xlsx`. Run with:
//   pnpm --filter @a11y/dashboard exec tsx scripts/sample-report.mts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildExcelReport,
  type ReportFinding,
  type StatusRow,
} from '../src/lib/excel-report.js';

const status: StatusRow[] = [
  {
    url: 'https://1finance.co.in/',
    results: {
      'Automated Tools': 'Done',
      'NVDA/Chrome': 'Done',
      'IOS/ Voice Over': 'Done',
      'Android / Talk Back': 'Done',
      'Color Contrast': 'Done',
      'Keyboard-Only': 'Done',
      'Browser Zoom': 'Done',
      'Text-Spacing': 'Done',
    },
  },
  {
    url: 'https://1financep2p.com/',
    results: {
      'Automated Tools': 'Done',
      'NVDA/Chrome': 'Done',
      'IOS/ Voice Over': 'Done',
      'Android / Talk Back': 'Done',
      'Color Contrast': 'Done',
      'Keyboard-Only': 'Done',
      'Browser Zoom': 'Done',
      'Text-Spacing': 'Done',
    },
  },
];

const automated: ReportFinding[] = [
  {
    url: 'https://1finance.co.in/',
    defectSummary: 'Color contrast error detected',
    type: 'Color contrast',
    environment: 'Win 11/ NVDA',
    severity: 'Medium',
    expectedResult:
      'All text and interactive elements should meet the minimum contrast ratio of 4.5:1 against their background.',
    actualResult:
      'The WAVE tool has detected 1 instance where the foreground and background color contrast falls below WCAG 2.2 AA.',
    userImpact:
      'Users with low vision or color vision deficiencies may struggle to read content, leading to lost information.',
    instances: '1',
    wcagCheckpoints: ['1.4.3'],
    recommendation:
      'Review all flagged elements and adjust color combinations to meet contrast requirements.',
  },
];

const manual: ReportFinding[] = [
  {
    url: 'https://1finance.co.in/',
    pageName: 'HomePage',
    defectSummary: 'Slider below header does not have pause/play mechanism',
    type: 'Pause/Play',
    environment: 'Win 11/NVDA',
    severity: 'High',
    expectedResult:
      'Any moving or auto-scrolling content should provide user controls to pause, stop, or hide.',
    actualResult:
      'The image slider auto-scrolls and provides no pause/stop control.',
    userImpact:
      'Users with cognitive disabilities, low vision, or screen-reader users may find it disorienting.',
    wcagCheckpoints: ['2.2.2'],
    recommendation:
      'Provide accessible controls (pause/stop) and respect prefers-reduced-motion.',
  },
  {
    url: 'https://1finance.co.in/',
    pageName: 'HomePage',
    defectSummary: 'Logo image does not have proper alternative text',
    type: 'Image',
    environment: 'Win 11/NVDA',
    severity: 'High',
    expectedResult:
      'Logo images should have meaningful alternative text identifying the brand.',
    actualResult:
      'The logo image has no alt text or non-descriptive alt content.',
    userImpact: 'Screen reader users cannot identify the brand.',
    wcagCheckpoints: ['1.1.1'],
    recommendation: 'Provide descriptive alt text such as "Company Name logo".',
  },
  {
    url: 'https://play.google.com/store/apps/details?id=app.onefin&hl=en_IN',
    pageName: 'Login',
    defectSummary: 'Step indicators in account creation process are not announced',
    type: 'Image',
    environment: 'Win 11/NVDA',
    severity: 'High',
    expectedResult: 'All steps should be programmatically accessible.',
    actualResult:
      'The 5-step process is not announced by screen readers (likely image-based).',
    userImpact: 'Screen reader users cannot understand current progress.',
    // Multiple WCAG SCs joined with newline, exactly like the reference file:
    wcagCheckpoints: ['1.1.1', '4.1.2'],
    recommendation:
      'Use semantic HTML (e.g. <ol> with aria-current) instead of images for step state.',
  },
];

const buf = await buildExcelReport({ status, automated, manual });
const out = resolve(process.cwd(), 'sample-finance-report.xlsx');
writeFileSync(out, buf);
console.log(`wrote ${out} (${buf.length} bytes)`);
