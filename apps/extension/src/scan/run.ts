import type { Severity, WcagLevel, WcagVersion } from '@a11y/shared-types';

export interface ExtensionViolation {
  id: string;
  ruleId: string;
  severity: Severity;
  message: string;
  helpUrl?: string;
  selector: string;
  wcag: { sc: string; level: WcagLevel; version: WcagVersion };
}

export interface ExtensionScanResult {
  pageUrl: string;
  scannedAt: string;
  violations: ExtensionViolation[];
}

// Run axe inside the active tab's main world. Bundled axe avoids loading remote
// code (forbidden under MV3).
export async function runScanInActiveTab(): Promise<ExtensionScanResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  const tabId = tab.id;

  const exec = async (): Promise<ExtensionScanResult | undefined> => {
    const results = (await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: 'MAIN',
      files: ['src/scan/inject.js'],
    })) as Array<{ result?: ExtensionScanResult }>;
    return results[0]?.result;
  };

  let result = await exec();
  if (!result) {
    await new Promise((r) => setTimeout(r, 100));
    result = await exec();
  }
  if (!result) throw new Error('Scan returned no result');
  return result;
}
