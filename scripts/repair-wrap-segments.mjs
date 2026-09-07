#!/usr/bin/env node
// repair-wrap-segments — clean up the archive damage left by the pre-1.11.2 wrap-boundary bug.
//
// THE DAMAGE. Until 1.11.2, "where does the current window start" lived in an in-memory counter
// (`_rolledThrough`) that died with the process. After every sessiond restart the whole conversation
// counted as un-archived, so the next completed turn wrapped again — archiving a segment that
// *contained* its predecessor whole. The result, per conversation, is a chain of strictly NESTED
// segment files plus an index whose absolute P#/R# ranges are the SUM of those overlaps and so run
// far past the number of turns the conversation actually has. `recallByNumber` resolves a number
// against those ranges, so recalling a late turn can answer with an early one.
//
// WHAT THIS DOES. For each conversation it finds nested segments (segment n's rows being a strict
// prefix of segment n+1's) and keeps only the LAST one — the superset, which holds every row the
// discarded ones held. It then rewrites that survivor's absolute P#/R# range, and re-points the live
// transcript's `wrapped` marks at it so no mark addresses a file that no longer exists. The survivor
// KEEPS its own segment number precisely so marks that already name it stay correct.
//
// THE RANGE IS DERIVED BY ALIGNMENT, NOT ASSUMED TO START AT 1 — and that distinction is the whole
// reason this got a second draft. R#n means "the n-th assistant row of the conversation", and the
// conversation is the live transcript (a roll never splices it, it only appends a mark). The obvious
// repair — set promptStart/responseStart to 1 — is wrong whenever a segment holds rows the live
// transcript does not. Measured on Claudstermind@main: seg14 has 7,418 turns, 7,416 of which are in
// the live transcript, preceded by two that are not — a tunnel health-check exchange ("Reply with
// ONLY: TUNNEL-OK" / "TUNNEL-OK"). Starting at 1 would have left every recall in that conversation
// off by exactly one, permanently, and looking perfectly plausible.
//
// So: find the offset k where the survivor's rows line up with the start of the live transcript, and
// number from there. Rows before k are pre-history and take numbers <= 0, which is exactly what the
// start field is for. A conversation whose survivor cannot be aligned is REFUSED, not guessed at.
//
// WHY THIS IS SAFE. It only ever discards a file whose every row is provably present in the file it
// keeps, compared row by row on role + text. It refuses to touch anything that is not a clean
// prefix chain. And the archives are themselves a copy: the live transcript still holds these turns
// (verified on the reported workspace — segment 3 was a prefix of the live transcript).
//
// DRY RUN BY DEFAULT. Prints what it would do and changes nothing. Pass --commit to apply, which
// first copies every file it touches to <name>.bak.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const COMMIT = process.argv.includes("--commit");
const root = process.argv.find((a) => a.startsWith("--dir="))?.slice(6)
  || join(process.env.HOME || "", "ClaudeWS", ".claude", "workspace");

const rows = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
const sig = (r) => (r.role || r.kind || "?") + "|" + String(r.text || "").slice(0, 200);
const isPrefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i]);
const mib = (n) => (n / 1048576).toFixed(2) + " MiB";

let reclaimed = 0, touched = 0;
for (const wsName of existsSync(root) ? readdirSync(root) : []) {
  const segDir = join(root, wsName, "_segments");
  if (!existsSync(segDir)) continue;
  const idxPath = join(segDir, "_index.json");
  if (!existsSync(idxPath)) continue;
  let index;
  try { index = JSON.parse(readFileSync(idxPath, "utf8")); } catch { console.log(`! ${wsName}: unreadable index, skipped`); continue; }
  const entries = Array.isArray(index) ? index : (index.entries || []);
  const byConv = new Map();
  for (const e of entries) { const k = String(e.conversationId); if (!byConv.has(k)) byConv.set(k, []); byConv.get(k).push(e); }

  for (const [conv, list] of byConv) {
    list.sort((a, b) => (a.n || 0) - (b.n || 0));
    if (list.length < 2) continue;
    const files = list.map((e) => join(segDir, e.file || (e.path || "").split("/").pop() || ""));
    if (!files.every((f) => f && existsSync(f))) { console.log(`! ${wsName} / ${conv}: a segment file is missing, skipped`); continue; }
    const sigs = files.map((f) => rows(f).map(sig));

    // Only a clean, fully-nested chain is repairable — anything else is a shape this bug does not
    // produce, and guessing is worse than leaving it alone.
    let nested = true;
    for (let i = 0; i + 1 < sigs.length; i++) if (!isPrefix(sigs[i], sigs[i + 1])) nested = false;
    if (!nested) { console.log(`  ${wsName} / ${conv}: segments are not nested — nothing to repair (this is the healthy shape)`); continue; }

    const keep = list[list.length - 1], keepFile = files[files.length - 1];
    const drop = list.slice(0, -1), dropFiles = files.slice(0, -1);
    const bytes = dropFiles.reduce((n, f) => n + statSync(f).size, 0);
    const kept = rows(keepFile);

    // ALIGN the survivor against the live transcript to learn where absolute numbering starts.
    const liveFile = join(root, wsName, wsName + ".jsonl");
    if (!existsSync(liveFile)) { console.log(`! ${wsName} / ${conv}: no live transcript to align against, skipped`); continue; }
    const liveRows = rows(liveFile);
    const isTurn = (r) => r && (r.role === "user" || r.role === "assistant");
    const keptT = kept.filter(isTurn), liveT = liveRows.filter(isTurn);
    const kSig = keptT.map(sig), lSig = liveT.map(sig);
    // k = how many of the survivor's leading turns are NOT part of the live conversation. Almost
    // always 0; the tunnel health-check case above makes it 2. Bounded so a pathological file cannot
    // scan forever, and the match must be a real run, not a coincidental single row.
    let k = -1;
    for (let c = 0; c <= Math.min(kSig.length, 64); c++) {
      const n = Math.min(kSig.length - c, lSig.length);
      if (n < 8) break;                                   // too short to be evidence of anything
      let same = true;
      for (let i = 0; i < n; i++) if (kSig[c + i] !== lSig[i]) { same = false; break; }
      if (same) { k = c; break; }
    }
    if (k < 0) { console.log(`! ${wsName} / ${conv}: the survivor does not line up with the live transcript — REFUSED (numbering would be a guess)`); continue; }
    const preP = keptT.slice(0, k).filter((r) => r.role === "user").length;
    const preR = keptT.slice(0, k).filter((r) => r.role === "assistant").length;
    const prompts = keptT.filter((r) => r.role === "user").length;
    const responses = keptT.filter((r) => r.role === "assistant").length;
    const pStart = 1 - preP, rStart = 1 - preR;
    const pEnd = pStart + prompts - 1, rEnd = rStart + responses - 1;

    console.log(`\n${wsName} / ${conv}`);
    console.log(`  nested chain: ${list.map((e) => "seg" + e.n + " (" + sigs[list.indexOf(e)].length + " rows)").join(" ⊂ ")}`);
    console.log(`  keep seg${keep.n}; discard ${drop.map((e) => "seg" + e.n).join(", ")} — ${mib(bytes)} of duplicated rows`);
    console.log(`  index ranges: P#${list[0].promptStart}–${keep.promptEnd}, R#${list[0].responseStart}–${keep.responseEnd}`
              + `  →  P#${pStart}–${pEnd}, R#${rStart}–${rEnd}`);
    console.log(`  aligned at offset ${k}${k ? ` — ${k} leading turn(s) are pre-history, numbered <= 0` : " (survivor starts the conversation)"}`);
    reclaimed += bytes; touched++;

    // The live transcript carries a `wrapped` mark per wrap, each naming a segment. The spurious
    // wraps left marks naming files this repair removes, so they are re-pointed at the survivor
    // rather than left dangling — a mark whose link opens nothing is worse than no mark.
    const keepRef = String(keep.segmentRef || "");
    let dangling = 0;
    for (const r of liveRows) if (r && r.kind === "wrapped" && String(r.sourceRef) !== keepRef) dangling++;
    if (dangling) console.log(`  ${dangling} transcript wrap mark(s) name a discarded segment — they will be re-pointed at seg${keep.n}`);

    if (COMMIT) {
      for (const f of dropFiles) { copyFileSync(f, f + ".bak"); unlinkSync(f); }
      // n is NOT renumbered: marks already naming seg${keep.n} must keep resolving.
      const survivor = { ...keep, promptStart: pStart, promptEnd: pEnd, responseStart: rStart, responseEnd: rEnd };
      const rest = entries.filter((e) => String(e.conversationId) !== conv);
      const next = rest.concat([survivor]);
      copyFileSync(idxPath, idxPath + ".bak");
      writeFileSync(idxPath, JSON.stringify(Array.isArray(index) ? next : { ...index, entries: next }, null, 2));
      if (dangling) {
        copyFileSync(liveFile, liveFile + ".bak");
        const out = readFileSync(liveFile, "utf8").split("\n").map((line) => {
          if (!line.trim()) return line;
          let r; try { r = JSON.parse(line); } catch { return line; }
          if (!r || r.kind !== "wrapped" || String(r.sourceRef) === keepRef) return line;
          return JSON.stringify({ ...r, sourceRef: keepRef, segment: keep.n });
        }).join("\n");
        writeFileSync(liveFile, out);
      }
      console.log(`  ✓ applied (originals kept as .bak)`);
    }
  }
}
console.log(`\n${touched} conversation(s) repairable · ${mib(reclaimed)} of duplicated archive`);
console.log(COMMIT ? "APPLIED." : "Dry run — nothing changed. Re-run with --commit to apply.");
