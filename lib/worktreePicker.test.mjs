// node --test lib/worktreePicker.test.mjs
//
// "Tried to create a new workspace in the new chat 2 tab, and it didn't work. If exocortex workspace
//  does exist, it didn't appear in the list."
//
// It does exist — `git worktree list` shows it. Measured on the real page, the same pane's worktree
// dropdown, four states in one run:
//
//   after picking the repo by hand   main, exocortex, + new…
//   after a RELOAD                   main, + new…          <- gone
//   in chat 2                        main, + new…          <- gone
//   after re-firing the change       main, exocortex, + new…
//
// Two independent defects, and you need both to get the dead end that was reported:
//
//  1. CLIENT — `st.worktrees[repo]` was requested from exactly two places, both of which are a
//     person CHANGING the repo: the dropdown's change handler and the sidebar/drawer pick. A pane
//     restored from the saved layout already has its repo, so neither fires, and the list falls back
//     to `[{name:"main"}]`. Every restored pane has been showing a truncated list since worktrees
//     existed; opening chat 2 is just where it finally got noticed.
//
//  2. SERVER — with the list empty, "+ new worktree…" is the only route left, and creating one that
//     is already on disk is refused with *"already exists — pick it from the list instead of
//     creating it."* That refusal `return`s BEFORE `_sendWorktrees`, so the list it tells you to pick
//     from is still the empty one. A correct message pointing at nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const wsm = readFileSync(join(__dir, "..", "lib", "workspace.mjs"), "utf8");

test("a pane that HAS a repo asks what checkouts it has, however it got that repo", () => {
  // The fix goes in fillWorktreeSelect because that is the one place every pane with a repo passes
  // through, on every paint, no matter which path set the repo — restore, slot switch, adoption from
  // an open reply, or a person using the dropdown.
  const at = app.indexOf("function fillWorktreeSelect");
  const body = app.slice(at, app.indexOf("\n  }", at));
  assert.match(body, /wsWantWorktrees\(p\.repo\)/,
    "the picker must be able to ask, instead of assuming somebody else already did");

  const fi = app.indexOf("function wsWantWorktrees");
  assert.ok(fi > -1, "and the asking is its own named thing, so the once-only rule lives in one place");
  const fn = app.slice(fi, app.indexOf("\n  }", fi));
  assert.match(fn, /if \(!repo \|\| st\.worktrees\[repo\]\) return/,
    "already have the list -> never ask again; this runs on every paint of every pane");
  assert.match(fn, /if \(_wtAsked\.has\(repo\)\) return/,
    "…and an in-flight request must not be re-sent on the next paint either");
  assert.match(app.slice(app.indexOf("function _wtAsk(repo)")), /action: "worktrees"/, "the request itself");
});

test("a refused create still tells you what DOES exist", () => {
  const at = wsm.indexOf("_worktreeAdd(repo, name) {");
  const body = wsm.slice(at, wsm.indexOf("\n  }", at));
  assert.ok(!/if \(!r\.ok\) return this\.send\("event", null, \{ kind: "error"/.test(body),
    "the refusal must not return before the list is sent — that is what made the message point at nothing");
  assert.match(body, /this\._sendWorktrees\(repo\);\s*\n\s*return;/,
    "on failure: say why, then publish the truth, then stop");
  assert.equal((body.match(/_sendWorktrees\(repo\)/g) || []).length, 2,
    "both the success and the failure path publish it");
});

test("a request lost while the server restarts must not latch the list away forever", () => {
  // "I saw it just before, but right now it has disappeared (I deployed 1.20.6)."
  //
  // My own fix caused this one. `wsWantWorktrees` marked a repo as asked and NEVER unmarked it,
  // while `st.worktrees[repo]` is only ever written when a reply arrives. So one missed reply meant
  // the list stayed empty for the life of the page — and a deploy is precisely the moment a reply
  // goes missing: it restarts the web process AND sessiond, and the worktrees answer comes back over
  // the SSE stream, not as the POST's response, so the round trip can be broken at either end.
  //
  // This is the same shape as `fitRisers` pinning width:0 and recording the failure as done. A latch
  // with no release turns one lost message into a permanent wrong answer. Two releases, because the
  // trip can break in two places:
  const fi = app.indexOf("function _wtAsk(repo)");
  const fn = app.slice(fi, app.indexOf("\n  }", fi));
  assert.match(fn, /if \(!r \|\| r\.ok === false\) _wtAsked\.delete\(repo\)/,
    "the POST failing (server down mid-deploy) must release the latch on the spot");
  assert.match(fn, /\.catch\(\(\) => _wtAsked\.delete\(repo\)\)/, "…and so must it rejecting outright");

  // …and the POST can SUCCEED while the stream that carries the answer dies. Only a reconnect
  // proves that happened, so the reconnect re-asks — which also refreshes a list gone stale because
  // a worktree was created from another terminal.
  assert.match(app, /function wsPrimeWorktrees\(\)/, "reconnect catch-up for the worktree lists");
  const pi = app.indexOf("function wsPrimeWorktrees()");
  const pf = app.slice(pi, app.indexOf("\n  }", pi));
  assert.match(pf, /_wtAsked\.clear\(\)/, "…which starts by forgetting what it thinks it asked");
  assert.match(pf, /for \(const repo of new Set\(st\.panes\.map\(\(p\) => p\.repo\)\.filter\(Boolean\)\)\) _wtAsk\(repo\)/,
    "…and asks UNCONDITIONALLY for every repo on screen — a merely stale list looks exactly like a right one");
  assert.match(app, /primeControls\(\);\s*\n\s*wsPrimeWorktrees\(\);/,
    "…driven from the SAME hello handler as every other reconnect catch-up, so it cannot be forgotten");
});
