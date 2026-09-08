// node --test lib/pactMobileSend.test.mjs
//
// WHY THIS EXISTS. Reported from a phone with a screenshot: "This view couldn't load — pres is not
// defined". Pact's mobile chat was dead on arrival — the FIRST paint threw, before a single message
// rendered, and the view's error boundary swallowed the whole tab.
//
// The cause was scope, not logic. `pactChatPaint` computes the shared Send/Stop presentation once
// (ChatShell.sendPresentation) and TWO branches read it: the desktop one, which pushes it into the
// package via setState, and the mobile one, which applies it to mobile's own buttons by hand. The
// declaration sat INSIDE the desktop branch — `const` is block-scoped, so the mobile branch's read
// was a ReferenceError every time. Desktop never noticed: `.pc-compose` exists only on mobile, so
// the branch that reads it never runs there.
//
// Nothing caught it. The wiring test asserted that the STRING `send.textContent = pres.sendLabel;`
// appears in app.js — presence, not reachability — and no test has ever loaded the app at a mobile
// viewport. So this file checks the one thing that was actually wrong: that a value read from two
// sibling branches is DECLARED where both can see it. It is a scope-shape check over the function's
// own source (app.js is a ~15k-line browser monolith that cannot be imported — it boots the DOM),
// which is the same technique as lib/appScopeLeaks.test.mjs and for the same reason.
//
// The behaviour itself was verified by loading the real thing: Chromium at 412x915 with
// `Emulation.setDeviceMetricsOverride {mobile:true}` against the live dashboard, navigating to
// #workspace/pact. Before the fix the console read `ReferenceError: pres is not defined at
// pactChatPaint`; after it, the transcript rendered with an empty console.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

/** Comments and string/template/regex literals blanked out, positions preserved. A name inside a
 *  comment ("the SAME decision (`pres`, computed above)") is prose, not a read — and flagging it is
 *  how a guard like this gets muted, which is worse than not having it (see appScopeLeaks). Regex
 *  literals are recognised too, because app.js is full of patterns like /['"]/ and mistaking one for
 *  a quote desynchronises everything after it — a stripper that loses sync fails OPEN, which is the
 *  dangerous direction, so `assertVisible` below re-checks that real code survived the strip. */
function stripLiterals(s) {
  let out = "", i = 0, prev = "";
  const n = s.length;
  const regexOk = () => !prev || "(,=:[!&|?{};+-*%~^<>".includes(prev) || /\breturn$|\btypeof$/.test(out.trimEnd().slice(-10));
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === "/" && d === "/") { while (i < n && s[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && d === "*") { const e = s.indexOf("*/", i + 2), end = e < 0 ? n : e + 2;
      for (let k = i; k < end; k++) out += s[k] === "\n" ? "\n" : " "; i = end; continue; }
    if (c === '"' || c === "'" || c === "`") { const q = c; out += " "; i++;
      while (i < n) { if (s[i] === "\\") { out += "  "; i += 2; continue; }
        if (s[i] === q) { out += " "; i++; break; } out += s[i] === "\n" ? "\n" : " "; i++; } continue; }
    if (c === "/" && regexOk()) {   // a regex literal, not division
      let j = i + 1, cls = false, ok = false;
      for (; j < n && s[j] !== "\n"; j++) {
        if (s[j] === "\\") { j++; continue; }
        if (s[j] === "[") cls = true;
        else if (s[j] === "]") cls = false;
        else if (s[j] === "/" && !cls) { ok = true; break; }
      }
      if (ok) { for (let k = i; k <= j; k++) out += " "; i = j + 1; prev = "/"; continue; }
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}
const app = raw;
const code = stripLiterals(raw);
// Fail LOUDLY if the stripper lost sync: these three are plain code and must survive it.
for (const must of ["function pactChatPaint(", "function paintPane(", "sendPresentation("])
  assert.ok(code.includes(must), `the literal stripper ate real code (${must} vanished) — the scope checks below would pass vacuously`);

// The source of ONE top-level function, by brace matching from its `function name(` header.
function functionSource(src, name) {
  // Matched with its own indentation allowed: paintPane is nested inside the Core view's closure,
  // pactChatPaint is top level, and both are equally in scope for this check.
  const at = src.search(new RegExp(`\\n\\s*function ${name}\\(`));
  assert.notEqual(at, -1, `${name} must exist`);
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** Every read of `name` inside `src` must sit inside the block that declares it. Brace depth is
 *  counted from the declaration: a read that appears once the depth has gone negative is outside
 *  the declaring block — which at runtime is a ReferenceError, not a style opinion. */
function readsOutsideDeclaringBlock(src, name) {
  const decl = new RegExp(`(?:const|let)\\s+${name}\\s*=`).exec(src);
  assert.ok(decl, `${name} must be declared in this function`);
  const from = decl.index;
  let depth = 0, end = src.length;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { if (depth === 0) { end = i; break; } depth--; }
  }
  const use = new RegExp(`(?<![.\\w$])${name}\\s*[.,)\\]}]`, "g");
  const out = [];
  let m;
  while ((m = use.exec(src))) {
    if (m.index >= from && m.index <= end) continue;
    out.push(src.slice(0, m.index).split("\n").length);   // line, relative to the function
  }
  return out;
}

test("Pact: the shared Send presentation is declared where BOTH the desktop and mobile branches can read it", () => {
  const fn = functionSource(code, "pactChatPaint");
  assert.match(fn, /const pres = window\.ChatShell\.sendPresentation\(/,
    "one decision, shared with Core — not a second chain of ternaries");
  assert.deepEqual(readsOutsideDeclaringBlock(fn, "pres"), [],
    "a read outside the declaring block is a ReferenceError on the branch that runs it — this is exactly how Pact mobile died");
});

test("Pact: both branches really do read it — the mobile one is the branch that has no package to setState", () => {
  const fn = functionSource(app, "pactChatPaint");
  assert.match(fn, /pv\.setState\(\{ sending: \{ \.\.\.pres, sendDisabled: false \} \}\)/, "desktop hands it to the package");
  assert.match(fn, /send\.textContent = pres\.sendLabel;/, "mobile applies the SAME decision by hand");
  assert.match(fn, /stop\.textContent = pres\.stopLabel;/, "…including Stop, which is where the two had drifted before");
});

test("Core: the same value in the same shape stays in scope too", () => {
  // Core was never broken here, and this is what keeps it that way: it reads `_pres` from several
  // places in one long function, and any one of them moving into a branch is the same bug.
  const fn = functionSource(code, "paintPane");
  assert.deepEqual(readsOutsideDeclaringBlock(fn, "_pres"), [],
    "Core's send/stop presentation must stay readable from every branch that paints a button");
});
