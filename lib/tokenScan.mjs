// Live token/secret reconnaissance via the GitHub API.
//
// What the user asked: "how can a button scan repositories — does GitHub offer an API?"
// Yes — for GitHub Actions SECRETS. The API lists a repo's or org's secret NAMES and
// their last-updated dates; the VALUES are write-only and never returned (so this can
// never leak a secret). It CANNOT enumerate a user's Personal Access Tokens — GitHub
// has no such API — so the scan covers "which repos/orgs hold which secrets, and when
// they last changed", which is exactly what you need to see the token landscape.
//
// The auth token is read server-side and never sent to the browser; only names + dates
// cross the wire.

const GH = "https://api.github.com";

/** owner/repo from a git origin URL (https or ssh). */
export function parseOriginUrl(url) {
  if (!url) return null;
  const m = url.trim().replace(/\.git$/, "").match(/github\.com[:/]+([^/]+)\/(.+)$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function ghJson(path, token, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${GH}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    });
  } catch (e) {
    // A transient network error on ONE target must not abort the whole sweep.
    return { status: 0, ok: false, body: null, scopes: null, netError: e.cause?.code || e.message };
  }
  const scopes = res.headers.get("x-oauth-scopes");
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, body, scopes };
}

/** Validate the token and report its login + scopes (never the value). */
export async function tokenIdentity(token, fetchImpl = fetch) {
  const r = await ghJson("/user", token, fetchImpl);
  if (!r.ok) return { ok: false, status: r.status, message: r.status === 401 ? "token rejected (401)" : `GitHub returned ${r.status}` };
  return { ok: true, login: r.body?.login || null, scopes: (r.scopes || "").split(",").map((s) => s.trim()).filter(Boolean) };
}

async function secretsFor(kind, id, token, fetchImpl) {
  // kind: "repos/<owner>/<repo>" or "orgs/<org>"
  const r = await ghJson(`/${kind}/actions/secrets?per_page=100`, token, fetchImpl);
  if (r.netError) return { reachable: false, reason: `network error (${r.netError})`, secrets: [] };
  if (r.status === 404) return { reachable: false, reason: "not found", secrets: [] };
  if (r.status === 403) return { reachable: false, reason: "no access (token lacks the scope)", secrets: [] };
  if (!r.ok) return { reachable: false, reason: `HTTP ${r.status}`, secrets: [] };
  return { reachable: true, secrets: (r.body?.secrets || []).map((s) => ({ name: s.name, updated: s.updated_at })) };
}

/**
 * Scan the given repos + their orgs for Actions secrets.
 * @param targets [{ label, owner, repo }]  (repo omitted ⇒ an org target)
 * Runs with bounded concurrency so a big suite doesn't open 60 sockets at once.
 */
export async function scanSecrets(targets, token, { fetchImpl = fetch, concurrency = 6 } = {}) {
  const results = new Array(targets.length);
  let i = 0;
  async function worker() {
    while (i < targets.length) {
      const idx = i++;
      const t = targets[idx];
      const kind = t.repo ? `repos/${t.owner}/${t.repo}` : `orgs/${t.owner}`;
      const s = await secretsFor(kind, `${t.owner}/${t.repo || ""}`, token, fetchImpl);
      results[idx] = { ...t, ...s };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length || 1) }, worker));

  // Roll up: which secret names appear where, and the newest update per name.
  const byName = {};
  for (const r of results) {
    for (const s of r.secrets) {
      const e = (byName[s.name] ||= { name: s.name, locations: [], newest: "" });
      e.locations.push({ where: r.label, updated: s.updated });
      if ((s.updated || "") > e.newest) e.newest = s.updated || "";
    }
  }
  return {
    targets: results,
    secretsByName: Object.values(byName).sort((a, b) => a.name.localeCompare(b.name)),
    counts: {
      targetsScanned: results.length,
      reachable: results.filter((r) => r.reachable).length,
      distinctSecrets: Object.keys(byName).length,
    },
  };
}
