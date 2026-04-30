// Minimal type-shim — pa11y v9 ships no types.
declare module 'pa11y' {
  export interface Pa11yIssue {
    code: string;
    type: 'error' | 'warning' | 'notice';
    typeCode: number;
    message: string;
    selector: string;
    context?: string;
  }
  export interface Pa11yResult {
    documentTitle: string;
    pageUrl: string;
    issues: Pa11yIssue[];
  }
  export interface Pa11yOptions {
    standard?: string;
    timeout?: number;
    runners?: string[];
    includeWarnings?: boolean;
    chromeLaunchConfig?: Record<string, unknown>;
  }
  export default function pa11y(url: string, opts?: Pa11yOptions): Promise<Pa11yResult>;
}
