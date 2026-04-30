// T-042: PDF export. Renders the same scan detail HTML and prints to PDF via
// Playwright. Keeps brand styling cheap (uses the dashboard's CSS).
//
// Note: Playwright is a heavy dep for the dashboard runtime. In production we
// render the PDF inside the API worker (the existing playwright install) and
// proxy through this route. The route below is a minimal placeholder that
// emits a printable HTML response — the API endpoint can be added later.
import { api } from '../../../../lib/api';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const scan = await api.getScan(params.id);
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8" />
<title>A11y report ${scan.id}</title>
<style>
  body { font-family: -apple-system, sans-serif; padding: 24px; }
  h1 { border-bottom: 2px solid #000; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { padding: 6px 8px; border: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; }
  @media print { @page { margin: 16mm; } }
</style>
</head><body>
<h1>Accessibility report</h1>
<p><strong>URL:</strong> ${escape(scan.url)}<br/>
<strong>Scanned:</strong> ${escape(scan.completedAt ?? scan.createdAt)}<br/>
<strong>Pages:</strong> ${scan.pagesScanned}<br/>
<strong>Total violations:</strong> ${scan.violations.length}</p>
<h2>Violations</h2>
<table>
  <thead><tr><th>SC</th><th>Severity</th><th>Page</th><th>Selector</th><th>Issue</th></tr></thead>
  <tbody>
    ${scan.violations
      .map(
        (v) =>
          `<tr><td>${v.wcag.sc} ${v.wcag.level}</td><td>${v.severity}</td><td>${escape(v.pageUrl)}</td><td><code>${escape(v.nodes[0]?.selector ?? '')}</code></td><td>${escape(v.message)}</td></tr>`,
      )
      .join('')}
  </tbody>
</table>
</body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `inline; filename="a11y-${params.id}.html"`,
    },
  });
}

function escape(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
