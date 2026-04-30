// Re-exports kept for the original tests / external imports during the workspace
// transition. Real entry points are popup, devtools, content, background.
export {
  runScanInActiveTab,
  type ExtensionScanResult,
  type ExtensionViolation,
} from './scan/run.js';
export { highlightViolation } from './scan/highlight.js';
export { syncViolationsToApi, drainQueue } from './sync.js';
export { signIn, signOut, getAuthToken } from './auth.js';
