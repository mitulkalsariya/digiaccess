import { describe, it, expect, vi } from 'vitest';
import {
  fileViolation,
  idempotencyKey,
  shouldFile,
  type JiraClient,
  type JiraConfig,
} from '../src/integrations/jira.js';
import {
  notify,
  buildSlackPayload,
  type NotifyConfig,
  type ScanSummary,
} from '../src/integrations/notify.js';
import type { Violation } from '@a11y/shared-types';

const v: Violation = {
  id: 'v1',
  ruleId: 'image-alt',
  sources: ['axe'],
  confidence: 'medium',
  severity: 'serious',
  wcag: { sc: '1.1.1', level: 'A', version: '2.0' },
  message: 'Image missing alt',
  pageUrl: 'https://e.com/',
  nodes: [{ selector: 'img.hero' }],
};

describe('TC-045 Jira ticket auto-creation', () => {
  it('idempotency key is derived deterministically', () => {
    expect(idempotencyKey(v)).toBe('a11y/image-alt/https://e.com//img.hero');
    expect(idempotencyKey({ ...v, ruleId: 'image-alt' })).toBe(idempotencyKey(v));
  });

  it('respects the severity threshold', () => {
    expect(shouldFile(v, 'serious')).toBe(true);
    expect(shouldFile({ ...v, severity: 'minor' }, 'serious')).toBe(false);
    expect(shouldFile({ ...v, severity: 'critical' }, 'moderate')).toBe(true);
  });

  it('reuses an existing ticket instead of creating a duplicate', async () => {
    const client: JiraClient = {
      searchByLabel: vi.fn().mockResolvedValue({ key: 'A11Y-123', status: 'In Progress' }),
      createIssue: vi.fn().mockResolvedValue({ key: 'NEW' }),
      reopen: vi.fn(),
    };
    const cfg: JiraConfig = {
      baseUrl: 'https://x',
      email: 'a@b',
      apiToken: 't',
      projectKey: 'A11Y',
    };
    const r = await fileViolation(v, client, cfg);
    expect(r).toEqual({ key: 'A11Y-123', reused: true });
    expect(client.createIssue).not.toHaveBeenCalled();
  });

  it('reopens a closed ticket on recurrence', async () => {
    const client: JiraClient = {
      searchByLabel: vi.fn().mockResolvedValue({ key: 'A11Y-9', status: 'Done' }),
      createIssue: vi.fn(),
      reopen: vi.fn(),
    };
    await fileViolation(v, client, { baseUrl: 'x', email: 'a', apiToken: 't', projectKey: 'A11Y' });
    expect(client.reopen).toHaveBeenCalledWith('A11Y-9');
  });
});

describe('T-046 notifications', () => {
  const summary: ScanSummary = {
    siteName: 'Example App',
    scanUrl: 'https://e.com/',
    dashboardUrl: 'https://dash/',
    newCount: 3,
    topNewViolations: [
      { severity: 'serious', message: 'Image missing alt', wcag: { sc: '1.1.1' } as never },
    ],
  };

  it('Slack payload includes site name + new count', () => {
    const p = buildSlackPayload(summary);
    expect(p.text).toContain('Example App');
    expect(p.text).toContain('3');
  });

  it('skips when in quiet hours (UTC overnight)', async () => {
    const cfg: NotifyConfig = {
      slackWebhookUrl: 'https://x',
      quietHours: { startHour: 22, endHour: 6, timezone: 'UTC' },
    };
    const r = await notify(cfg, summary, new Date('2026-04-30T23:00:00Z'));
    expect(r.suppressed).toBe(true);
    expect(r.slack).toBe(false);
  });

  it('posts to Slack when not in quiet hours', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    const cfg: NotifyConfig = { slackWebhookUrl: 'https://x' };
    const r = await notify(
      cfg,
      summary,
      new Date('2026-04-30T15:00:00Z'),
      fakeFetch as unknown as typeof fetch,
    );
    expect(r.slack).toBe(true);
    expect(fakeFetch).toHaveBeenCalledOnce();
  });
});
