// Build → zip a sideload-ready package. CI signs and uploads to the internal
// CDN; a corresponding updates.xml lists the latest version (T-025 update server).
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');
const out = resolve(root, 'package');

if (!existsSync(dist)) {
  console.error('dist/ not found — run `pnpm build` first.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const zipName = `a11y-extension-${manifest.version}.zip`;
execSync(`cd "${dist}" && zip -r "${resolve(out, zipName)}" .`, { stdio: 'inherit' });

// Generate the update manifest Chrome polls.
const updates = `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="REPLACE_WITH_EXTENSION_ID">
    <updatecheck codebase="https://internal-cdn.example.com/a11y/${zipName}" version="${manifest.version}"/>
  </app>
</gupdate>
`;
writeFileSync(resolve(out, 'updates.xml'), updates, 'utf8');
console.log(`packaged: ${zipName}`);
console.log('upload to internal CDN; configure GPO/MDM to force-install.');
