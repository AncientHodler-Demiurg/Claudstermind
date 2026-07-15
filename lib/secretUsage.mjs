// "Is this secret actually used?" — the answer to token/secret sprawl.
//
// A GitHub Actions secret is USED only if some workflow references `secrets.NAME`.
// A secret nothing references is dead weight you can delete. We can't ask GitHub this
// (its API lists secrets, not who reads them), but the workflow files are right here on
// disk — so we grep them. Repo secrets are checked against that repo's workflows; org
// secrets against every repo in the org (any repo can read an inherited org secret).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Every `secrets.NAME` referenced in a repo's workflow files → { NAME: [files] }. */
export function workflowSecretRefs(repoAbs) {
  const dir = join(repoAbs, ".github", "workflows");
  const out = {};
  if (!existsSync(dir)) return out;
  let files = [];
  try { files = readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)); } catch { return out; }
  for (const f of files) {
    let content = "";
    try { content = readFileSync(join(dir, f), "utf8"); } catch { continue; }
    for (const m of content.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      (out[m[1]] ||= new Set()).add(f);
    }
  }
  // Sets → arrays for JSON.
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

/**
 * Build the usage index across all scanned repos.
 * @param repos [{ owner, repo, abs }]
 * @returns { byRepo: {"owner/repo": {NAME:[files]}}, byOrg: {org: Set(names)} }
 */
export function buildUsageIndex(repos) {
  const byRepo = {};
  const byOrg = {};
  for (const r of repos) {
    const refs = workflowSecretRefs(r.abs);
    byRepo[`${r.owner}/${r.repo}`] = refs;
    (byOrg[r.owner] ||= new Set());
    for (const name of Object.keys(refs)) byOrg[r.owner].add(name);
  }
  return { byRepo, byOrg };
}

/**
 * Is a secret used? For a repo secret, does that repo's workflows reference it? For an
 * org secret, does any repo in the org? Returns { used, usedBy } — usedBy names the
 * workflow files (repo scope) or the count of repos (org scope) for the UI.
 */
export function secretUsage(index, scope, target, name) {
  if (scope === "repo") {
    const files = index.byRepo[target]?.[name] || [];
    return { used: files.length > 0, usedBy: files };
  }
  // org: target is the org name; count repos in it that reference the name.
  const repos = Object.entries(index.byRepo)
    .filter(([k, refs]) => k.startsWith(`${target}/`) && refs[name])
    .map(([k]) => k);
  return { used: repos.length > 0, usedBy: repos };
}
