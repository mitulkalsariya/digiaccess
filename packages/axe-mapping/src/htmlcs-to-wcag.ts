// HTMLCS (Pa11y default runner) emits codes like:
//   "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail" → SC 1.4.3
// Parse the underscore-encoded SC identifier out of the code.
const SC_RX = /Principle\d\.Guideline[\d_]+\.(\d+)_(\d+)_(\d+)\./;

export function htmlcsCodeToSc(code: string): string | undefined {
  const m = SC_RX.exec(code);
  if (!m) return undefined;
  return `${m[1]}.${m[2]}.${m[3]}`;
}
