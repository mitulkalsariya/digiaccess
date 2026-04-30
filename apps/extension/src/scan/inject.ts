// Injected into the page's main world. Bundled axe-core handles the scan.
import axe from 'axe-core';

(async () => {
  const start = Date.now();
  const results = await axe.run(document, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    },
    resultTypes: ['violations'],
  });

  const out = {
    pageUrl: location.href,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    violations: results.violations.flatMap((v, i) =>
      v.nodes.map((n, j) => ({
        id: `${v.id}-${i}-${j}`,
        ruleId: v.id,
        severity: (v.impact ?? 'moderate') as 'critical' | 'serious' | 'moderate' | 'minor',
        message: v.help,
        helpUrl: v.helpUrl,
        selector: Array.isArray(n.target) ? n.target.join(' > ') : String(n.target),
        // Mapping to WCAG SC happens server-side via @a11y/axe-mapping; popup shows axe rule id only.
        wcag: { sc: '', level: 'AA' as const, version: '2.2' as const },
      })),
    ),
  };
  return out;
})();
