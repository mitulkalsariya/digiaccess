export type WcagLevel = 'A' | 'AA' | 'AAA';

export type WcagVersion = '2.0' | '2.1' | '2.2';

export interface WcagSuccessCriterion {
  sc: string;
  level: WcagLevel;
  version: WcagVersion;
  title: string;
  description: string;
  url?: string;
}
