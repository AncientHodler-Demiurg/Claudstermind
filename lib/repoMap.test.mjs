// node --test lib/repoMap.test.mjs
//
// WHY THIS EXISTS. `dashboard/data/map.json` is what the Overview draws and, since 1.15.0, what the
// mobile cockpit's repository chooser lists — so a stale entry is no longer just a wrong picture, it
// is a repository you cannot open from a phone.
//
// It had drifted for seven weeks, and the interesting half was not the four repos nobody had added.
// It was TWO ENTRIES FROZEN MID-MOVE: `ouronet-libs` and `stoa-chain-libs` both carried the path
// `"StoaChain/_infra/stoa-js (pre-split)"` — a placeholder written while they were one repository —
// while `ouronet-libs`' own movement note already said `✅ Phase-4 done (2026-07-22): split from
// stoa-js`. The record of the move landed; the path it moved to never did. Both repos existed on
// disk, separately, with their own remotes, and neither could be found by anything reading this file.
//
// These checks are over the file alone (no disk access — this runs anywhere), and each is a shape
// that was actually wrong rather than a rule invented for tidiness.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(readFileSync(join(__dir, "..", "dashboard", "data", "map.json"), "utf8"));
const repos = map.repos || [];

test("no repository is left holding a placeholder path after its move is recorded as done", () => {
  const stuck = repos.filter((r) => {
    const done = (r.movement || []).some((m) => /✅|done/i.test(String(m)));
    return done && /\(|pre-split|no repo yet|embedded/i.test(String(r.localPath || ""));
  }).map((r) => `${r.id}: "${r.localPath}" vs ${JSON.stringify(r.movement)}`);
  assert.deepEqual(stuck, [],
    "a finished move with an unfinished path is invisible to everything that reads this file — the " +
    "Overview draws it in the wrong place and the phone's chooser cannot open it at all");
});

test("a placeholder path is allowed only where it says WHY, and never for an active code repo", () => {
  // "(no repo yet)" and "(embedded)" are real, honest states. "(pre-split)" was too — until it wasn't.
  for (const r of repos) {
    const p = String(r.localPath || "");
    if (!p.includes("(")) continue;
    assert.match(p, /\((no repo yet|embedded)\)?/,
      `${r.id} carries the placeholder "${p}" — if that state has passed, the path has to be the real one`);
  }
});

test("every entry can be found: an id, a name, a role in the known set, and a path", () => {
  const roles = new Set(["constructor", "automaton", "daimon", "seer", "infra", "website", "tool", "media", "client", "orchestrator"]);
  for (const r of repos) {
    assert.ok(r.id && r.name, "an entry without an id or a name cannot be referred to");
    assert.ok(roles.has(r.role), `${r.id} has role "${r.role}", which nothing renders a badge for`);
    assert.ok(r.localPath, `${r.id} has no path, so no chooser can open it`);
    assert.ok(r.org && (r.org.current || r.org.target), `${r.id} belongs to no organisation, so it groups nowhere`);
  }
});

test("no two entries claim the same path or the same id", () => {
  const byPath = new Map(), byId = new Map();
  for (const r of repos) {
    const p = String(r.localPath);
    if (!p.includes("(")) {
      assert.ok(!byPath.has(p), `${r.id} and ${byPath.get(p)} both claim ${p} — one of them is stale`);
      byPath.set(p, r.id);
    }
    assert.ok(!byId.has(r.id), `two entries share the id ${r.id}`);
    byId.set(r.id, true);
  }
});

test("the reconciliation says what it deliberately leaves out", () => {
  // Fifteen more git checkouts live under the workspace root — vendored upstreams, a study directory,
  // an archive, a font source. Leaving them out is a decision, and a decision that is not written
  // down reads as an omission the next time someone runs the diff.
  assert.ok(map.meta && map.meta.reconciled, "the map must record when it was last checked against disk");
  assert.match(String(map.meta.reconciledNote || ""), /_upstream|_Archive/,
    "…and which checkouts are deliberately not repositories of the estate");
});
