# Pact 5 semantics & types (correctness layer)

> From the `kda-community/pact-5` source (`IR/Eval/CEK/Evaluator.hs`, `CoreBuiltin.hs`, `Syntax/*`,
> `Type.hs`). StoicSyntax says *where* code lives; this says *how* Pact evaluates it. Builtin/keyword
> list is in `PACT-REFERENCE.md` (source-derived). **Formal verification (`@model`) is gone** — see
> PACT-REFERENCE; use `.repl` tests + `typecheck`.

## Capabilities (mechanics)

- **Scope is dynamic + stack-based.** `with-capability` grants the cap only for its body's dynamic extent; the slot pops on return. You cannot hold a cap past its body.
- **`with-capability` is IDEMPOTENT.** If the cap (token+args) is already in scope, it's a no-op that just runs the body — the defcap's guards/`enforce`s fire only on the **first** acquisition. Never rely on a second `with-capability` to re-check a guard.
- **`require-capability`** acquires nothing; it asserts a cap (token+args) is already granted, else `CapabilityNotGranted`. This is what `W_`/`XI_` use with `(require-capability (SECURE))`.
- **`compose-capability`** is **defcap-body-only** (`enforceStackTopIsDefcap`); it adds the composed cap to the *same* slot (scoped to the enclosing `with-capability`). Inside a defcap you compose — you do **not** `with-capability`/`install-capability` (both throw `FormIllegalWithinDefcap`).
- **Inside a defcap, DB is read-only** (`_ceInCap`) — cap bodies validate, they don't write.
- **Managed caps** (`@managed param mgr-fn`): must be installed (explicitly or via a scoped signature) before use, else `CapNotInstalled`. The manager fn `(old requested -> new)` runs on each acquisition and its return **replaces** the stored managed value (linear resource, e.g. a transfer budget). Auto/one-shot `@managed` (no param) can be acquired once (`OneShotCapAlreadyUsed`). `@event`/managed caps auto-emit an event on acquisition; `emit-event` requires `@event`/`@managed`. **Ouronet house style avoids `@managed`** — composed bands + `SECURE` instead.

## defpact

Sequence of `step`/`step-with-rollback`. **Exactly one step per transaction**, in order (index must match the stored `DefPactExec`); can't skip/re-run/nest. Cross-step state travels only via `yield`/`resume` or the DB (each step is a fresh env). `step-with-rollback` runs its rollback only on explicit cancel. Cross-chain: `yield` with a target chain sets provenance; continuing needs an **SPV proof**; `resume` verifies provenance. No rollback on a cross-chain (yielding) step.

## Database

- **`insert`** fails if the row exists; **`update`** fails if it's absent; **`write`** is unconditional upsert. Choose deliberately.
- **`read`/`with-read`** throw `NoSuchObjectInDb` on a missing row. **`with-default-read`** takes defaults and never fails; it accepts a **partial subschema** (default/read just the fields you need).
- **No deletes / immutability** — every write is a `TxLog` (history auditable). "Removal" = `WU_` on a liveness flag.
- Row-level guards = a `guard`-typed column: store it, later `enforce-guard`. Tables are module-scoped; only the module's code (or module admin) writes.
- `select`/`fold-db`/`keys` scan O(table) — local/read queries only, never hot paths.

## Types

- **Objects are STRICTLY CLOSED**: exact schema match — **all fields required, no extras, no optional fields**. A schema field with no `:type` defaults to `TyAny`. `object{Schema}` (or `object` bare = any schema).
- Typed lists `[type]` (e.g. `[integer]`, `[object{acct}]`); bare `list` = any.
- **`module{iface1,iface2}`** subtypes by interface **subset** (modref must implement ⊇ the declared ifaces). `::` dynamic-dispatches at runtime to the concrete module (`m::transfer`). A modref call back into a module already on the stack → **read-only** (reentrancy guard).
- **Numbers:** `integer` (arbitrary precision) and `decimal` (exact) are distinct. **Arithmetic auto-promotes** mixed int/decimal → decimal, **but `int / int` truncates** (integer division). `dec` casts int→decimal; `round`/`floor`/`ceiling` 1-arg → integer, 2-arg → decimal (banker's rounding). Force decimal math with `dec`/a decimal literal.
- **Annotations are optional and RUNTIME-checked** (only schema fields carry a mandatory type slot). Annotate a param → it's checked on entry; omit → any type accepted. `typecheck` runs a static pass.
- **Partial application** works for defuns, lambdas, AND natives (`(map (+ 1) xs)` is valid). Lambdas: `(lambda (a b) body)`.

## Evaluation & gas

- `and`/`or` **short-circuit**; `if` runs only the taken branch; `enforce`/`enforce-one` evaluate the failure message **lazily** and run the **condition read-only** (no DB writes inside an `enforce` condition). `enforce` requires a boolean; a failing `enforce` is `try`-catchable.
- Gas is per-native + structural (list/object work, cap-op depth). Full-table ops and large object/list construction dominate — keep loops keyed and bounded.

## Pact-5 footguns

- **No recursion** — a self-(re)calling function throws `RuntimeRecursionDetected`. Use `fold`/`map`/list ops or a defpact.
- **Read-only reentrancy guard** is default on modref calls (5.3) — design cross-module callbacks assuming they may run read-only.
- **`let` == `let*`** (same scope, same gas; later bindings see earlier ones).
- `enforce`/user-guards run **read-only** (5.3), not sys-only — more reads allowed inside guards, still no writes.
- Many former runtime errors now surface at **load / typecheck** time (improved typechecker, native-shadowing/recursion/link checks at load).
- `pact <file>.repl` runs a script; `--trace`/`-t` for line-by-line; no arg → interactive `pact>`.
