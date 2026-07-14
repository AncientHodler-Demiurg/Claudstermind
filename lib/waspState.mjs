// Parser for wasp `state.md` files — the shared ground truth of a cascade.
//
// Both triggers write the SAME files: the dashboard's button and an agent running
// `/wasp:master-pollinate` in a conversation. The dashboard therefore never "owns"
// a run; it reads whatever the state files say and renders it. That is why a
// cascade an agent started in another window still shows up live here.
//
// The three tiers write DIFFERENT schemas (see the wasp command docs in
// Tools/wasp-dev/plugins/wasp/commands/) — this parser must handle all three:
//
//   tier 1  master-pollinate  ## Workspace execution order   (| # | Workspace | Publishes | Status | …)
//   tier 2  cross-pollinate   ## Execution order             (| # | Package | Repo | From → To | Tag | Status | …)
//   tier 3  pollinate         ## Queue (computed at run start) + ## Per-package gates (### heading + ✅/⏳ bullets)
//
// and all of them: ## Run history, ## Failure context, ## …pin updates.
import { readFileSync, existsSync } from "node:fs";

/** `**Key:** value` → { key: value }, keys lowercased. */
function readFields(md) {
  const fields = {};
  for (const m of md.matchAll(/^\*\*([^:*]+):\*\*[ \t]*(.*)$/gm)) {
    fields[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return fields;
}

/** Split into `## Heading` → body, keyed by the lowercased heading. */
function readSections(md) {
  const out = {};
  for (const part of md.split(/^##\s+/m).slice(1)) {
    const nl = part.indexOf("\n");
    out[part.slice(0, nl < 0 ? part.length : nl).trim().toLowerCase()] =
      nl < 0 ? "" : part.slice(nl + 1);
  }
  return out;
}

/**
 * Find sections by PATTERN, not by exact heading.
 * The headings drift between tiers and versions — `## Execution order` (tier 2) vs
 * `## Workspace execution order` (tier 1); `## Consumer pin updates` (an older run
 * on disk) vs `## Pending consumer pin updates` (current cross-pollinate) vs
 * `## Cross-workspace pin updates` (master). Exact-matching them is how the tab
 * silently renders an empty table over a live cascade.
 */
const sectionsMatching = (sections, re) =>
  Object.entries(sections).filter(([k]) => re.test(k)).map(([, v]) => v);

/** A markdown table → array of objects keyed by header cell. */
function readTable(section) {
  if (!section) return [];
  const lines = section.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return [];
  const cells = (l) => l.split("|").slice(1, -1).map((c) => c.trim());
  const headers = cells(lines[0]).map((h) => h.toLowerCase());
  return lines
    .slice(2) // skip the |---|---| separator
    .map((l) => Object.fromEntries(cells(l).map((c, i) => [headers[i] || `col${i}`, c])))
    .filter((row) => Object.values(row).some(Boolean));
}

/**
 * A ✅/⏳/❌/⏭️ status cell or bullet → a gate we can colour.
 *
 * The GLYPH is authoritative and is checked first; the words are only a fallback for
 * rows that have no glyph. Order matters: `⏳ workflow completed green` is a PENDING
 * step whose text contains "completed", and scoring it by the word turns a still-
 * running publish green.
 */
export function classifyGate(status = "") {
  const s = status.toLowerCase();

  if (s.includes("❌")) return "failed";
  if (s.includes("⏭")) return "skipped";
  if (s.includes("⏳")) return "running";
  if (s.includes("✅") || s.includes("✓")) return "done";

  if (s.includes("fail") || s.includes("error")) return "failed";
  if (s.includes("skip")) return "skipped";
  if (s.includes("progress") || s.includes("in-flight") || s.includes("running") || s.includes("waiting")) return "running";
  if (s.includes("complete") || s.includes("published")) return "done";
  return "pending";
}

/**
 * A run is RUNNING unless it has reached a terminal state.
 *
 * Do NOT whitelist the in-flight statuses. wasp writes a different, longer set at
 * each tier — planning, scanning, closing, sorting, executing, consumer-commits,
 * ci-waiting, verifying, adding-workspace, proposing, classifying, moving,
 * synthesizing — and any future skill version may add more. A whitelist that misses
 * one renders a live cascade as IDLE, which is the worst possible lie for this tab
 * to tell. Only `complete` / `failed` / `cancelled` end a run; everything else is
 * still going.
 */
const TERMINAL = /^(complete|completed|failed|cancelled|canceled|aborted)\b/;
export const isRunning = (status) => Boolean(status) && status !== "unknown" && !TERMINAL.test(status);

/**
 * Tier-3 `pollinate` records progress as ✅/⏳ bullet lists under a `### [n/N] pkg@ver`
 * heading, not as a status column. Roll each package's bullets up into one gate:
 * any ❌ ⇒ failed; all ✅ ⇒ done; otherwise still running.
 */
function readPerPackageGates(section) {
  if (!section) return [];
  const gates = [];
  for (const block of section.split(/^###\s+/m).slice(1)) {
    const nl = block.indexOf("\n");
    const heading = block.slice(0, nl < 0 ? block.length : nl).trim();
    // `### [1/2] @stoachain/stoa-core@4.3.0` — strip the counter, then split the
    // trailing @version off so the name matches the Queue table's bare package name
    // (the scope's own leading @ is at index 0, so only a LATER @ is the version).
    const full = heading.replace(/^\[\d+\/\d+\]\s*/, "").trim();
    const at = full.lastIndexOf("@");
    const name = at > 0 ? full.slice(0, at) : full;
    const version = at > 0 ? full.slice(at + 1) : "";
    const bullets = block.split(/\r?\n/).filter((l) => /^\s*-\s*[✅⏳❌✓⏭]/u.test(l));
    if (!name) continue;

    const marks = bullets.map((b) => classifyGate(b));
    const gate = marks.includes("failed") ? "failed"
      : marks.length && marks.every((m) => m === "done" || m === "skipped") ? "done"
      : marks.length ? "running"
      : "pending";

    gates.push({
      n: (heading.match(/^\[(\d+)\//) || [])[1] || "",
      name,
      repo: "",
      transition: version ? `→ ${version}` : "",
      tag: "",
      status: `${marks.filter((m) => m === "done").length}/${marks.length} steps`,
      gate,
      started: "", completed: "",
    });
  }
  return gates;
}

/** Parse one state.md. Returns null when the file doesn't exist (no run yet). */
export function parseWaspState(file, label) {
  if (!existsSync(file)) return null;
  let md;
  try { md = readFileSync(file, "utf8"); } catch { return null; }

  const fields = readFields(md);
  const sections = readSections(md);
  const status = (fields.status || "unknown").toLowerCase();

  // tier 1 "Workspace execution order" | tier 2 "Execution order" | tier 3 "Queue".
  const rows = sectionsMatching(sections, /execution order|^queue\b/).flatMap(readTable);

  const tableGates = rows.map((r) => ({
    n: r["#"] || "",
    name: r.package || r.workspace || r.repo || "",
    repo: r.repo || r["publishes (planned)"] || "",
    transition: r["from → to"] || r["from -> to"] || r["current → next"] || r["current -> next"] || "",
    tag: r.tag || "",
    status: r.status || r["bump reason"] || "",
    gate: classifyGate(r.status || r["bump reason"] || ""),
    started: r.started || "",
    completed: r.completed || "",
  }));

  // tier 3's real progress lives in the bullet gates, not the queue table — prefer it.
  const bulletGates = readPerPackageGates(sections["per-package gates"]);
  const byName = new Map(tableGates.map((g) => [g.name, g]));
  for (const b of bulletGates) {
    const t = byName.get(b.name);
    byName.set(b.name, t ? { ...t, gate: b.gate, status: b.status } : b);
  }
  const gates = [...byName.values()];

  const history = (sections["run history"] || "")
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("- "))
    .map((l) => l.replace(/^\s*-\s*/, "").trim());

  const failure = sectionsMatching(sections, /^failure/).join("\n").trim();
  const pins = sectionsMatching(sections, /pin updates/).flatMap(readTable);

  return {
    label,
    file,
    title: (md.match(/^#\s+(.*)$/m) || [])[1] || label,
    command: fields.command || "",
    runId: fields["run id"] || "",
    status,
    running: isRunning(status),
    failed: TERMINAL.test(status) && status.startsWith("fail"),
    mode: fields.mode || "",
    started: fields.started || "",
    lastUpdate: fields["last update"] || "",
    gates,
    pins,
    history: history.slice(-40),
    failure: failure || null,
    counts: gates.reduce((acc, g) => ({ ...acc, [g.gate]: (acc[g.gate] || 0) + 1 }), {}),
  };
}
