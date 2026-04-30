// Engine-level raw findings before WCAG mapping / dedup.
export interface RawFinding {
  source: 'axe' | 'pa11y' | 'custom' | 'manual';
  ruleId: string; // axe rule id OR HTMLCS code OR custom rule id
  message: string;
  helpUrl?: string;
  selector: string;
  html?: string;
  pageUrl: string;
  // axe severities: critical|serious|moderate|minor; pa11y has only error/warning.
  severityHint?: 'critical' | 'serious' | 'moderate' | 'minor';
}

export interface EngineResult {
  pageUrl: string;
  engine: 'axe' | 'pa11y';
  findings: RawFinding[];
  durationMs: number;
}

export interface ScanContext {
  url: string;
  viewport?: 'mobile' | 'tablet' | 'desktop';
}
