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
