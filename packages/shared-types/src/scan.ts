import type { Violation } from './violation.js';

export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ScanType = 'single-page' | 'crawl' | 'scheduled';

export interface ScanRequest {
  url: string;
  siteId?: string;
  type?: ScanType;
  viewports?: Array<'mobile' | 'tablet' | 'desktop'>;
  authProfileId?: string;
  isPrivate?: boolean;
}

export interface Scan {
  id: string;
  siteId?: string;
  url: string;
  type: ScanType;
  status: ScanStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  createdByUserId: string;
  teamId?: string;
  violations: Violation[];
  pagesScanned: number;
  errorMessage?: string;
}

export interface ScanSummary {
  total: number;
  byConfidence: { high: number; medium: number; needsReview: number };
  bySeverity: { critical: number; serious: number; moderate: number; minor: number };
}
