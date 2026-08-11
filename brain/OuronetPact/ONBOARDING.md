# Onboarding — OuronetPact

> Durable orientation for a fresh Claude session working on the Ouronet Pact smart contracts.
> This is the knowledge base ("pact brain") that the Claudstermind **Pact IDE** (Workspace › Pact)
> feeds: chat about Pact work is meant to be written back here so it compounds over time.

## One-line identity

The **Pact smart-contract source of the Ouronet / StoaChain ecosystem** — Kadena-Pact modules written
in the **StoicSyntax** discipline, tested through a staged `.repl` pipeline.

## Where it lives (this Linux machine)

- **Repo (tree target):** `/home/ancientbox/ClaudeWS/OuroborosNetwork/_onchain/Ouronet/`
- **StoicSyntax spec:** `…/Ouronet/OuronetInformational/StoicSyntax.md` (~1380 lines; the authority)
- **REPL entrypoints:** `…/Ouronet/REPL/` (`Z.repl` = full pipeline; `Stage0X_*.repl` per stage; `Stage00_Sanboxes.repl` = known-good smoke test)
- **Pact binary:** `/home/ancientbox/.local/bin/pact` → `pact version 5.4` (on PATH). The REPLs target **Pact 5**, not 4.

## Who owns it

- **Primary owner:** Mihai. Solo.

## How to run the tests (verified)

From `…/Ouronet/REPL/`:
- `pact Stage00_Sanboxes.repl` → `Load successful`, exit 0 (smoke test).
- `pact Z.repl` → full pipeline (Stage00 sandboxes → 00a Stoa tests → Stage 01 → Stage 02).
- `pact Stage01_Tester.repl` / `pact Stage02_Tester.repl` → per stage.

In the **Pact IDE**, open a `.repl` file and press **▶ Run** — it spawns `pact <file>` on the work
machine and streams stdout/stderr live into the right-column terminal.

## The one Pact 5 gotcha already hit

Pact **4.11 fails** on `init-phase-01-ns.repl:37` — *"Cannot define a keyset outside of a namespace"*.
Pact **5.4 is correct** for this codebase. If a REPL errors on keyset/namespace ordering, check you're
on 5.x, not 4.x.

## The discipline: StoicSyntax — the prefix is the contract

Function names are **prefixed, and the prefix is the contract** — unprotected (compute/reads/ctors) vs
protected (admin/orchestration/persistence). The Pact IDE colors by prefix band so the contract is
visible. Learn the prefixes before writing or reviewing Pact here.

## The brain (read in this order to write Pact)

This project's knowledge was learned from the StoicSyntax spec, the Ouronet code + `OuronetInformational/`,
your existing skills, and the Pact 5 source — then verified with a live `pact 5.4` run. Docs:
1. **`SKILL-write-stoic-pact.md`** — the operating guide + pre-flight checklist + test recipe. Start here to author.
2. **`STOICSYNTAX.md`** — the full discipline (prefix contract, section/body order, bands, W/X rules, IMC spine, read discipline, anti-patterns).
3. **`PATTERNS.md`** — real house-style idioms + a verified minimal skeleton + `.repl` anatomy.
4. **`PACT5.md`** — Pact 5 semantics + type system (capability mechanics, DB rules, objects/numbers, footguns).
5. **`PACT-REFERENCE.md`** — the source-verified builtin/syntax catalog.
6. **`ARCHITECTURE.md`** — Ouronet module families + the Talos/IMC spine + real build lessons.
7. **`LEARNINGS.md`** — the running cheat-sheet + hard-won learnings. Canonical authority stays `OuronetInformational/` in the Ouronet repo.
