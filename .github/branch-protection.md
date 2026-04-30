# Branch protection setup (manual, applied via GitHub UI or API)

The CI workflow alone cannot block merges — branch protection rules on `main`
must be configured to enforce them. Apply once, then leave alone.

## Required settings on `main`

- Require a pull request before merging
  - Require approvals: **1**
  - Dismiss stale approvals when new commits are pushed
  - Require review from CODEOWNERS
- Require status checks to pass before merging
  - **CI success** (the aggregator job in `.github/workflows/ci.yml`) — required
  - Require branches to be up to date before merging
- Require linear history
- Do not allow bypassing the above settings (admins included)

## GitHub Environments

Two environments are referenced by the deploy workflows:

- `staging` — auto-deploys on every push to `main` (no reviewers required)
- `production` — **required reviewers** configured here. This is what enforces
  the "production deploy is manual approval" AC. Set at minimum:
  - Required reviewers: 1 from `@platform-team`
  - Allow administrators to bypass: **off**
  - Wait timer: 0 (gating is by review, not by clock)

## Repo variables expected by the deploy workflows

| Variable                     | Used in           | Purpose                   |
| ---------------------------- | ----------------- | ------------------------- |
| `STAGING_DEPLOY_ROLE_ARN`    | deploy-staging    | OIDC AWS role for staging |
| `PRODUCTION_DEPLOY_ROLE_ARN` | deploy-production | OIDC AWS role for prod    |
| `AWS_REGION`                 | both              | AWS region                |
| `ECR_REGISTRY`               | both              | ECR registry URL          |
| `STAGING_CLUSTER`            | deploy-staging    | EKS cluster name          |
| `PRODUCTION_CLUSTER`         | deploy-production | EKS cluster name          |
| `STAGING_URL`                | deploy-staging    | Public URL for smoke test |
| `PRODUCTION_URL`             | deploy-production | Public URL for smoke test |

No long-lived AWS access keys are stored as secrets — auth is OIDC only.
