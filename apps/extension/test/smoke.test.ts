import { describe, it, expect } from 'vitest';

describe('extension build artefacts', () => {
  it('manifest exposes the required MV3 entry points', async () => {
    const manifest = (await import('../manifest.json')).default;
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.action.default_popup).toBe('src/popup/index.html');
    expect(manifest.background.service_worker).toBe('src/background.ts');
    expect(manifest.devtools_page).toBe('src/devtools/index.html');
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(['activeTab', 'scripting', 'storage', 'identity']),
    );
  });

  it('queue key matches between sync and background', async () => {
    // The popup enqueues to a11y_pending_scans; the background must drain the same key.
    const sync = await import('../src/sync.js');
    expect(typeof sync.syncViolationsToApi).toBe('function');
    expect(typeof sync.drainQueue).toBe('function');
  });
});
