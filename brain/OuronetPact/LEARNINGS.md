# Learnings — OuronetPact

> Durable, hard-won knowledge. Append here (with a date) whenever a Pact task teaches something worth
> keeping — this is the store the Pact IDE's chat is meant to feed. Newest at the top of each section.

## StoicSyntax — the prefix taxonomy (the prefix IS the contract)

Every function name carries a prefix that declares its power. Prefixes appear at a **segment boundary**
— word start, or after `|` `.` `:` `>` — so a prefix can sit after a module/band segment
(`IC|UDC_…`, `URC|KDA-PID_CLAD`) and cap names carry it too (`MODULE|A_…`, `MODULE|C>…`).

**Unprotected** (safe to call; no privileged state change):
- `UC_` — pure compute. `UCK_` — key constructors.
- `UR_` — reads. `URD_` — read/scan (derive). `URC_` — read + compute. `URDC_` — read/derive + compute.
- `UDC_` — object constructors (build a data object, no persistence).
- `UEV_` — enforce / validate (guards, assertions).
- `CAP_` — capability enforcement (ownership).

**Protected** (privileged — these are the dangerous surface):
- `A_` — admin. `C_` — client recipe (composed client-facing entry).
- `XI_` / `XE_` / `XB_` — orchestration writes (internal / external / bulk).
- `W_` / `WI_` / `WU_` / `WW_` — persistence writes (insert / update / with-write). **The ledger-touching band.**

Also structural: capability bands `C1`–`C4`; section bars `;;====`, `;;POLICY`, `;;{C1}`, `{F0} [UR]`;
cap-name shapes `MODULE|C>…` / `MODULE|A>…` / `MODULE|XE>…`; module-ref `::` calls.

### The IDE color language (so screenshots/PRs read consistently)
compute=teal · read=cyan · ctor=yellow · enforce=amber · cap=gold · client=green · orch=orange ·
admin=salmon · **write=red** (persistence = loudest). Cool = unprotected, warm/red = protected.

## Pact 5 vs 4

- This codebase is **Pact 5** (5.4 installed). Pact 4.11 fails on keyset-outside-namespace ordering
  (`init-phase-01-ns.repl:37`). Always run with 5.x.
- `chainweb-data` does **not** do per-address balances — "supply = sum of positive addresses" still
  needs the node's own Pact `coin` table (or Rosetta). (Captured cluster-wide; StoaChain is Kadena-derived.)

## Testing

- The `.repl` pipeline is staged: `Stage00_Sanboxes` (bootstrap) → `Stage00a_StoaTests` → `Stage01` →
  `Stage02`; `Z.repl` runs them in order. `Stage00_Sanboxes.repl` is the fast known-good smoke test.
- Iterate loop (what the IDE terminal is for): write code → run the `.repl` → read the error → fix → re-run.
- Ouronet tests use namespace **`ouronet-ns`** (not `free`); integration tests in `REPL/Stage_*`, scratch in `REPL/Kursan/`.

## Deep-learned house rules (2026-08-11 — see STOICSYNTAX/PATTERNS/PACT5/ARCHITECTURE)

- **No `use`, no `MODULE.fun`** — cross-module = `(ref-X:module{Iface} X)` + `::`; resolves at load (target must pre-exist).
- **No `@managed` caps in-house** — composed capability **bands** bottoming at `(defcap SECURE () true)`; writers `(require-capability (SECURE))`.
- **No foreign caps** (compose/with/require only home caps); trust = registered guards + `(UEV_IMC)` (the FIRST statement of a cross-module mutator, never `enforce`-wrapped).
- **All validation in the master `defcap`/`UEV_`** — `C_`/`XI_`/`XE_`/`W_` carry no `enforce`. `C_` body only wires: `UEV_IMC → with-capability → XI_`.
- **`and` is binary** — 3+ → `(fold (and) true […])`. **No `URD_`/`URDC_`/`(keys …)`/`select` on the execution path** (measured ~800× gas blowup; use an aggregate table + `UR_` point reads).
- **Body order:** all enforce → all bare ref → home → caps (`compose-capability` last). `W_` = one persistence op, last, nothing after.
- **Types:** objects match schema exactly (all fields, no extras); `int/int` truncates (force `dec`); **no recursion** (use `fold`/`map`); `let`==`let*`; read-only reentrancy on modref callbacks; **formal verification / `@model` is GONE in Pact 5**.
- Gas budgets seen: Pythia flush ≈103 (insert)/185 (update)/217 (seal) gas per day-entry; batch cap 1000; ~2M ceiling ≈9,234 seals.
- **Verified live:** a StoicSyntax-shaped `DEMO` module (`C_`→master cap→`XI_`→`WW_`) loads + passes on Pact 5.4 (skeleton in PATTERNS.md).
