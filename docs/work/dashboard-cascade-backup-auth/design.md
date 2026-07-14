# Claudstermind dashboard — Cascade view, archive backup/restore, AncientHub auth

## Acceptance criteria (the confirmed outcome)

1. **Cascade tab** — live master-pollinate progress.
   - `GET /api/cascade` reads `D:/_Claude/.wasp/master-state.md`, each workspace's `<ws>/.wasp/state.md`, and per-repo `<repo>/.wasp/state.md`.
   - Dashboard "Cascade" tab polls ~2s and renders: master run status → per-workspace → per-package gates (✅/⏳/❌), run history, failure context.
   - Works whether the run is triggered by a dashboard button **or** by an agent running `/wasp:master-pollinate` in conversation (both write the same state files).
   - Renders "no run in progress" gracefully when `master-state.md` is absent.

2. **Backup = dated archive + restore.**
   - `orchestrator/backup.mjs` creates `X:\_Claude-backup\claude-<ISO-date>-<shortid>.tar` via `tar` (built into Win10).
   - Excludes `node_modules .next dist build .turbo .vite .pnpm-store`; **keeps `.git` and `.secrets`**.
   - Keeps the idle-gate (refuses while agents active unless `--force`).
   - Records each archive in `.claude/activity/backups.json` (`id, date, bytes, path`).
   - List archives + restore-from-archive (extract over `D:/_Claude`) behind a hard confirmation (it overwrites).
   - Wired into the dashboard **Ops** tab: Backup / list / Restore.

3. **AncientHub OIDC auth + role gating.**
   - Ports the proven recipe from `Pythia/apps/pythia/src/admin/` per `docs/HANDOFF-consumer-ancienthub-login.md`.
   - Issuer `https://ancientholdings.eu`; endpoints **feature-detected** via `/.well-known/openid-configuration`; auth-code + **PKCE S256**; `client_secret_basic` at the token endpoint.
   - Includes the handoff's fixes: **manual same-origin redirect-follow** for the token POST (a 308 eats the body), and **full id_token verification** pinning `issuer` + `audience` + `algorithms:["RS256"]` + **nonce** + `clockTolerance`, keying the user on `sub`.
   - Cookies: signed login-state (state+nonce+code_verifier, HttpOnly/Secure/SameSite=Lax, ~10 min, callback-scoped) and site session (HttpOnly/Secure/SameSite=Lax, `path=/`).
   - Routes: `/auth/login`, `/auth/callback`, `/auth/logout`, `/api/me` → `{authenticated, sub, name, roles}`.
   - **Role gating:** `roles.includes("ancient")` ⇒ execute (may POST backup / restore / master-pollinate). `modern` ⇒ **read-only** (all GETs; **403** on any mutation). Unauthenticated on live ⇒ redirect to login.
   - **LOCAL vs LIVE:** when `OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / OIDC_REDIRECT_URI / SESSION_SECRET` are **unset** → auth fully disabled, dashboard behaves exactly as today. When **set** → auth required **and** the local-only actions (Backup, Restore, master-pollinate trigger) are **hidden/disabled entirely**.
   - Security tests ported: HS256-forgery rejection, issuer/audience/nonce mismatch, 308 body preservation.

## Decisions

Autonomous run confirmed 2026-07-14.

- **Add `jose` as the dashboard's single dependency.** Pythia verifies id_tokens with `jose@^5.9.6`; the handoff states plainly that a partial verify *is* an auth bypass. Hand-rolling RS256 on WebCrypto is that exact trap. The dashboard ceases to be strictly zero-dep — the correct price for sound auth.
- **Port near-verbatim, adapt the transport.** Pythia's modules are TypeScript on Hono; the dashboard is plain `node:http` ESM. Logic (pkce, discovery, idToken, session) ports 1:1; only `routes.ts` is re-expressed against `node:http`.
- **Archives via `tar`** (bsdtar ships with Win10). One archive per run, no rotation policy yet.
- **Auth is a wrapper, not a rewrite.** A single `guard()` in the request path decides: local ⇒ allow all; live ⇒ require session, `ancient` for mutations, `modern` read-only.

### Decided in flight

- **Two independent locks, not one.** The confirmed outcome said both "`ancient` ⇒ may execute backup/restore/master-pollinate" *and* "on live, those actions are hidden/disabled entirely" — which conflict. Resolved by separating the **role** lock (`canExecute`) from the **place** lock (`localActionsAvailable`). A machine-local action needs both, so a live `ancient` admin still gets `403 local-only`, and the role check remains meaningful for any future non-local mutation.
- **A partial OIDC env throws instead of falling back to local mode.** "Any var unset ⇒ auth off" would mean one typo'd variable name silently boots the live deployment wide open. All-or-nothing, and it fails loudly.
- **`/api/me` is answered before the gate.** Gating it would leave a logged-out browser unable to discover that it needs to log in. It exposes only identity + roles, never secrets, and is `Cache-Control: no-store` so a cached "authenticated" can't produce a phantom login.
- **Restore requires the archive id typed back**, in both the CLI (`--confirm <id>`) and the browser (a prompt that must match). No blanket `--yes`, and no "restore latest" shortcut — the one irreversible action in the dashboard should be impossible to fire by reflex.
- **A failed package gate raises the top-level cascade flag** even while the run's own `Status:` is still `in-progress` — otherwise the header reads a reassuring "RUNNING" over a broken publish. Shown as `RUNNING ⚠`.
- **The 308 test was rewritten to assert what is actually true.** The handoff's claim (auto-follow drops the POST body) does not reproduce on Node 24: undici preserves method and body across a same-origin 308. The real divergence is the `Authorization` header, which undici strips on a **cross-origin** redirect — so `postForm` is still necessary, and the test now proves the true failure mode instead of a false one. `postForm` is kept verbatim from Pythia regardless: it is correct under both behaviours.
- **`activity.mjs` had to learn that `backups.json` is not a session heartbeat** — it globs `*.json` in the activity dir, so the new registry file would have been parsed as a (dead) agent session. Now an allowlist (`sessionId` + numeric `ts`), not a denylist: this gate is what stands between a live agent's edits and `tar -xf`, and "it's a session unless someone remembered to blacklist it" is the wrong default there.

### Decided during review (all three lenses found real defects; every one is fixed)

- **The tar binary is pinned to `System32\tar.exe`, never taken from `PATH`.** In a Git-Bash `PATH`, a bare `tar` resolves to GNU tar 1.32, which reads `X:\_Claude-backup\…` as a *remote host* named `X` and dies. Whether the backup worked would otherwise depend on which shell launched it. The PowerShell-run tests passed while the same code failed under bash — which is exactly why the binary is now explicit.
- **`exit 1` from tar is not automatically a warning.** bsdtar returns 1 both for "a file changed while I read it" (harmless) and for "I could not stat something and gave up" (fatal). The second case produced a **167 KB "backup" of a 1.9 GB workspace** and reported `ok: true`. The stderr is now classified: unless every line is a known-benign warning, exit 1 is a failed backup and the stump is deleted. `status === null` (killed / maxBuffer) is likewise a failure, not a `-1 <= 1` success.
- **Archives are written to `.partial` and renamed only after verification.** tar streams to disk, so a crash or an unplugged drive would otherwise leave a truncated file sitting at the *final* name — where it lists as the newest archive and is offered as the one-click "latest" restore point. Rename on the same volume is atomic. Archives with no verified registry record are additionally flagged `⚠ unverified` in the UI.
- **A dangling junction in `_Archive` is detected and its parent folder excluded, loudly.** `_Archive/StoaOuronet-nested-stale-2026-07-05/stoa-js/packages` still points at `D:\_Claude\StoaOuronet\…`, which the reorg deleted; tar aborts the entire archive on it. bsdtar stats an entry *before* testing it against `--exclude`, so the link itself cannot be excluded — only an ancestor can. The backup therefore skips that one folder and says so in the result and the Ops tab. **This is reported, not silently dropped** — the user decides whether to delete the broken junction.
- **A partial restore reports `ok: false`.** On *extraction*, exit 1 means files could not be replaced (locked/in use), so the tree is a mix of archived and current files — the torn state the whole gate exists to prevent. That is a failure to act on, not a footnote in a message string.
- **Restore's idle gate is stricter than backup's**, and has no HTTP timeout. Any *unstopped* session blocks it regardless of heartbeat age (a 120s-stale heartbeat just means the agent is inside one long tool call, not that it stopped writing). And killing the HTTP wrapper would not kill the `tar.exe` grandchild on Windows — we would report failure while the restore was still overwriting the workspace.
- **The wasp state parser was rewritten against the real schemas.** The first version was built from fixtures I invented, and it whitelisted statuses wasp never writes (`in-progress`, `running`) while wasp actually writes `planning|scanning|closing|sorting|executing|consumer-commits|ci-waiting|verifying|…`. It also exact-matched `## Execution order` when tier 1 writes `## Workspace execution order` and tier 3 writes `## Queue` + `## Per-package gates`. **The tab would have shown IDLE through an entire live cascade, and every repo run as a green ✅.** Now: anything non-terminal is running, headings are matched by pattern, and the fixtures come from the wasp command docs. The glyph also beats the words — `⏳ workflow completed green` is a *pending* step whose text contains "completed".
- **Local mode binds loopback only.** It grants full execute rights with no login, which is right for the machine's user and wide open to the LAN. Cross-origin `POST`s are refused in both modes, so a random page the user browses cannot fire `/api/restore` at `localhost`.
- **The server has an error boundary.** Hono gave the reference implementation this for free; bare `node:http` does not, so any throw in an async handler — an unreachable hub, a malformed cookie — became an unhandled rejection and killed the process. A malformed `Cookie` header on the unauthenticated `/auth/callback` was a **one-request remote kill** of the live dashboard.

## Not included

- Registering the OIDC client (`client_id`/`client_secret`/`redirect_uri` are hub-issued) and deploying the site. The code activates the moment those env vars exist.
- Phase 4 / the stoa-js split.
