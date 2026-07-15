// node --test lib/tokenScan.test.mjs — mocked GitHub API (no network).
import test from "node:test";
import assert from "node:assert/strict";
import { parseOriginUrl, scanSecrets, tokenIdentity } from "./tokenScan.mjs";

test("parseOriginUrl handles https and ssh remotes", () => {
  assert.deepEqual(parseOriginUrl("https://github.com/StoaChain/stoa-js.git"), { owner: "StoaChain", repo: "stoa-js" });
  assert.deepEqual(parseOriginUrl("git@github.com:AncientPantheon/Codex.git"), { owner: "AncientPantheon", repo: "Codex" });
  assert.deepEqual(parseOriginUrl("https://github.com/o/nested/repo"), { owner: "o", repo: "nested/repo" });
  assert.equal(parseOriginUrl("https://gitlab.com/x/y"), null);
  assert.equal(parseOriginUrl(""), null);
});

// A fake GitHub that returns canned secret lists + a scopes header.
function fakeGitHub(routes) {
  return async (url) => {
    const path = url.replace("https://api.github.com", "").split("?")[0];
    const r = routes[path];
    const headers = new Map([["x-oauth-scopes", "repo, workflow"]]);
    if (!r) return { ok: false, status: 404, headers: { get: (k) => headers.get(k) }, json: async () => ({ message: "Not Found" }) };
    return { ok: r.status < 400, status: r.status, headers: { get: (k) => headers.get(k) }, json: async () => r.body };
  };
}

test("scanSecrets returns names + dates and never a value; rolls up by name", async () => {
  const fetchImpl = fakeGitHub({
    "/repos/StoaChain/stoa-js/actions/secrets": { status: 200, body: { secrets: [
      { name: "NPMPUSHER", updated_at: "2026-07-15T00:00:00Z" },
      { name: "RELEASE_TOKEN", updated_at: "2026-05-01T00:00:00Z" },
    ] } },
    "/repos/StoaChain/DALOS_Crypto/actions/secrets": { status: 200, body: { secrets: [
      { name: "NPMPUSHER", updated_at: "2026-06-01T00:00:00Z" },
    ] } },
    "/orgs/AncientPantheon/actions/secrets": { status: 200, body: { secrets: [
      { name: "NPM_TOKEN", updated_at: "2026-07-14T00:00:00Z" },
    ] } },
  });
  const targets = [
    { label: "StoaChain/stoa-js", owner: "StoaChain", repo: "stoa-js" },
    { label: "StoaChain/DALOS_Crypto", owner: "StoaChain", repo: "DALOS_Crypto" },
    { label: "AncientPantheon (org)", owner: "AncientPantheon" },
  ];
  const out = await scanSecrets(targets, "tok", { fetchImpl });

  assert.equal(out.counts.targetsScanned, 3);
  assert.equal(out.counts.reachable, 3);
  assert.equal(out.counts.distinctSecrets, 3);

  // no field named "value" anywhere — the API never returns it, and neither do we.
  assert.equal(JSON.stringify(out).includes('"value"'), false);

  const npmpusher = out.secretsByName.find((s) => s.name === "NPMPUSHER");
  assert.equal(npmpusher.locations.length, 2);               // in both repos
  assert.equal(npmpusher.newest, "2026-07-15T00:00:00Z");    // newest of the two
});

test("a 403 org (token lacks admin:org) is reported, not fatal", async () => {
  const fetchImpl = fakeGitHub({
    "/repos/o/pub/actions/secrets": { status: 200, body: { secrets: [{ name: "A", updated_at: "2026-01-01T00:00:00Z" }] } },
    "/orgs/o/actions/secrets": { status: 403, body: { message: "Forbidden" } },
  });
  const out = await scanSecrets(
    [{ label: "o/pub", owner: "o", repo: "pub" }, { label: "o (org)", owner: "o" }],
    "tok", { fetchImpl },
  );
  assert.equal(out.counts.reachable, 1);
  const org = out.targets.find((t) => !t.repo);
  assert.equal(org.reachable, false);
  assert.match(org.reason, /no access/);
});

test("tokenIdentity reports login + scopes on success, rejects a bad token", async () => {
  const good = fakeGitHub({ "/user": { status: 200, body: { login: "AncientHodler-Demiurg" } } });
  const id = await tokenIdentity("tok", good);
  assert.equal(id.ok, true);
  assert.equal(id.login, "AncientHodler-Demiurg");
  assert.deepEqual(id.scopes, ["repo", "workflow"]);

  const bad = async () => ({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) });
  assert.equal((await tokenIdentity("bad", bad)).ok, false);
});
