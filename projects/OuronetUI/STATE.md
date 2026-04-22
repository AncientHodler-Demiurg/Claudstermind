# State — OuronetUI

- **Version at close:** `0.30.0` (from `src/constants/version.ts`, commit `<pending>` on `dev`)
- **Open plan:** [`docs/EXTRACT_OURONET_CORE_PLAN.md`](../../../OuronetUI/docs/EXTRACT_OURONET_CORE_PLAN.md) — Phases -1.1, -1.3, -1.2, 1, 2a, 2b, 2c, 3a, 3b.1, 3b.2, 3b cleanup, 4, **5** complete. **Phase 6 next** (final) — docs cleanup.
- **Companion repo state:** `D:/_Claude/OuronetCore/` at tag `v0.10.0` (commit `b5af2c9` on `main`), version `0.10.0`. **Published to GitHub Packages** under `@stoachain/ouronet-core`. Both CIs green.
- **Last session (2026-04-22):** Phase 5 — the publish-and-switch milestone. Core v0.10.0 goes live on GitHub Packages; OuronetUI swaps its dependency from `file:../OuronetCore` to `^0.10.0`. **Ploi dev/main deploys recover** — they've been red since Phase 2c (earlier same day, commit a1f9081a86) purely because `file:` paths don't resolve on machines without a sibling checkout. End of that window.
  - **Core additions:**
    - `.github/workflows/publish.yml` — on v*-tag push, auto-publish to GH Packages under @stoachain. Uses the built-in `GITHUB_TOKEN` with `packages: write` — no cross-org PAT needed. Version parity check (tag must match package.json) bakes in safety.
    - Tag `v0.10.0` pushed → workflow ran → first published artifact. From here on, every core release is `git tag v$VERSION && git push --tags`.
  - **UI changes:**
    - `.npmrc` NEW — `@stoachain:registry=https://npm.pkg.github.com` with `${NPM_TOKEN}` auth. Local dev exports NPM_TOKEN (PAT with read:packages); CI sources from FIRSTSECRET repo secret.
    - `package.json`: `"@stoachain/ouronet-core": "file:../OuronetCore"` → `"^0.10.0"`.
    - `.github/workflows/build.yml`: dropped the sibling OuronetCore checkout + "Install OuronetCore deps" step — no longer needed since the package is a registry dep. Also dropped `actions/checkout@v4` `path: OuronetUI` nesting. From 73 lines to 54.
    - Version bump `0.29.8 → 0.30.0` as the migration-done marker (Phase 6 docs-cleanup will land at v0.30.x; ship 1.0.0 after that).
  - **Local dev note:** cross-repo hot-reload now goes through `npm link` instead of the old `file:` dep. `cd OuronetCore && npm link` then `cd OuronetUI && npm link @stoachain/ouronet-core` restores the "edit core, UI sees it" flow. `npm unlink @stoachain/ouronet-core` to restore registry resolution.
- **Known outstanding:**
  - **Phase 6** (final, ~0.5 day) — docs cleanup. Update CLAUDE.md (remove stale "Kadena Integration" file-path table that references moved files; add a "Shared Core" section), update `docs/CFM_BUILD_GUIDE.md`, cross-link READMEs between OuronetCore ↔ OuronetUI ↔ HUB_HANDOFF. After Phase 6: core v1.0.0 tag as the symbolic migration-complete release.
- **User directives in play:**
  - Migration workflow: Flow A throughout (develop with `file:` link, publish at the end). THIS IS THE END — flow transitions here. From this commit forward, core is a normal registry dep and new changes are `npm version` + tag push.
- **Drift notes:** none. Every phase shipped with local `npm run validate` green + core tests green (193 pass). No behavioural drift; purely structural moves across 5 phases.
