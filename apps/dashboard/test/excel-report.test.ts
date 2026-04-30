import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildExcelReport,
  violationToReportFinding,
  typeForRule,
  reportSeverity,
  STATUS_CATEGORIES,
} from '../src/lib/excel-report';
import type { Violation } from '@a11y/shared-types';

const v: Violation = {
  id: 'v1',
  ruleId: 'color-contrast',
  sources: ['axe', 'pa11y'],
  confidence: 'high',
  severity: 'serious',
  wcag: { sc: '1.4.3', level: 'AA', version: '2.0' },
  message: 'Color contrast error detected',
  helpUrl: 'https://x',
  pageUrl: 'https://1finance.co.in/',
  nodes: [{ selector: 'p.lede' }],
};

describe('TC-015 Excel export matches reference template structure', () => {
  it('produces three named sheets in order: Status, automated testing, Manual Audit Failures', async () => {
    const buf = await buildExcelReport({
      status: [{ url: 'https://1finance.co.in/', results: { 'Automated Tools': 'Done' } }],
      automated: [violationToReportFinding(v)],
      manual: [
        violationToReportFinding(v, {
          pageName: 'HomePage',
          environment: 'Win 11/NVDA',
          screenshotLink: 'https://drive/x.png',
        }),
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(['Status', 'automated testing', 'Manual Audit Failures']);
  });

  it('Status sheet uses URL × test-category checklist matching the reference', async () => {
    const buf = await buildExcelReport({
      status: [
        {
          url: 'https://1finance.co.in/',
          results: { 'Automated Tools': 'Done', 'NVDA/Chrome': 'Done' },
        },
        { url: 'https://1financep2p.com/', results: { 'Automated Tools': 'Done' } },
      ],
      automated: [],
      manual: [],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const status = wb.getWorksheet('Status')!;
    const headers = (status.getRow(1).values as ExcelJS.CellValue[]).slice(1) as string[];
    expect(headers).toEqual([
      'URL',
      'Automated Tools',
      'NVDA/Chrome',
      'IOS/ Voice Over',
      'Android / Talk Back',
      'Color Contrast',
      'Keyboard-Only',
      'Browser Zoom',
      'Text-Spacing',
    ]);
    expect(STATUS_CATEGORIES.length).toBe(8);
    // Two URL rows
    expect(status.getRow(2).getCell(1).value).toBe('https://1finance.co.in/');
    expect(status.getRow(2).getCell(2).value).toBe('Done'); // Automated Tools
    expect(status.getRow(3).getCell(1).value).toBe('https://1financep2p.com/');
  });

  it('automated testing sheet has the 12-column header from the reference, including the blank between WCAG checkpoint and Recommendation', async () => {
    const buf = await buildExcelReport({
      status: [],
      automated: [violationToReportFinding(v)],
      manual: [],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.getWorksheet('automated testing')!;
    const headers = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1) as Array<
      string | undefined
    >;
    expect(headers).toEqual([
      'url',
      'Defect Summary',
      'Type',
      'Environment',
      'Severity',
      'Expected Result',
      'Actual Result',
      'User Impact',
      'Instances',
      'Failed WCAG 2.2 checkpoint(s)',
      '', // the blank/empty header (matches the reference's blank column)
      'Recommendation',
    ]);
  });

  it('Manual Audit Failures has the 12-column header matching the reference (URL, Page Name, …, Screenshot link, Recommendation)', async () => {
    const buf = await buildExcelReport({ status: [], automated: [], manual: [] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.getWorksheet('Manual Audit Failures')!;
    const headers = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1) as string[];
    expect(headers).toEqual([
      'URL',
      'Page Name',
      'Defect Summary',
      'Type',
      'Environment',
      'Severity',
      'Expected Result',
      'Actual Result',
      'User Impact',
      'Failed WCAG 2.2 checkpoint(s)',
      'Screenshot link',
      'Recommendation',
    ]);
  });

  it('automated row content reflects the violation: Type, Severity (High/Med/Low), WCAG SC', async () => {
    const buf = await buildExcelReport({
      status: [],
      automated: [violationToReportFinding(v)],
      manual: [],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.getWorksheet('automated testing')!;
    const row = sheet.getRow(2);
    expect(row.getCell(1).value).toBe('https://1finance.co.in/'); // url
    expect(row.getCell(2).value).toBe('Color contrast error detected'); // Defect Summary
    expect(row.getCell(3).value).toBe('Color contrast'); // Type
    expect(row.getCell(4).value).toBe('Win 11/ NVDA'); // Environment default
    expect(row.getCell(5).value).toBe('High'); // Severity (axe serious → High)
    expect(row.getCell(10).value).toBe('1.4.3'); // WCAG checkpoint
  });

  it('manual row preserves Page Name and Screenshot link from options', async () => {
    const buf = await buildExcelReport({
      status: [],
      automated: [],
      manual: [
        violationToReportFinding(v, {
          pageName: 'HomePage',
          environment: 'Win 11/NVDA',
          screenshotLink: 'https://drive/x.png',
        }),
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.getWorksheet('Manual Audit Failures')!;
    const row = sheet.getRow(2);
    expect(row.getCell(2).value).toBe('HomePage');
    expect(row.getCell(11).value).toBe('https://drive/x.png');
  });
});

describe('mapping helpers', () => {
  it('typeForRule classifies axe rule ids into reference Type buckets', () => {
    expect(typeForRule('color-contrast')).toBe('Color contrast');
    expect(typeForRule('image-alt')).toBe('Image');
    expect(typeForRule('label')).toBe('Form field');
    expect(typeForRule('heading-order')).toBe('Heading');
    expect(typeForRule('marquee')).toBe('Pause/Play');
    expect(typeForRule('tabindex')).toBe('Keyboard');
    expect(typeForRule('something-unknown')).toBe('Other');
    expect(typeForRule('color-contrast,WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail')).toBe(
      'Color contrast',
    );
  });

  it('reportSeverity maps axe scale → reference scale', () => {
    expect(reportSeverity('critical')).toBe('High');
    expect(reportSeverity('serious')).toBe('High');
    expect(reportSeverity('moderate')).toBe('Medium');
    expect(reportSeverity('minor')).toBe('Low');
    expect(reportSeverity('whatever')).toBe('Medium');
  });
});
