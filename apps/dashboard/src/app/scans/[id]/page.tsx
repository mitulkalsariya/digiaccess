import { api, type ScanWithViolations } from '../../../lib/api';
import Link from 'next/link';

// T-039 scan results detail page (server component for fast initial load).
export default async function ScanDetailPage({ params }: { params: { id: string } }) {
  let scan: ScanWithViolations | null = null;
  try {
    scan = await api.getScan(params.id);
  } catch {
    return <p role="alert">Scan not found or you do not have access.</p>;
  }
  if (!scan) return null;

  const bySeverity = groupBy(scan.violations, (v) => v.severity);

  return (
    <section aria-labelledby="scan-heading">
      <h2 id="scan-heading">Scan {scan.id.slice(0, 8)}</h2>
      <p>
        URL: <a href={scan.url}>{scan.url}</a> · Status: {scan.status} · Pages scanned:{' '}
        {scan.pagesScanned}
      </p>

      <div style={{ marginBottom: 16 }}>
        <Link href={`/scans/${scan.id}/export.xlsx`}>Export Excel</Link>
        {' · '}
        <Link href={`/scans/${scan.id}/export.pdf`}>Export PDF</Link>
      </div>

      <h3>Violations by severity</h3>
      {(['critical', 'serious', 'moderate', 'minor'] as const).map((sev) => {
        const list = bySeverity.get(sev) ?? [];
        if (list.length === 0) return null;
        return (
          <details key={sev} open>
            <summary>
              <span className={`severity ${sev}`}>{sev}</span> · {list.length}
            </summary>
            <ul>
              {list.map((v) => (
                <li key={v.id}>
                  <strong>WCAG {v.wcag.sc}</strong> ({v.confidence}) — {v.message}
                  <br />
                  <code>{v.nodes[0]?.selector}</code>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}

function groupBy<T, K>(arr: ReadonlyArray<T>, key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of arr) {
    const k = key(x);
    let bucket = m.get(k);
    if (!bucket) {
      bucket = [];
      m.set(k, bucket);
    }
    bucket.push(x);
  }
  return m;
}
