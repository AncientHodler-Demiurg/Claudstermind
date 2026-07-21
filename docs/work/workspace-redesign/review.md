# Workspace redesign + per-repo history — review

Autonomous honey run. Two adversarial review lenses (backend correctness+security, frontend
correctness+robustness+leaks) over the changed surface, then a fix loop to a clean pass. Every
fix was re-verified in the browser harness and/or by a new regression test.

## Round 1 — findings

### Backend (lib/workspace.mjs, lib/claudeSession.mjs)
- **[HIGH] Same-key restart wiped the saved transcript.** `_prompt` reset `s.transcript = []`
  when starting a fresh session under an existing key (a pane re-prompting after its session
  ended), and `_persist` overwrites `${key}.json` — so the full raw history (the learning-loop
  substrate) was erased on every restart. **Fixed:** seed `s.transcript` from disk via
  `_readSavedTranscript(key)` before appending the new turn. Regression test added.
- **[MEDIUM] `_sendHistory` aborted the whole listing on one odd file.** Shape access
  (`m.role`) ran outside the per-file `try`, so a parseable-but-structurally-odd transcript
  (e.g. a `null` entry) threw and killed enumeration of every later file. **Fixed:** per-file
  `try/continue` around the whole body + `m && m.role` guard. Regression test added.
- Verified sound (noted, not changed): `_openTranscript` sanitizer fully blocks path traversal
  (`.`/`/`/`\`/`:` all replaced); `walkTree` depth-bounded before recursing + symlinks skipped;
  `_persist` no-crash; `resume` plumbing correct.

### Frontend (dashboard/public/app.js)
- **[HIGH] Concurrent tool-permissions clobbered each other.** A single `pendingPerm` slot meant
  a second pane's request overwrote the first, orphaning its `requestId` and hanging that pane.
  **Fixed:** FIFO `permQueue` — render one at a time, pop on decide, surface the next.
- **[HIGH] Orphaned events polluted the active pane.** After the layout picker trimmed a pane
  whose session kept streaming, its frames (still carrying that `sessionKey`) fell through
  `paneOf(key) || activePane()` into the active pane. **Fixed:** route streamed events strictly
  by `sessionKey`; drop frames with no matching pane.
- **[HIGH] A stray `transcript` frame clobbered the active pane.** The single `pendingOpen` slot
  + `|| activePane()` fallback meant a duplicate/late reopen frame overwrote a live pane and
  forced it read-only; two in-flight reopens also mis-paired mode. **Fixed:** `pendingOpens` Map
  keyed by the saved session key echoed back in the frame; drop unmatched frames.
- **[LOW] Dead throwaway `el("select")`** in the repos handler — replaced with a guarded
  `paneUI.get(p.id)` lookup.

## Round 2 — clean pass
All Round-1 findings fixed. Re-review confirms no new issues. Live re-verification in the harness:
- Concurrent permissions: two panes prompted → first modal shown, second queued → approving the
  first surfaces the second ("Bash · Codex"); each pane's stream stayed isolated.
- Trim-orphan: prompt in pane 2, trim to 1 mid-stream → pane 1 kept only its own transcript.
- Reopen/resume still correct with the Map correlation (Codex loaded, compose enabled on resume).

## Evidence
- `node --test`: **178/178 pass** (16 in workspace.test.mjs, incl. the 2 new regression tests).
- `node --check` clean on app.js, workspace.mjs, claudeSession.mjs.
- Browser harness: every acceptance criterion exercised (see plan.md T3.3).

## Deferred (not defects)
- On **resume into a fresh pane** the continuation saves under a new key; the original saved
  conversation is preserved intact (no loss), but the two files aren't stitched. Stitching by
  `sessionId` belongs to the next-phase learning loop, not this build.
