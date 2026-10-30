// Tests for lib/codeGraph.mjs — Ch.3.3's graph build + NetworkX node-link serialization +
// end-to-end algorithm wiring.

import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, toNodeLink, fromNodeLink, runLouvain, degreeCentrality, EXTERNAL_NODE_TYPE } from "./codeGraph.mjs";

function sampleBatch() {
  return {
    nodes: [
      { id: "file:a.js", type: "file" },
      { id: "function:a.js#foo", type: "function", name: "foo" },
      { id: "function:a.js#bar", type: "function", name: "bar" },
    ],
    edges: [
      { source: "file:a.js", target: "function:a.js#foo", kind: "contains", confidence: "EXTRACTED" },
      { source: "file:a.js", target: "function:a.js#bar", kind: "contains", confidence: "EXTRACTED" },
      { source: "function:a.js#foo", target: "function:a.js#bar", kind: "calls", confidence: "EXTRACTED" },
      { source: "file:a.js", target: "module:lodash", kind: "imports", confidence: "EXTRACTED" },
    ],
  };
}

test("buildGraph: every node from the batch is present, with its attributes", () => {
  const g = buildGraph(sampleBatch());
  assert.equal(g.order, 4, "3 real nodes + 1 placeholder for module:lodash");
  assert.equal(g.getNodeAttribute("function:a.js#foo", "type"), "function");
  assert.equal(g.getNodeAttribute("function:a.js#foo", "name"), "foo");
});

test("buildGraph: an edge endpoint with no corresponding node gets a bare EXTERNAL placeholder, never dropped or thrown", () => {
  const g = buildGraph(sampleBatch());
  assert.ok(g.hasNode("module:lodash"));
  assert.equal(g.getNodeAttribute("module:lodash", "type"), EXTERNAL_NODE_TYPE);
  assert.ok(g.hasEdge("file:a.js|module:lodash|imports|0"));
});

test("buildGraph: is idempotent per node id — re-adding the same id merges attributes rather than throwing", () => {
  const batch = {
    nodes: [{ id: "file:a.js", type: "file" }, { id: "file:a.js", type: "file", extra: 1 }],
    edges: [],
  };
  assert.doesNotThrow(() => buildGraph(batch));
  const g = buildGraph(batch);
  assert.equal(g.order, 1);
  assert.equal(g.getNodeAttribute("file:a.js", "extra"), 1);
});

test("buildGraph: a genuine repeat of the exact same (source,target,kind) triple is a SEPARATE edge, not a collision", () => {
  const batch = {
    nodes: [{ id: "a", type: "file" }, { id: "b", type: "file" }],
    edges: [
      { source: "a", target: "b", kind: "imports", confidence: "EXTRACTED" },
      { source: "a", target: "b", kind: "imports", confidence: "EXTRACTED" },
    ],
  };
  const g = buildGraph(batch);
  assert.equal(g.size, 2, "two independent imports edges between the same pair both survive");
});

test("buildGraph: tolerates missing/malformed input without throwing", () => {
  assert.doesNotThrow(() => buildGraph(null));
  assert.doesNotThrow(() => buildGraph({}));
  assert.equal(buildGraph(null).order, 0);
});

test("toNodeLink: pins the EXACT NetworkX node-link shape — flat attrs, 'links' not 'edges'", () => {
  const g = buildGraph({ nodes: [{ id: "a", type: "file" }, { id: "b", type: "function" }], edges: [{ source: "a", target: "b", kind: "contains", confidence: "EXTRACTED" }] });
  const nl = toNodeLink(g);
  assert.equal(nl.directed, true);
  assert.equal(nl.multigraph, true);
  assert.deepEqual(nl.graph, {});
  assert.deepEqual(nl.nodes, [{ id: "a", type: "file" }, { id: "b", type: "function" }]);
  assert.equal(nl.links.length, 1);
  assert.equal(nl.links[0].source, "a");
  assert.equal(nl.links[0].target, "b");
  assert.equal(nl.links[0].kind, "contains");
  assert.equal(nl.links[0].confidence, "EXTRACTED");
  assert.ok("key" in nl.links[0], "a multigraph link always carries its key");
  assert.ok(!("edges" in nl), "NetworkX's edges=\"links\" shape uses the key 'links', never 'edges'");
});

test("round-trip: build -> serialize -> reload -> same node/edge count", () => {
  const g1 = buildGraph(sampleBatch());
  const g2 = fromNodeLink(toNodeLink(g1));
  assert.equal(g2.order, g1.order);
  assert.equal(g2.size, g1.size);
  assert.deepEqual(new Set(g2.nodes()), new Set(g1.nodes()));
});

test("round-trip: node and edge ATTRIBUTES survive, not just counts", () => {
  const g1 = buildGraph(sampleBatch());
  const g2 = fromNodeLink(toNodeLink(g1));
  assert.equal(g2.getNodeAttribute("function:a.js#foo", "name"), "foo");
  const edgeKey = "file:a.js|function:a.js#foo|contains|0";
  assert.equal(g2.getEdgeAttribute(edgeKey, "confidence"), "EXTRACTED");
});

test("runLouvain: wired end-to-end, produces a community for every node", () => {
  const g = buildGraph(sampleBatch());
  const communities = runLouvain(g);
  for (const id of g.nodes()) assert.ok(Number.isFinite(communities[id]), `${id} must have a community index`);
});

test("degreeCentrality: wired end-to-end, a SANE (hand-verifiable) result, not just 'doesn't throw'", () => {
  // a -> b, a -> c (a plain directed path graph; degree centrality = degree / (n-1))
  const g = buildGraph({
    nodes: [{ id: "a", type: "file" }, { id: "b", type: "function" }, { id: "c", type: "function" }],
    edges: [
      { source: "a", target: "b", kind: "contains", confidence: "EXTRACTED" },
      { source: "a", target: "c", kind: "contains", confidence: "EXTRACTED" },
    ],
  });
  const d = degreeCentrality(g);
  assert.equal(d.a, 1, "a touches both other nodes — max possible centrality in a 3-node graph");
  assert.equal(d.b, 0.5);
  assert.equal(d.c, 0.5);
});
