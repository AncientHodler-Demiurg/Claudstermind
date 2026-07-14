# Conventions — OuronetUI

> Project-specific rules. Cluster-wide rules live in [`../../meta/shared-conventions.md`](../../meta/shared-conventions.md) and take precedence except where explicitly overridden below.

## Custom day-counter versioning (not semver)

Format: `v0.<day>.<n>[letter]` — e.g. `v0.29.1c`.

- `<day>` is a monotonic day counter that increments by **1** whenever the calendar date of a commit is a new day relative to the previous version's day. Not day-of-month — treat as an opaque counter.
- `<n>` is the commit counter within that day, starting at 1.
- Letter suffixes (`1a`, `1b`…) are **reserved** for refinement commits authorised by the `Exec Refinement:` prompt prefix. Plain `Exec:` uses number-only bumps.

**New-day bump rule:** before every commit, verify today's date vs. the date of the previous commit's version. If different → bump `<day>` and reset `<n>` to 1. Example chain across a day boundary: `v0.27.4` (2026-04-20) → `v0.28.1` (2026-04-21, new day) — NOT `v0.27.5`.

## Commit = version bump + changelog entry (no exceptions)

Every commit MUST:

1. Bump `src/constants/version.ts` (`APP_VERSION`).
2. Prepend a new entry to `src/constants/changelog.ts` (newest at top).

Changelog entry shape:

```ts
{
  version: "0.29.1",        // no leading 'v'
  date: "22.04.2026",       // DD.MM.YYYY
  time: "HH:MM",            // optional, omit if unknown
  title: "<imperative summary>",
  changes: [
    "<bullet 1 — user-facing phrasing>",
    "<bullet 2>",
  ],
}
```

Bullets are for the HUMAN reading at `/app/changelog`. Include root cause when it's a bug fix. Avoid internal jargon.

## `Exec:` / `Exec Refinement:` / no-prefix conventions

- **`Exec:`** at the start of a user message → implement + commit + number-only version bump.
- **`Exec Refinement:`** → implement + commit + **letter-suffix** version bump (continues under the current number).
- **No prefix** → discuss only. Do NOT implement or commit without explicit authorisation. Ask before coding.

## Commit & push cadence

- **Commits:** only when the user explicitly says "commit" or its equivalent. Don't commit after every edit; multiple edits can accumulate locally via live-reload until approved.
- **Push to `dev`:** when the user asks. Verify build first.
- **Push to `master`:** rare; explicit ask only. Merge from dev with `--no-ff` so the release point is visible:
  ```
  git checkout master && git pull --ff-only && \
    git merge dev --no-ff -m "merge: dev → master (v<version>)" && \
    git push origin master && git checkout dev
  ```
- **Mandatory pre-push verification** (both dev and master): `npm run typecheck` + `npm run build` clean. Tests run in CI on the push itself.
- **Windows bash + Node.js on PATH:** `npm` is not on the default bash PATH on the dev box. Prefix commands with:
  ```
  export PATH="/c/Program Files/nodejs:$PATH" && npm ...
  ```

## Backfill rule

If a prior version was committed without a changelog entry, add the missing entry in the same commit that introduces the next version. Don't create a separate "docs" commit.

## Claude does not push workflow files without `workflow` scope

Pushes that touch `.github/workflows/*.yml` require the PAT to have the `workflow` scope. User's current PAT at `.secrets/github-token.txt` has it. If that token is ever rotated without the scope, git pushes will fail with "refusing to allow a Personal Access Token to create or update workflow" — regenerate with the scope.

## Git push mechanism (security-critical)

Tokens NEVER enter chat. Never. Mechanism:

- `.secrets/github-token.txt` (local, gitignored) holds the PAT.
- Git remote URL is clean (`https://github.com/…/OuronetUI.git`) — no embedded credentials.
- Push uses git's `credential.helper` inline, which git is designed NOT to echo:
  ```bash
  GIT_TERMINAL_PROMPT=0 git \
    -c credential.helper= \
    -c credential.helper='!f() { echo username=x-access-token; echo "password=$(cat .secrets/github-token.txt | tr -d "[:space:]")"; }; f' \
    push origin dev
  ```

If a token ever appears in terminal output (e.g. baked into a remote URL), treat it as compromised — revoke immediately, rotate, move on.

## CI secret name quirk

The cross-org OuronetCore read token in GitHub Actions is stored as `FIRSTSECRET` on the OuronetUI repo (not `OURONET_CORE_TOKEN` as the plan originally wrote). The workflow references `${{ secrets.FIRSTSECRET }}`. Rename when convenient; not blocking.

## Extraction-phase conventions (active through 2026)

- **One phase per commit series.** A phase may land in multiple commits (`v0.28.7 → v0.28.7a → v0.28.7b … v0.28.7e`) but one phase does not mix with the next in a single push.
- **Stop-gate per phase.** Every phase ends with a green CI run + an explicit user-side smoke test (or explicit "no smoke needed") before the next phase starts.
- **OuronetCore version bumps on every extraction push.** `D:/_Claude/OuronetCore/package.json` + `CHANGELOG.md`. Separate push, lands before OuronetUI's matching push so the file: link resolves the new contract.
- **Rollback = git revert the phase commit.** Never amend, never force-push. Each phase is a deterministic revert target.

## StoaChain™ branding

User-facing mentions of the chain render as **StoaChain™** — bold, color `#facc15`, with the ™ symbol. Applies to UI strings that a user will see. Commit messages, changelog titles, code comments, docs: plain `StoaChain` is fine.

## Code style (overrides + extensions of cluster rules)

In addition to cluster-wide [`../../meta/shared-conventions.md`](../../meta/shared-conventions.md):

- **Lint not CI-gated (yet).** `npm run lint` has ~400 pre-existing errors from before the extraction started. Not blocking. Fix in a dedicated lint-sweep phase after extraction lands.
- **No `console.log` in shipped code.** Debug logs are fine in dev, but strip before `Exec:`-ing a commit that touches them.
- **File-size soft cap 300 lines.** Split bigger files. Especially enforced in `src/components/*CFMModal.tsx` which have tended to grow.
- **Import style:** always prefer scoped-subpath `@stoachain/ouronet-core/guard` over barrel `@stoachain/ouronet-core`. Tree-shaking friendly + makes the dependency footprint legible.

## Hard don'ts (project-specific, override cluster if in conflict)

- **Don't add EVM-compat code** to any signing path. StoaChain is Pact-maximalist; this is cluster-wide too but worth restating here because the DEX UI is where someone might be tempted.
- ~~Don't run the dev server from Claude's side.~~ **Reversed 2026-04-22.** Owner prefers Claude drives the dev server too (start / restart as needed) since Windows reboots kill it and the owner doesn't want to manage it manually. Use `run_in_background: true` so the Bash tool doesn't block on the long-running process; verify startup by tailing the output file, then confirm `localhost:5173` responds HTTP 200 before telling the owner it's up.
- **Don't publish `@stoachain/ouronet-core` yet.** Phase 5 handles that. The current `file:` link is intentional.
- **Don't touch `docs/EXTRACT_OURONET_CORE_PLAN.md` casually.** It's the active plan — edits land only when a decision actually changes. Don't restate phase contents in commit messages; link to the doc instead.
