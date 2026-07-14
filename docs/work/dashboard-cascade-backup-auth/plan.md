# Plan — Cascade view, archive backup/restore, AncientHub auth

## Wave 1 — auth core (portable logic + tests)
- [x] 1.1 Add `jose` dependency to `dashboard/package.json`; `npm install`.
- [x] 1.2 `dashboard/auth/pkce.mjs` — port `pkce.ts` 1:1 (node:crypto only): `createLoginChallenge()`, `deriveCodeChallenge()`.
- [x] 1.3 `dashboard/auth/idToken.mjs` — port `idToken.ts`: `verifyIdToken()` pinning issuer + audience + `algorithms:["RS256"]` + nonce + `clockTolerance:60`, key on `sub`; `hasAncientRole()`; `hasModernRole()`.
- [x] 1.4 `dashboard/auth/session.mjs` — port `session.ts`: HS256-signed login-state (10 min) + session (8 h) cookies with a `purpose` claim so they can't be interchanged.
- [x] 1.5 `dashboard/auth/discovery.mjs` — port `discovery.ts`: cached discovery (1 h TTL), `createRemoteJWKSet`, **including the `resolveJwksUri` 308-follow fix**.
- [x] 1.6 `dashboard/auth/oidcConfig.mjs` — env → config; `null` when OIDC env unset ⇒ **auth disabled (local mode)**; throws on a PARTIAL env.
- [x] 1.7 `dashboard/auth/auth.test.mjs` — 19 tests: HS256-forgery, issuer/audience/nonce/exp/unknown-key rejection, role tiers, PKCE derivation, cookie purpose separation, config modes.

## Wave 2 — auth transport + gating
- [x] 2.1 `dashboard/auth/routes.mjs` — `postForm()` manual redirect-follow; `handleAuthRoute()` (/auth/login, /auth/callback, /auth/logout); `guard()`; `readSessionFromHeader()` duplicate-cookie tolerance.
- [x] 2.2 `dashboard/auth/routes.test.mjs` — 10 tests: 308 body preservation, cross-origin auth-header preservation, guard matrix, forged-cookie rejection.
- [x] 2.3 `server.mjs` — wired routes + the `guard()` gate. Local ⇒ all open. Live ⇒ 302/401 unauthenticated, 403 for `modern` mutations, 403 `local-only` for machine actions.
- [x] 2.4 `GET /api/me` — answered BEFORE the gate (the UI must be able to learn it is logged out).

## Wave 3 — Cascade tab
- [x] 3.1 `lib/waspState.mjs` — parse a wasp `state.md`: fields, markdown tables → gates, run history, failure context.
- [x] 3.2 `lib/cascade.mjs` + `GET /api/cascade` — master + per-workspace + per-repo state; `{everRun:false}` when nothing has run.
- [x] 3.3 `viewCascade()` + the "Cascade" tab — 2 s poll, progress tree with ✅/⏳/❌/⏭️ gates, run history, failure context, graceful empty state.

## Wave 4 — archive backup + restore
- [x] 4.1 `orchestrator/backup.mjs` — rewritten around `tar`; dated `claude-<ISO>-<id>.tar`; idle gate + `--force`; registry append.
- [x] 4.2 `orchestrator/restore.mjs` — `--id` + `--confirm <id>` (the id must be typed back); idle gate; `--dry` lists contents.
- [x] 4.3 `orchestrator/archives.mjs` + `GET /api/backups` + `POST /api/restore`.
- [x] 4.4 Ops tab — archive table with sizes, Restore with a typed-id confirm. Whole tab removed in live mode.

## Wave 5 — verify
- [x] 5.1 Test suites: **52/52 pass**.
- [x] 5.2 LOCAL boot: every endpoint 200, `/api/cascade` graceful empty, cascade fixture rendered live then removed.
- [x] 5.3 LIVE boot (fake OIDC env): unauthenticated 302/401, forged cookie 401, `modern` POST 403, `ancient` POST 403 `local-only`, `/auth/login` resolved the REAL hub discovery doc.

## Self-review of this plan
- W1 has no deps; W3 and W4 are independent of auth and of each other — only W2 depends on W1, and W4.3/4.4 touch the same `server.mjs` as W2.3, so **W2 lands before W4.3** to avoid a merge conflict in the request path. (Held: server.mjs was wired once, after W1–W4 logic existed.)
- Risk: `tar` on Win10 with long paths / `.git` — mitigated by capturing tar's exit code + stderr and surfacing it rather than claiming success. **Retired:** a real archive→delete→extract round-trip passes in the test suite.
- Risk: hand-rolling JWT verify — explicitly avoided via `jose` (see design Decisions).
