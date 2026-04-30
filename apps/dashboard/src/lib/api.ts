// Typed wrapper around the API. Used by Next server components.
import type { Scan, Site, Violation } from '@a11y/shared-types';

const API_BASE = process.env['API_BASE'] ?? 'http://localhost:3001';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { cache: 'no-store', ...init });
  if (!r.ok) throw new Error(`API ${path} ${r.status}`);
  return r.json() as Promise<T>;
}

export interface ScanWithViolations extends Scan {
  violations: Violation[];
}

export const api = {
  listSites: () => fetchJson<{ items: Site[] }>('/v1/sites'),
  listScans: (siteId?: string) =>
    fetchJson<{ items: Scan[]; nextCursor: string | null }>(
      siteId ? `/v1/scans?siteId=${encodeURIComponent(siteId)}` : '/v1/scans',
    ),
  getScan: (id: string) => fetchJson<ScanWithViolations>(`/v1/scans/${id}`),
};
