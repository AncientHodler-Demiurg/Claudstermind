# Workspace redesign + per-repo history — plan

Autonomous honey run. TDD per task. Builds on the existing streaming workspace.

## Wave 1 — bridge additions (tree, history, resume, persistence)
- [x] **T1.1 lib/workspace.mjs** — control `tree` (bounded walk, `.git`→isRepo, skip-list);
  control `history` `{repo?}` (read `.claude/workspace/` transcripts → summaries); control
  `open` `{sessionKey}` (stream a saved transcript as WS_OUT `transcript`); `_prompt` accepts
  `resume` (sessionId) → ClaudeSession resume; persistence keeps FULL raw transcript tagged by repo (unpruned).
- [x] **T1.2 lib/claudeSession.mjs** — accept `resume` option, pass to SDK query options.
- [x] **T1.3 workspace.test.mjs** — tree walk marks repo folders + respects skip-list; history
  lists saved sessions filtered by repo; open streams a transcript; resume passes the session id
  through (mock). 14/14 green.

## Wave 2 — frontend redesign
- [x] **T2.1 app.js viewWorkspace rebuild** — full-width shell; left sidebar (Repos | Tree
  toggle, repo badges, per-repo History); 1–4 pane layout picker; panes multiplex the one
  EventSource routed by sessionKey; active-pane model; sidebar/dropdown repo selection targets
  the active pane; approve/deny + trusted + usage per pane; history reopen (read-only) + resume.
  Prime initial controls on the SSE `hello` (no subscribe race); tree-picked non-tracked repo
  injects a dropdown option.
- [x] **T2.2 styles.css** — full-width layout, sidebar, pane grid (1–4 cols), repo badges,
  tree, active-pane highlight, history list. Theme-aware (uses existing tokens).
- [x] **T2.3 body full-width toggle** — `render()` toggles `body.ws-full`; WS_ES closed on tab-leave.

## Wave 3 — deploy + verify
- [x] **T3.1 full suite green** — 176/176; `node --check` on app.js/workspace.mjs/claudeSession.mjs.
- [ ] **T3.2 deploy** — relay rebuild on StoaNodePrime + restart local dashboard. **Deferred to the
  user (ship step).** honey autonomy covers building, not shipping — presented in the final report.
- [x] **T3.3 browser verify** — faithful local harness (forged-ancient live session, real
  index.html/app.js/styles.css, mock bridge over a scripted SSE stream). Verified: full-width;
  sidebar Repositories + Tree with repo badges; sidebar/tree → active-pane repo; 1→2 pane
  switching; per-pane repo dropdown; send→stream→permission(attributed to pane)→approve→result→usage;
  multi-pane routing isolates by sessionKey; history list; Reopen (read-only, compose disabled);
  Resume (loads transcript, compose enabled, resume pin); prime-on-hello (no history race).

## Verification gate
- [x] Full `node --test` suite green (176/176).
- [x] Redesigned Workspace verified in the browser (layout, sidebar, panes, history, routing).
