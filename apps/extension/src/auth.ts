// S-4: extension SSO using OAuth 2.1 code+PKCE.
//
// 1. Build redirect URI from chrome.identity.getRedirectURL() — that's the
//    only URI Chrome will redirect back to, so we register it on the server.
// 2. Open /auth/extension/start?redirect_uri=... via launchWebAuthFlow.
// 3. Server completes the IdP exchange, redirects back with `#code=<one-time>`
//    in the fragment. The fragment carries an opaque code, NOT a JWT.
// 4. POST the code to /auth/extension/exchange to receive an `accessToken`.
// 5. Store the access token in chrome.storage.session — wiped on browser close.
const TOKEN_KEY = 'a11y_at';
const API_BASE = 'http://localhost:3001';

export async function getAuthToken(): Promise<string | null> {
  const r = await chrome.storage.session.get(TOKEN_KEY);
  return (r[TOKEN_KEY] as string | undefined) ?? null;
}

export async function setAuthToken(token: string): Promise<void> {
  await chrome.storage.session.set({ [TOKEN_KEY]: token });
}

export async function signIn(): Promise<void> {
  const redirectUri = chrome.identity.getRedirectURL('a11y');
  const startUrl = `${API_BASE}/auth/extension/start?redirect_uri=${encodeURIComponent(redirectUri)}`;
  const responseUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: startUrl, interactive: true }, (result) => {
      if (chrome.runtime.lastError || !result) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'auth-failed'));
        return;
      }
      resolve(result);
    });
  });

  // Extract one-time code from fragment.
  const fragment = new URL(responseUrl).hash.replace(/^#/, '');
  const params = new URLSearchParams(fragment);
  const code = params.get('code');
  if (!code) throw new Error('No exchange code in callback');

  // Exchange the one-time code for a JWT bearer token.
  const exch = await fetch(`${API_BASE}/auth/extension/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!exch.ok) throw new Error(`exchange failed: ${exch.status}`);
  const { accessToken } = (await exch.json()) as { accessToken: string };
  if (!accessToken) throw new Error('No access token from exchange');
  await setAuthToken(accessToken);
}

export async function signOut(): Promise<void> {
  await chrome.storage.session.remove(TOKEN_KEY);
}
