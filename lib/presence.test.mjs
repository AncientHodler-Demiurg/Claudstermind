// node --test lib/presence.test.mjs — the connection registry (which terminals are connected).
import test from "node:test";
import assert from "node:assert/strict";
import { createPresence } from "./presence.mjs";

test("add then list surfaces the connection with its label and origin", () => {
  const p = createPresence();
  p.add({ id: "c1", label: "laptop", origin: "local" }, 1000);
  const list = p.list(2000);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "c1");
  assert.equal(list[0].label, "laptop");
  assert.equal(list[0].origin, "local");
});

test("remove drops a connection", () => {
  const p = createPresence();
  p.add({ id: "c1" }, 1000);
  p.remove("c1");
  assert.deepEqual(p.list(2000), []);
});

test("touch refreshes lastSeen so a connection is not pruned as stale", () => {
  const p = createPresence();
  p.add({ id: "c1" }, 1000);
  p.touch("c1", 5000);
  // Prune anything not seen since 4000 — c1 was touched at 5000, so it survives.
  p.prune(4000);
  assert.equal(p.list(6000).length, 1);
});

test("prune removes connections not seen since the cutoff", () => {
  const p = createPresence();
  p.add({ id: "old" }, 1000);
  p.add({ id: "fresh" }, 5000);
  p.prune(3000);   // cutoff: last-seen before 3000 is stale
  assert.deepEqual(p.list(6000).map((c) => c.id), ["fresh"]);
});

test("attach records which workspace a connection is viewing; list reflects it", () => {
  const p = createPresence();
  p.add({ id: "c1", label: "phone" }, 1000);
  p.attach("c1", "Mnemosyne@main", 1500);
  assert.equal(p.list(2000)[0].workspaceId, "Mnemosyne@main");
  // Re-attaching to another workspace replaces it.
  p.attach("c1", "Mnemosyne@wt-a", 1600);
  assert.equal(p.list(2000)[0].workspaceId, "Mnemosyne@wt-a");
});

test("attach on an unknown connection is a no-op, not a crash", () => {
  const p = createPresence();
  p.attach("ghost", "X@main", 1000);
  assert.deepEqual(p.list(2000), []);
});

test("whoOn returns the connections viewing a given workspace", () => {
  const p = createPresence();
  p.add({ id: "a", label: "laptop" }, 1000);
  p.add({ id: "b", label: "phone" }, 1000);
  p.add({ id: "c", label: "desktop" }, 1000);
  p.attach("a", "Repo@main", 1000);
  p.attach("b", "Repo@main", 1000);
  p.attach("c", "Repo@wt-1", 1000);
  const on = p.whoOn("Repo@main", 2000).map((c) => c.id).sort();
  assert.deepEqual(on, ["a", "b"]);
});

test("merge folds in connections reported from another origin (the relay), de-duped by id", () => {
  const p = createPresence();
  p.add({ id: "local1", label: "laptop", origin: "local" }, 1000);
  // The relay reports its own browsers up the tunnel.
  p.merge([
    { id: "relay1", label: "phone", origin: "relay", workspaceId: "Repo@main", lastSeen: 1200 },
    { id: "relay2", label: "tablet", origin: "relay", lastSeen: 1300 },
  ], 1400);
  const ids = p.list(2000).map((c) => c.id).sort();
  assert.deepEqual(ids, ["local1", "relay1", "relay2"]);
  assert.equal(p.list(2000).find((c) => c.id === "relay1").origin, "relay");
});

test("merge replaces a previously-reported remote set, so a disconnected remote terminal drops", () => {
  const p = createPresence();
  p.add({ id: "local1", origin: "local" }, 1000);
  p.merge([{ id: "r1", origin: "relay", lastSeen: 1000 }, { id: "r2", origin: "relay", lastSeen: 1000 }], 1000);
  assert.equal(p.list(2000).length, 3);
  // Next report from the relay: r2 is gone (its browser closed).
  p.merge([{ id: "r1", origin: "relay", lastSeen: 2000 }], 2000);
  const ids = p.list(3000).map((c) => c.id).sort();
  assert.deepEqual(ids, ["local1", "r1"], "r2 dropped; the LOCAL connection is untouched by a remote report");
});

test("prune ages out stale REMOTE entries too, so a dropped tunnel leaves no ghosts", () => {
  const p = createPresence();
  p.add({ id: "local1", origin: "local" }, 5000);
  p.merge([{ id: "r1", origin: "relay", lastSeen: 1000 }], 1000);
  assert.equal(p.list(6000).length, 2);
  p.prune(3000);   // cutoff past the relay's last report but before the local one
  assert.deepEqual(p.list(6000).map((c) => c.id), ["local1"], "the ghost relay terminal is gone");
});

test("count is the number of live connections after pruning", () => {
  const p = createPresence();
  p.add({ id: "a" }, 1000);
  p.add({ id: "b" }, 5000);
  assert.equal(p.count(6000, 4000), 1, "only b is fresh past the 4000 cutoff");
});
