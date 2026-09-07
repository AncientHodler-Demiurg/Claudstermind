#!/usr/bin/env node
// recall — read ONE turn of any Claudstermind conversation, by its address.
//
// WHY. You want to show agent B what agent A said. Pasting a 4 KB answer into another chat works
// until the answer is 40 KB, or until you want six of them. An ADDRESS is small, stable, and stays
// meaningful later — and every agent here has a shell, so agent B can simply read it:
//
//     node scripts/recall.mjs 'AncientPantheon/constructors/Khronoton@main#R949'
//     node scripts/recall.mjs 'Khronoton#R949'        # any unambiguous fragment of the id
//     node scripts/recall.mjs --list                  # what conversations exist
//     node scripts/recall.mjs 'Khronoton#R949' --json # {conversation,kind,number,text,…}
//
// The `#R949` form is deliberately the same shape as the archive's own `<conversationId>#seg14`
// refs, so it reads as a sibling of something that already exists rather than a competing scheme.
// The ⧉ button on every message copies exactly this address (Alt/Shift-click).
//
// HOW TURNS ARE NUMBERED, and it is worth stating because getting it wrong returns the WRONG TURN
// while looking perfectly plausible: R#n is the n-th assistant row of the LIVE transcript, 1-based.
// Wrapping never splices that file — it only archives a COPY of the head into `_segments/` — so the
// archive plays no part in numbering. (Confirmed against the server: `capTranscript` hands a full
// transcript back with `responseOffset: 0`, and the client counts up from there.) The archive is used
// only as a fallback, for a live file that has been trimmed.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { recallByNumber, readIndex } from "../lib/conversationArchive.mjs";

const WS = process.env.CM_WORKSPACE_DIR
  || join(process.env.HOME || "", "ClaudeWS", ".claude", "workspace");

const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
const rows = (f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim())
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

/** Every conversation on disk: its id, its live transcript file, and its workspace dir. */
function conversations() {
  const out = [];
  let dirs = [];
  try { dirs = readdirSync(WS); } catch { return out; }
  for (const d of dirs) {
    const dir = join(WS, d);
    let files = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) {
      const stem = f.slice(0, -6);
      // A file named after its workspace IS that workspace's one conversation (Core); a uuid-named
      // one is a conversation of its own inside that workspace (a Pact tab).
      const id = stem === d ? d.replace(/~2f~/g, "/") : stem;
      let turns = 0, at = 0;
      try { const st = statSync(join(dir, f)); at = st.mtimeMs; } catch {}
      out.push({ id, dir, file: join(dir, f), workspace: d.replace(/~2f~/g, "/"), at, turns });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

function pickConversation(frag) {
  const all = conversations();
  const exact = all.filter((c) => c.id === frag);
  if (exact.length === 1) return exact[0];
  const lc = String(frag).toLowerCase();
  const hits = all.filter((c) => c.id.toLowerCase().includes(lc));
  if (hits.length === 1) return hits[0];
  if (!hits.length) die(`No conversation matches "${frag}".\nTry: node scripts/recall.mjs --list`);
  die(`"${frag}" is ambiguous — ${hits.length} conversations match:\n`
    + hits.slice(0, 12).map((h) => "  " + h.id).join("\n")
    + "\nUse the full id.");
}

/** How many prompts/responses are archived. NOT part of the numbering — see the header — only used
 *  to answer "is this turn recoverable from the archive?" when the live file cannot supply it. */
function archivedCounts(conv) {
  let p = 0, r = 0;
  try {
    for (const e of readIndex(conv.dir)) {
      if (!e || String(e.conversationId) !== String(conv.id)) continue;
      if (Number.isFinite(e.promptEnd)) p = Math.max(p, e.promptEnd);
      if (Number.isFinite(e.responseEnd)) r = Math.max(r, e.responseEnd);
    }
  } catch {}
  return { p, r };
}

function resolve(conv, kind, n) {
  const wantRole = kind === "R" ? "assistant" : "user";
  const live = rows(conv.file).filter((x) => x.role === wantRole);
  if (n >= 1 && n <= live.length) return { text: live[n - 1].text || "", where: "live transcript" };
  // Only reachable if the live file no longer holds that turn. The archive keeps a copy of the head,
  // so try it before giving up.
  const arch = archivedCounts(conv);
  const archivedUpTo = kind === "R" ? arch.r : arch.p;
  if (n <= archivedUpTo) {
    const hit = recallByNumber(conv.dir, { conversationId: conv.id, kind: kind === "R" ? "response" : "prompt", number: n });
    if (hit) return { text: hit.text || "", where: "archive " + (hit.segmentRef || "") };
  }
  return die(`${kind}#${n} is out of range — this conversation has ${live.length} ${wantRole === "assistant" ? "answers" : "prompts"}.`);
}

// ---- CLI ----------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const args = argv.filter((a) => !a.startsWith("--"));

if (argv.includes("--list") || (!args.length && !argv.length)) {
  const all = conversations();
  if (!all.length) die(`No conversations found under ${WS}`);
  console.log(`${all.length} conversation(s) under ${WS}:\n`);
  for (const c of all.slice(0, 60)) {
    const live = rows(c.file);
    const R = live.filter((x) => x.role === "assistant").length;
    const P = live.filter((x) => x.role === "user").length;
    const a = archivedCounts(c);
    console.log(`  ${c.id}\n      P#1–${P} · R#1–${R}${a.r ? `  (${a.r} answers also archived)` : ""}`);
  }
  process.exit(0);
}
if (!args.length) die("usage: recall '<conversation>#R949'   |   --list   |   --json");

const m = /^(.*)#([PR])(\d+)$/i.exec(args[0]);
if (!m) die(`Not an address: "${args[0]}"\nExpected <conversation>#R949 or <conversation>#P21.`);
const conv = pickConversation(m[1]);
const kind = m[2].toUpperCase();
const n = Number(m[3]);
const got = resolve(conv, kind, n);

if (json) {
  console.log(JSON.stringify({ conversation: conv.id, kind, number: n, source: got.where, text: got.text }, null, 2));
} else {
  // Header on STDERR so `recall … > file` and pipes get the text and nothing else.
  console.error(`── ${conv.id} · ${kind}#${n} · ${got.where} · ${got.text.length} chars ──`);
  console.log(got.text);
}
