# Conventions — AncientHoldings

## Overrides

None today. The project follows cluster-wide conventions verbatim.

## Extensions (project-specific)

- **Version suffix is mandatory on every dev patch** — `0.7.6a-dev` → `0.7.6b-dev`. Worker banners the suffix; owner tracks progress by watching the letter change. Skip only for cosmetic changes that don't touch `lib/` or `worker/`.
- **Worker lifecycle belongs to Claude.** After any change in `lib/handlers/**` or anywhere worker code runs, Claude verifies (a) the worker is on `npm run worker:watch`, (b) the banner printed the new version. Owner never manages the worker.
- **Admin 404 convention.** All `pages/api/admin/*` routes must use `requireAdminApi()` / `requireOwnedNodeApi()` / `requireAncientAdminApi()` which respond 404 on failure, never 403. New routes that respond 403 to unauthorised callers are a bug.
- **Fresh-confirm for destructive admin actions.** Any action that deletes, transfers ownership, resets state, or rotates secrets must be gated by `requireFreshAdminConfirmApi()` + a site-styled confirm modal (`useConfirm`), not the browser-native `window.confirm()`.
- **Migrations are SQLite files numbered zero-padded** (`019_stoic_power.sql`, etc.) in `db/migrations/`. Never apply a migration out-of-band with `node -e "..."` — breaks the `schema_migrations` tracker. If forced to, also insert the tracker row in the same transaction.
- **SSH commands from handlers time out at 20 min max.** `runRemote` timeout > 20 min is a code smell; split into smaller ops or use background jobs on the target.
- **No `window.confirm` / `window.alert`.** All modals in the admin UI go through `lib/useConfirm.tsx` (site-styled, dark/gold theme).
- **No EVM integrations.** StoaChain is Pact-maximalist; EVM-adjacent libraries, helpers, or patterns are rejected on principle. If an upstream chainweb PR adds EVM, we cherry-pick around it.
