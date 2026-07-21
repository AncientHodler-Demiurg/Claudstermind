// Semver bump + changelog entry — the §10 release primitives, kept pure so they're testable.
export function nextVersion(cur, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(cur || "").trim());
  if (!m) throw new Error(`not a semver: ${cur}`);
  let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (kind === "major") return `${a + 1}.0.0`;
  if (kind === "minor") return `${a}.${b + 1}.0`;
  if (kind === "patch") return `${a}.${b}.${c + 1}`;
  throw new Error(`unknown bump: ${kind}`);
}

/** A new CHANGELOG top entry (inserted right after the file's intro, before the newest version). */
export function changelogEntry(version, dateStr, summary) {
  const body = String(summary || "").trim() || "_No summary._";
  return `## [${version}] - ${dateStr}\n\n${body}\n\n`;
}

/** Insert a new entry above the first existing `## [` heading (or append if none). */
export function insertChangelog(md, entry) {
  const idx = md.search(/^##\s*\[/m);
  if (idx === -1) return md.replace(/\s*$/, "\n\n") + entry;
  return md.slice(0, idx) + entry + md.slice(idx);
}
