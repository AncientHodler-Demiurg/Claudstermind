# StoicSyntax real-code patterns (house style)

> Idioms extracted from real Ouronet modules (`DALOS`, `IGNIS`, `U|ST`, `BSD-L`, `AQP-*`, the Sample)
> + REPL suites, plus a minimal skeleton **verified to load + pass on Pact 5.4**. Imitate these exactly.

## Non-negotiables (house style)

- **No `use` imports, ever.** Cross-module = bind a module ref in a `let`, call `::`. Zero `(use …)` in `1_SOVEREIGN/`.
- **No `(namespace …)` inside module files** — the deploy/REPL harness sets it (`(namespace "ouronet-ns")`; tests use `ouronet-ns`, not `free`).
- **No `@managed` caps in-house** — composed capability **bands** + `create-capability-guard`. `SECURE` is a leaf cap literally `(defcap SECURE () true)`; entry points build the band down to it, writers `(require-capability (SECURE))`.
- **Thin one-field `UR_` readers** — never inline a `read`; wrap each column access in its own `UR_`, compose derived readers from them.
- **`UEV_IMC` first** in every `A_`/`X`-writer. **Interfaces are versioned** (`FooV1→V2`); an API change bumps the interface and cascades to all `implements`/`module{…}` refs.
- **Fixed `;;<====>` banner skeleton** in every module, even empty sections keep their `;;{tag}`.

## Minimal skeleton (verified `Load successful` on Pact 5.4)

```pact
(module DEMO GOV
    ;;<========>
    ;;GOVERNANCE
    (defcap GOV () (enforce-guard (keyset-ref-guard "free.demo-admin")))
    ;;<======================>
    ;;SCHEMAS-TABLES-CONSTANTS
    ;;{1}
    (defschema Balance @doc "row" amount:decimal active:bool)
    ;;{2}
    (deftable BalanceTable:{Balance})                 ;;Key = <account>
    ;;<==========>
    ;;CAPABILITIES
    ;;{C1}
    (defcap SECURE () true)
    ;;{C4}
    (defcap DEMO|C>SET (account:string amount:decimal)
        @event
        (enforce (>= amount 0.0) "Amount must be non-negative")   ;; 1] natives
        (compose-capability (SECURE)))                            ;; 4] caps LAST
    ;;<=======>
    ;;FUNCTIONS
    (defun UC_IsPositive:bool (amount:decimal) (> amount 0.0))
    (defun UR_Amount:decimal (account:string)
        (at "amount" (read BalanceTable account ["amount"])))     ;; projected read
    (defun UR_AmountOrZero:decimal (account:string)
        (with-default-read BalanceTable account { "amount" : 0.0 } { "amount" := a } a))
    (defun UDC_Balance:object{Balance} (amount:decimal)
        { "amount" : amount, "active" : true })                  ;; no I/O
    (defun WW_Balance (account:string obj:object{Balance})
        (require-capability (SECURE))                            ;; gated write, op LAST
        (write BalanceTable account obj))
    (defun XI_SetBalance (account:string amount:decimal)
        (require-capability (SECURE))
        (WW_Balance account (UDC_Balance amount)))
    (defun C_SetBalance (account:string amount:decimal)
        @doc "Client recipe — validated in the master cap."
        (with-capability (DEMO|C>SET account amount)             ;; cap holds validation
            (XI_SetBalance account amount)))                     ;; body only wires
)
(create-table BalanceTable)                                     ;; after the module
```
The full chain — `C_` → `with-capability` (master cap validates + composes `SECURE`) → `XI_` (`require SECURE`) → `WW_` (`require SECURE`, one write last) — is the canonical recipe shape. `C_`/`XI_`/`W_` carry **no `enforce`**; all validation is in `DEMO|C>SET`.

## Governance block (real form — `02_IGNIS.pact`)

```pact
(defconst GOV|MD_IGNIS   (keyset-ref-guard (GOV|Demiurgoi)))
(defcap GOV ()           (compose-capability (GOV|IGNIS_ADMIN)))
(defcap GOV|IGNIS_ADMIN ()  (enforce-guard GOV|MD_IGNIS))
(defun GOV|Demiurgoi () (let ((ref-DALOS:module{OuronetDalosV1} DALOS)) (ref-DALOS::GOV|Demiurgoi)))
```
Interface + module ship in the **same file** (`(interface OuronetDalosV1 … bodyless defuns …)` then `(module DALOS GOV … (implements OuronetDalosV1) …)`).

## Capability bands (not managed caps — `02_IGNIS.pact`)

```pact
(defcap IGNIS|C>COLLECT (patron:string interactor:string amount:decimal)
    @event
    (UEV_Patron patron)                              ;; validators in the cap body
    (compose-capability (IGNIS|C>TRANSFER patron interactor amount)))
(defcap IGNIS|C>TRANSFER (sender:string receiver:string ta:decimal)
    (enforce (!= sender receiver) "Sender and Receiver must differ")
    (compose-capability (IGNIS|C>DEBIT sender ta))
    (compose-capability (IGNIS|C>CREDIT receiver)))
(defcap IGNIS|C>DEBIT (sender:string ta:decimal)
    (let ((read-gas …)) (enforce (<= ta read-gas) "Insufficient GAS")
        (compose-capability (SECURE))))              ;; band bottoms out at SECURE
```
`@event` on state-changing/audit-worthy caps. Cap-name bands: `MOD|C>…` client, `MOD|A>…` admin, `MOD|XE>…` external, `MOD|GOV`/`MOD|F>…` ownership.

## Enforce / guard / principal idioms

- `enforce-one "msg" [ (enforce-guard A) (enforce-guard B) ]` = "any of these passes".
- `(enforce (fold (and) true [ … ]) "msg")` for 3+ ANDed booleans; `(fold (or) false [ … ])` for OR.
- Ownership via a `CAP_` dispatcher branching on account type: `(if (UR_AccountType a) (UEV_SmartAccOwn a) (UEV_StandardAccOwn a))`.
- Principals: `(typeof-principal (create-principal g))` → `k:`/`w:`/`r:`/`u:`/`c:`/`m:`/`p:`. Guards handed out via `(create-capability-guard (SECURE))` / `(create-user-guard (UEV_… x))`.
- Error messages use `format` with `{}`; the house spells apostrophes as `|` (e.g. `doesn|t`) since `'` is Pact syntax.

## Cross-module `::` + IMC handshake

```pact
(defun C_TransferDalosFuel (sender:string receiver:string amount:decimal)
    (let ((ref-coin:module{stoa-ns.fungible-v1} coin))
        (ref-coin::transfer sender receiver amount)))
;; IMC: home registers a caller guard; every mutator gates on UEV_IMC first
(defun P|A_Define ()
    (let ((ref-P|DALOS:module{OuronetPolicyV1} DALOS)
          (mg:guard (create-capability-guard (P|IGNIS|CALLER))))
        (ref-P|DALOS::P|A_AddIMP mg)))
(defun UEV_IMC ()
    (let ((ref-U|G:module{OuronetGuardsV1} U|G)) (ref-U|G::UEV_Any (P|UR_IMP))))
```
Writer split: outer `XE_`/`XB_` runs `(UEV_IMC)` then `with-capability (SECURE)` then calls the inner `XI_` which `(require-capability (SECURE))` and does the `update`.

## Recurring micro-idioms

Column-aligned one-liners; `let` with `(` on its own line, refs first then locals; **leading-comma** objects/lists (`{"a" : x` newline `,"b" : y}`); the `BAR` sentinel (`(defconst BAR (CT_Bar))`) as null/joiner; `(do expr1 expr2)` for side-effects in an `if` branch; `cond`/`fold`/`map` with **typed** lambda params (`(lambda (acc:[bool] x:integer) …)`); `(implements …)` right after the module header; deploy exec scripts (`(namespace …) (MOD.C_… )`) only in Sample/genesis files, never inside a module.

## `.repl` test anatomy

Per-tx banner `;;||>>>>> NEXT >` ; `(begin-tx "TX-NN label")` → `(env-gasmodel "table")(env-gaslimit 10000000)(env-gas 0)` → `(namespace "ouronet-ns")` → `(env-sigs [{"key":K,"caps":[(MOD.CAP …)]}])` (caps are **term objects**, not strings) → `(load "…pact")` or calls → `(commit-tx)`. Assert with `(map print [ (expect "label" expected actual) … ] "")`; negative tests `(expect-failure "label" (call …))`, often after `(test-capability (MOD.CAP …))`. Gas echo per module: `(format "<<{} GAS>>" [(env-gas)])`. Fixtures come from helper modules (`TV.TIME00`, `KC.PBKY_0`). Integration tests live in `REPL/Stage_*`; scratch only in `REPL/Kursan/`. Some suites open with `(env-enable-repl-natives true)`.
