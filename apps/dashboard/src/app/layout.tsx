import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'A11y Audit Tool',
  description: 'Internal accessibility dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <header role="banner" className="topbar">
          <h1>A11y Audit</h1>
          <nav role="navigation" aria-label="Primary">
            <ul>
              <li>
                <a href="/">Sites</a>
              </li>
              <li>
                <a href="/scans">Scans</a>
              </li>
              <li>
                <a href="/reports">Reports</a>
              </li>
              <li>
                <a href="/settings">Settings</a>
              </li>
            </ul>
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
