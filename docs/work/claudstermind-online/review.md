# Claudstermind Online — review

Two rounds: three parallel lenses (security, correctness, regression) → adversarial validation
of the fixes. Converged clean.

## Round 1 — findings (all fixed)

| # | Sev | Where | Finding | Fix |
|---|-----|-------|---------|-----|
| 1 | HIGH | relay-core.mjs / server.mjs | Relay command timeout (130s) < backup (600s) / restore (unbounded) → a slow-but-succeeding op returns a false 504 and the late RESULT is dropped, defeating restore's "let it finish" semantics | Per-call `timeout` on `relay()`; server passes `LONG_COMMAND_MS {backup:900s, restore:3600s}`. A dead agent is still settled promptly by heartbeat → detach. |
| 2 | MED | relay-core.mjs | On newest-wins socket replacement, the old socket's in-flight commands weren't failed — they lingered to the full timeout and returned the wrong reason (504 not 503) | `_attach` now calls `_failPending("local-not-connected", …)` before swapping; extracted `_failPending` shared with `detach`. |
| 3 | LOW | server.mjs | `send-failed` transport error returned HTTP 200 | Mapped `send-failed` → 502. |
| 4 | LOW | gitActions.mjs | `resolveRepo` containment used bare `startsWith(root)` — a sibling like `../rootEVIL` string-prefixes the root and passed the guard | Require `abs === root` or `startsWith(root + sep)`. |
| 5 | LOW | app.js | Ops-tab UI hardcoded `X:\_Claude-backup` / "→ X:" / restore path `D:\_Claude`, contradicting the new cross-platform backend | Genericized all backup-location + restore-target copy (4 strings + the restore prompt). |

New tests locking the fixes: `relay-core.test.mjs` (per-call timeout honored; replaced-socket fails fast as `local-not-connected`), `gitActions.test.mjs` (sibling-prefix rejected).

## Round 2 — adversarial validation

Validator verdicts: fixes 1–4 **CONFIRMED-CORRECT** (traced: no double-settle on replace→close→detach; dead agent settled by heartbeat within ~60s regardless of the long bound; `sep` correct for the Windows bridge; single-connection path unaffected). Fix 5 **INCOMPLETE** — a 4th `X:` string + stale "Backup to X:" button label at app.js:982 and the `D:\_Claude` restore prompt remained. **Completed** in this round. No new defects introduced by any fix.

## Final state
- Full suite: **141 tests, 0 fail** (lib, orchestrator, dashboard/auth, relay, agent).
- End-to-end integration (`relay/integration.test.mjs`): real relay + real bridge — not-connected→503, connected, ancient command executes locally (real commit lands), modern refused 403.
- Browser: local dashboard renders clean (no console errors); live-mode banner + Ops-hidden verified; cross-platform Ops copy confirmed live.

Clean pass.
