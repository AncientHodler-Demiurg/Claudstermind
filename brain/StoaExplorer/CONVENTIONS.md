# Conventions — StoaExplorer

> Project-specific rules. Cluster-wide rules live in [`../../meta/shared-conventions.md`](../../meta/shared-conventions.md) and take precedence except where explicitly overridden below.

## Versioning (same scheme as OuronetUI)

Custom day-counter versioning, **not** semver. Format: `v0.<day>.<n>[letter]`. Version lives at [`frontend/src/constants/version.ts`](../../../StoaExplorer/frontend/src/constants/version.ts); the same file holds the `CHANGELOG` array that renders at `/update-logs`.

- `<day>` bumps when the calendar date of a commit is a new day relative to the previous version's date
- `<n>` is the commit counter within that day, starting at 1
- Letter suffixes (`1a`, `1b`…) indicate refinement commits under the same `<n>`

**Commit = version bump + changelog entry.** Every commit that a user could see the effect of must:

1. Bump `APP_VERSION` in `frontend/src/constants/version.ts`
2. Prepend a new entry to the `CHANGELOG` array (newest at top)

Changelog entry shape (same as OuronetUI's):

```ts
{
  version: "0.5.1",
  date: "23.04.2026",       // DD.MM.YYYY
  title: "<imperative summary>",
  changes: [
    "<bullet 1 — user-facing phrasing>",
    ...
  ],
}
```

Docs-only commits (README / CLAUDE.md / Claudstermind scaffolding) do **not** need a version bump. The rule is "if a user could see the effect".

The backend has no separate version file — the frontend version is the project version.

## No `Exec:` / `Exec Refinement:` prefixes

OuronetUI uses `Exec:` / `Exec Refinement:` prompt prefixes to gate commits. **StoaExplorer does not.** Commits happen when the owner says "commit" or equivalent, following the cluster's safety rule (no commit without explicit ask). Commit-message style here is conventional-commits (`feat:`, `fix:`, `chore:`) — see `git log` for examples.

## Chain count — 10, never 20

`sync.service.ts:76` emits `chainCount: 10`. Older README prose says 20. The chain is 10. Do not "fix" 10 → 20. If you find a stray 20, it's a bug — the reference is the shared fact in [`../../meta/shared-facts.md`](../../meta/shared-facts.md) §StoaChain ≠ Kadena.

## One Chainweb client — `KadenaService`

Never add a second axios/fetch path to the chain node. If `AccountsService` or a new feature needs live chain data, add the method to `KadenaService` and consume it. This is the same rule as OuronetCore's `@stoachain/ouronet-core/network` for the OuronetUI stack — consolidated access.

## TypeORM migrations vs `synchronize`

- **Dev default:** `synchronize: true` is on (`NODE_ENV !== 'production'` or `TYPEORM_SYNC=true`). Additive entity edits auto-migrate — no migration needed for adding columns / tables.
- **Write a migration when:** the change is non-additive (column rename, drop, data transform, index rebuild) OR when the change must also apply in production (prod has `synchronize: false`).
- **Never edit an already-run migration.** Write a new one. The 4 existing migrations in `backend/src/migrations/` have run on every dev DB in existence.
- **Don't rely on `synchronize` for renames.** It silently drops the old column and creates the new one — no data migration. Always write an explicit migration for renames.

## Testing layout

- Tests are `*.spec.ts` files colocated next to their source (Jest `rootDir` is `src/`).
- Match that layout when adding tests. Suite covers services, controllers, the gateway, and `KadenaService`'s HTTP mocks. ~157 tests per README.
- `npm run test:e2e` uses `test/jest-e2e.json`; unit `npm test` uses the inline Jest config in `backend/package.json`.

## File-size soft cap

~250–300 lines. Split services before they grow past that. The `sync` module is the precedent: it was split into `sync.service.ts` + `transfer-extractor.service.ts` when the extractor logic grew.

## Docker-first workflow

- `docker compose -f docker/development/docker-compose.yml up -d` is the canonical dev entry point. Host-level `npm` installs only exist for IDE intellisense.
- Exec into containers: `docker exec explorer_backend_dev npm test`. Logs: `docker logs explorer_backend_dev -f`.
- Do **not** run `npm run dev` (frontend) or `npm run start:dev` (backend) from Claude's side. Owner hosts the stack. Claude drives `docker compose`, typecheck, tests, git.

## Ports & env defaults

- **Ports:** backend `3000`, frontend `5173`, postgres `5432`, redis `6379` (Swagger at `:3000/api`)
- **Env defaults:** `KADENA_NODE_URL=http://129.212.143.119:1848`, `KADENA_NETWORK_ID=stoa`, `KADENA_API_VERSION=0.0`
- **If compose and `configuration.ts` disagree, compose wins at runtime.** Don't "fix" `configuration.ts` to match the older README examples (`mainnet01` / `3100` / `5450` / `6400`) — they are stale.

## Frontend build — keep the `rolldown-vite` override

`frontend/package.json` has:

```json
"overrides": { "vite": "npm:rolldown-vite@7.2.5" }
```

Don't drop it without verifying the build. React 19 + Tailwind v4 + the current rolldown-vite version is the working combo. The stock Vite fallback may work but hasn't been tested recently.

## Hard don'ts (project-specific)

- **Don't add a second HTTP client to the node.** Use `KadenaService`.
- **Don't "fix" `chainCount: 10`.** See above.
- **Don't commit without the version bump + changelog entry** for user-visible changes.
- **Don't drop the `rolldown-vite` override.**
- **Don't touch `START_HEIGHT` casually.** Changing it re-indexes the whole DB.
- **Don't run the dev server from Claude's side** (ports 5173 / 3000 belong to the owner).
