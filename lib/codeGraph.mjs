// codeGraph.mjs — Ch.3.3, the graph itself. Per docs/work/exocortex/HANDOFF.md: the whole
// NetworkX surface Graphify's extractor actually uses is a container plus ~14 calls —
// `graphology` + `graphology-communities-louvain` + `graphology-metrics` covers it. No custom
// graph engine.
//
// NODE-LINK SHAPE IS DELIBERATE (per HANDOFF): `toNodeLink` emits NetworkX's
// `json_graph.node_link_data(G, edges="links")` shape, NOT graphology's own native `.export()`
// shape (verified different by actually calling both — graphology's export nests edges under
// `edges: [{key, source, target, attributes}]`; NetworkX's node-link shape is flatter — attrs
// merged onto the node/link object itself, not nested under an `attributes` key). This is what
// makes Ch.3.4's viz free: Graphify's own `graph.html` already reads exactly this shape and does
// not care what produced the file.
//
// A MultiDirectedGraph (not a plain DirectedGraph): two independent `imports` edges between the
// same file pair (re-indexing, or a batch merging more than one extraction pass) must not collide
// as "the same edge" the way a simple graph would force. `allowSelfLoops: true` because direct
// recursion (Ch.3.2's "foo calls foo") is a real, valid self-loop.
//
// EXTERNAL/PLACEHOLDER NODES: an edge may name an endpoint id with no corresponding node in the
// SAME batch (e.g. `module:lodash` — never given a real node; or a file not yet extracted in a
// partial/incremental run — Ch.3.5). `buildGraph` adds a bare placeholder (`type: "external"`,
// not one of lib/codeGraphSchema.mjs's NODE_TYPES, so a consumer can always tell a placeholder
// from a real extracted node) rather than throwing or silently dropping the edge — per
// docs/work/exocortex/code-graph-schema.md's Edge section.
//
// ESM.

import { MultiDirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import * as metrics from "graphology-metrics";

export const EXTERNAL_NODE_TYPE = "external";

/**
 * buildGraph({ nodes, edges }) → a MultiDirectedGraph.
 * Idempotent per node id (re-adding the same id merges attributes rather than throwing) so a
 * caller assembling one graph from several files' extraction batches (each starting with its own
 * `file:` node) never has to pre-dedupe. Every edge gets a stable, content-derived key
 * (`${source}|${target}|${kind}|${n}` — `n` disambiguating a genuine repeat of the exact same
 * triple) rather than an auto-generated one, so `toNodeLink`/`fromNodeLink` round-trips are
 * byte-for-byte reproducible from the same input, not dependent on graphology's internal counter.
 */
export function buildGraph(batch) {
  const { nodes, edges } = batch && typeof batch === "object" ? batch : {};
  const g = new MultiDirectedGraph({ allowSelfLoops: true });
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (!n || typeof n.id !== "string") continue;
    const { id, ...attrs } = n;
    g.mergeNode(id, attrs);
  }
  const keyCounts = new Map();
  for (const e of Array.isArray(edges) ? edges : []) {
    if (!e || typeof e.source !== "string" || typeof e.target !== "string") continue;
    if (!g.hasNode(e.source)) g.addNode(e.source, { type: EXTERNAL_NODE_TYPE });
    if (!g.hasNode(e.target)) g.addNode(e.target, { type: EXTERNAL_NODE_TYPE });
    const triple = `${e.source}|${e.target}|${e.kind}`;
    const n = keyCounts.get(triple) || 0;
    keyCounts.set(triple, n + 1);
    const { source, target, ...attrs } = e;
    g.addEdgeWithKey(`${triple}|${n}`, e.source, e.target, attrs);
  }
  return g;
}

/**
 * toNodeLink(graph) → { directed, multigraph, graph: {}, nodes: [{id, ...}], links: [{source, target, key, ...}] }
 * NetworkX node-link shape, `edges="links"` — see module header for why this exact shape, not
 * graphology's native export.
 */
export function toNodeLink(graph) {
  const nodes = graph.mapNodes((id, attrs) => ({ id, ...attrs }));
  const links = graph.mapEdges((key, attrs, source, target) => ({ source, target, key, ...attrs }));
  return { directed: true, multigraph: true, graph: {}, nodes, links };
}

/**
 * fromNodeLink(data) → a MultiDirectedGraph rebuilt from toNodeLink's shape — the inverse, for a
 * round-trip test (build -> serialize -> reload -> same node/edge count, same keys).
 */
export function fromNodeLink(data) {
  const d = data && typeof data === "object" ? data : {};
  const g = new MultiDirectedGraph({ allowSelfLoops: true });
  for (const n of Array.isArray(d.nodes) ? d.nodes : []) {
    if (!n || typeof n.id !== "string") continue;
    const { id, ...attrs } = n;
    g.mergeNode(id, attrs);
  }
  for (const l of Array.isArray(d.links) ? d.links : []) {
    if (!l || typeof l.source !== "string" || typeof l.target !== "string") continue;
    if (!g.hasNode(l.source)) g.addNode(l.source, { type: EXTERNAL_NODE_TYPE });
    if (!g.hasNode(l.target)) g.addNode(l.target, { type: EXTERNAL_NODE_TYPE });
    const { source, target, key, ...attrs } = l;
    if (key != null && !g.hasEdge(key)) g.addEdgeWithKey(key, source, target, attrs);
    else if (key == null) g.addEdge(source, target, attrs);
  }
  return g;
}

/** runLouvain(graph) → { [nodeId]: communityIndex } — Louvain community detection, end to end. */
export function runLouvain(graph) {
  return louvain(graph);
}

/** degreeCentrality(graph) → { [nodeId]: score } — graphology-metrics' degree centrality, chosen
 *  over eigenvector/pagerank for this slice's "at least one algorithm, a sane result" requirement
 *  because it always converges (no iterative fixed-point to fail to reach) and is trivially
 *  hand-verifiable in a test. */
export function degreeCentrality(graph) {
  return metrics.centrality.degree(graph);
}
