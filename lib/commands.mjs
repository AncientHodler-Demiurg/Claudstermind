// The single command path.
//
// Every action Claudstermind can execute — whether fired from a local dashboard button
// or relayed down the tunnel from the online site — goes through executeCommand(). One
// whitelist (protocol.COMMAND_TYPES), one dispatch. A command type cannot exist on the
// local path and not the relayed one, and an unknown type is refused before any executor
// is reached.
//
// Semantics are IDENTICAL to the endpoints they replace in dashboard/server.mjs — the
// long-running, process-isolated actions (backup, restore, pollinate) are still spawned
// as subprocesses via ctx.runProc, because killing the wrapper would not kill the tar
// grandchild (see restore's timeout:0). The fast, in-process ones (git, tokens) call the
// lib functions directly.
//
// ctx = {
//   root,        // workspace root (D:/_Claude) — resolves repo localPaths
//   secretsDir,  // .secrets store for tokens.save
//   dataDir,     // dashboard/data — the token registry saveSecret validates against
//   orchDir,     // orchestrator/ — where backup.mjs / restore.mjs live
//   runProc,     // async (cmd, argv, opts) => { code, stdout, stderr, spawnFailed? }
//   readActivity // () => { active, activeRepos } — the idle gate for pollinate
// }
import { join } from "node:path";
import { resolveRepo, pushRepo, pullRepo, commitRepo } from "./gitActions.mjs";
import { saveSecret } from "./tokenRegistry.mjs";
import { COMMAND_TYPES, isCommandType } from "./protocol.mjs";

export { COMMAND_TYPES };

// Parse the last JSON line a spawned orchestrator script prints, with a caller-supplied
// fallback message when it produced nothing parseable.
function parseProc(r, fallbackMessage, running = false) {
  try {
    const line = (r.stdout || "").trim().split(/\r?\n/).pop() || "{}";
    return JSON.parse(line);
  } catch {
    return {
      ok: false,
      message: fallbackMessage,
      running,
      raw: (r.stdout || "").slice(-500),
      stderr: (r.stderr || "").slice(-300),
    };
  }
}

export async function executeCommand(type, args = {}, ctx = {}) {
  if (!isCommandType(type)) {
    return { ok: false, reason: "unknown-command", message: `Unknown command: ${String(type)}` };
  }
  const { root, secretsDir, dataDir, orchDir, runProc, readActivity } = ctx;

  switch (type) {
    case "git.commit":
    case "git.push":
    case "git.pull": {
      const abs = resolveRepo(args.localPath, root);
      if (!abs) return { ok: false, message: `Not a resolvable git repo: ${args.localPath}` };
      if (type === "git.push") return pushRepo(abs);
      if (type === "git.pull") return pullRepo(abs);
      return commitRepo(abs, args.message);
    }

    case "tokens.save": {
      // The value is written to .secrets/<file> and never returned or logged.
      return saveSecret(secretsDir, dataDir, args.secretFile, args.value);
    }

    case "backup": {
      const argv = [join(orchDir, "backup.mjs")];
      if (args.dest) argv.push("--dest", args.dest);
      if (args.force) argv.push("--force");
      const r = await runProc(process.execPath, argv, { timeout: 600000 });
      return parseProc(r, "backup produced no parseable result");
    }

    case "restore": {
      const argv = [join(orchDir, "restore.mjs")];
      if (args.id) argv.push("--id", args.id);
      if (args.confirm) argv.push("--confirm", args.confirm);
      if (args.dry) argv.push("--dry");
      // NO timeout — killing this wrapper would orphan the tar it spawned, leaving the
      // workspace half-overwritten while we falsely reported failure. Let it finish.
      const r = await runProc(process.execPath, argv, { timeout: 0 });
      return parseProc(
        r,
        "The restore process produced no parseable result. It MAY STILL BE RUNNING — check the workspace before doing anything else.",
        true,
      );
    }

    case "pollinate.dryrun": {
      const act = readActivity ? readActivity() : { active: false, activeRepos: [] };
      const command = "/wasp:master-pollinate --dry-run";
      if (act.active) {
        return { ok: false, reason: "active", command,
          message: `Suite active (${(act.activeRepos || []).join(", ")}). master-pollinate is gated until idle.` };
      }
      const r = await runProc("claude", ["-p", command], { shell: true, timeout: 300000 });
      if (r.spawnFailed) {
        return { ok: true, ran: false, command,
          message: "Idle ✓. claude CLI not reachable from the server — run this in a terminal:",
          note: "Real --execute (publishing) is intentionally NOT a one-click button; run it in a terminal so its AskUserQuestion safety gates apply." };
      }
      return { ok: true, ran: true, command, code: r.code,
        output: (r.stdout || "").slice(-4000), note: "Dry-run only. --execute stays terminal-driven." };
    }
  }
}
