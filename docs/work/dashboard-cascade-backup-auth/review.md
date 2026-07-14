# Review — Cascade view, archive backup/restore, AncientHub auth

Three independent lenses over the new surface. **17 findings, all real, all fixed.**
Final: **66/66 tests pass**, clean pass.

## Lens 1 — security (the auth surface)

The port itself was faithful: every id_token pin from the handoff survived (`RS256` only,
issuer + audience pinned, explicit nonce check, `clockTolerance`, keyed on `sub`), state is
bound, PKCE S256 is minted and sent, the two cookies are separated by `purpose`, and the
callback redirects to a literal `/` (no open redirect). **No auth bypass.** What the port
broke was error handling — and one of those was remotely fatal.

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| 1 | **CRITICAL** | A malformed `Cookie` header on the *unauthenticated* `/auth/callback` threw `URIError` out of an async handler → unhandled rejection → **process exit**. `curl /auth/callback -H 'Cookie: a=%'` killed the live dashboard. | Guarded the decode in `parseCookies` (the guard existed in the *other* cookie reader; the new one lost it). |
| 2 | HIGH | No error boundary: a brief hub outage during `/auth/login` killed the process. Hono gave the reference this for free; `node:http` does not. | Wrapped the handler; 500 instead of death, plus an `unhandledRejection` backstop. |
| 3 | HIGH | Bound `0.0.0.0`, so **local mode handed every host on the LAN full execute rights** — including `POST /api/restore`. | Local mode binds `127.0.0.1`. Only the authenticated live deployment listens publicly. |
| 4 | MEDIUM | A hub user with no admin role got an **infinite redirect loop** (login → SSO → deny → login…) instead of a denial. | A real 403 deny page naming their roles, with a sign-out link. |
| 5 | MEDIUM | No CSRF defence on the local-mode mutations: any page the user browsed could `fetch('http://localhost:3001/api/restore?…', {method:'POST'})`. | Cross-origin state-changing requests refused in both modes. |
| 6 | LOW | The reference's HTML escaper was dropped from the login-failure pages (not yet exploitable — all callers pass static strings). | `esc()` restored. |

## Lens 2 — backup/restore (data loss)

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| 7 | **HIGH** | `ok = code <= 1` accepted `code = -1` (tar killed / maxBuffer) — a **truncated archive recorded as a successful backup**. | Only exit 0, or exit 1 whose stderr is entirely benign warnings. Killed ⇒ failure, stump deleted. |
| 8 | **HIGH** | tar wrote straight to the final filename, so a crash left a partial file that listed as the newest archive and was offered as the one-click "latest" restore. | Write `.partial`, atomic-rename after verification. Unregistered archives flagged `⚠ unverified`. |
| 9 | MEDIUM | The HTTP timeout killed the Node wrapper, not the `tar.exe` grandchild — reporting "restore failed" **while the restore kept overwriting the workspace**. | No timeout on restore; the "no parseable result" message now warns it may still be running. |
| 10 | MEDIUM | `last-backup.json` had no writer after the robocopy→archive rewrite: the Ops headline said **"never"** seconds after a successful backup. | `recordArchive` writes it. |
| 11 | MEDIUM | A **partial restore** (exit 1 = files it couldn't replace → tree is half archived, half current) returned `ok: true`. | `ok: code === 0`, with an explicit `partial` flag and the skipped-file list. |
| 12 | MEDIUM | Restore's idle gate opened for an agent that had simply been inside one long tool call for >120s. | Any *unstopped* session blocks restore, regardless of heartbeat age. |
| 13 | LOW | The archive date label was UTC; a 01:30 local backup filed under the previous day, disagreeing with the `mtime` column beside it. | Local date (`sv-SE` → `YYYY-MM-DD`). |
| 14 | LOW | `readActivity` treated every `.json` as a session unless denylisted — a trap on the gate guarding the irreversible action. | Allowlist: it's a session if it *looks* like one (`sessionId` + numeric `ts`). |

## Lens 3 — cascade + UI (correctness)

This lens read the wasp command docs that **write** the state files, and found the parser
was fiction. It was built from fixtures I invented, so the tests passed while the code
could not have parsed a single real file.

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| 15 | **HIGH** | `RUNNING_STATUSES` (`in-progress`, `running`, …) intersected the statuses wasp actually writes (`planning\|scanning\|closing\|sorting\|executing\|consumer-commits\|ci-waiting\|verifying\|…`) in **exactly zero places**. The tab would have shown **IDLE through an entire live cascade** — the worst lie it could tell. | Anything not terminal (`complete\|failed\|cancelled`) is running. Robust to statuses a future wasp adds. |
| 16 | **HIGH** | Tier 1 writes `## Workspace execution order`; the parser exact-matched `## Execution order`. The suite card showed "no gates recorded yet" for the entire life of every master run. | Headings matched by pattern, not equality. |
| 17 | **HIGH** | Tier 3 (`pollinate`) has no status column and no execution-order table — it writes `## Queue` + `## Per-package gates` bullets. Every repo run rendered as **a green ✅ with 0/0 gates**, a tick over an unfinished publish. | Bullet gates parsed and rolled up per package; the glyph never defaults to ✅. |
| 18 | MEDIUM | A server-side failure to read the state files rendered as "No cascade run in progress" — a false negative on the highest-blast-radius operation in the suite. | `error` surfaced as a red banner. |
| 19 | MEDIUM | `refresh()` never checked `res.ok`; a 401 body parsed fine as JSON, then threw on `d.workspaces` — freezing the tab on "Reading .wasp state…" and throwing every 2s. | Status checked; session-expiry and HTTP errors rendered. |
| 20 | MEDIUM | `render()` cleared `CASCADE_TIMER` but not `OPS_TIMER` — leaving Ops leaked a 4s poller that then threw on detached DOM nodes forever. | Both pollers cleared on tab change. |
| 21 | MEDIUM | Restore disabled the **Backup** button while leaving every Restore button live — inviting a second `tar -xf` over the same tree. | The clicked button is passed through; all archive buttons lock for the duration. |
| 22 | MEDIUM | A workspace whose `path` was quoted, or missing from disk, was **silently dropped** — indistinguishable from "it isn't running". | Quotes stripped; a missing workspace is surfaced as a ⚠ row. |
| 23 | LOW | `readCascade`'s default `masterRoot` resolved to the wrong directory — a trap that returns a phantom empty cascade. | Required argument. |

Additionally, found by running the thing rather than reading it:

- **tar was taken from `PATH`.** Under Git-Bash that is GNU tar 1.32, which reads `X:\…` as a
  *remote host* and fails. The PowerShell-run tests passed while the same code failed under
  bash. Pinned to `System32\tar.exe`.
- **A dangling junction aborts the entire backup.** `_Archive/…/stoa-js/packages` still points
  at the reorg-deleted `D:\_Claude\StoaOuronet\…`; tar cannot stat it and gives up, which is
  what produced the 167 KB "backup". Now detected up-front; its parent folder is excluded and
  the skip is reported. **Left for the user to decide** whether to delete the broken junction.

## Evidence

```
tests 66 · pass 66 · fail 0
```

Real backup, end to end: **1.91 GB in 53s**, 43,626 entries — `.git` (23,515 entries) and
`.secrets` present, zero `node_modules`. Restore refuses without the archive id typed back.

Live-mode gating, driven against a running server: unauthenticated `GET /` → 302; `GET /api/map`
→ 401; forged cookie → 401; `modern` POST → 403; `ancient` POST → 403 `local-only`; role-less
user → 403 deny page; `/auth/login` resolved the **real** hub discovery document and issued a
correct PKCE S256 authorize URL.
