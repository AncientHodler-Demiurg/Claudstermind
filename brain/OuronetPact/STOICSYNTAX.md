# StoicSyntax — the discipline for writing Ouronet Pact

> Synthesized from `StoicSyntax.md` (v1.6.7) + `OuronetInformational/pact/*` + `ouronet/conventions/*`
> + real code. **The prefix is the contract**: a function's name declares its privilege and side-effect
> class before you open the body. **The layout is the first audit pass.** Validated live on Pact 5.4.

## The prefix taxonomy (exact call/no-call rules)

**Unprotected utilities** (no admin/client lock):
- **`UC_`** pure compute on args. MUST NOT read/`select`/`keys`/**`enforce`**. May call `UC_`/`UDC_`.
- **`UCK_`** table-key constructors (AQP). Args only.
- **`UR_`** single-row point read (`read`/`with-default-read`). No scans.
- **`UDC_`** object constructors — build an object, **no table I/O**.
- **`URD_`** scan/inventory (`select`/`keys`/multi-row). **Never on the execution path** (not in caps/`C_`/`A_`/`X*`); UI / `/local` dirty-read only.
- **`URC_`** read+compute via `UR_`. MUST NOT call `URD_` or `enforce`.
- **`URDC_`** read+compute via `URD_`. MUST NOT `enforce`; same execution-path ban as `URD_`.
- **`UEV_`** enforce/validate — **may `enforce`** (returns bool). Placed after all read tiers.
- **`CAP_`** account/ownership enforce helpers.
- Aux depth: `URCX_`/`URDCX_`. **Migration signals:** a `UC_` that reads → rename `URC_`; a `URC_` that scans → rename `URDC_`. Handle invalid input with `if → safe default` (e.g. `0.0`), never `enforce`, in URC/URDC.

**Protected entrypoints:**
- **`A_`** admin recipe (admin keyset). **`C_`** client recipe (reached via the Aggregator, never directly).
- **`XI_`** this-module-only orchestration → `W_*` (composes `SECURE`). **`XE_`** forward/external write entry (`UEV_IMC` + named `MOD|XE>…` cap). **`XB_`** home + peers, bidirectional (IMC replaces SECURE).
- `A_`/`C_` are **locked inside their module** — not the public surface. Clients hit the **Aggregator (Talos)**.

**Persistence (`W_`):** `WI_`=`insert` (row absent, full row via `UDC_`), `WU_`=`update` one field, `WU{N}_`=N fields, `WW_`=`write`/upsert. **No row delete** in Pact — deactivate via `WU_` on a flag. A `W_` body is `(require-capability (SECURE))` then **ONE** persistence op as the **final** expression, nothing after. **No `enforce`, not on interfaces, never `ref-OTHER::W_*`.**

## Module section order (fixed)

1. **GOVERNANCE** — `GOV` (composes `GOV|MOD_ADMIN`), keyset consts, `GOV|Demiurgoi` resolver.
2. **POLICY** — IMC spine tables `P|T`/`P|MT`, `P|…|CALLER`/`P|SECURE-CALLER` caps, `P|Info`/`P|UR`/`P|A_Add…`/`P|A_Define`/`UEV_IMC`.
3. **SCHEMAS-TABLES-CONSTANTS** — `;;{1}` schemas, `;;{2}` tables (one numbered `;;N]` per `deftable`), `;;{3}` consts.
4. **CAPABILITIES** — bands **C1** (trivial roots, e.g. `SECURE`) → **C2** (simple, non-composing) → **C3** (ownership) → **C4** (composite: `compose-capability`, recipe masters, `@event` shells).
5. **FUNCTIONS** — canonical order: `UC_` → `UCK_` → `UR_` → `UDC_` → `W_` → `URD_` → `URC_` → `URDC_` → `UEV_` → `C_` → `A_` → `X` (`XI_`/`XE_`/`XB_`). `CAP_` sits with `UEV_` or just before `C_`.

`(create-table …)` calls go **after** the closing module paren, one per table. Banner skeleton (`;;<====>` bars + `;;{tag}` placeholders, kept even when empty) is fixed — see `PATTERNS.md`.

## Function / defcap body order (STRICT — do not interleave)

After the `let`: **1)** all Pact natives (`enforce`/`enforce-guard`/`enforce-keyset`/`enforce-one`; an `(enforce (ref-M::URC_…))` counts as a native) → **2)** all bare cross-module `(ref-M::…)` calls → **3)** home helpers (`UR_`/`URC_`/`XI_`/`W_`/`UC_`, home `UEV_`) → **4)** capabilities (`with-capability`/`require-capability`/`compose-capability`). **`compose-capability` is LAST in a defcap.** Rule of thumb: **all enforce → all bare ref → home → compose caps.** Never a bare `enforce` in `XI_`/`XE_`/`C_`/`W_` — validation lives only in the **master defcap** or a `UEV_`.

## `let` layout

All `(ref-*:module{Iface} …)` bindings first → `;;` separator (only if locals follow) → local vars. **Bind once, reuse** (e.g. `(length entries)` used twice → bind `entry-count:integer`). Single-ref one-liner needs no separator.

## Boolean grouping — `and` is BINARY only

- 1 predicate: `(enforce p "msg")`
- 2: `(enforce (and p q) "msg")`
- 3+: `(enforce (fold (and) true [p q r …]) "msg")` (OR: `(fold (or) false […])`)

`(and a b c)` → runtime `Attempted to apply a closure to too many arguments`. Non-boolean checks (`CAP_*`, `UEV_*`, `UEV_Fee`) stay as **separate** step-2 calls **before** the grouped `enforce`.

## Capabilities

One **master cap** per public `C_`/`A_` (`MOD|C>…` / `MOD|A>…`), `@doc` then `@event` then body; **ALL** validation via `UR_`/`URC_`/`UEV_` point reads (never raw `read`/`select`, avoid `URD_`); ends with `compose-capability (SECURE)` for same-module `XI_*`, cross-module legs compose `MOD|XE>…`/GOV/nested caps. **House style avoids Pact `@managed` caps** — it uses composed capability **bands** bottoming out at `SECURE` (a leaf cap literally `true`) + `create-capability-guard`. `with-capability` acquires the band at the entry; `XI_`/`W_` re-assert with `require-capability (SECURE)`.
Batch validation: one `UEV_*:bool` that **folds** the array (pure bools, no inner enforce) + one `(enforce (UEV_Entries entries) …)`; **never `(keys …)`** for existence — use `try` + `UR_*`.

## Cross-module calls — module-ref + `::` ONLY

```pact
(let ((ref-DALOS:module{OuronetDalosV1} DALOS)
      (ref-TFT:module{TrueFungibleTransferV1} TFT))
    (ref-DALOS::CAP_EnforceAccountOwnership account)
    (ref-TFT::C_Transfer id sender receiver amount true))
```
`module{Iface}` types by the interface (only used members couple). **FORBIDDEN:** peer `MODULE.function` business calls (couples the whole module, fights the ~150k deploy-gas cap). `MODULE.CAP` allowed **only** inside `create-capability-guard` for a **home** cap. **No `(use …)`** to call peers; bare `(use M)` forbidden; selective `(use M [types…])` only for schemas/consts when `object{Iface.Schema}` won't do. `(ref-X:module{Iface} Other)` resolves at **module load** → target must already be deployed.

## IMC / policy spine (the security backbone)

- **HARD RULE:** a module must **never** use another module's capabilities (no `compose`/`with`/`require-capability` on a foreign cap). Only home caps. Trust = **registered guards**, not cross-module compose.
- Every module implements `OuronetPolicyV1` (verbatim spine: `P|T`/`P|MT` tables, `P|…|CALLER`/`P|SECURE-CALLER` caps, `P|Info`/`P|UR`/`P|UR_IMP`/`P|A_Add`/`P|A_AddIMP`/`P|A_Define`/`UEV_IMC`; `(create-table P|T)(create-table P|MT)` after the module).
- **`(UEV_IMC)`** is the callee gate — the **FIRST statement** of every cross-module mutator (`XE_`/`XB_`/IMC-gated `C_`), **never wrapped in `enforce`** (`(enforce (UEV_IMC) …)` is WRONG — IMC is a statement).
- `P|A_Define` = post-deploy registration; core wires IMP only to other core; Talos adds `P|TALOS-SUMMONER`; cross-links needing both loaded run at **executor time** (avoid core↔Talos load cycles). After redeploying an IMC pair, re-run `P|A_Define` or `UEV_IMC` fails.
- Smart-account governor: `MOD|GOV` = "I own this account" (home only); `P|*|REMOTE-GOV` = "I operate your account". Forwards compose only their own `P|*|REMOTE-GOV`, never a foreign `MOD|GOV`.

## Read discipline & gas

Call sites never `read`/`select` domain tables — always through a thin `UR_*` (one per field: `(at "f" (read T k ["f"]))`; `with-default-read` for maybe-absent rows). **`URD_`/`URDC_` scans are banned on any on-chain execution path** — keep a maintained aggregate table + point-read it; scans belong in UI/`/local`. Gas ceilings: Kadena ~150k, StoaChain/Ouronet ~2,000,000 (still avoid scans). Batch-validate with **one fold-backed `UEV_` + one `enforce`**, not `map`-per-entry; never `(keys …)` in a hot path (measured ~800× cost blowup in the Pythia flush).

## Naming & formatting

`defun` inside a module = **prefix only, no `MOD|`** (`UC_ComputeMin`, not `UC_VCT|ComputeMin`); caps/schemas MAY use `MOD|…`. Cap shapes `MOD|C>…`/`MOD|A>…`/`MOD|XE>…` encode the recipe class. `@doc` (then `@event`) goes **immediately after** the closing `)` of the param list. ~88–92 char lines (break `@doc` with `\`). Stable indentation (match the file; sovereign ≈ 4 spaces), section bars, numbered step comments, grouped/aligned `let`. **No drive-by reformat.** Params: one per line when long, never hybrid-squeeze. Deploy layers **Utilities → Core → Aggregator (Talos)**; a new `A_`/`C_`/`X` is not production-final until wired into Talos.

## Top anti-patterns (Don't → Do)

foreign cap in compose/with/require → home caps + policy guards · call core `C_` directly → Aggregator flow · peer `MODULE.fun` → `ref-M::fun` · `enforce` in `XI_`/`XE_`/`C_`/`W_` → put it in the defcap/`UEV_` · `(and a b c)` → `fold (and) true […]` · `(enforce (UEV_IMC) …)` → `(UEV_IMC)` as a statement · `read`/`select` outside `UR_` → `UR_*` point reads · `URD_`/`URDC_` on execution path → aggregate table + `UR_` · `(keys T)` for existence → `try` + `UR_*` · raw `write` in `C_` when a `W_` exists → call `W_*`/`XI_*` · `X` returns `true`/cumulator → writes only; metering in `C_`/Aggregator · skipping an `XI_` tier hop → go through `XI_1|*` · code after the persistence op in a `W_` body → nothing after · `@managed` in-house → composed bands + `SECURE`.
