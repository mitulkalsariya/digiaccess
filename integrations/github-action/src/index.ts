// T-044 GitHub Action entry. Posts a PR comment + sets check status based on
// the diff between this scan and the baseline branch's latest scan.
//
// Builds with @vercel/ncc into integrations/github-action/dist/index.js for
// distribution as a JS-only action (no node_modules in the action repo).
import { context, getOctokit } from '@actions/github';
import { getInput, setFailed, setSecret, info, summary } from '@actions/core';

type Severity = 'critical' | 'serious' | 'moderate' | 'minor';
const RANK: Record<Severity, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

interface Violation {
  ruleId: string;
  message: string;
  severity: Severity;
  wcag: { sc: string };
  pageUrl: string;
  selector: string;
}

async function main(): Promise<void> {
  const appId = getInput('app-id', { required: true });
  const previewUrl = getInput('preview-url', { required: true });
  const baselineBranch = getInput('baseline-branch') || 'main';
  const failOn = (getInput('fail-on-severity') || 'serious') as Severity;
  const apiBase = getInput('api-base', { required: true });
  const apiToken = getInput('api-token', { required: true });
  // S-12: register the token as a secret so anything that accidentally logs
  // it (our code or a transitive dependency's debug output) gets masked.
  setSecret(apiToken);

  // 1. Run a scan via the API.
  info(`Submitting scan for ${previewUrl}`);
  const submit = await fetch(`${apiBase}/v1/scans`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({ url: previewUrl, siteId: appId }),
  });
  if (!submit.ok) {
    setFailed(`scan submit failed: ${submit.status}`);
    return;
  }
  const { scan } = (await submit.json()) as { scan: { id: string } };

  // 2. Poll until complete.
  let result: { violations: Violation[] } | null = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await fetch(`${apiBase}/v1/scans/${scan.id}`, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    if (!r.ok) continue;
    const body = (await r.json()) as { status: string; violations: Violation[] };
    if (body.status === 'completed') {
      result = body;
      break;
    }
    if (body.status === 'failed') {
      setFailed('scan failed on the server');
      return;
    }
  }
  if (!result) {
    setFailed('scan timed out');
    return;
  }

  // 3. Diff against baseline (server-side endpoint not yet exposed; the action
  //    treats the entire result as "new" if no baseline endpoint is wired).
  const baseline = await fetchBaseline(apiBase, apiToken, appId, baselineBranch);
  const newOnes = diffNew(result.violations, baseline);
  const blocking = newOnes.filter((v) => RANK[v.severity] <= RANK[failOn]);

  // 4. PR comment + status.
  if (context.payload.pull_request) {
    const octokit = getOctokit(process.env['GITHUB_TOKEN'] ?? apiToken);
    const body = renderComment(newOnes, blocking, failOn);
    await octokit.rest.issues.createComment({
      ...context.repo,
      issue_number: context.payload.pull_request.number,
      body,
    });
  }

  await summary
    .addHeading('A11y scan results')
    .addRaw(`New: ${newOnes.length}, Blocking (≥ ${failOn}): ${blocking.length}`)
    .write();

  if (blocking.length > 0) {
    setFailed(`${blocking.length} new violation(s) at or above '${failOn}'.`);
  }
}

async function fetchBaseline(
  apiBase: string,
  token: string,
  appId: string,
  branch: string,
): Promise<Violation[]> {
  try {
    const r = await fetch(`${apiBase}/v1/sites/${appId}/baseline?branch=${branch}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) return [];
    const body = (await r.json()) as { violations?: Violation[] };
    return body.violations ?? [];
  } catch {
    return [];
  }
}

function key(v: Pick<Violation, 'ruleId' | 'selector' | 'pageUrl'>): string {
  return `${v.ruleId}|${v.selector}|${v.pageUrl}`;
}
function diffNew(current: Violation[], baseline: Violation[]): Violation[] {
  const baseKeys = new Set(baseline.map(key));
  return current.filter((v) => !baseKeys.has(key(v)));
}
function renderComment(allNew: Violation[], blocking: Violation[], failOn: Severity): string {
  if (allNew.length === 0) return `### ✅ A11y scan: no new violations.`;
  const top = blocking
    .slice(0, 10)
    .map((v) => `- **${v.severity}** WCAG ${v.wcag.sc}: ${v.message} \`${v.selector}\``)
    .join('\n');
  return `### ❌ A11y scan: ${allNew.length} new violation(s)\n\n${blocking.length} at/above \`${failOn}\` (failing this check):\n\n${top}\n`;
}

void main().catch((err) => setFailed(err instanceof Error ? err.message : String(err)));
