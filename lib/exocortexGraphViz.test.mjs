// node --test lib/exocortexGraphViz.test.mjs
//
// Ch.3.4's data transform lives inline in dashboard/public/graph.html (a standalone static page —
// it can't be imported as a module; it boots vis-network against a real DOM on load), so — same
// slice-and-eval convention as lib/exocortexUi.test.mjs/lib/exocortexMount.test.mjs for app.js —
// the sentinel-marked pure block is cut out and eval'd on its own.
//
// What's under test: the pure node-link -> vis-network dataset transform, and that confidence/type
// drive a VISIBLE style distinction (Ch.3.4's own requirement) — not the vis.Network rendering
// itself (that's scripts/graph-smoke.mjs's job, a real headless-browser run).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "graph.html"), "utf8");
const begin = "// ===== EXOCORTEX GRAPH VIZ — pure helpers";
const end = "// ===== end EXOCORTEX GRAPH VIZ pure helpers =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "exocortex graph-viz helper block markers must exist in graph.html");
const block = src.slice(a, b + end.length);
const H = new Function(block + "\nreturn { nodeLinkToVisData, graphStatusText, NODE_STYLE, EDGE_STYLE };")();

function sample() {
  return {
    directed: true, multigraph: true, graph: {},
    nodes: [
      { id: "file:a.js", type: "file" },
      { id: "function:a.js#foo", type: "function", name: "foo" },
      { id: "module:lodash", type: "external" },
    ],
    links: [
      { source: "file:a.js", target: "function:a.js#foo", key: "k1", kind: "contains", confidence: "EXTRACTED" },
      { source: "file:a.js", target: "module:lodash", key: "k2", kind: "imports", confidence: "INFERRED" },
    ],
  };
}

test("nodeLinkToVisData: every node/link becomes a vis-network dataset entry, 1:1", () => {
  const { nodes, edges } = H.nodeLinkToVisData(sample());
  assert.equal(nodes.length, 3);
  assert.equal(edges.length, 2);
  assert.ok(nodes.every((n) => typeof n.id === "string"));
  assert.ok(edges.every((e) => typeof e.from === "string" && typeof e.to === "string"));
});

test("nodeLinkToVisData: a node's label prefers `name`, falls back to its id", () => {
  const { nodes } = H.nodeLinkToVisData(sample());
  assert.equal(nodes.find((n) => n.id === "function:a.js#foo").label, "foo");
  assert.equal(nodes.find((n) => n.id === "file:a.js").label, "file:a.js");
});

test("nodeLinkToVisData: CONFIDENCE drives a visible style distinction — EXTRACTED/INFERRED/AMBIGUOUS are all different", () => {
  const data = sample();
  data.links.push({ source: "file:a.js", target: "module:lodash", key: "k3", kind: "imports", confidence: "AMBIGUOUS" });
  const { edges } = H.nodeLinkToVisData(data);
  const extracted = edges.find((e) => e.id === "k1");
  const inferred = edges.find((e) => e.id === "k2");
  const ambiguous = edges.find((e) => e.id === "k3");
  assert.equal(extracted.dashes, false, "EXTRACTED is a solid line");
  assert.notDeepEqual(inferred.dashes, extracted.dashes, "INFERRED must look different from EXTRACTED");
  assert.notDeepEqual(ambiguous.dashes, inferred.dashes, "AMBIGUOUS must look different from INFERRED");
  assert.notEqual(inferred.color.color, extracted.color.color);
  assert.notEqual(ambiguous.color.color, inferred.color.color);
});

test("nodeLinkToVisData: NODE TYPE drives a visible style distinction too — file/function/class/external all differ", () => {
  const { nodes } = H.nodeLinkToVisData({
    nodes: [
      { id: "a", type: "file" }, { id: "b", type: "function" },
      { id: "c", type: "class" }, { id: "d", type: "external" },
    ],
    links: [],
  });
  const shapes = new Set(nodes.map((n) => n.shape));
  const colors = new Set(nodes.map((n) => n.color));
  assert.ok(shapes.size > 1 || colors.size > 1, "at least one visible dimension must distinguish node types");
  assert.notEqual(nodes[0].color, nodes[3].color, "a real node and an external placeholder must look different");
});

test("nodeLinkToVisData: an unknown node type degrades to the 'external' style, never throws", () => {
  const { nodes } = H.nodeLinkToVisData({ nodes: [{ id: "x", type: "mystery" }], links: [] });
  assert.deepEqual({ shape: nodes[0].shape, color: nodes[0].color }, { shape: H.NODE_STYLE.external.shape, color: H.NODE_STYLE.external.color });
});

test("nodeLinkToVisData: tolerates malformed/missing input without throwing", () => {
  assert.doesNotThrow(() => H.nodeLinkToVisData(null));
  assert.doesNotThrow(() => H.nodeLinkToVisData({}));
  assert.deepEqual(H.nodeLinkToVisData(null), { nodes: [], edges: [] });
});

test("nodeLinkToVisData: accepts 'edges' as a fallback key too (tolerant of a non-NetworkX-exact producer)", () => {
  const { edges } = H.nodeLinkToVisData({ nodes: [], edges: [{ source: "a", target: "b", kind: "calls", confidence: "EXTRACTED" }] });
  assert.equal(edges.length, 1);
});

test("graphStatusText: reports exact node/link counts", () => {
  assert.equal(H.graphStatusText(sample()), "3 nodes, 2 links");
  assert.equal(H.graphStatusText({ nodes: [{ id: "a" }], links: [] }), "1 node, 0 links");
  assert.equal(H.graphStatusText(null), "0 nodes, 0 links");
});
