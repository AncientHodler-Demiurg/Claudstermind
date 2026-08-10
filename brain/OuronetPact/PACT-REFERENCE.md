# Pact Language Reference (indexed)

> A condensed, accurate index of Kadena **Pact 5**, compiled from `kda-chain.org/docs/pact-5/*`, the
> Kadena reference, and the canonical `kadena-io/pact` docs (2026-08). This is durable knowledge for
> the Pact IDE's agent — read it before writing or reviewing Pact. StoicSyntax discipline (LEARNINGS.md)
> layers ON TOP of this: raw Pact here, the prefix contract there.

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

`@doc "…"` (a bare string in the meta slot is shorthand) · `@model [ (property …) (invariant …) ]` ·
`@managed [param manager-fn]` (or bare `@managed` = single-use) · `@event` (emit on acquire).

## Core concepts

- **Governance:** keyset governance (a named keyset enforced on deploy/upgrade) OR a governance capability (custom logic, in scope for the whole tx). `bless` old hashes across upgrades.
- **Capabilities:** parameterized in-transaction rights. Managed caps track a resource via a manager fn (bounded repeated use), must be scoped in a signature, auto-emit an event, and are `install`-ed before use. `create-capability-guard` turns an in-scope cap into a storable guard.
- **Keysets & guards:** a guard is a pure predicate; keysets are one kind. Predicates `keys-all`/`keys-any`/`keys-2`. `define-keyset` registers/rotates; `enforce-keyset`/`enforce-guard` check. User guards `create-user-guard`; capability guards `create-capability-guard` (may read DB); module/pact guards are **deprecated/unsafe**.
- **Principals:** 1:1 guard↔account-name binding. Prefixes: `k:` single-key, `w:` multi-key, `u:` user guard, `c:` capability guard, `r:` keyset-ref, `n_…` principal namespace. `create-principal` / `is-principal` / `validate-principal`.
- **Tables:** `defschema` → `deftable` → top-level `create-table`. Writes: `insert` (fail if exists), `update` (fail if absent, merge), `write` (upsert). Reads: `read`, `with-read`, `with-default-read`. Queries: `keys`, `select` (+ `where`), `fold-db`. History: `txlog`/`keylog`.
- **defpact:** ordered steps, each its own tx. `yield`/`resume` pass data (cross-chain consumes an SPV proof). Continuation (`cont`) txs advance a pact by id+step, no code resubmitted.
- **Execution:** tx types `exec` (atomic) and `cont`. Ed25519 signatures, scoped to a `clist` of capabilities. `publicMeta`: chainId, sender (gas payer), gasLimit, gasPrice, ttl, creationTime. The built-in `coin` contract is the KDA ledger (`transfer`, `transfer-crosschain` defpact, gas). Marmalade = token/NFT standard on Pact (ecosystem, not core).

## Built-in functions (by category — the full set)

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

## Formal verification (property checking)

Compiles Pact to SMT and discharges with **Z3**; a violation → counterexample, else proved for all inputs.
Attach via `@model [ (property …) (invariant …) ]`: **properties** on `defun` (per-function guarantees over
all paths); **invariants** on `defschema` (hold on every DB write, inductively). `defproperty` names reusable
properties. Canonical: `(defproperty conserves-mass (= (column-delta accounts 'balance) 0.0))`. Building
blocks: `column-delta`, `cell-delta`, `row-write-count`, `authorized-by`, `row-enforced`. `(typecheck 'm)`
is the prerequisite; `(verify 'm)` typechecks then proves all `@model` claims (calls inlined).

## Pact 5 vs 4

Pact 5 is a core rewrite with **semantic equivalence** to 4 (drop-in; some latent errors now surface at
compile time). Notable: **`let` == `let*`** (no difference, same gas); ~8× smaller storage, ~2–3× faster;
new/better LSP + debugging. REPL and property systems carry over unchanged. (Ouronet's REPLs target 5.4;
Pact 4.11 fails on keyset-outside-namespace ordering — always run 5.x.)
