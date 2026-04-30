# Enterprise sideload (T-025)

The extension is distributed only via enterprise force-install policy — never
the public Chrome Web Store.

## Build & package

```bash
pnpm --filter @a11y/extension build
pnpm --filter @a11y/extension package
# → apps/extension/package/a11y-extension-<version>.zip + updates.xml
```

## Hosting

Upload the zip and `updates.xml` to the internal CDN (e.g.,
`https://internal-cdn.example.com/a11y/`). The extension queries the
`updatecheck` URL on browser startup; new versions install within ~24h.

## GPO / MDM force-install

Set the `ExtensionInstallForcelist` policy to:

```
<extension-id>;https://internal-cdn.example.com/a11y/updates.xml
```

The extension ID is generated from the public key in the signed `.crx`. Build
once, take the resulting ID from `chrome://extensions`, and replace
`REPLACE_WITH_EXTENSION_ID` in `scripts/package.mjs` (or thread it through env).

## Signing

CI signs the `.crx` with the company-owned private key (kept in AWS Secrets
Manager). The public key in the manifest pins the extension ID — never rotate
without coordinating an org-wide reinstall.
