import type { BrowserContext, Page } from 'playwright';
import type {
  AuthConfig,
  AuthMethod,
  CookieAuthConfig,
  FormAuthConfig,
  RecordedAuthConfig,
} from './methods.js';

export interface ReplayOptions {
  // Optional out-of-band OTP fetcher for recorded flows that include MFA.
  fetchOtp?: () => Promise<string>;
}

// Shared entry point — dispatches to the method-specific replayer.
export async function applyAuth(
  ctx: BrowserContext,
  method: AuthMethod,
  config: AuthConfig,
  opts: ReplayOptions = {},
): Promise<void> {
  switch (method) {
    case 'cookie':
      await applyCookieAuth(ctx, config as CookieAuthConfig);
      return;
    case 'form':
      await applyFormAuth(ctx, config as FormAuthConfig);
      return;
    case 'recorded':
      await applyRecordedAuth(ctx, config as RecordedAuthConfig, opts);
      return;
  }
}

// T-026
async function applyCookieAuth(ctx: BrowserContext, c: CookieAuthConfig): Promise<void> {
  await ctx.addCookies(
    c.cookies.map((k) => ({
      name: k.name,
      value: k.value,
      domain: k.domain,
      path: k.path ?? '/',
      secure: k.secure ?? true,
      sameSite: 'Lax' as const,
    })),
  );
}

// T-027
async function applyFormAuth(ctx: BrowserContext, c: FormAuthConfig): Promise<void> {
  const page = await ctx.newPage();
  await page.goto(c.loginUrl);
  await page.fill(c.usernameSelector, c.username);
  await page.fill(c.passwordSelector, c.password);
  await Promise.all([page.waitForLoadState('networkidle'), page.click(c.submitSelector)]);

  // Verify success
  if (c.successIndicator.kind === 'url-contains') {
    if (!page.url().includes(c.successIndicator.value)) {
      throw new Error('form-auth: success indicator URL not matched');
    }
  } else {
    await page.waitForSelector(c.successIndicator.value, { timeout: 10_000 });
  }
  await page.close();
}

// T-028
async function applyRecordedAuth(
  ctx: BrowserContext,
  c: RecordedAuthConfig,
  opts: ReplayOptions,
): Promise<void> {
  const page = await ctx.newPage();
  for (const step of c.steps) {
    switch (step.kind) {
      case 'goto':
        await page.goto(step.url);
        break;
      case 'fill':
        await page.fill(step.selector, step.value);
        break;
      case 'fill-otp': {
        if (!opts.fetchOtp)
          throw new Error('recorded-auth: OTP fetcher required for fill-otp step');
        const code = await opts.fetchOtp();
        await page.fill(step.selector, code);
        break;
      }
      case 'click':
        await page.click(step.selector);
        break;
      case 'wait-for':
        await page.waitForSelector(step.selector, { timeout: 30_000 });
        break;
      case 'wait-ms':
        await page.waitForTimeout(step.ms);
        break;
    }
  }
  await page.close();
}

// T-030 — detect mid-crawl session expiry. Heuristic: navigation ended on a
// path that looks like login, or the page contains a sign-in form selector.
export function looksLikeLoginPage(page: Page, loginPathHint?: string): boolean {
  const url = page.url();
  if (loginPathHint && url.includes(loginPathHint)) return true;
  return /\/(login|signin|sign-in|auth)\b/i.test(url);
}

export interface ReAuthOptions {
  method: AuthMethod;
  config: AuthConfig;
  maxAttempts?: number;
  fetchOtp?: () => Promise<string>;
}

export async function reAuthIfNeeded(
  page: Page,
  ctx: BrowserContext,
  opts: ReAuthOptions,
): Promise<boolean> {
  if (!looksLikeLoginPage(page)) return false;
  const max = opts.maxAttempts ?? 3;
  for (let i = 0; i < max; i++) {
    try {
      await applyAuth(
        ctx,
        opts.method,
        opts.config,
        opts.fetchOtp ? { fetchOtp: opts.fetchOtp } : {},
      );
      return true;
    } catch {
      // retry
    }
  }
  throw new Error('re-auth failed after max attempts');
}
