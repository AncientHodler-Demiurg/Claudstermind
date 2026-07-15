// node --test lib/tokenRegistry.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expiryStatus, enrich, groupTokens, tokenTotals, isSafeSecretFile, saveSecret } from "./tokenRegistry.mjs";

const TODAY = "2026-07-15";

test("expiryStatus classifies none / active / expiring / expired", () => {
  assert.deepEqual(expiryStatus(null, TODAY), { status: "none", daysLeft: null });
  assert.equal(expiryStatus("2027-01-01", TODAY).status, "active");
  assert.equal(expiryStatus("2026-08-10", TODAY).status, "expiring");   // 26 days
  assert.equal(expiryStatus("2026-08-23", TODAY).status, "active");     // 39 days — outside the 30-day window
  assert.equal(expiryStatus("2026-07-01", TODAY).status, "expired");
  assert.equal(expiryStatus("2026-08-10", TODAY).daysLeft, 26);
});

test("30-day boundary: 30 days out is 'expiring', 31 is 'active'", () => {
  assert.equal(expiryStatus("2026-08-14", TODAY).status, "expiring"); // 30 days
  assert.equal(expiryStatus("2026-08-15", TODAY).status, "active");   // 31 days
});

test("enrich adds store presence without reading values", () => {
  const dir = mkdtempSync(join(tmpdir(), "sec-"));
  writeFileSync(join(dir, "pat.txt"), "SECRET-VALUE");
  const tokens = [
    { id: "a", secretFile: "pat.txt", expires: null },
    { id: "b", secretFile: "missing.txt", expires: "2026-07-01" },
    { id: "c" },   // no file
  ];
  const e = enrich(tokens, dir, TODAY);
  assert.equal(e[0].stored, true);
  assert.equal(e[1].stored, false);
  assert.equal(e[2].stored, null);
  assert.equal(e[1].status, "expired");
  // the value never appears in the enriched output
  assert.equal(JSON.stringify(e).includes("SECRET-VALUE"), false);
  rmSync(dir, { recursive: true, force: true });
});

test("groupTokens buckets by entity × scope in a stable order", () => {
  const tokens = [
    { id: "gh-acct", entity: "github", scope: "account", label: "z" },
    { id: "gh-acct2", entity: "github", scope: "account", label: "a" },
    { id: "npm-acct", entity: "npm", scope: "account", label: "n" },
    { id: "gh-repo", entity: "github", scope: "repo", target: "o/r" },
  ];
  const g = groupTokens(tokens);
  assert.deepEqual(g.github.account.map((t) => t.id), ["gh-acct2", "gh-acct"]); // sorted by label
  assert.equal(g.npm.account.length, 1);
  assert.equal(g.github.repo.length, 1);
  assert.equal(g.npm.repo.length, 0);
});

test("tokenTotals counts by status + store presence", () => {
  const tokens = enrich([
    { id: "a", secretFile: "x.txt", expires: null },
    { id: "b", secretFile: "y.txt", expires: "2026-07-01" },
  ], mkdtempSync(join(tmpdir(), "empty-")), TODAY);
  const t = tokenTotals(tokens);
  assert.equal(t.total, 2);
  assert.equal(t.expired, 1);
  assert.equal(t.missing, 2);   // neither file exists
});

test("isSafeSecretFile rejects traversal and non-txt", () => {
  assert.equal(isSafeSecretFile("pat.txt"), true);
  assert.equal(isSafeSecretFile("github-x_y.txt"), true);
  assert.equal(isSafeSecretFile("../pat.txt"), false);
  assert.equal(isSafeSecretFile("a/b.txt"), false);
  assert.equal(isSafeSecretFile("pat.exe"), false);
  assert.equal(isSafeSecretFile(""), false);
});

test("saveSecret only writes files declared in the registry, and stores the value", () => {
  const root = mkdtempSync(join(tmpdir(), "tok-"));
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  const dataDir = join(root, "data"); mkdirSync(dataDir);
  writeFileSync(join(dataDir, "tokens.json"), JSON.stringify({ tokens: [{ id: "a", secretFile: "npm-token.txt" }] }));

  // undeclared file → refused
  assert.equal(saveSecret(secretsDir, dataDir, "evil.txt", "x").ok, false);
  // traversal → refused
  assert.equal(saveSecret(secretsDir, dataDir, "../evil.txt", "x").ok, false);
  // empty → refused
  assert.equal(saveSecret(secretsDir, dataDir, "npm-token.txt", "  ").ok, false);

  // declared → written
  const r = saveSecret(secretsDir, dataDir, "npm-token.txt", "npm_ABC123");
  assert.equal(r.ok, true);
  assert.ok(existsSync(join(secretsDir, "npm-token.txt")));
  assert.equal(readFileSync(join(secretsDir, "npm-token.txt"), "utf8").trim(), "npm_ABC123");
  rmSync(root, { recursive: true, force: true });
});
