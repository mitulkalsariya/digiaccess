import type { WcagSuccessCriterion } from '@a11y/shared-types';
import { lookupCriterion } from '@a11y/wcag-rules';
import { AXE_RULE_TO_SC } from './axe-to-wcag.js';
import { htmlcsCodeToSc } from './htmlcs-to-wcag.js';

export { AXE_RULE_TO_SC } from './axe-to-wcag.js';
export { htmlcsCodeToSc } from './htmlcs-to-wcag.js';

export function mapAxeRule(ruleId: string): WcagSuccessCriterion | undefined {
  const sc = AXE_RULE_TO_SC[ruleId];
  return sc ? lookupCriterion(sc) : undefined;
}

export function mapHtmlcsCode(code: string): WcagSuccessCriterion | undefined {
  const sc = htmlcsCodeToSc(code);
  return sc ? lookupCriterion(sc) : undefined;
}
