import type { WcagLevel, WcagVersion } from './wcag.js';

export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';

export type ViolationSource = 'axe' | 'pa11y' | 'manual' | 'custom';

export type Confidence = 'high' | 'medium' | 'needs-review';

export type TriageState = 'untriaged' | 'confirmed' | 'false-positive' | 'needs-review';

export interface ViolationNode {
  selector: string;
  html?: string;
  failureSummary?: string;
  target?: string[];
}

export interface Violation {
  id: string;
  ruleId: string;
  sources: ViolationSource[];
  confidence: Confidence;
  severity: Severity;
  wcag: {
    sc: string;
    level: WcagLevel;
    version: WcagVersion;
  };
  message: string;
  helpUrl?: string;
  nodes: ViolationNode[];
  pageUrl: string;
  viewport?: 'mobile' | 'tablet' | 'desktop';
  triage?: TriageState;
}
