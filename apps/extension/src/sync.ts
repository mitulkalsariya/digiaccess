import type { ExtensionScanResult } from './scan/run.js';
import { getAuthToken } from './auth.js';

const API_BASE = 'http://localhost:3001';
const QUEUE_KEY = 'a11y_pending_scans';

interface QueuedScan {
  result: ExtensionScanResult;
  attempts: number;
  queuedAt: string;
}

export async function syncViolationsToApi(result: ExtensionScanResult): Promise<void> {
  const token = await getAuthToken();
  if (!token) {
    await enqueue(result);
    return;
  }
  try {
    const r = await fetch(`${API_BASE}/v1/scans`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: result.pageUrl }),
    });
    if (!r.ok) await enqueue(result);
  } catch {
    await enqueue(result);
  }
}

async function enqueue(result: ExtensionScanResult): Promise<void> {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = (stored[QUEUE_KEY] as QueuedScan[] | undefined) ?? [];
  queue.push({ result, attempts: 0, queuedAt: new Date().toISOString() });
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

// Drain on next launch / when sign-in succeeds.
export async function drainQueue(): Promise<void> {
  const token = await getAuthToken();
  if (!token) return;
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = (stored[QUEUE_KEY] as QueuedScan[] | undefined) ?? [];
  if (queue.length === 0) return;
  const remaining: QueuedScan[] = [];
  for (const item of queue) {
    try {
      const r = await fetch(`${API_BASE}/v1/scans`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: item.result.pageUrl }),
      });
      if (!r.ok) remaining.push({ ...item, attempts: item.attempts + 1 });
    } catch {
      remaining.push({ ...item, attempts: item.attempts + 1 });
    }
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
}
