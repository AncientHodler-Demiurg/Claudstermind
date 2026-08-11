# HANDOFF — Pact IDE UI rehaul (8 points)

> Durable state for the Pact IDE editor rework so it survives context compaction. Repo: Claudstermind
> (`dashboard/public/app.js` + `styles.css`). Current version when this was written: **1.0.7**.
> Workflow discipline (MANDATORY every change): run `node --test --test-concurrency=1`; bump
> `package.json` version + add a CHANGELOG.md entry ABOVE the top one (a test enforces top==package.json);
> `git add` the SPECIFIC changed files (never -A); commit with a HEREDOC ending `Co-Authored-By: Claude
> Sonnet 5 <noreply@anthropic.com>`; push using the token at `.secret/github-token.txt` inlined into the
> URL (NEVER logged/persisted): `PUSH_URL=$(git remote get-url origin | sed -E "s#https://([^@]*@)?#https://${TOKEN}@#"); git push "$PUSH_URL" HEAD:main`. User deploys via admin panel (local+remote restart).

## The 8 points (user's spec, verbatim intent)

1. **Tree**: auto-adjust width up to a max of ~10% of available width to fit filenames; if still too narrow, decrease font; **font +/- buttons**; if a name still won't fit at min font, **carousel/marquee** it in place.
2. **Editable files** (not read-only) so the user can type edits; a **Save All** button (like an editor).
3. **Agent-edit diffs** (Cursor-style): new text on green bg, removed text on red bg; a **Keep All** button clears the highlights and retains the text.
4. **Autosave-all** that kicks in when something needs saving; the Save-All button is **disabled when everything is saved**, **enabled when dirty** — so at a glance you know the repo is on disk. (Like Cursor: agent modifies files, user still triggers save.)
5. Splitting view boxes should keep **equal sizes** + be **resizable** (terminator-style). Currently a 4th box makes 2 tiny bottom boxes with no resize.
6. **Layout ladder:** tree | **right zone (chat+repl) = ⅕ of the remaining width** | editor area splits: 1=whole, 2=2 across, 3=3 across, 4=4 across, 5=3up+2down, 6=3+3, 7=4up+3down, 8=4up+4down. **Max 8 boxes.**
7. **Per-view-box font +/-** buttons; when tabs exceed one line, use **multiple tab lines** (wrap) instead of horizontal scroll.
8. **Color-coded tabs by file type** (.pact/.repl/.md/.txt). ✅ **DONE (v1.0.7)** — `pk-t-<ext>` class on `.pact-tab2` + CSS left-accent/name-tint.

## Status
- ✅ #8 color-coded tabs (v1.0.7).
- ✅ U1 = #1 (tree width/font) + #7 (per-box font, multi-line tabs) (v1.0.8).
- ✅ U2 = #5 + #6 (split ladder 1–8, resizable flex gutters, right zone ⅕) (v1.0.9).
- ✅ U3 = #2 + #4 (editable overlay editor + Save All + debounced autosave + dirty dots; backend
  `writeTextFile` + `POST /api/pact/file` + relay `pactWrite` tunnel) (v1.1.0).
- ✅ U4 = #3 (agent-edit diff view: green added / red removed lines + Keep All) (v1.1.1) — **solid
  partial**, see the U4 notes below for the scoped remainder.

## IDE state preservation + chat history/resume (P1–P4)
> Goal: the Pact workspace reopens exactly where you left off (open files, editor boxes, chat tabs,
> drafts, collapse) like Cursor — and state is **shared local↔remote** (lives server-side on the
> work machine, NOT localStorage). Plus every Pact chat is saved, auto-named, renameable, listed in
> a history panel, and resumable with full agent context.

- ✅ **P1 — shared server-side IDE-state store (tunneled)** (v1.1.4). `lib/pactIdeState.mjs`
  (`readIdeState`/`writeIdeState`, object-only + 512 KB cap + safe-parse, file at
  `.claude/workspace/OuroborosNetwork~2f~_onchain~2f~Ouronet@main/_ide-state.json`) + `lib/pactIdeState.test.mjs`
  (9 tests). `GET`/`PUT /api/pact/ide-state` in dashboard (GET=canRead; PUT=same-origin+local+execute),
  forwarded in `relay/server.mjs`, answered by `pactIdeStateGet`/`pactIdeStatePut` in `agent.mjs`
  handleCommand — mirrors the pactFile/pactWrite tunnel exactly. The blob is opaque JSON the frontend
  authors.
- ✅ **P2 — persist + restore the IDE layout** (v1.1.5). `pactStateSnapshot()`/`pactStateSave()`
  (debounced 800ms PUT) + `pactRestoreState()`/`pactRestoreEditor`/`pactRestoreChat`/`pactRestoreCollapse`
  in app.js. Snapshot = `{v:1, editor:{groups:[{tabs:[paths],active,fontPx,flex}],activeIndex,rowFlex},
  chat:{tabs:[{key,name,draft}],activeIndex}, collapse, chatNames}`. Save triggers wired into
  `pactEdLayout`, `pactEdCloseTab`, font +/-, gutter mouseup, `pactChatNewTab/CloseTab`, tab switch,
  compose `input`, `pactChatSend` (clears draft), `pactToggleCollapse`, `pactChatRenameTab`.
  `PACT_STATE_READY` gates saves (false during build/restore + when leaving Pact via `pactChatStop`).
  Per-tab drafts persist via `pactChatSaveDraft()` (shared textarea folds into the tab on switch).
  `pactEdOpen` refactored to share `pactEdOpenInto(g,path,makeActive,relayout)` used by restore.
  Double-click a chat tab name to rename (writes `PACT_CHAT_NAMES`). NOT persisted: file contents,
  transcripts (P3), tree font.
- ✅ **P3 — chat history panel + auto-name + rename + resume** (v1.1.6). Backend: `WS_CONTROL_ACTIONS`
  += `sessions`/`sessionOpen`/`sessionDelete` (protocol.mjs) → `_sendSessionList`/`_openSession`/
  `_deleteSession` (workspace.mjs). NOTE: my method was first named `_sendSessions`, colliding with the
  EXISTING live-snapshot `_sendSessions()` — renamed to `_sendSessionList` (a broken test caught it).
  `store.listSessions` now carries `realSessionId`; new `store.deleteSession(dir,id,sessionId)`.
  Frontend (app.js): 🕐 header button → `pactChatToggleHistory` overlay → `pactChatRenderHistory` /
  `pactHistRow`; `pactChatOpenSaved(r, adopt)` (Resume adopts key=sessionId; Load mints a fresh key —
  both carry `resume=realSessionId`); `pactHistRename`/`pactHistDelete`; `pactTranscriptToMsgs`;
  `pactDeriveChatName` (auto-name on first send, preamble-stripped). `pactChatSend` now sends
  `resume: t.resume`. Transcript rehydration routed via `PACT_CHAT._pendingOpen`. CSS: `.pc-hist-*`
  in styles.css. Names live in the shared `chatNames` map (P1 store).
- ⏳ **P4 — surface the recovered "Ouronet Pact audit" chat** (session file id
  `9b41003b-b616-4ac3-9b2b-780f3b229662`, realSessionId `ad269259-019d-4b49-93bd-8742207a8e60`,
  75 msgs) named in the store + resumable. NOT YET DONE.

**Backend facts for P2–P4 (verified):**
- Every Pact chat prompt goes out as `wsPost("prompt", {sessionKey:t.key, repo:PACT_REPO, worktree:"main", …})`.
  In `lib/workspace.mjs._prompt`, `workspaceId` = `OuroborosNetwork/_onchain/Ouronet@main` for ALL Pact
  chats, so each tab's `t.key` (a `wsUuid()`) becomes the **session-file name** under that one workspace
  dir. `_prompt` accepts an explicit `resume` (a realSessionId) that WINS over auto-resume — pass the
  saved session's `realSessionId` on the first prompt of a resumed tab.
- Per-session listing: `store.listSessions(dir,{repo})` / the `eachSession` generator yields
  `{id, sessionId, realSessionId, transcript, updatedAt,…}`. NOTE: the `history` control action →
  `_sendHistory` → `store.listWorkspaces` AGGREGATES the whole Pact repo into ONE row (not per-chat) —
  P3 needs a per-session list, so add a new control action (e.g. `sessions`) or extend `summarise` to
  carry `realSessionId` (it's already in the generator's yield, just dropped by `summarise`).
- Rehydrate a chat: `store.readSession(dir, workspaceId, sessionId)` (a.k.a. sessionTranscript) or the
  `open` control action (`_openTranscript` → `transcript` frame with `sessionId` = the realSessionId).
- Chat names: store a `chatNames` map (`{ [sessionKey]: name }`) in the SAME `_ide-state.json` blob so
  local+remote agree. Pre-seed `chatNames["9b41003b-…"] = "Ouronet Pact audit"` for P4.

## U4 notes — what shipped vs. the remainder
**Shipped (v1.1.1):** at the end of each Pact-chat turn (`result` in `pactChatRoute`),
`pactEdCheckAgentEdits()` re-reads every open, **non-dirty** file. If the on-disk content differs from
what the editor last held, the box switches to a **read-only diff view** (`pactDiffLines()` LCS →
`.pact-diff-view` rows: `pd-add` green / `pd-del` red, with a `+N/−M` badge). A global **Keep All**
button (`pactEdKeepAll`, shown only while a diff is pending) accepts the edits and returns the boxes to
the editable overlay. Because the new content is already on disk (the agent wrote it), Keep All doesn't
save — it just clears the diff. User-dirty tabs are skipped so in-progress edits are never clobbered.

**Deliberate design choice:** the diff is shown in a **separate read-only view** rather than as inline
green/red backgrounds *inside* the editable overlay. The overlay aligns a transparent `<textarea>` over
the highlight `<pre>`; representing **removed** lines inline would require phantom rows the textarea
can't hold without breaking caret/scroll alignment. The read-only diff view sidesteps that and matches
Cursor's "review then accept" flow.

**Remainder (deferred, not blocking):**
1. **Files the agent edits that aren't open** aren't surfaced — only currently-open tabs are diffed.
   A fuller version would expose a tunneled `git -C <ouronetRoot> diff --name-only` to list changed
   files and auto-open/badge them. (Endpoint would mirror the `pactTree`/`pactFile`/`pactWrite` tunnel.)
2. **Inline diff within the editable overlay** (per-line green/red backgrounds behind live-editable
   text) — needs a line-metric stripe layer; left out to keep the overlay's alignment bulletproof.
3. Detection is **turn-boundary polling** of open files, not a live filesystem watch; edits mid-turn
   show once the turn's `result` arrives.

## Code map (dashboard/public/app.js)
- **`viewPact()`** builds `.pact-ide` = [ `.pact-tree` (aside), `.pact-work` = [ `.pact-editor` (the editor grid), `.pact-right` = chat + repl-terminal ] ]. Calls `pactEdInit(editorEl)`, `pactChatInit(chatEl)`, `loadPactDir("", treeBody)`.
- **Tree:** `loadPactDir(rel, container)` → `pactNode(it)` (dir/file rows; file click → `pactEdOpen(it.path, row)`). Tree DOM: `.pact-tree-hd` (header) + `.pact-tree-body`. Node = `.pact-node`/`.pact-node-name`/`.pact-chev`.
- **Editor group model:** `let PACT_ED = { host, groups:[g], activeId, seq }`; `g = { id, tabs:[{path,name,loaded,content,error}], active, el, tabsEl, bodyEl }`. Functions: `pactEdInit/pactEdAddGroup(cap 6)/pactEdCloseGroup/pactEdCloseTab/pactEdLayout/pactEdRenderGroup/pactEdRenderBody/pactEdOpen`. `pactEdLayout()` sets `--pact-ed-cols` = `[1,1,2,3,2,3,3][n]` (THIS is the split logic to replace for #6, cap→8) and rebuilds groups. Tabs rendered in `pactEdRenderGroup` as `.pact-tab2` (now with `pk-t-<ext>`), split control `⊞`=`pactEdAddGroup`, `×`=close.
- **Body render:** `pactEdRenderBody(g, tab)` → `.pact-editor-scroll` with `<pre class="pact-code">` (highlight via `window.pactHighlight`) OR `.pact-md` (markdown) OR plain. **For #2 editable:** replace the `<pre>` with a `<textarea>` overlay or contenteditable + a highlight layer; track dirty per tab; add Save All.
- **File content:** fetched via `GET /api/pact/file?path=` (returns `{ok,content,size}`). **For save (#2/#4):** add `POST /api/pact/file` (write) in `dashboard/server.mjs` (near the other `/api/pact/*`, ~line 850; local-only + canExecute + repo-confined via `pactFs.safeResolve`); add a `writeTextFile` to `lib/pactFs.mjs` (+ test); FORWARD it down the relay tunnel like the reads — bridge (`agent/agent.mjs` `handleCommand`, add `pactWrite` case) + relay (`relay/server.mjs`, near the `/api/pact/tree|file` forward block).
- **Chat/terminal (right zone):** `PACT_CHAT` model; `.pact-chat` + `.pact-term` (`.pact-terminal`). Terminal run = `pactRunRepl` (SSE `/api/pact/run`, local-only).
- **`.repl` runner:** `/api/pact/run` SSE — local dashboard only (relay can't tunnel SSE via COMMAND/RESULT yet).

## CSS map (dashboard/public/styles.css, "Pact IDE" section ~L910+)
`.pact-ide` (flex row) · `.pact-tree` (flex 0 0 240px — **#1 make responsive + font var**) · `.pact-tree-body` · `.pact-node`/`.pact-node-name` (**#1 marquee overflow**) · `.pact-work` (flex row) · `.pact-editor` (`display:grid; grid-template-columns: repeat(var(--pact-ed-cols,1), minmax(0,1fr))` — **#5/#6 replace with a rows+cols grid + resizable**) · `.pact-ed-group`/`.pact-ed-hd`/`.pact-tabs2` (`overflow-x:auto` — **#7 change to flex-wrap:wrap**)/`.pact-tab2` (+ `.pk-t-*` colors) · `.pact-ed-ico` (split/close btns) · `.pact-right` (flex col, chat+term — **#6 make it ⅕ via flex ratio: editor `flex:4`, right `flex:1`**). Mobile block `@media (max-width:900px)` stacks the IDE.

## Increment specs

### U1 (do first)
- **#7 multi-line tabs:** `.pact-tabs2 { flex-wrap: wrap; overflow-x: visible; }` (drop the horizontal scroll).
- **Per-box font +/- (#7):** add two small buttons to each group's `.pact-ed-hd` (`A-`/`A+`) that adjust a per-group font size (store on `g.fontPx`, default 12.5; apply as inline `style.fontSize` on that group's `.pact-code`). Re-render body or set the var.
- **Tree font +/- (#1):** two buttons in `.pact-tree-hd`; a `--pact-tree-font` var (default 12.5px) on `.pact-tree`, driving `.pact-node`. Store in a module var.
- **Tree width (#1):** `.pact-tree { flex: 0 0 clamp(180px, 16%, 340px); }` (grows on wide screens; ~the "up to 10%" intent — tune the % if the user wants exactly 10%). 
- **Carousel long names (#1):** on `.pact-node-name` overflow, marquee on hover (reuse the header `animate-marquee`/measure pattern, or a CSS keyframe translateX on `:hover` when `scrollWidth>clientWidth`). Keep it light.

### U2 (#5+#6)
- Replace `pactEdLayout`'s `--pact-ed-cols` scheme with an explicit **rows×cols grid** per the ladder: n→(cols,rows) = 1→(1,1) 2→(2,1) 3→(3,1) 4→(4,1) 5→(3,2) 6→(3,2) 7→(4,2) 8→(4,2); place groups row-major; when a row is under-filled (5,7) let the last row's boxes fill equally (use CSS grid `grid-template-columns/rows` + `grid-column`/auto-flow). Cap `pactEdAddGroup` at **8**.
- **Right zone = ⅕:** `.pact-editor { flex: 4 }`, `.pact-right { flex: 1 }` inside `.pact-work` (so editor:right = 4:1 of the space after the tree).
- **Resizable:** add drag splitters between editor boxes (and optionally between tree/editor/right). Simplest: CSS `resize` won't do grid; use draggable gutter divs adjusting `grid-template-columns/rows` track sizes stored per-layout. Persist sizes if feasible; equal by default.

### U3 (#2+#4) — editable + save
- Backend: `lib/pactFs.mjs` add `writeTextFile(root, rel, content)` (repo-confined, size guard) + test. `dashboard/server.mjs` `POST /api/pact/file` (local-only+canExecute). Tunnel it: `agent/agent.mjs` `pactWrite` command; `relay/server.mjs` forward POST `/api/pact/file` (ancient-only) — mirror the `pactTree`/`pactFile` forward + `handleCommand` cases already added for reads.
- Frontend: make the body a real editor (textarea or CodeMirror-less contenteditable + a syntax overlay is complex — simplest is a `<textarea class="pact-edit">` that mirrors the highlighted `<pre>`; or keep the `<pre>` for view + toggle to edit). Track dirty per tab (`tab.dirty`, `tab.content` vs `tab.saved`). **Save All** button (in a toolbar) POSTs every dirty tab; **autosave** on a debounce; the button is disabled when no tab is dirty, enabled when any is. Show a dot on dirty tabs.

### U4 (#3) — agent diffs
- Detect files the agent changed: on each chat turn end (result), or via polling the repo mtimes / a git-diff of the Ouronet repo, compute a per-file line diff (before vs after). Render in the editor with green (added) / red (removed) line backgrounds (a diff view mode). **Keep All** accepts the changes (clears the diff highlight; the file on disk already has the new content). This is the hardest — likely needs the backend to expose a git diff of the Ouronet repo (`git -C <ouronet> diff`) tunneled, or track content snapshots per open file and diff against the agent's writes.

## Backend reach reminder
Pact tree/file **reads** are already tunneled through the relay (v1.0.4: relay `/api/pact/tree|file` → `link.relay("pactTree"/"pactFile")` → bridge `handleCommand`). Any NEW pact endpoint (write, git-diff) must be added the SAME way to work on brain.ancientholdings.eu. The `.repl` runner is local-only (SSE).

## Knowledge side (DONE — context, not a TODO)
Authority is in the Ouronet repo `OuronetInformational/`: `SKILL.md` (single hook) + `pact5/` + `MODULE-INDEX.md` (+ generator). Auto-loads in Cursor (`.cursor/skills/ouronet-pact`) and Claude (root `CLAUDE.md` pointer). OuronetUI `CLAUDE.md` has a cross-ref. Claudstermind brain (`brain/OuronetPact/`) mirrors it. Ouronet is off-limits in the Core cockpit (filtered in `st.repos`). Pact chat preamble = `PACT_CHAT_PREAMBLE` in app.js (a load hook).
