# Pact Language Reference (indexed)

> A condensed, accurate index of Kadena **Pact 5**, compiled from `kda-chain.org/docs/pact-5/*` and the
> Kadena docs, then **cross-checked against the Pact 5 SOURCE** (`kadena-io/pact-5`:
> `pact/Pact/Core/Builtin.hs` = the builtin registry, `pact/Pact/Core/Syntax/LexUtils.hs` = the lexer).
> **Where the source and the docs disagree, the source wins** — the docs still describe Pact-4 features
> that Pact 5 dropped (most notably formal verification / `@model`; see that section). This is durable
> knowledge for the Pact IDE's agent — read it before writing or reviewing Pact. StoicSyntax discipline
> (LEARNINGS.md) layers ON TOP of this: raw Pact here, the prefix contract there.

## What Pact is

A Turing-**incomplete**, human-readable LISP-style smart-contract language for the Kadena blockchain.
Code is organized as **modules** in **namespaces**; authorization is **keysets / guards / capabilities**;
state lives in typed **tables**; multi-step & cross-chain flows are **defpacts**. There is **no delete**
(immutability) — mark rows inactive instead. Decimals carry up to 256 places.

## Declarations (top-level forms)

| Form | Shape | Notes |
|---|---|---|
| `module` | `(module name gov [meta] body…)` | `gov` = keyset name (string), a keyset, or a **governance capability** (a defcap in the body). |
| `interface` | `(interface name [meta] body…)` | Abstract API: signatures + consts/schemas/models. Immutable, ungoverned. |
| `implements` | `(implements iface)` | Module satisfies an interface. |
| `use` | `(use mod [hash] [imports])` | Import; optionally pin by hash / restrict names. |
| `bless` | `(bless HASH)` | Whitelist a prior module hash so old pacts/values stay valid after upgrade. |
| `defun` | `(defun name:rtype (a:type …) [meta] body…)` | Function. |
| `defcap` | `(defcap NAME (a:type …) [meta] body…)` | Capability; body = the predicate enforced on acquisition. |
| `defconst` | `(defconst NAME value [meta])` | Constant, evaluated once at load. |
| `defschema` | `(defschema name [meta] field:type …)` | Row shape. |
| `deftable` | `(deftable name:{schema} [meta])` | Table; still needs a top-level `(create-table name)`. |
| `defpact` | `(defpact name (a:type …) [meta] step…)` | Multi-step coroutine tx; body is only `step`/`step-with-rollback`. |
| `defproperty` | `(defproperty name (expr))` | Reusable named property for `@model`. |

## Special forms

- Binding: `(let ((x v) …) body)` · `(let* …)` (**in Pact 5 `let` == `let*`**, same gas) · `(lambda (x …) body)` · `(bind src { "f" := v } body)`.
- Control: `(if c then else)` · `(cond (t1 b1) … else)`.
- Enforce: `(enforce test:bool "msg")` · `(enforce-one "msg" [tests])` · `(enforce-guard g)` · `(enforce-keyset ks)` · `(enforce-pact-version …)` · `(enforce-verifier …)`.
- Capabilities: `(with-capability (CAP a…) body)` grants for the body; `(require-capability (CAP a…))` asserts already-granted (no re-eval); `(compose-capability (CAP a…))` inside a defcap grants sub-caps with the parent; `(install-capability (CAP a…))` provisions a `@managed` cap; `(emit-event (CAP a…))`.
- defpact steps: `(step expr)` / `(step entity expr)` · `(step-with-rollback expr rollback)` — **no rollback on a cross-chain (yielding) step** · `(yield {data})` (+ target chain for cross-chain) · `(resume {bindings} …)` · `(pact-id)`.
- Namespaces: `(namespace 'name)` sets the active namespace; `(define-namespace "n" user-guard admin-guard)` (top-level only).

## Types & literals

`name:type` — `:string :integer :decimal :bool :time :keyset :guard :list`. Composite: `[integer]`
(typed list), `object{Schema}` / `:{schema}`, `module{fungible-v2,iface}` (module ref; members called
with `::`). `:` attaches a type; `:=` binds an object field inside `bind` / `with-read` / `{…:=…}`.

Literals: `"str"` · `'symbol` (unique-id string, e.g. keyset ref / table name) · `42` · `1.0` · `true`/`false`
· `(time "2024-01-01T00:00:00Z")` (no bare time literal) · `[1 2 3]` (commas optional) · `{ "k": v }`.

## Metadata

The lexer recognizes exactly four annotations (`LexUtils.hs`): `@doc`, `@managed`, `@event`, `@model`.
- `@doc "…"` (a bare string in the meta slot is shorthand for it).
- `@managed [param manager-fn]` (or bare `@managed` = single-use) — managed capability.
- `@event` — emit an event on acquire.
- `@model [ … ]` — **still parses (it's a lexer token) but is INERT in Pact 5** (no verifier consumes it;
  see Formal verification below). Harmless to write; does nothing.

## Core concepts

- **Governance:** keyset governance (a named keyset enforced on deploy/upgrade) OR a governance capability (custom logic, in scope for the whole tx). `bless` old hashes across upgrades.
- **Capabilities:** parameterized in-transaction rights. Managed caps track a resource via a manager fn (bounded repeated use), must be scoped in a signature, auto-emit an event, and are `install`-ed before use. `create-capability-guard` turns an in-scope cap into a storable guard.
- **Keysets & guards:** a guard is a pure predicate; keysets are one kind. Predicates `keys-all`/`keys-any`/`keys-2`. `define-keyset` registers/rotates; `enforce-keyset`/`enforce-guard` check. User guards `create-user-guard`; capability guards `create-capability-guard` (may read DB); module/pact guards are **deprecated/unsafe**.
- **Principals:** 1:1 guard↔account-name binding. Prefixes: `k:` single-key, `w:` multi-key, `u:` user guard, `c:` capability guard, `r:` keyset-ref, `n_…` principal namespace. `create-principal` / `is-principal` / `validate-principal`.
- **Tables:** `defschema` → `deftable` → top-level `create-table`. Writes: `insert` (fail if exists), `update` (fail if absent, merge), `write` (upsert). Reads: `read`, `with-read`, `with-default-read`. Queries: `keys`, `select` (+ `where`), `fold-db`. History: `txlog`/`keylog`.
- **defpact:** ordered steps, each its own tx. `yield`/`resume` pass data (cross-chain consumes an SPV proof). Continuation (`cont`) txs advance a pact by id+step, no code resubmitted.
- **Execution:** tx types `exec` (atomic) and `cont`. Ed25519 signatures, scoped to a `clist` of capabilities. `publicMeta`: chainId, sender (gas payer), gasLimit, gasPrice, ttl, creationTime. The built-in `coin` contract is the KDA ledger (`transfer`, `transfer-crosschain` defpact, gas). Marmalade = token/NFT standard on Pact (ecosystem, not core).

## Built-in functions (by category)

> The authoritative, complete list is the coloring keyword set (sourced from `Builtin.hs`). Source-only
> natives the docs omitted include: `round-prec`/`ceiling-prec`/`floor-prec`, `str-to-int-base`,
> `read-msg-default`, `read-with-fields`, `select-with-fields`, `sort-object`, `define-read-keyset`,
> `enforce-pact-version-range`, `enumerate-step`, `continue-pact-with-rollback` (+ yield variants),
> `yield-to-chain`, `hash-poseidon`, `load-with-env`, `reset-pact-state`, `begin-named-tx`. Doc-listed
> names that are NOT in the Pact 5 core registry (avoid): `verify`, `create-user-guard`, `keys-all`/
> `keys-any`/`keys-2` (these are keyset predicate *names*, not natives), several `env-*` (`env-gasprice`,
> `env-gasrate`), `mock-spv`, `with-applied-env`, `format-address`, `bench`.

**General:** acquire-module-admin, at, base64-decode, base64-encode, chain-data, compose, concat, constantly, contains, continue, define-namespace, describe-namespace, distinct, drop, do, enumerate, filter, fold, format, hash, hash-keccak256, identity, if, int-to-str, is-charset, length, list-modules, make-list, map, namespace, negate, pact-id, pact-version, poseidon-hash-hack-a-chain, read-decimal, read-integer, read-keyset, read-msg, read-string, remove, resume, reverse, round, show, sort, static-redeploy, str-to-int, str-to-list, take, try, tx-hash, typeof, where, yield, zip.

**Database:** create-table, describe-keyset, describe-module, describe-table, fold-db, insert, keys, list-modules, read, select, update, with-default-read, with-read, write.

**Guards:** create-capability-guard, create-capability-pact-guard, create-module-guard, create-pact-guard, create-principal, create-user-guard, is-principal, keyset-ref-guard, typeof-principal, validate-principal.

**Keysets:** define-keyset, enforce-keyset, keys, keys-2, keys-all, keys-any.

**Capabilities:** compose-capability, emit-event, install-capability, require-capability, with-capability.

**Operators:** `+ - * / ^` · abs, ceiling, floor, round, dec, exp, ln, log, mod, sqrt · `= != < <= > >=` · and, or, not, and?, or?, not? · `& | ~` (bitwise), xor, shift.

**Time:** add-time, days, diff-time, format-time, hours, minutes, parse-time, time. Default format `%Y-%m-%dT%H:%M:%SZ`.

**Specialized:** hyperlane-decode-token-message, hyperlane-encode-token-message, hyperlane-message-id, verify-spv, pairing-check, point-add, scalar-mult.

## REPL & `.repl` testing (NOT callable on-chain)

`.repl` files are the unit-test/simulation harness: `load` a `.pact`, wrap calls in `begin-tx`/`commit-tx`,
seed env with `env-data`/`env-sigs`/`env-chain-data`, assert with `expect`/`expect-failure`/`expect-that`.
Run: **`pact my-test.repl`** (no arg → interactive `pact>`; `--trace`/`-t` for line-by-line).

- **Tx control:** begin-tx, commit-tx, rollback-tx, continue-pact, pact-state.
- **Env:** env-data, env-keys (deprecated → env-sigs), env-sigs, env-chain-data, env-hash, env-namespace-policy, env-entity, env-events, env-exec-config, env-dynref, env-enable-repl-natives, env-simulate-onchain.
- **Gas:** env-gas, env-gaslimit, env-gasmodel, env-gasprice, env-gasrate, env-gaslog.
- **Assert:** expect, expect-failure, expect-that, print.
- **Analysis:** typecheck, verify. **Caps/keys/SPV:** test-capability, sig-keyset, format-address, mock-spv, load, with-applied-env, bench.

## Formal verification — REMOVED in Pact 5 (source-verified)

**Pact 4 had** an SMT/Z3 property checker: `@model` properties on `defun`, `invariant`s on `defschema`,
`defproperty`, `column-delta`/`conserves-mass`, and `(verify 'module)`. **Pact 5 does NOT** — the
`kadena-io/pact-5` source has **no** `Analyze`/`Property`/`SBV`/`SMT`/`Invariant`/`Model` module, and
neither `defproperty`, `verify`, nor `invariant` is a builtin or a lexer keyword. `@model` still lexes
(so it won't be a parse error) but nothing runs it — it is **inert**. So: **do not rely on property
checking / formal verification in Pact 5.** Verify behavior with `.repl` tests (`expect`, `expect-failure`,
`expect-that`) and catch type errors with `(typecheck 'module)` — which IS still present (a REPL builtin).
(Ouronet code accordingly does not use `@model`/invariants.)

## Pact 5 vs 4

Pact 5 is a core rewrite (`pact-core`) with **semantic equivalence** to 4 for normal code (drop-in; some
latent errors now surface at compile time). Source-verified differences:
- **Formal verification is GONE** — no property checker; `@model` inert, `defproperty`/`verify`/`invariant`
  removed (see that section). This is the big one, and the clearest example of docs lagging the source.
- **`let` == `let*`** (no difference, same gas).
- The builtin registry gained precision/field/rollback variants (see the catalog note) and dropped some
  Pact-4 natives (e.g. `create-user-guard`, `verify`).
- ~8× smaller storage, ~2–3× faster; new/better LSP + debugging.
- (Ouronet's REPLs target 5.4; Pact 4.11 fails on keyset-outside-namespace ordering — always run 5.x.)
