// exocortex.gen.mjs — regenerate dashboard/public/exocortex.js from the pure lib/ modules.
//
//   node dashboard/public/exocortex.gen.mjs
//
// WHY THIS EXISTS. dashboard/public/app.js is a CLASSIC script (no bundler, no build step, see
// index.html) so it cannot `import` from lib/. The repo already has two answers to that:
//
//   1. small helpers written directly in app.js between SENTINEL comments, sliced+eval'd by a
//      co-located lib/*.test.mjs (coldLoadStatus, pactPrintRows, pactTabsDisplayOrder…);
//   2. a self-contained helper LIBRARY as its own classic script hanging off `window.*`, loaded
//      before app.js and eval'd in Node with a fake window for tests
//      (md-mini.js / pact-highlight.js / deploy-helpers.js + lib/deployHelpers.test.mjs).
//
// The Phase-2 exocortex helpers are ~2600 lines of ALREADY-TESTED ESM owned by another agent, so
// (1) would mean hand-copying them and guaranteeing drift. This takes pattern (2) and removes the
// copy problem: the browser file is GENERATED from the lib/ sources, and lib/exocortexBundle.test.mjs
// regenerates in memory and fails the suite if the committed file is stale. There is exactly one
// source of truth (lib/), and no build step at runtime.
//
// The transform is deliberately dumb (strip `import`, strip the `export ` keyword, wrap each module
// in an IIFE that returns its exports) so it cannot silently change behaviour. It supports exactly
// the ESM subset these modules use; anything else throws rather than emitting something subtly wrong.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dir, "..", "..", "lib");

/** module file → the `EXO.<ns>` namespace it is published under. Order is DEPENDENCY order. */
export const MODULES = [
  { file: "contextUsage.mjs", ns: "usage" },
  { file: "contextPopover.mjs", ns: "popover" },
  { file: "thresholdIndicator.mjs", ns: "ind" },
  { file: "transcriptWindow.mjs", ns: "win" },
  { file: "scrollCache.mjs", ns: "cache" },
  { file: "agentsPanel.mjs", ns: "agents" },
  { file: "recallCue.mjs", ns: "recall" },
];

const NS_OF_FILE = new Map(MODULES.map((m) => [m.file, m.ns]));

/**
 * Transform one ESM module body into an IIFE body + its export map.
 * Returns { body, exports: Map<exportedName, localName>, imports: [{ from, names: [{local, imported}] }] }.
 */
export function transformModule(file, src) {
  const lines = src.split("\n");
  const out = [];
  const exports = new Map();
  const imports = [];

  for (const line of lines) {
    // import { a, b as c } from './x.mjs';
    const imp = /^import\s*\{([^}]*)\}\s*from\s*['"]\.\/([A-Za-z0-9_.]+)['"];?\s*$/.exec(line);
    if (imp) {
      const names = imp[1].split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
        const m = /^(\S+)\s+as\s+(\S+)$/.exec(s);
        return m ? { imported: m[1], local: m[2] } : { imported: s, local: s };
      });
      imports.push({ from: imp[2], names });
      out.push("");
      continue;
    }
    if (/^import\b/.test(line)) throw new Error(`${file}: unsupported import form: ${line}`);

    // export { a as b, c };
    const reexp = /^export\s*\{([^}]*)\};?\s*$/.exec(line);
    if (reexp) {
      for (const part of reexp[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        const m = /^(\S+)\s+as\s+(\S+)$/.exec(part);
        if (m) exports.set(m[2], m[1]);
        else exports.set(part, part);
      }
      out.push("");
      continue;
    }

    // export function f(…) / export const X = / export class C
    const decl = /^export\s+(async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (decl) {
      exports.set(decl[2], decl[2]);
      out.push(line.replace(/^export\s+/, ""));
      continue;
    }
    if (/^export\b/.test(line)) throw new Error(`${file}: unsupported export form: ${line}`);
    out.push(line);
  }

  return { body: out.join("\n"), exports, imports };
}

/** Build the whole browser bundle source. Pure w.r.t. the sources it is handed. */
export function buildBundle(sources) {
  const chunks = [];
  chunks.push("// GENERATED FILE — DO NOT EDIT BY HAND.");
  chunks.push("// Source of truth: lib/{" + MODULES.map((m) => m.file.replace(/\.mjs$/, "")).join(",") + "}.mjs");
  chunks.push("// Regenerate:  node dashboard/public/exocortex.gen.mjs");
  chunks.push("// Drift guard: lib/exocortexBundle.test.mjs re-runs the generator and fails if this file is stale.");
  chunks.push("//");
  chunks.push("// A classic script (same stance as md-mini.js / deploy-helpers.js) that publishes the Phase-2");
  chunks.push("// exocortex helpers as `window.EXO.<ns>` for dashboard/public/app.js, which cannot import ESM.");
  chunks.push('(function (root) {');
  chunks.push('  "use strict";');
  chunks.push("  var __m = {};");

  for (const mod of MODULES) {
    const src = sources[mod.file];
    if (typeof src !== "string") throw new Error(`missing source for ${mod.file}`);
    const { body, exports, imports } = transformModule(mod.file, src);

    const injected = [];
    const passed = [];
    for (const im of imports) {
      const ns = NS_OF_FILE.get(im.from);
      if (!ns) throw new Error(`${mod.file}: imports unknown module ${im.from}`);
      for (const n of im.names) {
        injected.push(`  var ${n.local} = __imp.${n.local};`);
        passed.push(`${n.local}: __m.${ns}.${n.imported}`);
      }
    }

    const ret = [...exports.entries()].map(([name, local]) => `${name}: ${local}`).join(", ");
    chunks.push("");
    chunks.push(`  // ---- lib/${mod.file} → EXO.${mod.ns} ----------------------------------------------`);
    chunks.push(`  __m.${mod.ns} = (function (__imp) {`);
    if (injected.length) chunks.push(injected.join("\n"));
    chunks.push(body.replace(/[ \t]+$/gm, ""));
    chunks.push(`    return { ${ret} };`);
    chunks.push(`  })({ ${passed.join(", ")} });`);
  }

  chunks.push("");
  chunks.push("  root.EXO = __m;");
  chunks.push('})(typeof window !== "undefined" ? window : this);');
  chunks.push("");
  return chunks.join("\n");
}

/** Read every source module off disk (used by both the CLI and the drift test). */
export function readSources(libDir = LIB) {
  const out = {};
  for (const m of MODULES) out[m.file] = readFileSync(join(libDir, m.file), "utf8");
  return out;
}

export const OUT_FILE = join(__dir, "exocortex.js");

if (process.argv[1] && process.argv[1].endsWith("exocortex.gen.mjs")) {
  writeFileSync(OUT_FILE, buildBundle(readSources()), "utf8");
  process.stdout.write(`wrote ${OUT_FILE}\n`);
}
