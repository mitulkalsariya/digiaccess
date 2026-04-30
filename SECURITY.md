# Security posture

This document tracks how the codebase addresses each finding from the security
review (S-1 … S-24). Items marked **shipped** are enforced by code + tests; items
marked **deferred** require infrastructure or operational work tracked separately.

## Critical

| #   | Finding                                          | Status      | Where                                                                                                              |
| --- | ------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| S-1 | Insecure default secrets fail-fast in production | **shipped** | [config.ts](apps/api/src/config.ts), tests in [config.test.ts](apps/api/test/config.test.ts)                       |
| S-2 | SSRF guard before scan submission                | **shipped** | [url-guard.ts](apps/api/src/scan/url-guard.ts), tests in [url-guard.test.ts](apps/api/test/url-guard.test.ts)      |
| S-3 | KMS envelope encryption for vault                | **shipped** | [kms-envelope.ts](apps/api/src/auth-profiles/kms-envelope.ts) + new prisma migration `20260430120000_kms_envelope` |
| S-4 | Extension OAuth 2.1 code+PKCE flow               | **shipped** | [auth-extension.ts](apps/api/src/routes/auth-extension.ts) + [extension/auth.ts](apps/extension/src/auth.ts)       |

## High

| #    | Finding                                     | Status      | Where                                                                                                                    |
| ---- | ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| S-5  | Refresh-token families + reuse detection    | **shipped** | [refresh-tokens.ts](apps/api/src/auth/refresh-tokens.ts)                                                                 |
| S-6  | Stricter rate limit on auth routes (10/min) | **shipped** | [routes/auth.ts](apps/api/src/routes/auth.ts) + [auth-extension.ts](apps/api/src/routes/auth-extension.ts)               |
| S-7  | ReDoS-safe regex in crawler filters         | **shipped** | [safe-regex.ts](apps/api/src/scan/safe-regex.ts)                                                                         |
| S-8  | Explicit `TRUST_PROXY` (no blind trust)     | **shipped** | config + [server.ts](apps/api/src/server.ts)                                                                             |
| S-9  | `isPrivate` enforced on read + list         | **shipped** | [routes/scans.ts](apps/api/src/routes/scans.ts)                                                                          |
| S-10 | Comprehensive logger redaction list         | **shipped** | [logger.ts](apps/api/src/logger.ts)                                                                                      |
| S-11 | Jira/Slack/Teams creds via vault            | **shipped** | `createNamedSecretStore` in [store.ts](apps/api/src/auth-profiles/store.ts), `resolveJiraConfig` / `resolveNotifyConfig` |
| S-12 | `core.setSecret` on GitHub Action token     | **shipped** | [github-action/src/index.ts](integrations/github-action/src/index.ts)                                                    |

## Medium

| #    | Finding                                                   | Status       | Where                                                                                                                                                                                    |
| ---- | --------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-13 | Playwright `--no-sandbox` is a residual risk              | **deferred** | Mitigated by S-2 (no internal targets) + restricted PSS (S-16) + pod NetworkPolicy (S-15). Full sandbox isolation requires gVisor/Kata or single-tenant per-scan VMs — operational work. |
| S-14 | Container ships only prod deps                            | **shipped**  | [api.Dockerfile](infra/docker/api.Dockerfile) (4-stage build with separate `deps --prod` stage)                                                                                          |
| S-15 | NetworkPolicy on workload                                 | **shipped**  | [networkpolicy.yaml](infra/helm/a11y/templates/networkpolicy.yaml)                                                                                                                       |
| S-16 | PSS-restricted namespace                                  | **shipped**  | [namespace.yaml](infra/helm/a11y/templates/namespace.yaml) + per-pod `securityContext`                                                                                                   |
| S-17 | SAST in CI (CodeQL)                                       | **shipped**  | [.github/workflows/codeql.yml](.github/workflows/codeql.yml)                                                                                                                             |
| S-18 | Postgres row-level security                               | **shipped**  | migration `20260430130000_row_level_security` + [rls-context.ts](apps/api/src/auth/rls-context.ts)                                                                                       |
| S-19 | CSRF double-submit on cookie-authed POST/PUT/PATCH/DELETE | **shipped**  | [csrf.ts](apps/api/src/auth/csrf.ts), tests in [csrf.test.ts](apps/api/test/csrf.test.ts)                                                                                                |

## Low / informational

| #    | Finding                                  | Status       | Where                                                                                                                                                                                                             |
| ---- | ---------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-20 | RS256 signing via KMS instead of HS256   | **deferred** | Symmetric JWT is acceptable for an internal monolith. Migrating to RS256 with KMS-stored keys is straightforward (replace `app.jwt.sign` config) and should be paired with rotation. Track as a follow-up ticket. |
| S-21 | Jira reopen transition lookup is dynamic | **shipped**  | [jira.ts](apps/api/src/integrations/jira.ts)                                                                                                                                                                      |
| S-22 | CLI hidden stdin prompt for token        | **shipped**  | [cli.ts](integrations/cli/src/cli.ts)                                                                                                                                                                             |
| S-23 | Audit-log metadata size cap (16KB)       | **shipped**  | `writeAuditLog` in [store.ts](apps/api/src/auth-profiles/store.ts)                                                                                                                                                |
| S-24 | File-mounted secrets in Helm             | **shipped**  | [api-deployment.yaml](infra/helm/a11y/templates/api-deployment.yaml) (projected volume → `/run/secrets/...`) + `*_FILE` env support in [config.ts](apps/api/src/config.ts)                                        |

## Operational checks every release should verify

- `pnpm audit --audit-level high` is green (CI gate)
- CodeQL run for the SHA has no new alerts (CI gate)
- Branch protection on `main` requires CI success aggregator
- Production `KMS_KEY_ARN` is set; vault read at startup succeeds
- `JWT_SECRET` rotation procedure is documented and tested annually
- Refresh-token reuse alarms route to the security-on-call channel
