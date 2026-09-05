# StoicSyntax highlighter — resume note (design session)

**Preview:** `http://localhost:3001/pact-theme-preview.html` (swatches + live code sample)
**Generator (edit + re-run to tweak):** `dashboard/public/pact-theme-palette.gen.mjs` → `node …`

## FINAL palette (approved so far, on dark bg #0b1020)
Rule: **bold = the lead/heavy group of each chapter** · **aux (`x`) = italic** · `def*` built-ins bold.

**1 CONSTRUCT — yellow:** `UDC_` **#f3c81b bold** · `{object literal}` #e3c652 · `UDCx_` #e4c136 *italic*
**2 COMPUTE — blue:** `UC_` **#3181e9 bold** · `UCk_ UCv_` #4d90e8 · `UCx_ UCkx_` #9dbeea *italic*
**3 READ — orange:** heavy `URH_ URHC_ URHx_ URHCx_` **#ec8013 bold** · light `UR_ URC_ URU_ URCv_` #e8b683 (`URCx_` *italic*) · cost `URCi_` **#a36633 dark brown**
**4 VALIDATE — cherry red:** `UEV_` **#be274a bold** · `CAP_` #be274a (same colour, not bold). `UEV_IMC` = a `UEV_` (no special case; longest-first colours it red).
**5 WRITE — magenta/pink:** `WW_` **#e61990 bold** · `WU_ WU2_ WU3_ WU4_` #e46db2 · `WI_` #e89fca
**6 AUX/PROTECTED — violet:** `XI_` **#a045d5 bold** · `XE_` #ab5fd7 · `XB_` #b577da
**7 USER — green:** admin `A_ AA_ Ap_ AAp_ AU_` **#1d9a4d bold (strong)** · client `C_ CC_ Cp_ CCp_` #9adfb1 (light)

**Supporting:** PACT-BUILTIN teal #66cfc1 (`def*` bold, other built-ins regular) · CONSTANT `CT_` grey #9298a4 · STRUCTURAL `GOV P| SECURE UEV_IMC` #737b8c · COMMENT #647085 (dark) / #7c8698 (light).
**Object literals** `{ … }` (braces + keys) → UDC_ yellow **#f3c81b, NOT bold** (construction, not a declaration).
**Types** (`decimal integer string time guard keyset bool …`) → **silver #c2c8d2** (cool neutral; dimmer than identifier text).

## DONE
- Source doc `OuroborosNetwork/…/StoicSyntax-Prefixes.md`: `URCcap_` removed → `CAP_` (migration notes in §1/§2/§4/§5.1/§6).

## PENDING — on user's "lock it"
1. **Rewrite StoicSyntax-Prefixes.md into the 7 ordered classes** (Construct→Compute→Read→Validate→Write→Aux/Protected→User) carrying these hexes; kill the stale "Ten/Twelve" count → 7; add the missing `UCkx_` §2 row.
2. **Bake the highlighter** `dashboard/public/pact-highlight.js` — rewrite the `BANDS` table with **longest-first** matching (URHC_ before URH_, URCi_/URCv_/URCx_ before URC_ before UR_, WU4_ before WU_, CC_ before C_, AAp_ before AA_ etc.), add classes: construct, compute(+k/x), read(light/heavy/aux/cost), validate, write(WW/WU/WI), protected(XI/XE/XB), user(admin/client), pact-builtin(def* bold), constant, structural.
3. **`styles.css`** — set the `.pk-*` colour values above.
4. **`lib/pactHighlight.test.mjs`** — update expectations for the new bands.

## Open micro-items to confirm before baking
- (none outstanding — all feedback applied through the last round)
