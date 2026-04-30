# A11y Audit Tool (Internal)

Internal Chrome extension + API platform for auditing company web apps against
WCAG 2.2 AA, using axe-core, Pa11y, and Playwright with support for authenticated flows.

## Workspace layout

```
apps/
  api/         Fastify API + scan workers
  dashboard/   Next.js dashboard
  extension/   Chrome MV3 extension
packages/
  shared-types/   Cross-app TypeScript types
  wcag-rules/     WCAG 2.2 mapping table
  axe-mapping/    axe rule → WCAG SC mapping
infra/
  Terraform / Helm / Docker (added in T-003, T-008)
```

## Prerequisites

- Node.js >= 20
- pnpm >= 9

## Common commands

```bash
pnpm install           # install all workspace deps
pnpm build             # build every package + app
pnpm type-check        # typecheck every workspace
pnpm lint              # lint every workspace
pnpm test              # run tests across workspaces
pnpm format            # prettier write
```

## Implementation status

Tickets are tracked in `Accessibility_Audit_Tool_Project_Tickets.xlsx`.
Implementation proceeds in dependency order; current state corresponds to the
last completed ticket noted in commits.
