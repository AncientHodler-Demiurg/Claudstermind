---
name: ci-cd
description: "CI/CD standards -- GitHub Actions, deployment pipelines, preview environments, automated testing. Use when project has .github/workflows/ directory or CI configuration."
---

# CI/CD Standards

**Detection:** Check for `.github/workflows/` directory, `Jenkinsfile`, `.gitlab-ci.yml`, or `bitbucket-pipelines.yml`. If absent, skip.

## GitHub Actions

### Basic CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm type-check
      - run: pnpm test -- --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/

  e2e:
    runs-on: ubuntu-latest
    needs: lint-test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

### Deploy Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile && pnpm build
      - run: ./scripts/deploy.sh
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

## Pipeline Rules

- **CI runs on every PR** — lint, type-check, test. Block merge on failure.
- **Deploy only from main** — never deploy from feature branches to production.
- **Concurrency groups** — cancel in-progress CI for the same branch on new push.
- **Cache dependencies** — use `actions/setup-node` with `cache: 'pnpm'`.
- **Artifacts on failure** — upload test reports and screenshots when tests fail.
- **Environment secrets** — use GitHub Environments with required reviewers for production.
- **No secrets in logs** — use `${{ secrets.* }}`, never echo secrets.

## Common Pitfalls

- **No `--frozen-lockfile`** — CI installs different versions than local dev. Always freeze.
- **Missing concurrency cancel** — old CI runs waste resources when new commits push.
- **Secrets in forks** — `pull_request` from forks don't have access to secrets. Use `pull_request_target` carefully.
- **No cache** — cold installs on every run. Cache `node_modules` or use built-in setup-node cache.
- **E2E without artifacts** — when Playwright fails without trace/screenshot upload, debugging is impossible.
- **Deploy without CI gate** — deploying without passing tests. Use `needs: lint-test` dependency.
