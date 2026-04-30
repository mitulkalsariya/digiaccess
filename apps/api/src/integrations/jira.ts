// T-045: Jira ticket auto-creation. Idempotent via deterministic key derived
// from (rule_id, page_url, selector). Re-opens existing ticket on recurrence.
//
// S-11: live Jira API tokens never travel through plain config — resolveJiraConfig
// pulls the token (and any other sensitive fields) from the named-secret vault.
import type { Violation } from '@a11y/shared-types';
import type { createNamedSecretStore } from '../auth-profiles/store.js';

export interface JiraConfig {
  baseUrl: string; // e.g. https://company.atlassian.net
  email: string;
  apiToken: string;
  projectKey: string;
  defaultAssignee?: string;
  severityThreshold?: 'critical' | 'serious' | 'moderate' | 'minor';
}

const SEVERITY_RANK: Record<'critical' | 'serious' | 'moderate' | 'minor', number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

export function shouldFile(
  v: Violation,
  threshold: 'critical' | 'serious' | 'moderate' | 'minor',
): boolean {
  return SEVERITY_RANK[v.severity] <= SEVERITY_RANK[threshold];
}

export function idempotencyKey(v: Violation): string {
  const sel = v.nodes[0]?.selector ?? '';
  return `a11y/${v.ruleId}/${v.pageUrl}/${sel}`;
}

export interface JiraClient {
  searchByLabel(label: string): Promise<{ key: string; status: string } | null>;
  createIssue(input: {
    summary: string;
    description: string;
    labels: string[];
    assignee?: string;
  }): Promise<{ key: string }>;
  reopen(key: string): Promise<void>;
}

export function buildJiraClient(config: JiraConfig): JiraClient {
  const auth = 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  return {
    async searchByLabel(label) {
      const r = await fetch(
        `${config.baseUrl}/rest/api/3/search?jql=labels=${encodeURIComponent(label)}`,
        {
          headers: { authorization: auth, accept: 'application/json' },
        },
      );
      if (!r.ok) return null;
      const json = (await r.json()) as {
        issues?: Array<{ key: string; fields: { status: { name: string } } }>;
      };
      const first = json.issues?.[0];
      return first ? { key: first.key, status: first.fields.status.name } : null;
    },
    async createIssue(input) {
      const r = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          fields: {
            project: { key: config.projectKey },
            summary: input.summary,
            description: {
              type: 'doc',
              version: 1,
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: input.description }] },
              ],
            },
            issuetype: { name: 'Bug' },
            labels: input.labels,
            ...(input.assignee ? { assignee: { accountId: input.assignee } } : {}),
          },
        }),
      });
      if (!r.ok) throw new Error(`jira create failed: ${r.status}`);
      const json = (await r.json()) as { key: string };
      return { key: json.key };
    },
    async reopen(key) {
      // S-21: look up the actual transition id rather than hard-coding it.
      // Different Jira workflows have different transition names; we accept any
      // of these in priority order.
      const r = await fetch(`${config.baseUrl}/rest/api/3/issue/${key}/transitions`, {
        headers: { authorization: auth, accept: 'application/json' },
      });
      if (!r.ok) throw new Error(`jira transitions fetch failed: ${r.status}`);
      const body = (await r.json()) as {
        transitions?: Array<{ id: string; name: string; to?: { name?: string } }>;
      };
      const candidates = body.transitions ?? [];
      const preferredNames = ['Reopen', 'Reopen Issue', 'To Do', 'In Progress', 'Open'];
      let transitionId: string | undefined;
      for (const name of preferredNames) {
        const match = candidates.find(
          (t) =>
            t.name?.toLowerCase() === name.toLowerCase() ||
            t.to?.name?.toLowerCase() === name.toLowerCase(),
        );
        if (match) {
          transitionId = match.id;
          break;
        }
      }
      if (!transitionId) {
        throw new Error(
          `jira reopen failed: no transition matched any of ${preferredNames.join(', ')} ` +
            `(available: ${candidates.map((t) => t.name).join(', ')})`,
        );
      }
      const post = await fetch(`${config.baseUrl}/rest/api/3/issue/${key}/transitions`, {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: JSON.stringify({ transition: { id: transitionId } }),
      });
      if (!post.ok) throw new Error(`jira transition POST failed: ${post.status}`);
    },
  };
}

// S-11: assemble a JiraConfig by reading the API token from the secret vault
// rather than receiving it in plain config. Caller passes the per-site scope
// the credential was stored under; missing values throw rather than silently
// degrading behaviour.
export interface ResolveJiraConfigInput {
  baseUrl: string;
  email: string;
  projectKey: string;
  scope: string; // e.g. "site:<uuid>"
  defaultAssignee?: string;
  severityThreshold?: 'critical' | 'serious' | 'moderate' | 'minor';
}

export async function resolveJiraConfig(
  secrets: ReturnType<typeof createNamedSecretStore>,
  input: ResolveJiraConfigInput,
): Promise<JiraConfig> {
  const apiToken = await secrets.get(input.scope, 'jira.apiToken');
  if (!apiToken) {
    throw new Error(
      `jira.apiToken not in vault for scope="${input.scope}"; store it via secrets.put() first`,
    );
  }
  return {
    baseUrl: input.baseUrl,
    email: input.email,
    apiToken,
    projectKey: input.projectKey,
    ...(input.defaultAssignee ? { defaultAssignee: input.defaultAssignee } : {}),
    ...(input.severityThreshold ? { severityThreshold: input.severityThreshold } : {}),
  };
}

export async function fileViolation(
  v: Violation,
  client: JiraClient,
  config: JiraConfig,
): Promise<{ key: string; reused: boolean }> {
  if (!shouldFile(v, config.severityThreshold ?? 'serious')) {
    return { key: '', reused: false };
  }
  const label = idempotencyKey(v);
  const existing = await client.searchByLabel(label);
  if (existing) {
    if (
      existing.status.toLowerCase().includes('done') ||
      existing.status.toLowerCase() === 'closed'
    ) {
      await client.reopen(existing.key);
    }
    return { key: existing.key, reused: true };
  }
  const issue = await client.createIssue({
    summary: `[a11y] WCAG ${v.wcag.sc}: ${v.message.slice(0, 80)}`,
    description: `Page: ${v.pageUrl}\nSelector: ${v.nodes[0]?.selector}\nWCAG: ${v.wcag.sc} ${v.wcag.level}\nSeverity: ${v.severity}\nConfidence: ${v.confidence}\n\n${v.message}`,
    labels: ['a11y', label, `wcag-${v.wcag.sc.replace(/\./g, '_')}`],
    ...(config.defaultAssignee ? { assignee: config.defaultAssignee } : {}),
  });
  return { key: issue.key, reused: false };
}
