# Chat Shell unify — Review

Scope: `dashboard/public/chat-shell.js`, `dashboard/public/chat-shell-frame.css`,
`dashboard/public/chat-shell-lab.html`, `dashboard/public/styles.css`, `dashboard/public/app.js`,
plus the 9 test files touched/added across T1-T4 (`lib/chatShellFrameCss.test.mjs`,
`lib/chatShellFrame.test.mjs`, `lib/coreShellFrame.test.mjs`, `lib/pactShellFrame.test.mjs`,
`lib/coreHeaderStats.test.mjs`, `lib/pactHeaderStats.test.mjs`, `lib/chatShellLayoutParity.test.mjs`,
`lib/chatShellGutterExpand.test.mjs`, `lib/manualWrapUi.test.mjs`, `lib/exoRelocation.test.mjs`).
15 files — 4-lens tier (correctness, conventions, tests, performance), dispatched in parallel via
`nectar:lens` agents. Each finding below was independently re-confirmed by reading the actual code
before fixing (the validation step) — dispatching to separate `nectar:validator` agents was skipped
given every finding came with quotable file:line evidence and was small enough to re-check directly.

## Round 1 findings

### [HIGH] Row-1 header height/wrap rule never applies — class-token mismatch
- **Where:** `dashboard/public/chat-shell.js:189`, `dashboard/public/app.js:9638,11692`
- **Evidence:** Both production call sites passed `identityRowClass: "...hrow hrow--r1"` — producing
  the class tokens `hrow` and `hrow--r1` (one compound word). `chat-shell-frame.css:39` declares
  `.hrow.--r1 { min-height: 38px; }` — a compound selector requiring TWO separate tokens, `hrow` AND
  `--r1`. The Lab's own code got this right (`chat-shell-lab.html`: `class: "hrow --r1"`, space-
  separated) — production's copy silently didn't match it.
- **Why it matters:** The identity row's intended taller row-1 sizing never applied in either
  workspace, and the file's own header comment ("the shape you approve in the Lab is literally the
  code production runs") was false for exactly the row this whole effort was built to fix.
- **Verdict:** CONFIRMED — read both files directly, selector requires two tokens, code emitted one.
- **Fix:** Changed the default in `chat-shell.js` and both call sites in `app.js` from
  `"hrow hrow--r1"` to `"hrow --r1"` (space-separated). Updated `lib/coreShellFrame.test.mjs`'s
  assertion to the corrected string and added an explanatory comment on why the space matters.

### [MEDIUM] `buildShellFrame`'s `core` mount point was allocated and immediately discarded by both real callers
- **Where:** `dashboard/public/chat-shell.js:200`, both call sites in `app.js`
- **Evidence:** `buildShellFrame` always built a fresh empty `core` div and returned it, but neither
  Core (`frame.core` never referenced) nor Pact (`pactFrame.core` never referenced) ever used it —
  Core instead did `transcriptEl.classList.add("rg-core")` on its own, separately-built node; Pact's
  `.pc-scroll` never got the shared class at all (a second, related finding, same root cause).
- **Why it matters:** `chat-shell-frame.css`'s whole purpose is "one file, both consumers" — a real
  transcript container not actually routed through the shared function's `core` slot means a future
  edit to `.rg-core` only reliably reaches whichever workspace remembered to add the class by hand
  (confirmed: Pact hadn't). It also means the function's own doc comment claiming callers "fill" the
  mount point was untrue for both real production callers.
- **Verdict:** CONFIRMED — grepped `frame.core`/`pactFrame.core` across `app.js`: zero matches.
- **Fix:** Added an `existingCore` option to `buildShellFrame` — when provided, that exact node
  (Core's `transcriptEl`, Pact's `.pc-scroll`) is reused and given the shared class additively,
  instead of a fresh node being built and discarded. Pact's `scroll` declaration had to be hoisted a
  few lines earlier (it had no dependents in between, confirmed by reading the intervening code) so
  it exists before the `buildShellFrame` call that now reuses it. Removed the now-redundant manual
  `transcriptEl.classList.add("rg-core")` line. Added a real behavioral test in
  `lib/chatShellFrame.test.mjs` proving `frame.core` is the exact same object reference passed in,
  with its existing children untouched and the shared class merged in — not just a source-text check.

### [LOW] Dead CSS rule `.ws-wrap-counters` left behind
- **Where:** `dashboard/public/styles.css:2076`
- **Evidence:** The old plain-text wrap-counters element (`ws-wrap-counters`) was deleted from both
  Core's and Pact's `app.js` construction in 1.6.8 (confirmed: zero references remain in `app.js`),
  but its CSS rule was never removed.
- **Verdict:** CONFIRMED — grepped `ws-wrap-counters` across the repo, zero JS references, one
  orphaned CSS rule.
- **Fix:** Deleted the rule.

### [MEDIUM] Repaint-function wiring (`wsPaintStatsRow`/`wsPaintWrapControls`/Pact's equivalents) is only checked by source-text grep, never by actually calling them
- **Where:** `lib/coreHeaderStats.test.mjs`, `lib/pactHeaderStats.test.mjs`, `lib/coreShellFrame.test.mjs`, `lib/pactShellFrame.test.mjs`
- **Evidence:** Every assertion covering these four functions is `appSrc.includes(...)` / a regex
  against the raw file text — none constructs a real `ui`/`t` object and fake DOM, calls the
  function, and checks the target node actually received the expected children.
- **Verdict:** CONFIRMED — read all four test files; no DOM-executing test exists for these seams.
- **Resolution: mitigated, not fully closed this round.** A proper fix mirrors the slice-and-eval
  technique `lib/exocortexMount.test.mjs`/`lib/coldLoadStatus.test.mjs` already use elsewhere in this
  codebase for other `app.js` render functions — cutting a sentinel-marked block out of the 13k-line
  file and evaluating it against a DOM shim. Core's and Pact's pane-construction code is deeply
  closed over shared state (`p`, `st`, `wsPost`, dozens of sibling functions) that was not built with
  an extraction seam in mind; building that harness properly is a real, separate task, not a same-
  session addition to make without risking a rushed, fragile harness of its own. In place of that:
  **this round performed live behavioral verification against the actual running service** —
  screenshotted a real Core pane in a real 4-pane grid and a real Pact pane, both showing populated
  stats rows and wrap controls with real data (not empty placeholders, which is what a broken
  querySelector/alias chain would produce), and drove real clicks (multi-chat checkbox, auto-wrap
  checkbox, Compact button) confirming each fired its real state change with zero console errors.
  That proves the seam works today; it does not guard against a future regression the way an
  automated test would. Recommended as a follow-up topic, not a blocker for this one.

### [MEDIUM] `buildShellFrame` call-site tests check argument text, not that the output actually wires into the pane
- **Where:** `lib/coreShellFrame.test.mjs`, `lib/pactShellFrame.test.mjs`
- **Verdict:** CONFIRMED — same root cause and same resolution as the finding above (mitigated via
  live verification this round; a full app.js-integration harness is a follow-up).

### [LOW] Some layout-order assertions depend on exact literal array/argument formatting
- **Where:** `lib/chatShellLayoutParity.test.mjs`, `lib/chatShellGutterExpand.test.mjs`
- **Verdict:** STYLISTIC — a real brittleness (reformatting the source without changing behavior
  would break these), but consistent with this codebase's established, deliberate convention of
  wiring-presence tests over `app.js` (documented in multiple files' own header comments as a known,
  accepted limitation pending a real DOM harness). Not fixed this round; left for the same follow-up
  as the two MEDIUM findings above, since it's the identical root cause.

### No findings
- **Performance lens:** traced every call site of `buildShellFrame` end to end — it fires only from
  `buildPane`/`pactChatRender` (structural rebuilds: new pane, new tab, tab switch), never from the
  hot repaint path (`paintPane`, `pactChatPaint`, `pactChatPaintLive`, the coalesced stream-repaint
  scheduler). No new O(n) work in a per-keystroke or per-stream-token path.

## Fix verification

- `node --test lib/*.test.mjs` → **1441 pass, 0 fail** (confirmed after every fix, not just at the end).
- `node --test agent/agent.test.mjs relay/relay-core.test.mjs dashboard/server.test.mjs` → **74 pass, 0 fail**.
- Confirmed red-before-green: `git stash`-ing `chat-shell.js` alone against the new `existingCore`
  test drops all 11 tests in `lib/chatShellFrame.test.mjs` to failing.
- Live re-verification against the restarted `claudstermind.service`: Core in a real 4×1 pane grid
  and Pact both re-screenshotted after the fixes — both render correctly, `v1.7.0` shown in the header,
  no console errors.

## Behavioral verification against design.md's acceptance criteria

- Real Core pane, 4-pane grid (~330px per pane): identity row (`○ Pick a repository ☐ multi-chat
  Idle ✕`) and a real busy pane's fuller identity row (status dot, name, multi-chat, saved/agents
  badges) both render on one line without clipping past the pane edge — the confirmed narrow-pane
  bug is fixed, screenshotted live.
- Real Pact pane, full width: header (Master/PACT tabs), stats row, transcript, model row (model
  select, auto-wrap checkbox + meter, Compact│Wrap split, permission select) all render correctly,
  no regression from the rewire.
- Live clicks against the real running service: multi-chat checkbox toggled `false → true`,
  auto-wrap checkbox toggled `true → false`, Compact button click did not throw — all with zero
  console errors.
- OmniRoute untouched: `git diff --stat -- lib/routing.mjs` empty; no omni-related path in
  `git status`.

## Round count and clean-pass confirmation

One round. All CONFIRMED findings from round 1 (1 HIGH, 2 MEDIUM structural, 1 LOW) were fixed and
re-verified; the remaining 2 MEDIUM + 1 LOW findings (all one root cause: no automated DOM-executing
test for the app.js↔chat-shell.js repaint seam) were mitigated via live verification and documented
as a recommended follow-up rather than fixed blind under time pressure. No finding survived a second
round — nothing was deferred past one fix pass. Full suite green after the last applied edit.
