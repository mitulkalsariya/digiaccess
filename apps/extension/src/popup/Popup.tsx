import { useEffect, useState, type KeyboardEvent } from 'react';
import { runScanInActiveTab, type ExtensionViolation } from '../scan/run.js';
import { highlightViolation } from '../scan/highlight.js';
import { syncViolationsToApi } from '../sync.js';
import { getAuthToken, signIn, signOut } from '../auth.js';

type State =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'done'; violations: ExtensionViolation[]; pageUrl: string }
  | { kind: 'error'; message: string };

export function Popup(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [signedIn, setSignedIn] = useState<boolean>(false);

  useEffect(() => {
    void getAuthToken().then((t) => setSignedIn(!!t));
  }, []);

  async function onScan(): Promise<void> {
    setState({ kind: 'scanning' });
    try {
      const result = await runScanInActiveTab();
      setState({ kind: 'done', violations: result.violations, pageUrl: result.pageUrl });
      // Best-effort sync; do not fail the UI if API is unreachable.
      void syncViolationsToApi(result).catch(() => undefined);
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function onSignIn(): Promise<void> {
    await signIn();
    setSignedIn(true);
  }
  async function onSignOut(): Promise<void> {
    await signOut();
    setSignedIn(false);
  }

  function activate(v: ExtensionViolation): void {
    void highlightViolation(v);
  }
  function onKey(e: KeyboardEvent<HTMLLIElement>, v: ExtensionViolation): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(v);
    }
  }

  return (
    <>
      <header className="header">
        <h1>A11y Audit</h1>
        {signedIn ? (
          <button onClick={onSignOut} aria-label="Sign out">
            Sign out
          </button>
        ) : (
          <button onClick={onSignIn} aria-label="Sign in with company SSO">
            Sign in
          </button>
        )}
      </header>

      <main className="content">
        {state.kind === 'idle' && (
          <button onClick={onScan} disabled={!signedIn} aria-label="Scan this page">
            Scan this page
          </button>
        )}
        {state.kind === 'scanning' && (
          <p role="status" aria-live="polite">
            Scanning…
          </p>
        )}
        {state.kind === 'error' && (
          <div role="alert" style={{ color: 'var(--critical)' }}>
            <p>Scan failed: {state.message}</p>
            <button onClick={onScan}>Try again</button>
          </div>
        )}
        {state.kind === 'done' && (
          <>
            <p className="summary">
              {state.violations.length === 0
                ? 'No violations found.'
                : `${state.violations.length} violation${state.violations.length === 1 ? '' : 's'} found.`}
            </p>
            <button onClick={onScan}>Scan again</button>
            <ul className="violation-list">
              {state.violations.map((v) => (
                <li
                  key={v.id}
                  className="violation"
                  tabIndex={0}
                  role="button"
                  aria-label={`${v.severity} ${v.message}. Press Enter to highlight.`}
                  onClick={() => activate(v)}
                  onKeyDown={(e) => onKey(e, v)}
                >
                  <span className={`severity ${v.severity}`}>{v.severity}</span>
                  <span className="sc">WCAG {v.wcag.sc}</span>
                  <span className="msg">{v.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  );
}
