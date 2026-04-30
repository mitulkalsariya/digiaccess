// T-046: Slack/Teams notifications. Plain incoming-webhook based; respects
// quiet-hours config when supplied.
//
// S-11: webhook URLs are credentials. resolveNotifyConfig() pulls them from
// the named-secret vault at use time so they're never in plain config or env.
import type { Violation } from '@a11y/shared-types';
import type { createNamedSecretStore } from '../auth-profiles/store.js';

export interface NotifyConfig {
  slackWebhookUrl?: string;
  teamsWebhookUrl?: string;
  quietHours?: { startHour: number; endHour: number; timezone: string };
}

function inQuietHours(now: Date, qh: NotifyConfig['quietHours']): boolean {
  if (!qh) return false;
  // Naive — production should use a proper timezone library.
  const h = now.getUTCHours();
  if (qh.startHour <= qh.endHour) return h >= qh.startHour && h < qh.endHour;
  return h >= qh.startHour || h < qh.endHour;
}

export interface ScanSummary {
  siteName: string;
  scanUrl: string;
  dashboardUrl: string;
  newCount: number;
  topNewViolations: ReadonlyArray<Pick<Violation, 'severity' | 'message' | 'wcag'>>;
}

export function buildSlackPayload(summary: ScanSummary): { text: string; blocks: unknown[] } {
  const lines = summary.topNewViolations
    .slice(0, 3)
    .map((v) => `• *${v.severity}* WCAG ${v.wcag.sc} — ${v.message}`)
    .join('\n');
  return {
    text: `[a11y] ${summary.siteName}: ${summary.newCount} new issue(s)`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${summary.siteName}: ${summary.newCount} new accessibility issue(s)`,
        },
      },
      { type: 'section', text: { type: 'mrkdwn', text: lines || 'No issue summary available.' } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open dashboard' },
            url: summary.dashboardUrl,
          },
        ],
      },
    ],
  };
}

export function buildTeamsPayload(summary: ScanSummary): unknown {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              size: 'Medium',
              weight: 'Bolder',
              text: `${summary.siteName}: ${summary.newCount} new accessibility issue(s)`,
            },
            {
              type: 'TextBlock',
              wrap: true,
              text: summary.topNewViolations
                .map((v) => `${v.severity} WCAG ${v.wcag.sc} — ${v.message}`)
                .join('\n\n'),
            },
          ],
          actions: [{ type: 'Action.OpenUrl', title: 'Open dashboard', url: summary.dashboardUrl }],
        },
      },
    ],
  };
}

// S-11: resolves webhook URLs from the secret vault (never in plain config).
export interface ResolveNotifyConfigInput {
  scope: string;
  quietHours?: { startHour: number; endHour: number; timezone: string };
}

export async function resolveNotifyConfig(
  secrets: ReturnType<typeof createNamedSecretStore>,
  input: ResolveNotifyConfigInput,
): Promise<NotifyConfig> {
  const slackWebhookUrl = (await secrets.get(input.scope, 'slack.webhookUrl')) ?? undefined;
  const teamsWebhookUrl = (await secrets.get(input.scope, 'teams.webhookUrl')) ?? undefined;
  return {
    ...(slackWebhookUrl ? { slackWebhookUrl } : {}),
    ...(teamsWebhookUrl ? { teamsWebhookUrl } : {}),
    ...(input.quietHours ? { quietHours: input.quietHours } : {}),
  };
}

export async function notify(
  config: NotifyConfig,
  summary: ScanSummary,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<{ slack: boolean; teams: boolean; suppressed: boolean }> {
  if (inQuietHours(now, config.quietHours)) {
    return { slack: false, teams: false, suppressed: true };
  }
  let slack = false,
    teams = false;
  if (config.slackWebhookUrl) {
    const r = await fetcher(config.slackWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildSlackPayload(summary)),
    });
    slack = r.ok;
  }
  if (config.teamsWebhookUrl) {
    const r = await fetcher(config.teamsWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildTeamsPayload(summary)),
    });
    teams = r.ok;
  }
  return { slack, teams, suppressed: false };
}
