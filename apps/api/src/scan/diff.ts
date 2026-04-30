// T-035: classify violations as new / persisting / fixed against the previous
// scan's baseline. Match key per AC: (rule_id, selector, page_url).

export interface DiffableViolation {
  ruleId: string;
  selector: string;
  pageUrl: string;
}

export interface DiffResult<V extends DiffableViolation> {
  newViolations: V[];
  persisting: V[];
  fixed: V[];
}

function key(v: DiffableViolation): string {
  return `${v.ruleId}|${v.selector}|${v.pageUrl}`;
}

export function diffViolations<V extends DiffableViolation>(
  current: ReadonlyArray<V>,
  baseline: ReadonlyArray<V>,
): DiffResult<V> {
  const baseKeys = new Set(baseline.map(key));
  const curKeys = new Set(current.map(key));

  return {
    newViolations: current.filter((v) => !baseKeys.has(key(v))),
    persisting: current.filter((v) => baseKeys.has(key(v))),
    fixed: baseline.filter((v) => !curKeys.has(key(v))),
  };
}
