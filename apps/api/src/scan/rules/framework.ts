// T-048: Custom-rule framework. A rule is a small object the worker registers
// at startup. Rules run after axe and produce RawFindings just like axe does.
import type { Page } from 'playwright';
import type { RawFinding } from '../types.js';

export interface CustomRule {
  id: string; // axe-style rule id
  wcagSc: string; // e.g. "2.5.8"
  description: string;
  evaluate: (page: Page, pageUrl: string) => Promise<RawFinding[]>;
}

const REGISTRY = new Map<string, CustomRule>();

export function registerCustomRule(rule: CustomRule): void {
  REGISTRY.set(rule.id, rule);
}

export function listCustomRules(): CustomRule[] {
  return [...REGISTRY.values()];
}

export async function runAllCustomRules(page: Page, pageUrl: string): Promise<RawFinding[]> {
  const out: RawFinding[] = [];
  for (const rule of REGISTRY.values()) {
    try {
      out.push(...(await rule.evaluate(page, pageUrl)));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[custom-rule:${rule.id}] failed`, err);
    }
  }
  return out;
}

export function clearCustomRules(): void {
  REGISTRY.clear();
}
