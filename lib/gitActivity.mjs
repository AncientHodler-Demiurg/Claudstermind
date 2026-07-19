// Daily work activity, straight from git history — the authoritative "how much work,
// where" source. For each tracked repo it reads `git log --numstat` over a window and
// aggregates commits + line churn (insertions+deletions) per day. This feeds the
// Activity tab's heatmap (repo × day intensity) and per-day cards.
//
// Public vs admin: `stripMessages` drops commit subjects so the PUBLIC showcase can
// show volume/counts/where without leaking private-repo commit text.
import { spawnSync } from "node:child_process";
import { resolveRepo } from "./gitActions.mjs";

const COMMIT = "__C__";

/** Parse one repo's `git log --numstat` window into commits with date + hour + churn.
 *  Header format is `__C__%aI|%h|%s` — %aI is strict ISO 8601 in the author's own
 *  timezone, so the hour reflects when they actually worked (night owl or not). */
export function parseGitLog(out) {
  const commits = [];
  let cur = null;
  for (const line of (out || "").split(/\r?\n/)) {
    if (line.startsWith(COMMIT)) {
      const rest = line.slice(COMMIT.length);
      const parts = rest.split("|");
      const iso = parts[0] || "";
      const date = iso.slice(0, 10);
      const hr = parseInt(iso.slice(11, 13), 10);
      const hour = Number.isFinite(hr) ? hr : 0;
      const hash = parts[1] || "";
      const subject = parts.slice(2).join("|");
      cur = { date, hour, hash, subject, churn: 0, insertions: 0, deletions: 0 };
      commits.push(cur);
    } else if (cur) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t/);   // numstat: ins \t del \t path  (binary → "-")
      if (m) {
        const ins = m[1] === "-" ? 0 : parseInt(m[1], 10);
        const del = m[2] === "-" ? 0 : parseInt(m[2], 10);
        cur.insertions += ins; cur.deletions += del; cur.churn += ins + del;
      }
    }
  }
  return commits;
}

function logForRepo(abs, sinceDays) {
  const r = spawnSync("git", ["-C", abs, "log", `--since=${sinceDays} days ago`,
    `--pretty=tformat:${COMMIT}%aI|%h|%s`, "--numstat", "--no-merges"],
    { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 20000 });
  if (r.status !== 0) return [];
  return parseGitLog(r.stdout || "");
}

/** Roll a repo's commits up into per-day { commits, churn } + a total. */
function rollup(commits) {
  const byDay = {};
  let commitsN = 0, churn = 0;
  for (const c of commits) {
    commitsN++; churn += c.churn;
    const d = (byDay[c.date] = byDay[c.date] || { commits: 0, churn: 0 });
    d.commits++; d.churn += c.churn;
  }
  return { byDay, total: { commits: commitsN, churn } };
}

/**
 * @param {Array} repos   map.json repos ({ name, localPath, org })
 * @param {string} root   workspace root
 * @param {{sinceDays?:number, stripMessages?:boolean}} opts
 */
export function repoCommitActivity(repos, root, opts = {}) {
  const sinceDays = opts.sinceDays || 30;
  const stripMessages = !!opts.stripMessages;
  const outRepos = [];
  const dayTotals = {};   // date -> { commits, churn, repos: Set }
  const dayHours = {};    // date -> [24] commit counts by hour-of-day (all repos)
  for (const r of repos || []) {
    const abs = resolveRepo(r.localPath, root);
    if (!abs) continue;
    const commits = logForRepo(abs, sinceDays);
    if (!commits.length) continue;                       // only repos with activity in the window
    const { byDay, total } = rollup(commits);
    const org = r.org?.target || r.org?.current || (r.localPath || "").split(/[\\/]/)[0] || "other";
    outRepos.push({
      name: r.name || (r.localPath || "").split(/[\\/]/).pop(),
      localPath: r.localPath, org,
      total, byDay,
      commits: stripMessages ? undefined : commits.map((c) => ({ date: c.date, hour: c.hour, hash: c.hash, subject: c.subject, churn: c.churn })),
    });
    for (const [date, v] of Object.entries(byDay)) {
      const t = (dayTotals[date] = dayTotals[date] || { commits: 0, churn: 0, repos: new Set() });
      t.commits += v.commits; t.churn += v.churn; t.repos.add(r.name || r.localPath);
    }
    for (const c of commits) {
      const h = (dayHours[c.date] = dayHours[c.date] || new Array(24).fill(0));
      h[c.hour] = (h[c.hour] || 0) + 1;
    }
  }
  const days = Object.keys(dayTotals).sort();
  const totals = { commits: 0, churn: 0, byDay: {} };
  for (const [date, t] of Object.entries(dayTotals)) {
    totals.commits += t.commits; totals.churn += t.churn;
    totals.byDay[date] = { commits: t.commits, churn: t.churn, repos: t.repos.size };
  }
  outRepos.sort((a, b) => b.total.commits - a.total.commits || b.total.churn - a.total.churn);
  return { sinceDays, days, repos: outRepos, totals, dayHours };
}
