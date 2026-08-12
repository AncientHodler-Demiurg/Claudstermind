# Pact editor → CodeMirror 5 migration (ship as v1.2.0)

## Why
The Pact editor is a `<textarea>` overlaid on a highlighted `<pre>`. A textarea can't hide/fold lines,
so folding had to be a SEPARATE read-only view — which broke the "everything editable" expectation and
also meant find + the change-ruler only existed in the editable overlay. Move the editing surface to a
real editor engine (CodeMirror 5 — loads via CDN, fits the no-build setup) so folding works INLINE while
editable, and line numbers / find / change-ruler come natively. OuronetUI already uses CM6 (bundled,
Vite) with its own lang-pact; Claudstermind stays no-build → CM5 + our existing StoicSyntax tokenizer as
a CM mode. Keep StoicSyntax band colors identical.

## Scope
- IN: the EDITABLE editing surface for .pact/.repl (and plain text/md editing). Replaces the
  textarea+pre+gutter+overlay+custom-find+read-only-fold+custom-ruler+caret-reveal.
- KEEP AS-IS (separate concerns, not the editing surface): the agent green/red DIFF review view
  (`tab.agentDiff` — a legitimate read-only review surface, like Cursor's diff), the changed-files tree
  tab, the Pact chat, the tunneled file read/write/git endpoints, autosave/Keep-All semantics.

## Stages (ship each as a working commit; the completing commit = v1.2.0)
- **S1 Core swap.** ✅ DONE (v1.1.61). CM5 vendored locally (no runtime CDN) + StoicSyntax CM mode +
  editable CM instance per tab + native line numbers; textarea overlay / caret-reveal / custom ruler DOM removed.
- **S2 Inline folding.** ✅ DONE (v1.1.62). Fold gutter + pactCmFoldRanges range finder; read-only fold view + ⊟/✎ toggle removed.
- **S3 Find/replace.** ✅ DONE (v1.1.63). CM search/dialog/matchesonscrollbar; custom find bar removed.
- **S4 Change ruler.** ✅ DONE (v1.1.64). annotatescrollbar change ruler (add/del/mod bands vs git HEAD) via pure pactChangeAnnRanges; custom `.pact-ovr` removed.
- **S5 Cleanup + 1.2.0.** ✅ DONE (v1.2.0). Removed dead textarea/overlay/gutter/find-overlay/ovr + read-only fold-view CSS and the unused `renderPactCode`; kept `pactHighlightLines` (agent-diff view) and all unit-tested pure helpers. Shipped as 1.2.0.
- **S1 Core swap.** Load CodeMirror 5 + addons from CDN in index.html. Write a CM5 mode for StoicSyntax
  (wrap `window.pactHighlight`'s tokenizer, or a token-level mode that reuses the same prefix/band rules
  → same `.pk-*`/`cm-*` colors). Replace the editable overlay in `pactEdRenderBody` with a CM instance
  per open .pact/.repl tab (plain mode for others). Wire: content load, change→dirty→autosave (5 min) +
  Ctrl/⌘-S + Save All, per-box font (`g.fontPx`), `tab.content` sync. Native **line numbers** (CM
  `lineNumbers`). Editor must be fully editable. Remove the textarea/pre/gutter/overlay + caret-reveal.
- **S2 Inline folding.** CM `foldgutter` + `foldcode` with a custom RangeFinder built from our paren
  logic (`pactFoldRanges`) so module/interface/def* fold INLINE while editable. Remove the read-only
  fold view (`pactEdRenderFoldBody`, `pactFoldViewFill`) and the ⊟/✎ toggle.
- **S3 Find/replace.** CM `search`/`searchcursor` (or keep our UI wired to CM). Ctrl/⌘-F, Ctrl/⌘-H,
  match count, case/word/regex, replace/all. Remove the custom `.pact-find-bar` + overlay.
- **S4 Change ruler.** CM `annotatescrollbar` (+ a line-change gutter if easy) marking added/removed/
  modified lines vs git HEAD, reusing `pactChangeMarks(before, after)`. Remove the custom `.pact-ovr`.
- **S5 Cleanup + 1.2.0.** Delete now-dead code/CSS (textarea overlay, custom gutter/find/fold/ruler,
  caret-reveal). Full suite green. Bump to **1.2.0** with a CHANGELOG entry summarizing the migration.

## Constraints
- No-build: CM5 + addons via CDN `<script>`/`<link>` in `dashboard/public/index.html`. No bundler, no npm
  frontend deps. Keep the single classic `app.js`.
- Keep StoicSyntax colors identical (reuse `dashboard/public/pact-highlight.js`'s token rules — a CM mode
  can call the same classifier). Do NOT rewrite the color palette.
- Tests green each commit (`env -u SESSIOND_SOCK node --test --test-concurrency=1`); pure helpers keep
  their unit tests; extract new pure helpers (fold-range→CM, change-marks→annotations) with tests.
- App must run at every commit (stage the swap so a half-migrated state still works, or land S1 wholesale
  but verified).
