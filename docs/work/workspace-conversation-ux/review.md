# Review — workspace conversation UX

## Round 1 — three lenses (correctness, data-integrity, client UX/resource-leak)

| # | Sev | File | Finding | Fix |
|---|-----|------|---------|-----|
| 1 | HIGH | `lib/workspace.mjs` / `lib/workspaceStore.mjs` | Auto-resume (and the explicit resume value handed to the client) seeded `options.resume` with the pane/workspace-id string (`s.key`, from the file name), never the real Claude Agent SDK session id — the SDK was being asked to resume a session it never issued, silently defeating "real Claude context" even though the displayed transcript looked continuous. | `_persist` now stamps each turn with the real `s.sessionId` (captured from the SDK's `init` event); `listWorkspaces`/`_latestWorkspaceRow`/`_openTranscript` prefer that stamped value, falling back gracefully (no crash, no migration) for any pre-fix file with no stamp. |
| 2 | HIGH | `dashboard/public/app.js` | `pendingOpens` was keyed only by `sessionKey`. Two panes sharing one workspace (a real, designed-for multi-terminal state) both queue a restore-open on reload; the second `beginPendingOpen` overwrote the first pane's map entry *and* cancelled its timer, leaving the first pane silently stuck with an empty transcript forever — no transcript, no error, no timeout. | `pendingOpens` restructured to `sessionKey -> Map<paneId, entry>`; each pane's request now tracked and resolved/timed-out independently, with a reply fanned out to every pane still waiting on that key. |
| 3 | MEDIUM | `dashboard/public/app.js` | Tool-call grouping (task 3.1) grouped only array-*adjacent* `tool_use`/`tool_result` events. Interim assistant commentary between two rounds of tool calls in the *same turn* split them into two separate "N tool calls" summaries instead of one, missing the plan's own per-turn acceptance bar. | Grouping is now turn-scoped (bounded by `user`-role events), not adjacency-scoped — interim non-tool items render inline without closing the pending tool-call group. |
| 4 | MEDIUM | `dashboard/public/app.js` | The `transcript` reply handler resolved purely by pane-id existence, with no check that the pane's *identity* (`sessionKey`/`repo`) still matched what was originally requested. A user who clicked Resume then cleared the pane or switched its repo/worktree before the async reply arrived would have that stale reply silently reapplied, reverting their explicit action. | Each `pendingOpens` entry now carries the pane's `_gen` generation counter at request time (bumped by `clearPane` and the repo/worktree change handlers); a reply is discarded, not applied, if the pane's generation has since moved on. |
| 5 | MEDIUM | `dashboard/public/app.js` | `paintPane` fully rebuilt the transcript DOM on *every* streamed event (the common case for any tool-using turn, not an edge case) with two consequences: a user-expanded tool-group summary silently re-collapsed on the next event, and scroll position was unconditionally snapped to bottom even if the user had deliberately scrolled up. | Per-group expand state now persists across repaints via `p._expandedGroups`, synced through the `<details>` `toggle` event; auto-scroll now only fires when the view was already near the bottom before the repaint. |
| 6 | MEDIUM | `dashboard/public/app.js` | The `repoSel`/`wtSel` change handlers reassigned a pane's identity but never reset `p.status`, so switching a pane's repo/worktree mid-turn left the spinner showing "busy" for the new (definitionally idle, never-started) workspace indefinitely — no event would ever arrive to correct it. | Both handlers now reset `p.status = "idle"` alongside the identity/generation change. |

All six: **CONFIRMED** by adversarial validation (independent read + active attempt to refute each), no REFUTED, no STYLISTIC.

## Round 2 — regression pass after the Round 1 fixes

Re-reviewing the four files together (not each fix in isolation) surfaced one more real defect, exposed *by* fixing #2 above:

| # | Sev | File | Finding | Fix |
|---|-----|------|---------|-----|
| 7 | HIGH | `dashboard/public/app.js` | With #2's per-pane fan-out now correctly delivering a reply to *both* panes of a legitimately shared session on restore, each pane's clash check found the *other* (legitimate twin) pane already holding the same key and misread it as a foreign collision — both panes ended up permanently read-only on every reload, defeating the multi-terminal-workspace "shared sessions" feature on the ordinary reload path. Pre-existing flaw in the clash check, previously unreachable in this form because the (now-fixed) pendingOpens clobber meant at most one pane per shared pair ever got a reply at all. | Each pending-open entry now also carries the pane's `priorKey` (its `sessionKey` at request time); the clash check only fires when the pane is genuinely adopting a *different* key than the one it already held, not when a legitimate twin shares the same key it always had. |

**CONFIRMED** by adversarial validation, including an independent live run of the full suite (fresh, not reused) confirming no other regression.

## Evidence

```
node --test (repo root, run fresh immediately before closing this topic):
# tests 299
# suites 0
# pass 298
# fail 1
# duration_ms 1657.50
```
The one failure, `orchestrator/backup.test.mjs`'s "listing an unreachable backup root reports unavailable, not a crash," is pre-existing and unrelated — confirmed present, identical, and unchanged in count across every checkpoint of this topic's build (from before task 1.1 through the final fix), and reproduces in isolation on this environment regardless of any change made here.

`node --check` clean on every touched file (`lib/workspace.mjs`, `lib/workspaceStore.mjs`, `dashboard/public/app.js`) at every checkpoint.

**No jsdom/browser test harness exists for `dashboard/public/app.js` in this repo** (confirmed independently by every implementer and lens on this topic, and by an explicit check for a browser-automation tool during this review — none is available in this environment). Every client-side acceptance criterion and every finding above was therefore verified by a written, quoted, step-by-step trace of the actual code against scripted mock event/click sequences, the same substitute this project already used for prior client-side work (see `workspace-redesign/review.md`'s manual browser-harness verification) — not a live click-through. This is a known limitation of this repo's test infrastructure, not something this topic introduced.

## Deferred (not defects)

- Retiring a workspace (`store.retire()`) has no caller anywhere in the codebase today — the "should a retired session still auto-resume?" question raised during Round 1 has no reachable trigger to worry about yet.
- Old on-disk session files written before this topic's fix have no stamped `realSessionId` and will resume via the pre-fix (file-name-derived) fallback exactly once more, until their next turn re-stamps them — a one-time, self-healing gap, not an ongoing defect.

## Final state

Server (`lib/workspace.mjs`, `lib/workspaceStore.mjs`): merge-on-read history grouping, real full-context resume keyed by the actual SDK session id, and a corrected not-found/reopen path — all read-only where the design requires it (no file ever written, moved, or deleted by the new store functions, verified by directory-snapshot diff).

Client (`dashboard/public/app.js`, `styles.css`): one history row per workspace; turn-scoped collapsed tool-call summaries with persistent expand state; a working/done status spinner tied to the existing turn-lock signal, correctly reset on identity changes; a reopen/resume path that either succeeds, explicitly times out, or explicitly errors — never silently hangs — and correctly keeps a legitimately shared session writable in every pane attached to it.

Clean pass.
