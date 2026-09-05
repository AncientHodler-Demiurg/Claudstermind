# StoicSyntax medallions in CodeMirror — integration guide & what to expect

This documents the port of the **read-only DALOS colouring engine** (`pact-dalos-preview.gen.mjs`) into an
**editable CodeMirror** live-write view, and how to take it from the preview tab into the real Pact editor
(and later OuronetUI / the explorer).

Preview: **`pact-theme-preview.html` → "Editable (live typing)" tab** (`#editable`). Toggle **Flat ⇄ Medallions**.

---

## 1. The core constraint (read this first)

CodeMirror positions the caret and maps clicks by assuming each character has a **fixed advance width**.
Anything that changes a token's box size desyncs the caret from the text:

| CSS property | In the read-only DALOS engine | In the editor |
|---|---|---|
| `background` | ✅ used | ✅ **safe** — no layout impact |
| `box-shadow: inset …` (fake border) | — | ✅ **safe** — never affects layout |
| `border-radius` | ✅ used | ✅ **safe** |
| `color` / `font-weight` | ✅ used | ✅ **safe** |
| `padding` | ✅ (breathing room) | ❌ **moves the caret** |
| `border` (real) | ✅ (type medallions) | ❌ changes width |
| `margin` | ✅ | ❌ changes width |
| `display:inline-block` | ✅ | ❌ re-boxes the token |
| `clip-path` on the **token** (clips text) | — | ❌ clips the glyphs |
| `clip-path` on a **`::before`/`::after` background layer** | — | ✅ **safe** — layout untouched, text on top |

So most medallions are drawn caret-safe with `background` + `box-shadow: inset 0 0 0 2px <hue>` (the border)
+ `border-radius` + `color`. **Angled** caps use a different caret-safe trick (see below). Nothing alters width.

### Angled metallic caps ARE possible (the pseudo-layer trick)
The metallic capability medallions render **angled** in the editor — not rounded. The hexagon is painted on
two absolutely-positioned pseudo layers **behind** the text: `::before` = outer metal border, `::after` = dark
inner fill, both `clip-path`'d into the hexagon. The token span only takes `position:relative; z-index:0` (a
local stacking context) — **no** padding/border/inline-block — so the character advance width never changes and
the caret stays glued. The text sits on top, unclipped. Bronze/silver/gold + foreign-black all use this.

### The one remaining difference vs. the read-only tab
**Pills hug the text — no side breathing padding** (padding is the one thing that moves the caret). The angled
cap points are therefore tight against the first/last glyph rather than sitting in a padded margin. That is the
*only* deliberate visual gap now.

**Everything else matches**: hues, which token gets which medallion, the **angled** bronze/silver/gold cap
metals, foreign-black, `ref-`/schema/form/tag medallions, per-type colours, and bracket-depth colouring.

---

## 2. Files

| File | Role |
|---|---|
| `pact-dalos-preview.gen.mjs` | The **canonical** engine (read-only HTML). The classification here is the source of truth. |
| `pact-medallion-embed.js` | The **port**: a streaming CodeMirror mode (`stoicpreview`) carrying the *same* taxonomy, emitting `md-*` token classes. Caret-safe. |
| `pact-theme-palette.gen.mjs` | Generates `pact-theme-preview.html`; owns the `.cm-md-*` CSS (base colours + `.mdl` pills) and the third tab. |
| `pact-theme-preview.html` | **Generated** — never hand-edit. Re-run `node dashboard/public/pact-theme-palette.gen.mjs`. |

The classification currently lives in **two** places (the `.gen.mjs` engine and `pact-medallion-embed.js`).
See §6 for the single-source plan before shipping to production.

---

## 3. Token taxonomy (what maps to what)

Classification order (mirrors `emitAtom` in the engine):

1. **numbers** → `md-num-int` / `md-num-dec` (value pill, rounded, no border)
2. **booleans** → `md-bool`
3. **`@tags`** → `md-tag` (doc/model, pink) · `md-tagO` (event/managed, orange)
4. **forms** `module`/`interface`/`create-table` → `md-form` (yellow, bordered pill)
5. **bare types** in `[string]` etc. → `md-ty-<type>`
6. **`name:type`** → the name classifies normally; `:type` → `md-ty-<type>` (per-type colour) or `md-ty` (grey) for custom types
7. **`qualifier::member`** → qualifier (`ref-…` → `md-ref` steel pill, else plain) · `::` default · member classified on its own (band, builtin, or **foreign-black**)
8. **bare `ref-…`** → `md-ref` (module value, steel)
9. **governance const** (`defconst` under `;;{G1}`) → `md-structb` (grey bold)
10. **region-4 capability name** → metallic `md-capB` / `md-capS` / `md-capG` (see §4)
11. **def keywords** → `md-bib`
12. **prefix band** (the 37) → `md-<band>` text colour (see below)
13. **builtins** → `md-bi`
14. else → plain text

**Prefix bands (region 5 — coloured TEXT, not pills):** `compute` `ck` `cx` (UC*) · `rl` `rx` `heavy` `cost` (UR*) ·
`ctor` `ctorx` (UDC*) · `val` (UEV_/UEV_IMC) · `cap` (CAP_ prefix) · `wi` `wu` `ww` (W*) · `xi` `xe` `xb` (X*) ·
`adm` (A*) · `cli` (C*) · `const` (CT_). Structural `GOV`/`P|`/`SECURE` → `md-struct`.

**Brackets** `()[]{}` → depth-cycling `md-bk0`/`bk1`/`bk2` (red→yellow→blue); a matched close takes its open's colour,
tracked in the mode's `state.depth`. A standalone `{Schema}` (single atom in braces) → one `md-schema` yellow pill.

**Strings**: single-line → `md-strv` (orange pill); multi-line → `md-strblk` per line (state.inString).

---

## 4. Metallic cap bands need a whole-document pre-pass

A capability's band (bronze/silver/gold) is **not** inferable from its own body — it comes from the `;;{Cx}`/`;;{Gx}`
block **markers**:
- literal `true` body → **bronze** (`B`)
- under `;;{C4}` or `;;{G2}` → **gold** (`G`)
- everything else → **silver** (`S`)

`pact-medallion-embed.js` runs `computeCaps(fullText)` on init **and on every edit (debounced 200ms)**, filling
`CAPBAND` / `GOVCONST`, then re-sets the mode so tokens repaint. A pure per-line streaming tokenizer cannot see the
markers, so this doc-level pre-pass is required in any real integration too.

---

## 5. Integrating into the real Pact editor (production)

The production editor is `pact-cm-mode.js` (mode `stoicpact`) + `styles.css` (`.cm-pk-*`). To adopt medallions:

1. **Replace the classifier.** Swap the coarse `wrapStoicFamilies`/`pactClassifyWord` path for the full taxonomy in
   `pact-medallion-embed.js` (bands + per-type + caps + foreign + ref/schema/form/tag). Return `md-*` token styles.
2. **Add the doc pre-pass.** Wire `computeCaps` to the editor's document + a debounced `change` handler (metallic caps
   depend on the whole file's markers).
3. **Port the CSS.** Copy the `.cm-md-*` base + `.CodeMirror.mdl .cm-md-*` blocks from `pact-theme-palette.gen.mjs`
   into `styles.css`. Gate pills behind a body/editor class (e.g. `.CodeMirror.mdl`) so medallions are a **toggle**,
   not forced — some people prefer flat text while typing.
4. **Keep bracket matching off or reconcile it.** The preview sets `matchBrackets:false` because the bracket-depth
   colours already show pairing; CM's `matchBrackets` highlight fights the depth colours. Pick one.
5. **Regenerate the vendored highlighter** only affects the read-only `<pre>` path — the editable path is the CM mode.

### OuronetUI (execute-code CodeMirror) & the explorer
- **OuronetUI** is an editable CM textarea → use the **same** editable path (mode + `.cm-md-*` CSS + `computeCaps`).
- **Explorer module/interface viewer** is read-only → use the **read-only** engine (`renderDalos`/`toHtml`) for the
  **full** design (angled caps, padded medallions, per-type) — no caret constraints there.

---

## 6. Single-source plan (before production)

Right now the taxonomy is duplicated (engine `.gen.mjs` ↔ `pact-medallion-embed.js`). To avoid drift, before shipping:

1. Extract the classifier (PREFIX table, sets, `prefixClass`, `computeCaps`, `classifyWord`, `classifyMember`) into the
   **`stoicsyntax-pact`** package as a framework-agnostic module returning **token types** (not HTML).
2. The package ships **three** renderers off that one classifier: `toHtml` (read-only, full medallions), a CodeMirror
   mode factory (editable, caret-safe), and the TextMate grammar.
3. Re-run the vendor build; Claudstermind, OuronetUI and the explorer all import the same package. A palette change is
   then one edit + one `npm run highlight:vendor`.

---

## 7. What to expect (verification checklist)

Open the **Editable** tab, toggle **Medallions**, and confirm:

- [ ] Function names by band — `UC_` blue, `UR_` tan, `UDC_` yellow, `UEV_`/`CAP_` red, `W*` pink, `X*` purple, `A_` green, `C_` light-green — as **coloured text** (bands are text, not pills).
- [ ] `CAP_TRANSFER` etc. that are **region-4 caps** → metallic **silver/gold/bronze** pills; `GOV` → silver.
- [ ] `:decimal` `:string` `:object` → per-type medallions; custom types (`:client-state`) → grey.
- [ ] numbers, `true/false`, `"strings"`, `@doc` → value/tag pills; `{client-state}` → yellow schema pill.
- [ ] `ref-DALOS::GOV|Demiurgoi` → steel `ref-` pill · `::` · grey struct.
- [ ] brackets cycle red/yellow/blue and matched pairs share a colour.
- [ ] **Type anywhere** — the caret stays glued to the character you clicked; selection is exact. If the caret drifts, a pill picked up `padding`/`border`/`inline-block` — remove it.
- [ ] Add a `defcap` under a `;;{C4}` marker → after ~200ms it repaints **gold** (the doc pre-pass).

- [ ] Caps render as **angled hexagons** (the `::before`/`::after` pseudo-layer trick), not rounded.

Only deliberate gap vs the read-only tab: **no side breathing padding** (padding is what would move the caret) — so
the angled points hug the first/last glyph. That's caret-safety, not a bug.
