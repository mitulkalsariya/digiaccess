// Dashboard entry stub. Next.js app is scaffolded in T-037.
import type { Scan } from '@a11y/shared-types';

export function formatScanLabel(scan: Pick<Scan, 'url' | 'status'>): string {
  return `${scan.status}: ${scan.url}`;
}
