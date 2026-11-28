// REPL/gate observability for the Pact workspace's "REPL terminal" pane.
//
// THE REQUEST: "wire the REPL terminal to show Pact/REPL activity as it happens... During a working
// session the agent runs, often concurrently: python3 REPL/tools/_gate.py (~375s, the full suite, 110
// entrypoints), pact AQP-FULL.repl / Stage02_Tester.repl / etc. (~150s each), python3
// REPL/tools/_suite_stats.py --gate (~550s, runs the gate inside itself), one-off throwaway .repl
// files. ... From the UI there is NO indication any of it is happening -- the chat just goes quiet for
// six minutes." Four pieces, smallest-value-first per the request: (1) detect + list matching
// processes (command/cwd/elapsed) so "hung vs working" stops being a guess; (2) tail whatever log the
// process is already writing to, for a live feed; (3) parse the real REPL/tools/_gate.py output shape
// into a table + a green/red verdict chip -- "the single highest-value piece... the thing the operator
// actually waits for"; (4) keep the last few runs so a failure can be compared against the previous
// green.
//
// THE REAL GATE OUTPUT SHAPE (read directly from the installed script, not guessed, so the parser
// below matches byte-for-byte — see OuroborosNetwork/_onchain/Ouronet/REPL/tools/_gate.py):
//   print(f"{'secs':>7} {'+':>6} {'-':>5} {'fail':>5}  entrypoint")
//   print(f"{r['secs']:7.1f} {r['pos']:6d} {r['neg']:5d} {r['fail']:5d}  "
//         f"{'' if r['ok'] and not r['fail'] else 'BROKEN '}{r['path']}")
//   print(f"\nwall {time.time()-t0:.1f}s   executed {pos+neg} assertions ({pos} positive, {neg} negative)")
//   verdict = "\nGATE FAILED" if bad or orphans else "\nGATE GREEN"
//   print(verdict)
// PLUS an earlier, different failure shape: many pre-flight checks `sys.exit("GATE FAILED: <reason>")`
// BEFORE the suite ever runs (no table, no wall time at all) -- both shapes are real and both must
// parse. The gate ALSO writes a fixed-path receipt of its own (GATE_RECEIPT below, same constant value
// as the real script's own `GATE_RECEIPT = "/tmp/.ouronet-gate-receipt.log"`) specifically so a reader
// never has to guess which `/tmp/*.log` redirect was the gate's — its own comment explains two prior
// bugs from exactly that guess. We read that receipt as the authoritative "last finished gate" signal,
// and separately tail whatever log is newest in /tmp for ambient, in-progress activity (any matching
// process, not just the gate) per the request's own "tails the newest matching log" wording.
import { readdirSync, readFileSync, readlinkSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

// ===== REPL ACTIVITY — pure helpers (sliced for unit tests; see lib/replActivity.test.mjs) =====

/** Does this process's joined argv look like Pact/REPL activity? Matches the request's own four
 *  patterns: a `pact <file>` invocation, the full gate, the suite-stats wrapper, or any `tools/_*.py`
 *  analysis script. `\bpact\s` (a word boundary before "pact") deliberately excludes "compact"/"impact"
 *  etc. — real argv, not prose, so this is intentionally simple rather than a full shell-arg parser. */
const REPL_ACTIVITY_RE = /\bpact\s|_gate\.py|_suite_stats\.py|tools\/_[^/\s]*\.py/;
export function matchesReplActivity(cmdline) {
  return REPL_ACTIVITY_RE.test(String(cmdline || ""));
}

/** /proc/[pid]/stat's start-time field (22nd field), correctly skipping the `(comm)` field even when
 *  comm itself contains spaces or parens — procfs's own guarantee is that comm is everything between
 *  the FIRST '(' and the LAST ')', so field 3 onward starts right after that last ')'. Returns null for
 *  anything unparsable rather than throwing (a process can exit mid-read; the stat line is then gone
 *  or truncated). */
export function parseProcStatStartTicks(statLine) {
  const s = String(statLine || "");
  const close = s.lastIndexOf(")");
  if (close < 0) return null;
  const rest = s.slice(close + 1).trim().split(/\s+/);
  // rest[0] is field 3 (state); field 22 (starttime) is rest[22 - 3] = rest[19].
  const n = Number(rest[19]);
  return Number.isFinite(n) ? n : null;
}

/** /proc/stat's `btime <epoch seconds>` line — the system boot time, the other half needed to turn a
 *  process's start-ticks-since-boot into a real wall-clock time. */
export function parseBootEpochSeconds(procStatText) {
  const m = /^btime[ \t]+(\d+)/m.exec(String(procStatText || ""));
  return m ? Number(m[1]) : null;
}

// Universal on every Linux this box or a CI runner for it would use (`getconf CLK_TCK`); not worth a
// native syscall dependency to read a constant that has been 100 on every mainstream Linux for decades.
export const LINUX_CLK_TCK = 100;

export function procStartEpochMs(startTicks, bootEpochSeconds) {
  if (!Number.isFinite(startTicks) || !Number.isFinite(bootEpochSeconds)) return null;
  return Math.round((bootEpochSeconds + startTicks / LINUX_CLK_TCK) * 1000);
}

export function elapsedMsSince(startEpochMs, nowMs) {
  if (!Number.isFinite(startEpochMs)) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return Math.max(0, now - startEpochMs);
}

/** Parse _gate.py's real stdout/stderr into a structured result. Handles BOTH real failure shapes:
 *  an early pre-flight `GATE FAILED: <reason>` (sys.exit, no table at all — the suite never ran), and
 *  a full run's table + wall-time summary + bare `GATE GREEN`/`GATE FAILED`. Never throws; a string
 *  that isn't gate output at all just yields `{ rows: [], summary: null, verdict: null, ... }`. */
export function parseGateOutput(text) {
  const t = String(text || "");
  const rowRe = /^[ \t]*(\d+\.\d+)[ \t]+(\d+)[ \t]+(\d+)[ \t]+(\d+)[ \t]{2,}(BROKEN[ \t]+)?(\S.*?)[ \t]*$/gm;
  const rows = [];
  let m;
  while ((m = rowRe.exec(t))) {
    rows.push({ secs: Number(m[1]), positive: Number(m[2]), negative: Number(m[3]), failures: Number(m[4]), broken: !!m[5], path: m[6] });
  }
  const summaryM = /^wall[ \t]+([\d.]+)s[ \t]+executed[ \t]+(\d+)[ \t]+assertions[ \t]+\((\d+)[ \t]+positive,[ \t]+(\d+)[ \t]+negative\)/m.exec(t);
  const summary = summaryM
    ? { wallSeconds: Number(summaryM[1]), assertions: Number(summaryM[2]), positive: Number(summaryM[3]), negative: Number(summaryM[4]) }
    : null;
  const finalVerdictM = /^GATE (GREEN|FAILED)[ \t]*$/m.exec(t);
  const earlyFailM = /^GATE FAILED:[ \t]*(.*)$/m.exec(t);
  let verdict = null, reason = null;
  if (finalVerdictM) verdict = finalVerdictM[1];
  else if (earlyFailM) { verdict = "FAILED"; reason = earlyFailM[1].trim(); }
  return { rows, summary, verdict, reason, running: !verdict };
}

/** Parse _gate.py's `--live` streaming progress lines (its OTHER print format — completion order, as
 *  entrypoints finish, not the final sorted table): "this many of this many entrypoints are done" is
 *  exactly the "how far along it is" the request asked for, available WHILE the run is still going,
 *  long before any final table or verdict exists. Real format (verbatim from the script):
 *    print(f"  [{i:3d}/{len(GATE)}] {'FAIL' if broke else '  ok'} "
 *          f"{r['secs']:6.1f}s {r['pos']+r['neg']:6d} asserts  {os.path.basename(r['path'])}"
 *          + (f"   <-- {nfail} failing so far" if broke else ""), flush=True)
 *  Returns the LATEST line's progress (highest completion count is always the most current one,
 *  completion order being what it is), with `failingSoFar` taken as the MAX seen across every line —
 *  it's only printed on a FAIL line, so the true running count would otherwise disappear the moment a
 *  later entrypoint happens to pass. `null` when the text has no such lines at all (not a --live run,
 *  or no entrypoints have finished yet). Pure; never throws. */
export function parseGateLiveProgress(text) {
  const re = /^[ \t]*\[[ \t]*(\d+)\/(\d+)\][ \t]+(FAIL|ok)[ \t]+([\d.]+)s[ \t]+(\d+)[ \t]+asserts[ \t]+(\S+)(?:[ \t]+<--[ \t]+(\d+)[ \t]+failing so far)?[ \t]*$/gm;
  let last = null, failingSoFar = 0, m;
  const t = String(text || "");
  while ((m = re.exec(t))) {
    last = { completed: Number(m[1]), total: Number(m[2]), ok: m[3] === "ok", secs: Number(m[4]), asserts: Number(m[5]), path: m[6] };
    if (m[7] != null) failingSoFar = Math.max(failingSoFar, Number(m[7]));
  }
  return last ? { ...last, failingSoFar } : null;
}

/** Append a finished gate parse to the history ring, capped to `maxLen`, newest first. Pure — the
 *  caller (the stateful tracker below) decides WHEN a new entry has actually landed (receipt mtime
 *  changed); this just owns the cap/ordering so that decision is testable independently of it. */
export function pushGateHistory(history, entry, maxLen = 5) {
  const h = Array.isArray(history) ? history : [];
  return [entry, ...h].slice(0, Math.max(1, maxLen));
}

// ===== end REPL ACTIVITY pure helpers =====

// The gate's OWN fixed-path receipt — same literal value as the installed script's own
// `GATE_RECEIPT = "/tmp/.ouronet-gate-receipt.log"` (OuroborosNetwork/_onchain/Ouronet/REPL/tools/_gate.py).
// A fixed path specifically so this reader (like _suite_stats.py's own) never has to guess which
// `/tmp/*.log` redirect, if any, was the gate's.
export const GATE_RECEIPT_PATH = "/tmp/.ouronet-gate-receipt.log";
export const LOG_TAIL_BYTES = 20000;
const DEFAULT_LOG_DIR = "/tmp";
const DEFAULT_LOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;   // 6h — generous; a log this old is almost certainly not today's run, but this is cosmetic, not a correctness boundary
const DEFAULT_LOG_LIMIT = 8;

/** Every currently-running process whose argv matches REPL/gate activity: { pid, cmdline, cwd,
 *  elapsedMs }. Linux-only (reads /proc directly, no native deps); returns [] rather than throwing
 *  anywhere this box doesn't have /proc, or a process vanishes mid-scan (the normal, frequent case for
 *  short-lived helpers — never let one disappearing process break the whole scan). */
export function scanReplProcesses(procRoot = "/proc", now = Date.now()) {
  let pids;
  try { pids = readdirSync(procRoot).filter((p) => /^\d+$/.test(p)); } catch { return []; }
  let bootEpochSeconds = null;
  try { bootEpochSeconds = parseBootEpochSeconds(readFileSync(join(procRoot, "stat"), "utf8")); } catch { /* no /proc/stat — elapsed just won't be available */ }
  const out = [];
  for (const pid of pids) {
    try {
      const cmdlineRaw = readFileSync(join(procRoot, pid, "cmdline"));
      if (!cmdlineRaw.length) continue;
      const cmdline = cmdlineRaw.toString("utf8").split("\0").filter(Boolean).join(" ");
      if (!matchesReplActivity(cmdline)) continue;
      let cwd = null;
      try { cwd = readlinkSync(join(procRoot, pid, "cwd")); } catch { /* permission or already-gone */ }
      let elapsedMs = null;
      try {
        const startTicks = parseProcStatStartTicks(readFileSync(join(procRoot, pid, "stat"), "utf8"));
        elapsedMs = elapsedMsSince(procStartEpochMs(startTicks, bootEpochSeconds), now);
      } catch { /* same */ }
      out.push({ pid: Number(pid), cmdline, cwd, elapsedMs });
    } catch { /* process exited mid-scan — skip it, never crash the whole poll over one process */ }
  }
  return out;
}

/** The `limit` most-recently-modified `*.log` files directly under `dir`, newest first, within
 *  `maxAgeMs` of now (an ancient leftover log from an unrelated tool shouldn't masquerade as today's
 *  activity). Real-FS based; see lib/replActivity.test.mjs for exercises against a real temp dir. */
export function listRecentLogs(dir = DEFAULT_LOG_DIR, opts = {}) {
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : DEFAULT_LOG_MAX_AGE_MS;
  const limit = Number.isFinite(opts.limit) ? opts.limit : DEFAULT_LOG_LIMIT;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".log")) continue;
    let st;
    try { st = statSync(join(dir, name)); } catch { continue; }
    if (!st.isFile()) continue;
    if (now - st.mtimeMs > maxAgeMs) continue;
    out.push({ name, path: join(dir, name), mtimeMs: st.mtimeMs, sizeBytes: st.size });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, limit);
}

/** The last `maxBytes` of a file (a live feed should show what's happening NOW, not replay a
 *  multi-megabyte log from the start). `{ text, truncated, sizeBytes }`; never throws — a missing or
 *  unreadable file just yields empty text. */
export function tailFile(path, maxBytes = LOG_TAIL_BYTES) {
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return { text: "", truncated: false, sizeBytes: size };
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, start);
      return { text: buf.toString("utf8"), truncated: start > 0, sizeBytes: size };
    } finally { closeSync(fd); }
  } catch { return { text: "", truncated: false, sizeBytes: 0 }; }
}

/** The gate's own receipt file: `{ text, mtimeMs }`, or null if it doesn't exist (no gate has ever run
 *  on this box, or it predates this feature). Small file (one run's worth of table + verdict) — read
 *  whole, no tailing needed. */
export function readGateReceipt(path = GATE_RECEIPT_PATH) {
  try {
    const st = statSync(path);
    return { text: readFileSync(path, "utf8"), mtimeMs: st.mtimeMs };
  } catch { return null; }
}

/** The stateful half: wraps the I/O above (all injectable for tests) and remembers the receipt's last-
 *  seen mtime across polls, so `history` only grows when a genuinely NEW gate run has actually
 *  finished — not once per poll of the same still-current receipt. Each `.poll(now)` call is otherwise
 *  side-effect-free aside from that history growth. */
export function createReplActivityTracker(io = {}) {
  const scan = io.scanReplProcesses || scanReplProcesses;
  const listLogs = io.listRecentLogs || listRecentLogs;
  const tail = io.tailFile || tailFile;
  const readReceipt = io.readGateReceipt || readGateReceipt;
  const historyMax = Number.isFinite(io.historyMax) ? io.historyMax : 5;
  let history = [];
  let lastReceiptMtime = null;
  return {
    poll(now = Date.now()) {
      const processes = scan(io.procRoot, now);
      const logs = listLogs(io.logDir, { now });
      const newestLog = logs[0] || null;
      const tailResult = newestLog ? tail(newestLog.path) : { text: "", truncated: false, sizeBytes: 0 };
      // The raw "tail" feed (priority 2, ambient activity): always the single freshest log, whatever
      // it is — "what's happening most recently" is the honest answer to show there, one-off
      // throwaway runs included.
      //
      // "gate" (priority 3, the parsed table + verdict — the high-value piece): scan the recent logs
      // newest-first for the FIRST one that actually looks like gate output (a row or a verdict) —
      // not just the single newest file. A one-off throwaway .repl measurement, or any other tool,
      // can easily land a newer mtime in /tmp than a gate run that's still the relevant one, and
      // "only ever look at logs[0]" would silently hide a real, still-current gate table behind it.
      //
      // A WITH-ROWS result always wins over a verdict-only one, even if the verdict-only one is
      // newer — the gate's OWN receipt file (GATE_RECEIPT_PATH) ends in `.log` too, so it shows up in
      // this same `logs` listing; it carries a real verdict but never a row table (the receipt is a
      // short final summary, not the full run's stdout), and without this preference it would win the
      // "first one with a verdict" race the instant it's newer than the actual table-bearing log —
      // trading the richer result for a thinner one for no reason.
      let liveGate = null, liveGateVerdictOnly = null, progress = null;
      for (const l of logs) {
        const r = tail(l.path);
        if (!progress) progress = parseGateLiveProgress(r.text);
        const parsed = parseGateOutput(r.text);
        if (parsed.rows.length) { liveGate = parsed; break; }
        if (!liveGateVerdictOnly && parsed.verdict) liveGateVerdictOnly = parsed;
      }
      const receipt = readReceipt(io.receiptPath);
      let receiptGate = null;
      if (receipt) {
        receiptGate = parseGateOutput(receipt.text);
        if (receiptGate.verdict && lastReceiptMtime !== receipt.mtimeMs) {
          history = pushGateHistory(history, { ...receiptGate, at: receipt.mtimeMs }, historyMax);
        }
        lastReceiptMtime = receipt.mtimeMs;
      }
      // Preference order: a real row table from one of the recent logs, then a verdict-only match
      // (from a log OR, if nothing else turned one up, the receipt itself), then nothing.
      const gate = liveGate || liveGateVerdictOnly || receiptGate;
      // Progress is only meaningful WHILE nothing has actually finished yet — once a verdict exists
      // anywhere, the run that produced it is done, and whatever in-flight completion count a log
      // happened to show would just be stale ("72/110" sitting next to a verdict that already says
      // GREEN reads as a contradiction, not useful detail).
      return {
        processes,
        logs: logs.map((l) => ({ name: l.name, mtimeMs: l.mtimeMs, sizeBytes: l.sizeBytes })),
        tail: newestLog ? { name: newestLog.name, text: tailResult.text, truncated: tailResult.truncated } : null,
        gate,
        progress: (gate && gate.verdict) ? null : progress,
        history,
      };
    },
  };
}
