// T-049: Five design-system custom rules. Each one is browser-scripted (so it
// works against the real DOM Playwright drives) but the *evaluation* pieces
// are pure functions, exported separately for unit testing.
import type { CustomRule } from './framework.js';
import type { RawFinding } from '../types.js';
import { registerCustomRule } from './framework.js';

// ---------- Pure evaluators (testable without Playwright) ----------

export interface ButtonInfo {
  selector: string;
  ariaLabel?: string;
  visibleText?: string;
  iconOnly: boolean;
}
export function evaluateIconOnlyButtonLabel(buttons: ReadonlyArray<ButtonInfo>): ButtonInfo[] {
  return buttons.filter((b) => b.iconOnly && !b.ariaLabel && !b.visibleText);
}

export interface FormInfo {
  selector: string;
  hasLiveRegion: boolean;
  errorElementCount: number;
}
export function evaluateFormErrorAnnouncement(forms: ReadonlyArray<FormInfo>): FormInfo[] {
  // Forms with errors must have a live region for screen-reader announcement.
  return forms.filter((f) => f.errorElementCount > 0 && !f.hasLiveRegion);
}

export interface ModalInfo {
  selector: string;
  focusableCount: number;
  trapsFocus: boolean;
}
export function evaluateModalFocusTrap(modals: ReadonlyArray<ModalInfo>): ModalInfo[] {
  return modals.filter((m) => m.focusableCount > 0 && !m.trapsFocus);
}

export interface CardInfo {
  selector: string;
  hasHeading: boolean;
  hasInteractiveDescendant: boolean;
}
export function evaluateCardHeading(cards: ReadonlyArray<CardInfo>): CardInfo[] {
  return cards.filter((c) => c.hasInteractiveDescendant && !c.hasHeading);
}

export interface ToastInfo {
  selector: string;
  politeness: string | null;
}
export function evaluateToastPoliteness(toasts: ReadonlyArray<ToastInfo>): ToastInfo[] {
  return toasts.filter((t) => t.politeness !== 'assertive' && t.politeness !== 'polite');
}

// ---------- Browser scripts ----------

const COLLECT_BUTTONS = `Array.from(document.querySelectorAll('[data-cmp="CompanyButton"], button[data-cmp="CompanyButton"]')).map((el, i) => {
  const txt = (el.textContent || '').trim();
  const hasIcon = !!el.querySelector('svg, [data-icon]');
  return { selector: el.getAttribute('data-cmp-selector') || '[data-cmp="CompanyButton"]:nth-of-type(' + (i+1) + ')', ariaLabel: el.getAttribute('aria-label') || undefined, visibleText: txt || undefined, iconOnly: hasIcon && !txt };
})`;

const COLLECT_FORMS = `Array.from(document.querySelectorAll('[data-cmp="CompanyForm"]')).map((el, i) => {
  const errors = el.querySelectorAll('[data-cmp-error="true"], .error, [aria-invalid="true"]').length;
  const liveRegion = !!el.querySelector('[aria-live]');
  return { selector: '[data-cmp="CompanyForm"]:nth-of-type(' + (i+1) + ')', hasLiveRegion: liveRegion, errorElementCount: errors };
})`;

const COLLECT_MODALS = `Array.from(document.querySelectorAll('[data-cmp="CompanyModal"][aria-modal="true"]')).map((el, i) => {
  const focusable = el.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])').length;
  return { selector: '[data-cmp="CompanyModal"]:nth-of-type(' + (i+1) + ')', focusableCount: focusable, trapsFocus: el.hasAttribute('data-cmp-traps-focus') };
})`;

const COLLECT_CARDS = `Array.from(document.querySelectorAll('[data-cmp="CompanyCard"]')).map((el, i) => {
  const hasHeading = !!el.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]');
  const hasInteractive = !!el.querySelector('a,button,input,select,textarea');
  return { selector: '[data-cmp="CompanyCard"]:nth-of-type(' + (i+1) + ')', hasHeading: hasHeading, hasInteractiveDescendant: hasInteractive };
})`;

const COLLECT_TOASTS = `Array.from(document.querySelectorAll('[data-cmp="CompanyToast"]')).map((el, i) => ({ selector: '[data-cmp="CompanyToast"]:nth-of-type(' + (i+1) + ')', politeness: el.getAttribute('aria-live') }))`;

// ---------- Rule registrations ----------

function findingFromSelector(
  rule: { id: string; wcagSc: string; message: string },
  selector: string,
  pageUrl: string,
): RawFinding {
  return {
    source: 'custom',
    ruleId: rule.id,
    message: rule.message,
    selector,
    pageUrl,
    severityHint: 'serious',
  };
}

const RULES: CustomRule[] = [
  {
    id: 'company-button-icon-only-label',
    wcagSc: '4.1.2',
    description: 'Icon-only CompanyButton must have an aria-label.',
    evaluate: async (page, pageUrl) => {
      const candidates = (await page.evaluate(COLLECT_BUTTONS)) as ButtonInfo[];
      return evaluateIconOnlyButtonLabel(candidates).map((b) =>
        findingFromSelector(
          {
            id: 'company-button-icon-only-label',
            wcagSc: '4.1.2',
            message: 'Icon-only CompanyButton has no accessible name.',
          },
          b.selector,
          pageUrl,
        ),
      );
    },
  },
  {
    id: 'company-form-announces-errors',
    wcagSc: '4.1.3',
    description: 'CompanyForm with errors must have an aria-live region.',
    evaluate: async (page, pageUrl) => {
      const candidates = (await page.evaluate(COLLECT_FORMS)) as FormInfo[];
      return evaluateFormErrorAnnouncement(candidates).map((f) =>
        findingFromSelector(
          {
            id: 'company-form-announces-errors',
            wcagSc: '4.1.3',
            message: 'CompanyForm has errors but no aria-live region.',
          },
          f.selector,
          pageUrl,
        ),
      );
    },
  },
  {
    id: 'company-modal-traps-focus',
    wcagSc: '2.4.3',
    description: 'CompanyModal must trap focus.',
    evaluate: async (page, pageUrl) => {
      const candidates = (await page.evaluate(COLLECT_MODALS)) as ModalInfo[];
      return evaluateModalFocusTrap(candidates).map((m) =>
        findingFromSelector(
          {
            id: 'company-modal-traps-focus',
            wcagSc: '2.4.3',
            message: 'CompanyModal does not trap keyboard focus.',
          },
          m.selector,
          pageUrl,
        ),
      );
    },
  },
  {
    id: 'company-card-heading',
    wcagSc: '1.3.1',
    description: 'Interactive CompanyCard must contain a heading.',
    evaluate: async (page, pageUrl) => {
      const candidates = (await page.evaluate(COLLECT_CARDS)) as CardInfo[];
      return evaluateCardHeading(candidates).map((c) =>
        findingFromSelector(
          {
            id: 'company-card-heading',
            wcagSc: '1.3.1',
            message: 'CompanyCard with interactive content has no heading.',
          },
          c.selector,
          pageUrl,
        ),
      );
    },
  },
  {
    id: 'company-toast-aria-live',
    wcagSc: '4.1.3',
    description: 'CompanyToast must announce via aria-live.',
    evaluate: async (page, pageUrl) => {
      const candidates = (await page.evaluate(COLLECT_TOASTS)) as ToastInfo[];
      return evaluateToastPoliteness(candidates).map((t) =>
        findingFromSelector(
          {
            id: 'company-toast-aria-live',
            wcagSc: '4.1.3',
            message: 'CompanyToast missing aria-live politeness.',
          },
          t.selector,
          pageUrl,
        ),
      );
    },
  },
];

export function registerDesignSystemRules(): void {
  RULES.forEach(registerCustomRule);
}

export const DESIGN_SYSTEM_RULES = RULES;
