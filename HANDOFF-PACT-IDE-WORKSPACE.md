# HANDOFF — Pact IDE Workspace (a new "Pact" tier‑2 view in the Claudstermind dashboard)

> **Status:** Discovery + environment setup done. No dashboard code written yet.
> **Created:** 2026-08-10 by a Claude session that was accidentally started in the Ouronet Pact repo (`OuroborosNetwork/_onchain/Ouronet`) instead of Claudstermind. This document hands the work over to a session running **inside Claudstermind**, where it belongs.

---

## 0. TL;DR for the next agent

The owner (Mihai) wants to add a new **tier‑2 button + view called "Pact"** to the **Claudstermind dashboard** (`dashboard/`). This "Pact" view is a **full Pact development IDE** (think VS Code + agentic Claude copilot + terminal), whose folder tree points at the **Ouronet Pact repository** on disk. The Ouronet repo is *only the location of the Pact source* — **all code you write lives in Claudstermind**, not in Ouronet.

**Build target:** `/home/ancientbox/ClaudeWS/Claudstermind/dashboard/`
**Folder‑tree target (data only):** `/home/ancientbox/ClaudeWS/OuroborosNetwork/_onchain/Ouronet/`

---

## 1. The four tier‑2 buttons the owner wants (in the Claudstermind workspace)

Inside the Claudstermind workspace, add these tier‑2 buttons:

1. **Core** — the *current* workspace content (whatever the workspace shows today), relabelled/rehomed under this button.
2. **Pact** — **the new thing to build** (the Pact IDE described below).
3. **Mirror** — the *existing* "Mirror" button/view (already in the dashboard — confirm where).
4. **Localhost** — the *existing* "Localhost" button/view (already in the dashboard — confirm where; note there is also a sibling folder `/home/ancientbox/ClaudeWS/LocalHost/`).

> ⚠️ In an earlier misfire I explored the **wrong** app (`OuroborosNetwork/daimons/OuronetUI`) and could not find "Mirror"/"Localhost" there — because they live in **Claudstermind's dashboard**, not OuronetUI. First job in the correct repo: locate the existing tier‑2 button bar + the Mirror/Localhost views.

---

## 2. Full spec of the "Pact" view (owner's own description, structured)

A Pact development workspace, structured as an IDE.

**Folder tree**
- A file/folder tree pointed **directly at the Pact workspace = the Ouronet repo** (`.../_onchain/Ouronet`).
- (Owner said "on the right"; standard IDEs put it left. Confirm placement — see Open Questions.)

**Three zones (of the width remaining after the tree):**

**Zone A — Editor, ~75% of remaining width**
- Two equal **levels** stacked vertically (upper + lower).
- **Each level can be split into up to 3** side‑by‑side view boxes → **up to 6 view boxes total**.
- **Each view box has its own tabs**; many Pact/REPL files open at once, cycling via tabs.
- Code shown here is **syntax‑colored like an IDE**, using a **custom Pact color system** based on **StoicSyntax** (see §4). Owner explicitly wants "our own custom pact colour system based on our special way of writing pact syntax."
- Must also **render `.md` files properly** (markdown parser/viewer).

**Zone B — Right column, ~25% of remaining width, split top/bottom:**
- **Top: multi‑tab AI chat.** Multiple chat conversations about working in the Pact repo, each with its **own history**, opened as tabs, run **simultaneously** (work on separate features in parallel).
  - Everything chatted must be **written down by the Claudstermind "mind"** and **actively learned from** — fed into a **single "pact brain"** that gets smarter with every Pact task. (This maps onto Claudstermind's existing `brain/` + continuous write‑back protocol — see §3 and §5.)
- **Bottom: a mirror of the Linux terminal.** When an agent runs a `.repl` file for testing, the **whole run is shown live** here so the owner can watch inputs/outputs. Example loop the owner described: *agent writes code → runs a `.repl` → it errors → agent inspects, edits → re‑runs → the entire run is visible to the owner.*

**Agent skill requirement:** the AI agent must **learn to write Pact** and specifically **write it in the StoicSyntax discipline**. The owner will point to Pact docs to learn from; capture that knowledge into the brain.

---

## 3. What Claudstermind ALREADY provides (huge — reuse, don't rebuild)

Claudstermind is **not** a static docs repo in practice — it's an **AI‑agent workspace** already built on the Claude Agent SDK. Root `package.json`:
- `name: "claudstermind"`, `"@anthropic-ai/claude-agent-sdk": "^0.3.216"`, `ws: "^8.21.1"`.

Top‑level dirs (all under `/home/ancientbox/ClaudeWS/Claudstermind/`):
- **`dashboard/`** — the web app we modify (has the tier‑2 buttons + workspace). *Has its own `package.json`.* **← primary build surface.**
- **`brain/`** — per‑project knowledge bases + the learning store (`brain/<name>/LEARNINGS.md`, `STATE.md`, etc.). **This is where the "pact brain" should live/feed.** Note: an `OuronetPact` project is listed in MANIFEST under "known but not yet linked" — the pact brain likely wants a `brain/OuronetPact/` (or similar) linked entry.
- **`agent/`**, **`orchestrator/`** — agent runtime / orchestration (how Claude Agent SDK sessions are spawned/managed). Chat tabs + agentic coders should plug in here.
- **`relay/`** — websocket tunnel (`ws`), *has its own `package.json`*. Likely the transport between dashboard ↔ agent runtime.
- **`skills/`** — step recipes (`::cm…` commands, load‑cluster, push, sync).
- **`meta/`** — cluster‑wide facts/conventions/glossary.
- **`lib/`, `ops/`, `docs/`, `scripts/`, `relay/`, `cm-deploy.tgz`** (a built deploy bundle).

**Operating mode (README, mandatory):** continuous write‑back — agents append to `brain/<project>/LEARNINGS.md` / refresh `STATE.md` **in the same turn** as the triggering event, without being asked. The owner's "pact brain that learns" is exactly this mechanism, specialized to Pact/StoicSyntax.

> **Implication:** the AI‑chat + brain half of this feature is *far less greenfield than it looked* — the Agent SDK, orchestrator, relay, and brain already exist. The task is mostly (a) the dashboard IDE UI and (b) wiring chat tabs to the existing agent runtime + brain, plus a Pact‑specialized knowledge/skill.

**MANIFEST caveat — paths are Windows.** `MANIFEST.md` uses `D:/_Claude/...` paths (owner works across a Windows box and this Linux box; that's why git was pulled from "another computer"). **On this Linux machine everything is under `/home/ancientbox/ClaudeWS/`.** Don't trust the `D:/` paths literally here.

---

## 4. The custom Pact color system (StoicSyntax‑aware)

- **StoicSyntax spec lives at:** `OuroborosNetwork/_onchain/Ouronet/OuronetInformational/StoicSyntax.md` (v1.6.7, ~1380 lines). It's a *discipline* for writing Pact: functions are prefixed and the **prefix is the contract**. The color system should **colorize by prefix**:
  - Unprotected: `UC_` (pure compute), `UCK_` (key ctors), `UR_`/`URD_` (reads/scans), `URC_`/`URDC_` (read+derive), `UDC_` (object ctors), `UEV_` (enforce/validate), `CAP_` (ownership enforce).
  - Protected: `A_` (admin), `C_` (client recipe), `XI_`/`XE_`/`XB_` (orchestration writes), `W_`/`WI_`/`WU_`/`WW_` (persistence).
  - Also worth coloring: capability bands (`C1`–`C4`), section bars (`;;====`, `;;POLICY`, `;;{C1}`, `{F0} [UR]`, `;;Select Keys`), cap‑name shapes (`MODULE|C>…`, `MODULE|A>…`, `MODULE|XE>…`), module‑ref `::` calls.
- **Prior art to port (same machine, sibling repo):** `OuroborosNetwork/daimons/OuronetUI/src/lang-pact/` is a **real CodeMirror 6 + Lezer grammar for Pact** with a VS Code "Dark+" theme:
  - `src/lang-pact/pact.grammar` (Lezer grammar: Keyword/DefKeyword/TypeKeyword/String/Number/Decimal/Symbol/MetaTag/Operator/Application/List/Object, `;;` line comments),
  - `src/lang-pact/index.ts` (`styleTags` → Lezer highlight tags, `pact()` LanguageSupport),
  - `src/lang-pact/pact-theme.ts` (palette: keyword `#c586c0`, type `#4ec9b0`, string `#ce9178`, number `#b5cea8`, comment `#6a9955`, parens gold `#ffd700`, brackets `#da70d6`, braces `#179fff`, gold accent `#ceac5f`, bg `#18181B`).
  - **This grammar has no notion of StoicSyntax prefixes** — extend it: add token rules / a highlighter that recognizes `^[A-Z]+_`‑style prefixes and cap‑name shapes and assigns distinct highlight tags. Decide whether the dashboard already uses CodeMirror/Monaco/etc. (check dashboard stack first) and either reuse this Lezer grammar or reimplement the prefix coloring in whatever editor the dashboard uses.

---

## 5. Environment work ALREADY DONE on this Linux machine

1. **Pulled Ouronet git** — `OuroborosNetwork/_onchain/Ouronet` was 2 commits behind `origin/main`; fast‑forwarded cleanly. (The "hundreds of modified files" were pure CRLF↔LF line‑ending churn — discarded with `git restore .`, zero content lost, then pulled.)
2. **Installed Pact 5.4** — the Ouronet REPLs target **Pact 5** (not Pact 4; the docs' "based on Pact 4.11.0" is a historical baseline — the live REPLs say "Pact 5+ REPL" and rely on 5.4 identifier syntax).
   - Binary: **`/home/ancientbox/.local/bin/pact`** (on PATH), from `github.com/kadena-io/pact-5` release `5.4`, asset `pact-5.4-linux-x64.tar.gz`. `pact --version` → `pact version 5.4`. No missing shared libs.
   - **Verified**: `cd OuroborosNetwork/_onchain/Ouronet/REPL && pact Stage00_Sanboxes.repl` → `Load successful`, exit 0. (First tried Pact 4.11 — it *failed* on `init-phase-01-ns.repl:37` "Cannot define a keyset outside of a namespace"; 4.11 was removed and replaced by 5.4.)
   - **The terminal‑runner feature can shell out to `pact <file>.repl` and stream stdout/stderr.**

**How to run the Ouronet REPL pipeline** (from `OuroborosNetwork/_onchain/Ouronet/REPL/`):
- `pact Z.repl` — full pipeline (Stage00 sandboxes → 00a Stoa tests → Stage 01 → Stage 02).
- `pact Stage01_Tester.repl` / `pact Stage02_Tester.repl` — per stage.
- `pact Stage00_Sanboxes.repl` — sandbox bootstrap (known‑good smoke test).

---

## 6. Decisions defaulted (owner did not answer the scoping questions; confirm/redirect)

- **Phasing:** *Foundation first.* Phase 1 = tier‑2 wiring + IDE layout (tree, up‑to‑6 tabbed panes, StoicSyntax coloring, markdown rendering, `.repl` terminal runner). Phase 2 = AI chat tabs + pact brain (wired to existing agent/orchestrator/brain).
- **AI agent type:** *agentic coders* (they write Pact + run REPLs + iterate, watched live in the terminal) — matches the owner's example. Lands in Phase 2.
- **LLM provider:** Anthropic Claude (already the stack — Claude Agent SDK). Keep behind an abstraction.
- **File editing:** *read + write* on the real Ouronet repo (git is the undo net).

## 7. Open questions to confirm with owner (in the Claudstermind session)

1. **Folder‑tree placement:** owner said "on the right," but the zone math (editor 75% + right column 25%) reads as tree‑left. Left (VS Code‑style) or literally far‑right?
2. **"Core" button:** confirm exactly what "current workspace content" is today, so Core simply rehomes it.
3. **Mirror / Localhost:** confirm the existing components/routes so the new tier‑2 bar includes them unchanged.
4. **Pane splitting UX:** resizable splitters vs fixed thirds; per‑pane tab drag‑and‑drop between boxes (nice‑to‑have)?
5. **Brain linkage:** should the "pact brain" be a new linked project `brain/OuronetPact/` (MANIFEST lists `OuronetPact` as known‑but‑unlinked), and should chat learnings write there?

---

## 8. Concrete next steps (do these IN the Claudstermind session)

1. **`::` load the cluster** per Claudstermind README/skills, then **explore `dashboard/`** properly: stack (framework/build/styling/state), the existing tier‑2 button bar, how content swaps, and the existing **Mirror** + **Localhost** views + existing chat/terminal components. *(A dashboard‑exploration Explore agent was launched from the wrong‑repo session and stopped; just redo it here with repo access.)*
2. Explore `agent/` + `orchestrator/` + `relay/` to learn how a chat session / agent run is spawned and how stdout streams to the dashboard (reuse for both chat tabs and the terminal mirror).
3. Confirm the Open Questions (§7) with the owner.
4. **Phase 1 build order:** (a) tier‑2 buttons Core/Pact/Mirror/Localhost wired; (b) `/pact` view shell with the 3‑zone resizable layout; (c) folder‑tree component + a backend fs endpoint rooted at the Ouronet repo (read+write); (d) multi‑pane tabbed editor; (e) StoicSyntax color system (port/extend `OuronetUI/src/lang-pact/`); (f) markdown viewer; (g) `.repl` terminal runner streaming `pact <file>` output live.
5. **Phase 2 build order:** multi‑tab chat wired to the existing agent runtime; per‑tab history persistence; continuous write‑back into `brain/` so the pact brain compounds; seed the brain with `StoicSyntax.md` + Pact 5 docs (`https://docs.kadena.io/pact-5`).

---

## 9. Key paths (this Linux machine)

| What | Path |
|------|------|
| Build target (dashboard) | `/home/ancientbox/ClaudeWS/Claudstermind/dashboard/` |
| Claudstermind root | `/home/ancientbox/ClaudeWS/Claudstermind/` |
| Ouronet Pact repo (tree target) | `/home/ancientbox/ClaudeWS/OuroborosNetwork/_onchain/Ouronet/` |
| StoicSyntax spec | `…/Ouronet/OuronetInformational/StoicSyntax.md` |
| Ouronet REPL entrypoints | `…/Ouronet/REPL/` (`Z.repl`, `Stage0X_*.repl`) |
| Pact 5.4 binary | `/home/ancientbox/.local/bin/pact` |
| Pact highlighter prior art | `/home/ancientbox/ClaudeWS/OuroborosNetwork/daimons/OuronetUI/src/lang-pact/` |
| Sibling "LocalHost" folder | `/home/ancientbox/ClaudeWS/LocalHost/` |

---

## 10. Progress log (built inside Claudstermind)

### 2026-08-10 — v0.17.0 — Phase 1a shipped (nav + fs API + IDE shell)
**Decisions taken** (owner didn't answer the scoping questions live; defaulted per handoff, all reversible):
- **Nav:** Pact added as a **tier-2 sub-tab under Workspace**, alongside a new **Core** sub-tab (= today's cockpit). **Mirror & Localhost left as tier-1 for now** — deliberately *not* moved yet (no disruption to daily nav; folding them in is a one-liner in `SECTIONS` once confirmed).
- **Editor engine:** **lightweight custom highlighter** path chosen (fits the frontend's no-build, single-classic-script reality — `index.html` loads one `/app.js`, zero ESM/bundler). Highlighter not yet written (viewer is plain monospace this slice); designed so a CodeMirror swap stays possible later.
- **Tree placement:** **left** (VS Code standard).

**Key architecture fact confirmed:** the dashboard frontend has **NO build step** — `dashboard/public/app.js` is one classic `<script>`, no imports, no frontend npm deps (`dashboard/package.json` deps = `jose` only). Any CodeMirror/Lezer port would require introducing a bundler or vendored ESM.

**What shipped (files):**
- `lib/pactFs.mjs` (+ `lib/pactFs.test.mjs`, 6 tests) — read-only fs confined to `pactRoot(MASTER_ROOT)` = `…/OuroborosNetwork/_onchain/Ouronet`. `listDir` (lazy, dirs-first, skips `.git`/`node_modules`/build dirs), `readTextFile` (refuses dirs, binaries via NUL-sniff, >2 MB), `safeResolve` (traversal/escape-proof).
- `dashboard/server.mjs` — `GET /api/pact/tree?dir=`, `GET /api/pact/file?path=` (canRead-gated).
- `dashboard/public/app.js` — `SECTIONS` Workspace now has `subs:[Core, Pact]`; `viewPact()` + tree/file helpers; `ws-full` now also true for `VIEW==="pact"`.
- `dashboard/public/styles.css` — `.pact-ide` 3-zone layout (tree | editor 75% | right 25% split chat/terminal), mobile stacks + scrolls.

**Remaining after Phase 1 (all of Phase 1 is now DONE — see log):**
- **Phase 2** — multi-tab AI chat in the IDE right column (agentic coders: write Pact + run REPLs + iterate, each tab its own history, parallel); continuous write-back to `brain/OuronetPact/` (now SEEDED, see below). **Recommended build:** reuse the existing workspace agent runtime — `agent/` + `orchestrator/` + the `ClaudeSession`/WS_IN·WS_OUT protocol that the Core cockpit already uses — scoped to the Ouronet repo, embedded in `.pact-chat`, writing learnings back to the seeded brain. Don't rebuild the session layer; wrap it.
- Editor polish: drag tabs between boxes, resizable splitters; remote (relay) `.repl` runner via the bridge protocol (Phase 1's runner is local-dashboard only).

### 2026-08-10 — v0.19.0–0.21.0 + brain seed — Phase 1 COMPLETE
- **v0.19.0 — `.repl` terminal runner.** `lib/pactRun.mjs` (pure spec: repo-confined, `.repl` only, resolves the pact bin) + `lib/pactRun.test.mjs`. Server SSE `GET /api/pact/run` (local-only + canExecute, spawns `pact <file>`, streams `out`/`err`/`exit`/`fail` events, 120 s cap, killed on disconnect; the server event is `fail` not `error` to avoid EventSource's native-error collision). Frontend: ▶ Run in a `.repl` box streams into `.pact-terminal`.
- **v0.20.0 — Markdown.** `dashboard/public/md-mini.js` → `window.mdRender` (classic script, eval-tested in `lib/mdMini.test.mjs`). HTML-escapes source first; code fences never formatted; link URLs whitelisted. `.md` files render formatted.
- **v0.21.0 — Multi-pane tabbed editor.** `PACT_ED` group model in app.js: up to 6 boxes in a CSS grid (`--pact-ed-cols`), each with its own tab strip; tree opens into the active box; ⊞ split, × close tab/box; per-tab content cached. Renders by type (highlight / markdown / plain); `.repl` box has its own ▶ Run.
- **Brain seeded:** `brain/OuronetPact/` — `ONBOARDING.md`, `LEARNINGS.md` (full StoicSyntax prefix taxonomy + IDE color language + Pact 5 gotchas), `STATE.md`. This is the write-back target for Phase 2's chat.

**Testing note:** browser classic scripts (`pact-highlight.js`, `md-mini.js`) are Node-tested by `new Function("window", src)(win)` — no bundler. Keep them pure.

### 2026-08-10 — v0.18.0 — Phase 1b: StoicSyntax highlighter
- **`dashboard/public/pact-highlight.js`** (classic script → `window.pactHighlight` / `pactClassifyWord` / `pactBandLegend`; loaded in `index.html` *before* app.js). Single-pass tokenizer, HTML-escaped/injection-safe. Colors by StoicSyntax prefix band at segment boundaries (`^` or after `| . : >`) so `IC|UDC_…`, `URC|KDA-PID_CLAD`, `SWP|A_…`, cap arrows `|C>` all resolve. Bands: compute/read/ctor/enforce/cap (cool/gold) vs client/orch/admin/write (warm/red). Plus `;;` section bars, strings, numbers, `:type`, `::`, keywords/def-forms, bracket kinds.
- **`lib/pactHighlight.test.mjs`** (6 tests) — evals the browser script with a fake `window` (no bundler, no dup). Verified on real `0_Sample/Empty.pact`: `C_RotateKadena`→client, `A_UpdateLiquidBoost`→admin, `UC_*`→compute, `URC_*`→read, no single-letter-band false positives.
- **`app.js`** `renderPactCode()` uses the highlighter for `.pact`/`.repl` (plain text otherwise); a **band legend** strip renders above the code. **`styles.css`** `.pk-*` token colors (VS Code Dark+ base) + `.pact-legend`.
- **Testing note for next agent:** the highlighter is a pure function; keep it that way. To test browser-global classic scripts in Node without a bundler, read the file and `new Function("window", src)(win)` — the pattern used here.

**Open questions still unanswered (§7):** nav-grouping confirm (move Mirror/Localhost in?), tree side (defaulted left), pane-split UX (splitters vs fixed thirds), brain linkage path.
