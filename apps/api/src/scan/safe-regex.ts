// S-7: refuse regex patterns whose syntax allows catastrophic backtracking.
// Standard heuristic ("nested quantifiers", "alternation with overlap") plus a
// hard length cap. Sources of inspiration: safe-regex2, RE2 docs.
//
// We deliberately do NOT pull in re2 (native dep). For our crawler the
// patterns are admin-supplied and small, so static analysis is sufficient.

export class UnsafeRegexError extends Error {
  constructor(
    message: string,
    public readonly source: string,
  ) {
    super(message);
  }
}

const MAX_PATTERN_LENGTH = 256;

// Common ReDoS shapes we forbid:
//   nested quantifier:        (a+)+   (a*)*   (a+)*   (.+)+
//   alternation + quantifier: (a|b)+  (a|a)*  (foo|foobar)+
const NESTED_QUANTIFIER = /\([^()]*[*+?][^()]*\)[*+?]/;
const NESTED_QUANTIFIER_DEEP = /\(([^()]|\([^()]*\))*[*+?]([^()]|\([^()]*\))*\)[*+?]/;
const ALTERNATION_QUANTIFIED = /\([^()]*\|[^()]*\)[*+?]/;
const SUSPICIOUS_BACKREF = /\\\d/; // backreferences amplify ReDoS
const SUSPICIOUS_LOOKBEHIND = /\(\?<[!=]/;

export interface SafeRegexOptions {
  flags?: string;
  maxLength?: number;
}

export function compileSafeRegex(source: string, opts: SafeRegexOptions = {}): RegExp {
  if (typeof source !== 'string') {
    throw new UnsafeRegexError('regex source must be a string', String(source));
  }
  const max = opts.maxLength ?? MAX_PATTERN_LENGTH;
  if (source.length > max) {
    throw new UnsafeRegexError(`regex too long (>${max} chars)`, source);
  }
  if (NESTED_QUANTIFIER_DEEP.test(source) || NESTED_QUANTIFIER.test(source)) {
    throw new UnsafeRegexError(
      'regex contains nested quantifiers (catastrophic backtracking)',
      source,
    );
  }
  if (ALTERNATION_QUANTIFIED.test(source)) {
    throw new UnsafeRegexError(
      'regex contains a quantified group with alternation (catastrophic backtracking risk)',
      source,
    );
  }
  if (SUSPICIOUS_BACKREF.test(source)) {
    throw new UnsafeRegexError('regex contains backreferences (potential ReDoS)', source);
  }
  if (SUSPICIOUS_LOOKBEHIND.test(source)) {
    throw new UnsafeRegexError('regex contains lookbehinds (potential ReDoS)', source);
  }
  try {
    return new RegExp(source, opts.flags);
  } catch (err) {
    throw new UnsafeRegexError(
      `invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      source,
    );
  }
}

// Bounded test that gives up after timeout-ms. RegExp.test is single-threaded
// and there's no native timeout; we instead pre-validate via compileSafeRegex
// and additionally cap input length so worst-case CPU is bounded.
const MAX_INPUT_LEN = 4096;
export function safeTest(rx: RegExp, input: string): boolean {
  if (input.length > MAX_INPUT_LEN) input = input.slice(0, MAX_INPUT_LEN);
  return rx.test(input);
}
