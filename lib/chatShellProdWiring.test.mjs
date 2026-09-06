// node --test lib/chatShellProdWiring.test.mjs
//
// chat-shell.js (dashboard/public/chat-shell.js) was written to be loaded by BOTH the prototyping
// lab AND production (see its own header comment), but for the whole time it existed, only the lab
// ever loaded it — dashboard/public/index.html had no reference to it at all, so `window.ChatShell`
// never existed in the real app. This asserts the load order in the one real entry point, so that
// gap cannot silently reopen: chat-shell.js must be present and must load BEFORE app.js, since app.js
// code (reply/quote, manual wrap) calls window.ChatShell at the moment those features run.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, "..", "dashboard", "public", "index.html"), "utf8");

test("chat-shell.js is loaded by the real production page", () => {
  assert.match(html, /<script src="\/chat-shell\.js"><\/script>/,
    "index.html must load chat-shell.js as a classic script, same path the lab already uses");
});

test("chat-shell.js loads BEFORE app.js, so window.ChatShell exists when app.js runs", () => {
  const shellIdx = html.indexOf('<script src="/chat-shell.js">');
  const appIdx = html.indexOf('<script src="/app.js">');
  assert.ok(shellIdx >= 0, "chat-shell.js script tag must exist");
  assert.ok(appIdx >= 0, "app.js script tag must exist");
  assert.ok(shellIdx < appIdx, "chat-shell.js must appear before app.js in document order");
});
