// Build the spawn spec for running a Pact `.repl` file, confined to the Ouronet repo.
//
// The IDE's terminal runner streams `pact <file>.repl` live. This module is the PURE, testable half:
// it validates the path (must be under the repo root and end in `.repl`) and resolves the pact
// binary, returning a spawn spec. The server does the actual spawn + SSE streaming. REPLs use
// relative `(load "…")`, so we run with cwd = the file's directory and pass just its basename —
// matching the verified `cd …/REPL && pact Stage00_Sanboxes.repl` invocation.
import { existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { safeResolve } from "./pactFs.mjs";

/** Resolve the pact binary: $PACT_BIN, then ~/.local/bin/pact (where 5.4 was installed), else PATH. */
export function resolvePactBin(env = process.env, home = homedir(), exists = existsSync) {
  if (env.PACT_BIN && exists(env.PACT_BIN)) return env.PACT_BIN;
  const local = resolve(home, ".local", "bin", "pact");
  if (exists(local)) return local;
  return "pact";
}

/** Spawn spec for a `.repl` run, or { ok:false, error }. `exists` injectable for tests. */
export function pactRunSpec(root, rel, opts = {}) {
  const exists = opts.existsSync || existsSync;
  const abs = safeResolve(root, rel);
  if (!abs) return { ok: false, error: "path escapes the Pact root" };
  if (!/\.repl$/i.test(abs)) return { ok: false, error: "only .repl files can be run" };
  if (!exists(abs)) return { ok: false, error: "not found" };
  const bin = opts.bin || resolvePactBin(opts.env, opts.home, exists);
  return { ok: true, bin, args: [basename(abs)], cwd: dirname(abs), file: rel };
}
