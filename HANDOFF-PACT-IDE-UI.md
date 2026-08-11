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
- ⏳ U1 = #1 (tree width/font/carousel) + #7 (per-box font, multi-line tabs).
- ⏳ U2 = #5 + #6 (equal-split resizable boxes + the layout ladder + right zone ⅕).
- ⏳ U3 = #2 + #4 (editable files + Save All + autosave + dirty state). **Needs a backend write endpoint.**
- ⏳ U4 = #3 (agent-edit green/red diffs + Keep All). Hardest — needs change-detection.

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
