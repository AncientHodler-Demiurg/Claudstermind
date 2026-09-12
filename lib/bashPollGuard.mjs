// The exact bug this exists for: a Pact conversation asked a background Bash tool call to run a
// `.pact` REPL test, then wait on it with `until grep -qE "<done marker>" out.log; do sleep N; done`.
// The `pact` run died (or simply never printed the exact marker being grepped for) hours before
// anyone looked — and the wait loop kept polling a file that would never change again, forever.
// Eleven of them accumulated over one session: real OS processes, permanently un-resolvable, each
// one counted by the engine's own background-task tracker and shown to the user as "still working."
//
// `pgrep -af "pact "` found nothing; the loops themselves don't even mention "pact" in their own
// command text (the run that produced the file was a SEPARATE, earlier statement) — so a check for
// "is anything still running" that only looks for the word "pact" cannot see this failure at all.
// That is exactly the check the agent itself ran when asked, and exactly why it answered "nothing of
// mine is running" while eleven of its own processes sat there, stuck, the whole time.
//
// A `timeout` on the THING BEING WAITED FOR (the pact run itself, `nohup timeout 2400 pact ... &`)
// does not bound the loop that's waiting on it — that loop has no ceiling of its own, and there is no
// way to fix that from the outside once the command is already running. The only place this is fixable
// is before the command starts: refuse a wait loop with no wall-clock ceiling ON ITSELF, and make the
// model add one and resend, rather than letting a fifth, sixth, eleventh copy of the same shape leak
// again next week.
const LOOP_RE = /\b(?:until|while)\b[\s\S]*?\bdo\b[\s\S]*?\bsleep\b[\s\S]*?\bdone\b/gi;
const STATEMENT_BOUNDARY_RE = /[;&\n]|&&|\|\|/g;

/** Does this shell command contain a "poll a condition, sleep, repeat" loop with no wall-clock
 *  ceiling of its own? Pure text heuristic — deliberately conservative in ONE direction only: it
 *  would rather flag a loop that turns out to be fine (the model just adds `timeout` and resends,
 *  a cheap round trip) than miss another one that hangs forever (the expensive failure, since
 *  nothing else in this system can ever un-stick it once it's running).
 *
 *  For each `until`/`while ... do ... sleep ... done` loop found, only the text since the LAST
 *  statement boundary (`;`, `&&`, `||`, `&`, a newline) is considered as a possible `timeout`
 *  wrapping THAT loop. A `timeout` earlier in the command almost always bounds a DIFFERENT, earlier
 *  statement — exactly `nohup timeout 2400 pact ... &`, which bounds the pact run and has nothing to
 *  do with the loop that waits on it. Trusting any `timeout` anywhere in the whole command is what
 *  let the real bug through in the first place: that exact command already contained the word
 *  "timeout", and still hung for over twelve hours. */
export function bashNeedsPollCeiling(command) {
  const cmd = String(command || "");
  LOOP_RE.lastIndex = 0;
  let m;
  while ((m = LOOP_RE.exec(cmd))) {
    const before = cmd.slice(0, m.index);
    let lastBoundary = -1;
    STATEMENT_BOUNDARY_RE.lastIndex = 0;
    let b;
    while ((b = STATEMENT_BOUNDARY_RE.exec(before))) lastBoundary = b.index + b[0].length - 1;
    const prefix = before.slice(lastBoundary + 1);
    if (!/\btimeout\s+\d/.test(prefix)) return true;
  }
  return false;
}

/** The PreToolUse hook itself — denies a Bash call shaped like the bug above, with a reason the
 *  model can act on directly (it writes the fix in its very next tool call; this is a retry, not a
 *  dead end). Only Bash is ever inspected; every other tool is untouched. Exported separately from
 *  the detector so the decision text lives in exactly one place and can't drift from what actually
 *  gets checked. */
export function bashPollGuardHook(toolName, toolInput) {
  if (toolName !== "Bash") return null;
  const command = toolInput && toolInput.command;
  if (!bashNeedsPollCeiling(command)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "This command waits in a loop (\"until/while ... do ... sleep ... done\") with no wall-clock " +
        "ceiling of its own. If the thing it's waiting on crashes, is killed, or never produces the " +
        "exact string being grepped for, this loop polls forever and can never be told apart from real " +
        "work again — it will sit in the background-task list indefinitely. A `timeout` on the command " +
        "you're waiting ON (e.g. `nohup timeout 2400 pact ... &`) does not bound this loop; the loop " +
        "needs its own. Wrap the WAIT LOOP ITSELF in `timeout <seconds> bash -c '...'`, or give it its " +
        "own elapsed-time/iteration exit, and resend.",
    },
  };
}
