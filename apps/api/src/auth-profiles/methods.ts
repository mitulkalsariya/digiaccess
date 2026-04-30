// Three supported auth methods. The shape of `config` varies per method.
// All configs are encrypted at rest; the runner decrypts inside the worker
// only and never logs decrypted contents (R-01).

export interface CookieAuthConfig {
  cookies: Array<{ name: string; value: string; domain: string; path?: string; secure?: boolean }>;
}

export interface FormAuthConfig {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  username: string;
  password: string;
  // Indicator that login succeeded — either a URL we should be on, or a
  // post-login element that should be present.
  successIndicator:
    | { kind: 'url-contains'; value: string }
    | { kind: 'selector-present'; value: string };
}

export interface RecordedAuthConfig {
  // Sequence of Playwright "actions" recorded with playwright codegen.
  steps: Array<RecordedStep>;
  // Where to look up out-of-band OTPs during replay (for MFA).
  otpProviderId?: string;
}
export type RecordedStep =
  | { kind: 'goto'; url: string }
  | { kind: 'fill'; selector: string; value: string }
  | { kind: 'fill-otp'; selector: string }
  | { kind: 'click'; selector: string }
  | { kind: 'wait-for'; selector: string }
  | { kind: 'wait-ms'; ms: number };

export type AuthMethod = 'cookie' | 'form' | 'recorded';
export type AuthConfig = CookieAuthConfig | FormAuthConfig | RecordedAuthConfig;
