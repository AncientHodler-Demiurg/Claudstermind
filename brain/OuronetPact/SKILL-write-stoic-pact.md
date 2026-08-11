# SKILL — write & test StoicSyntax Pact

> The operating guide for an agent writing Pact in the Ouronet codebase. Deep references:
> `STOICSYNTAX.md` (discipline), `PATTERNS.md` (real idioms + skeleton), `PACT5.md` (semantics/types),
> `PACT-REFERENCE.md` (builtins), `ARCHITECTURE.md` (module map). Canonical source of truth:
> `OuroborosNetwork/_onchain/Ouronet/OuronetInformational/` (StoicSyntax.md + `pact/*` + `ouronet/conventions/*`).

## Before touching code (read order)

1. `OuronetInformational/INDEX.md` → `CONTEXT.md` (vocabulary) → `ouronet/MODULE_ARCHITECTURE.md`.
2. The matching detail doc under `pact/` or `ouronet/conventions/` for the exact change.
3. The **deployed** module (not the archived `.pact` — it can drift). Pact 5 source lives at `~/ClaudeWS/_upstream/pact-5` for semantics questions.

## Greenfield workflow (StoicSyntax §15)

Schema → name the `C_` client surface (intent) → `UR_*` readers (grouped like schemas) → `UCK_` + `W_*` blocks → implement each `C_` end-to-end (master `defcap` → `X`/`W_` → add `URC_`/`UEV_` as the path needs). Don't front-load every helper. Then wire the `C_`/`A_` into the matching **Talos** module (not production-final otherwise).

## The recipe shape (memorize)

`C_Foo` = `(UEV_IMC)` → `(let (refs; locals))` → `(with-capability (MOD|C>FOO …) (XI_Foo …))` → (optional) build IGNIS cumulator via `ref-IGNIS::UDC_…`. **No enforce/write in `C_`.** The master cap `MOD|C>FOO` holds **all** validation (`UR_/URC_/UEV_`, order: enforces → bare refs → home → `compose-capability (SECURE)` last). `XI_`/`W_` do the write under `require-capability (SECURE)`, no enforce, the persistence op **last**.

## Pre-flight checklist (before declaring done)

- [ ] **Prefix honest?** name matches read/write/validate/orchestrate depth (UC no read/enforce; URC no scan/enforce; W one op last; X no enforce).
- [ ] **Section order** GOV→POLICY→SCHEMAS→CAPS(C1–C4)→FUNCTIONS; FUNCTIONS in canonical prefix order; `(create-table …)` after the module.
- [ ] **Body order** all enforce → all bare ref → home → caps; `compose-capability` last in defcaps.
- [ ] **Booleans:** 1→`enforce p`; 2→`(and p q)`; 3+→`(fold (and) true […])`. Never `(and a b c)`.
- [ ] **No foreign caps** (compose/with/require only home caps). Peers via `module{Iface}::` + policy guards. **No `use`.** No `MODULE.fun`.
- [ ] **IMC:** `(UEV_IMC)` is the FIRST statement of cross-module mutators, never `enforce`-wrapped. `P|A_Define` registration updated if a new IMC leg.
- [ ] **Reads:** only via `UR_*`; **no `URD_`/`URDC_`/`(keys …)`/`select` on the execution path**; batch-validate with one fold-backed `UEV_` + one `enforce`.
- [ ] **No `@managed`** — composed bands + `SECURE`.
- [ ] **Types:** objects match schema **exactly** (all fields, no extras); force decimal math (`int/int` truncates); annotate params you want runtime-checked.
- [ ] **No recursion** (use `fold`/`map`); mind read-only reentrancy on modref callbacks.
- [ ] **Formatting:** stable indent (match file), banners, `@doc` after the param `)`, ~88–92 cols, no drive-by reformat.
- [ ] **Interface change?** bump the version (`FooV1→V2`) and cascade all `implements`/`module{…}`/`object{Foo.Schema}` refs. Don't return a module-local-schema `object{…}` from an interface.

## Test it (the proof step)

Write a `.repl` (integration → `REPL/Stage_*`, scratch → `REPL/Kursan/`). Anatomy: `(begin-tx "…")` → `(env-gasmodel "table")(env-gaslimit 10000000)(env-gas 0)` → `(namespace "ouronet-ns")` → `(env-sigs [{"key":K,"caps":[(MOD.CAP …)]}])` (caps are term objects) → `(load "…pact")` / calls → assert `(map print [ (expect "label" expected actual) … ] "")` (+ `expect-failure` for negatives) → `(commit-tx)`. Run: `pact <file>.repl` (or the Pact IDE's ▶ Run once the local dashboard is restarted). Green = `Load successful` + every `Expect: success`.

## Minimal self-contained example that loads + passes on Pact 5.4

See `PATTERNS.md` → "Minimal skeleton" (the `DEMO` module + its `.repl`; verified `Load successful`, 3/3 expects). Use it as the shape for a new module; add the POLICY/IMC spine and cross-module refs when the module actually participates in IMC.

## Adoption note

StoicSyntax is written for the **Ouronet** repo (Talos/IGNIS/AQP, `ouronet-ns`). Whether a StoaChain-side Pact module adopts the full discipline (or just the prefix + body-order + no-scan core) is a per-project call — the prefix contract, body order, boolean grouping, no-scan, and cap-holds-validation rules port to any Pact; the IMC/Talos/IGNIS spine is Ouronet-specific.
