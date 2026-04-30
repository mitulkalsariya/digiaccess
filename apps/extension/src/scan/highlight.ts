import type { ExtensionViolation } from './run.js';

export async function highlightViolation(v: ExtensionViolation): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, {
    type: 'highlight',
    selector: v.selector,
    message: v.message,
  });
}
