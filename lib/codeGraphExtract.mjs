// codeGraphExtract.mjs — Ch.3.2, the ground-up Node/tree-sitter extractor. JS/TS only, first
// pass — per docs/work/exocortex/HANDOFF.md's Graphify verdict, this starts narrower and rougher
// than Graphify's own 32-language extractor, and does not chase parity.
//
// D7 (verified here, concretely): `web-tree-sitter@0.25.10` + `tree-sitter-wasms@0.1.13` is the
// working pair — `web-tree-sitter@0.27.1` (the version `npm install web-tree-sitter` resolves to
// today) fails to load this grammar bundle at all (`getDylinkMetadata` throws), a real
// compatibility finding from actually running it, not assumed from either package's docs. Pinned
// exactly in package.json for that reason — do not bump without re-verifying a real parse.
//
// AVOIDING GRAPHIFY'S OWN SCAR BY CONSTRUCTION, NOT BY BLOCKLIST: `extractors/go.py` carries a
// `_GO_PREDECLARED_FUNCS` blocklist because one unexported method named `append` absorbed 330
// phantom inbound `calls` edges on a real codebase — every member-method call was being resolved
// against a flat identifier namespace shared with top-level functions. This extractor never
// builds that shared namespace: a `calls` edge is ONLY ever emitted for a BARE identifier call
// (`foo()`) matching a TOP-LEVEL declaration; a member-expression call (`obj.foo()`) is never
// resolved at all, regardless of what `foo` is named. A method named `then`/`constructor` can
// never collide with a top-level function of the same name, because methods are never added to
// the name map a bare call is resolved against — there is no list of dangerous names to maintain.
//
// SCOPE LINES, DELIBERATE, NOT CHASED: no lexical scope resolution (a bare call matching a
// top-level name resolves to it even if a closer parameter/local shadows that name — "narrower
// and rougher," not wrong-often-enough-to-matter at this scale); no cross-file import RESOLUTION
// beyond the literal specifier text (3.5's impacted-set computation is file-identity based, not
// semantic-import-graph based); a dynamic `import()` whose argument isn't a literal string is
// skipped (nothing to point at, not a guess).
//
// ESM. `createExtractor()` loads both WASM grammars ONCE (expensive — do this once per process,
// not per file); `extractFile` itself is otherwise pure over its inputs.

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const WASM_DIR = path.join(__dir, "..", "node_modules", "tree-sitter-wasms", "out");

// Which grammar a file extension parses with. `.tsx` gets its OWN grammar (tree-sitter-wasms
// ships one) rather than reusing `typescript` — JSX syntax inside a .tsx file is a parse error
// under the plain typescript grammar.
const EXTENSION_LANG = {
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".tsx": "tsx",
};

/**
 * createExtractor() → { extractFile(path, source) -> {nodes, edges} }
 * Loads the three grammars (javascript/typescript/tsx) once. Call this once per process (or once
 * per batch job) and reuse the returned extractor — NOT once per file.
 */
export async function createExtractor() {
  const { Parser, Language } = await import("web-tree-sitter");
  await Parser.init();
  const langs = {};
  for (const name of ["javascript", "typescript", "tsx"]) {
    langs[name] = await Language.load(path.join(WASM_DIR, `tree-sitter-${name}.wasm`));
  }
  const parsers = {};
  for (const [name, lang] of Object.entries(langs)) {
    const p = new Parser();
    p.setLanguage(lang);
    parsers[name] = p;
  }

  return {
    extractFile(filePath, source) {
      const ext = path.extname(String(filePath || "")).toLowerCase();
      const langName = EXTENSION_LANG[ext];
      if (!langName) return { nodes: [], edges: [] }; // not a JS/TS file — nothing to extract, not an error
      const parser = parsers[langName];
      const tree = parser.parse(String(source || ""));
      return extractTree(filePath, tree.rootNode);
    },
  };
}

// Exported so lib/codeGraphIndex.mjs (Ch.3.5) can compute a file's own node id without
// duplicating the `file:` convention — this is the one place that owns it.
export const FILE_ID = (p) => `file:${p}`;
const FUNCTION_ID = (p, name) => `function:${p}#${name}`;
const CLASS_ID = (p, name) => `class:${p}#${name}`;

function strFragmentOf(stringNode) {
  if (!stringNode) return null;
  for (let i = 0; i < stringNode.namedChildCount; i++) {
    const c = stringNode.namedChild(i);
    if (c.type === "string_fragment") return c.text;
  }
  return null;
}

function lineRange(node) {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

/** Walk the WHOLE tree once, calling `visit(node)` for every named node (pre-order). */
function walkAll(node, visit) {
  visit(node);
  for (let i = 0; i < node.namedChildCount; i++) walkAll(node.namedChild(i), visit);
}

/**
 * extractTree(filePath, root) → {nodes, edges}, schema-shaped per lib/codeGraphSchema.mjs.
 * Two passes over the tree (see module header for why): Pass A collects every declaration
 * (functions, classes/methods) and every import-shaped statement; Pass B walks again, tracking
 * the current enclosing declaration, to resolve BARE-identifier calls against Pass A's map.
 */
function extractTree(filePath, root) {
  const nodes = [{ id: FILE_ID(filePath), type: "file", path: filePath, ...lineRange(root) }];
  const edges = [];
  const callableByName = new Map(); // top-level bare-callable name -> function node id (Pass A, consulted in Pass B)

  // ---- Pass A: declarations + imports ----------------------------------------------------
  walkAll(root, (node) => {
    if (node.type === "function_declaration") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const id = FUNCTION_ID(filePath, nameNode.text);
        nodes.push({ id, type: "function", path: filePath, name: nameNode.text, ...lineRange(node) });
        edges.push({ source: FILE_ID(filePath), target: id, kind: "contains", confidence: "EXTRACTED" });
        callableByName.set(nameNode.text, id);
      }
      return;
    }
    if (node.type === "variable_declarator") {
      const nameNode = node.childForFieldName("name");
      const valueNode = node.childForFieldName("value");
      if (nameNode && nameNode.type === "identifier" && valueNode &&
          (valueNode.type === "arrow_function" || valueNode.type === "function_expression")) {
        const id = FUNCTION_ID(filePath, nameNode.text);
        nodes.push({ id, type: "function", path: filePath, name: nameNode.text, ...lineRange(node) });
        // `contains` from the FILE — a const-bound function is a top-level thing the file
        // contains, same as a `function` declaration, regardless of the ceremony around it.
        edges.push({ source: FILE_ID(filePath), target: id, kind: "contains", confidence: "EXTRACTED" });
        callableByName.set(nameNode.text, id);
      }
      return;
    }
    if (node.type === "class_declaration") {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) return;
      const classId = CLASS_ID(filePath, nameNode.text);
      nodes.push({ id: classId, type: "class", path: filePath, name: nameNode.text, ...lineRange(node) });
      edges.push({ source: FILE_ID(filePath), target: classId, kind: "contains", confidence: "EXTRACTED" });
      const body = node.childForFieldName("body");
      if (body) {
        for (let i = 0; i < body.namedChildCount; i++) {
          const member = body.namedChild(i);
          if (member.type !== "method_definition") continue;
          const mName = member.childForFieldName("name");
          if (!mName) continue;
          // Qualified id ONLY — "Klass.then"/"Klass.constructor", never a bare "then"/"constructor"
          // in `callableByName`. This is the whole reason a method named `then`/`constructor`
          // can never collide with a same-named top-level function: methods never enter the
          // bare-call namespace at all (see module header).
          const methodId = FUNCTION_ID(filePath, `${nameNode.text}.${mName.text}`);
          nodes.push({ id: methodId, type: "function", path: filePath, name: `${nameNode.text}.${mName.text}`, ...lineRange(member) });
          edges.push({ source: classId, target: methodId, kind: "contains", confidence: "EXTRACTED" });
        }
      }
      return;
    }
    if (node.type === "import_statement" || node.type === "export_statement") {
      const sourceNode = node.childForFieldName("source");
      if (!sourceNode) return; // a plain `export function foo(){}` etc — not an import, nothing here
      const spec = strFragmentOf(sourceNode);
      if (spec == null) return;
      edges.push({ source: FILE_ID(filePath), target: importTargetId(filePath, spec), kind: "imports", confidence: "EXTRACTED" });
      return;
    }
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (fn && fn.type === "import") {
        // dynamic import("...") — only a LITERAL string argument resolves to a target; a
        // variable/expression argument is skipped (nothing to point at, not a guess).
        const args = node.childForFieldName("arguments");
        const first = args && args.namedChildCount > 0 ? args.namedChild(0) : null;
        if (first && first.type === "string") {
          const spec = strFragmentOf(first);
          if (spec != null) {
            edges.push({ source: FILE_ID(filePath), target: importTargetId(filePath, spec), kind: "imports", confidence: "INFERRED" });
          }
        }
        return;
      }
      if (fn && fn.type === "identifier" && fn.text === "require") {
        const args = node.childForFieldName("arguments");
        const first = args && args.namedChildCount > 0 ? args.namedChild(0) : null;
        if (first && first.type === "string") {
          const spec = strFragmentOf(first);
          if (spec != null) {
            edges.push({ source: FILE_ID(filePath), target: importTargetId(filePath, spec), kind: "imports", confidence: "EXTRACTED" });
          }
        }
      }
      return;
    }
  });

  // ---- Pass B: resolve bare-identifier calls against Pass A's callableByName map --------
  const callerStack = [FILE_ID(filePath)];
  const seenCallEdges = new Set(); // dedupe (caller->callee) pairs; a loop calling the same fn N times is still ONE edge
  function currentCaller() { return callerStack[callerStack.length - 1]; }

  function walkB(node) {
    let pushed = false;
    if (node.type === "function_declaration") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) { callerStack.push(FUNCTION_ID(filePath, nameNode.text)); pushed = true; }
    } else if (node.type === "variable_declarator") {
      const nameNode = node.childForFieldName("name");
      const valueNode = node.childForFieldName("value");
      if (nameNode && nameNode.type === "identifier" && valueNode &&
          (valueNode.type === "arrow_function" || valueNode.type === "function_expression")) {
        callerStack.push(FUNCTION_ID(filePath, nameNode.text)); pushed = true;
      }
    } else if (node.type === "method_definition") {
      // Walk up to find the enclosing class name — method_definition's parent is class_body, whose parent is class_declaration.
      const classBody = node.parent;
      const classDecl = classBody && classBody.parent;
      const className = classDecl && classDecl.type === "class_declaration" ? classDecl.childForFieldName("name")?.text : null;
      const mName = node.childForFieldName("name");
      if (className && mName) { callerStack.push(FUNCTION_ID(filePath, `${className}.${mName.text}`)); pushed = true; }
    } else if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (fn && fn.type === "identifier" && callableByName.has(fn.text)) {
        const targetId = callableByName.get(fn.text);
        const callerId = currentCaller();
        // Dedupe by (caller, target) pair — a loop calling the same function N times is still
        // ONE edge. Direct recursion (callerId === targetId) is a real, valid edge and is NOT
        // special-cased away; the pair-key naturally collapses repeats of it too.
        const key = callerId + "->" + targetId;
        if (!seenCallEdges.has(key)) {
          seenCallEdges.add(key);
          edges.push({ source: callerId, target: targetId, kind: "calls", confidence: "EXTRACTED" });
        }
      }
      // member-expression calls (obj.foo()) are NEVER resolved — see module header.
    }
    for (let i = 0; i < node.namedChildCount; i++) walkB(node.namedChild(i));
    if (pushed) callerStack.pop();
  }
  walkB(root);

  return { nodes, edges };
}

/** A relative specifier ("./x", "../y") becomes a file: id relative to this file's own dir — a
 *  bare specifier ("lodash", "@scope/pkg") becomes an external module: id, verbatim (no node is
 *  ever emitted FOR it; see docs/work/exocortex/code-graph-schema.md — an edge may point at an id
 *  with no corresponding node in this batch). Extension/index resolution is deliberately NOT
 *  attempted (3.5's impacted-set computation works at file-identity granularity, not full Node
 *  module resolution semantics) — a relative specifier keeps whatever extension (or lack of one)
 *  it was written with. */
function importTargetId(filePath, spec) {
  if (spec.startsWith(".")) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filePath.replace(/\\/g, "/")), spec));
    return FILE_ID(resolved);
  }
  return `module:${spec}`;
}
