// storage.mjs — Ch.1.1, the ONE place that knows the on-disk NAMING SCHEME for "where does a
// workspace's state live": given a root (`transcriptDir`) and a workspace id, where is that
// workspace's own directory, and where are its well-known subdirectories.
//
// WHY THIS EXISTS. Before this module, `join(root, slugFor(id))` was computed independently in
// at least three places — `lib/workspace.mjs` (5 call sites), `lib/workspaceStore.mjs` (6 call
// sites), `lib/pactIdeState.mjs` (1) — every one of them a raw `path.join` above whatever "the
// interface" was supposed to be. D4 (self-host only, hosted possible later): a future tenant
// boundary would need to change exactly this computation, and today that would mean editing
// three files instead of one. This module doesn't ADD multi-tenancy (D4 says don't) — it just
// makes the single choke point that a tenant boundary would need already exist.
//
// This module is PURE PATH COMPUTATION ONLY — no fs reads/writes, no knowledge of file formats.
// Each store (`lib/conversationArchive.mjs`, `lib/conversationFts.mjs`,
// `lib/knowledgeStore.mjs`, `lib/skillStore.mjs`) still owns reading/writing its OWN files and
// already receives an opaque `baseDir`/`wsDir` from its caller without computing one itself —
// those were already the correct shape and are UNCHANGED by this module. What changes is how
// callers arrive at that `baseDir` in the first place: through `workspaceDir()` here, not a
// hand-rolled `join(root, slugFor(id))`.
//
// ESM, node:path only. Every function is total (no bad-input branch throws) since path
// computation on a string is never something that legitimately fails.

import path from "node:path";

/** `<repoPath>@<worktree>`. The worktree defaults to `main`. */
export function workspaceId(repoPath, worktree = "main") {
  return `${repoPath}@${worktree || "main"}`;
}

/** Inverse of workspaceId. A worktree name never contains `@`, so split on the LAST one; a bare
 *  id (a legacy key, or a repo with no explicit worktree) is treated as the `main` worktree.
 *
 *  THE CONVERSATION SLOT IS NOT PART OF THE WORKTREE NAME. Multi-chat appends `#<n>` to the id
 *  (`Claudstermind@main#1`) to give a side conversation its own identity — and splitting on the
 *  last `@` only (ignoring the slot suffix) used to land the suffix in `worktree`, so a
 *  **worktree called "main#1" appeared in the picker**, selectable, for a checkout that does not
 *  exist. Every consumer here was affected: history rows and summaries for a slot conversation
 *  reported that phantom worktree too. A real worktree name can never contain `#`
 *  (`createWorktree`'s `SAFE_NAME` is letters, digits and `._-`), so a trailing `#<digits>` is
 *  unambiguously the slot. Returned as its own field rather than discarded, because "which
 *  conversation of this worktree" is a real question. */
export function parseWorkspaceId(id) {
  const s = String(id || "");
  const hash = s.lastIndexOf("#");
  const slot = hash > -1 && /^\d+$/.test(s.slice(hash + 1)) ? Number(s.slice(hash + 1)) : 0;
  const base = slot ? s.slice(0, hash) : s;
  const at = base.lastIndexOf("@");
  if (at === -1) return { repo: base, worktree: "main", slot };
  return { repo: base.slice(0, at), worktree: base.slice(at + 1) || "main", slot };
}

// The escape delimiter MUST be a character outside the "kept" set below, so it can never appear
// literally in a slug — that is what makes slugFor/idFromSlug an injective, reversible pair. `~`
// is filesystem-safe on Windows and Linux and is not in the kept set. (An earlier version used
// `-`, which IS kept, so a key like `rc-1-2` was mis-decoded and its saved conversation could not
// be reopened.)
const SLUG_KEEP = /[^A-Za-z0-9@._-]/g;
const SLUG_ESC = /~([0-9a-f]{1,2})~/g;

/** A one-level, filesystem-safe directory/file name for a workspace id or session key. Path
 *  separators and any other character outside the kept set are escaped as `~<hex>~`, so the whole
 *  workspace is a single flat folder and the mapping round-trips exactly (see idFromSlug). */
export function slugFor(id) {
  return String(id).replace(SLUG_KEEP, (ch) => "~" + ch.charCodeAt(0).toString(16) + "~");
}

/** Exact inverse of slugFor: decode every `~<hex>~` escape. Because `~` never appears literally in
 *  a slug (it is outside the kept set, so slugFor always escapes it), this is unambiguous. */
export function idFromSlug(slug) {
  return String(slug).replace(SLUG_ESC, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * workspaceDir(root, workspaceId) → the ONE path every other workspace-relative path is built
 * from. `root` is a transcript root (e.g. `WorkspaceManager.transcriptDir`); the result is that
 * workspace's own directory (`<root>/<slugFor(workspaceId)>`). This is what every "raw
 * path.join(transcriptDir, ...)" call site named in the module header now calls instead.
 */
export function workspaceDir(root, id) {
  return path.join(String(root), slugFor(id));
}

// Well-known subdirectory names, one literal each — every module that used to hard-code its own
// copy of "images"/"documents"/"_segments" now takes it from here.
export const SEGMENTS_SUBDIR = "_segments";
export const IMAGES_SUBDIR = "images";
export const DOCUMENTS_SUBDIR = "documents";

/** `<workspaceDir>/_segments` — the rolled-off conversation archive (lib/conversationArchive.mjs)
 *  AND its FTS index (lib/conversationFts.mjs), which deliberately lives alongside the archive it
 *  indexes rather than in its own top-level directory. */
export function segmentsDir(wsDir) {
  return path.join(String(wsDir), SEGMENTS_SUBDIR);
}

/** `<workspaceDir>/images` — content-addressed attached-image blobs (workspaceStore.saveImage). */
export function imagesDir(wsDir) {
  return path.join(String(wsDir), IMAGES_SUBDIR);
}

/** `<workspaceDir>/documents` — content-addressed attached-document blobs (workspaceStore.saveDocument). */
export function documentsDir(wsDir) {
  return path.join(String(wsDir), DOCUMENTS_SUBDIR);
}

// ---------------------------------------------------------------------------
// Ch.1.3b — zone as part of the interface, not an implicit property of which root a caller
// happened to pass in. See docs/work/exocortex/three-zone-model.md for the full model.
// ---------------------------------------------------------------------------

/**
 * ZONE — the three-zone vocabulary made a real, importable value instead of only living in prose.
 *   SHELL   — Zone 1, public shell/code: ships with the repo, safe on a clean clone.
 *   PRIVATE — Zone 2, private user data: conversations, secrets — never leaves the disk.
 *   BRAIN   — Zone 3, shared brain: this user's distilled knowledge across workspaces — also
 *             never leaves the disk today (D5 defers the opt-in commons), and per the
 *             three-zone-model doc, lives PHYSICALLY inside Zone 2's root (a workspace's own
 *             directory) — it inherits "never leaves the disk" by nesting inside Zone 2, not by
 *             having a separate enforced root of its own. `dashboard/server.mjs`'s `brainDir` is
 *             the one place that doesn't (1.2a/1.3a's finding) — a SEPARATE root, and the wrong
 *             one (anchored to the repo instead of alongside `transcriptDir`).
 */
export const ZONE = Object.freeze({
  SHELL: "shell",
  PRIVATE: "private",
  BRAIN: "brain",
});

/**
 * isInsideRepo(absPath, repoRoot) → true iff `absPath` resolves to `repoRoot` itself or somewhere
 * under it. Pure string/path comparison — both arguments should already be absolute (callers
 * establishing a real root always have one, e.g. `import.meta.url`-derived or `resolve(__dir,...)`).
 */
export function isInsideRepo(absPath, repoRoot) {
  const rel = path.relative(String(repoRoot), String(absPath));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * assertZoneRoot(zone, absPath, repoRoot) → `absPath` unchanged, or THROWS if a `PRIVATE`/`BRAIN`
 * root resolves inside the repo.
 *
 * This is "a call site says which zone it's reading/writing" made real and checkable, not just
 * documented: a module establishing a Zone-2/3 root (`transcriptDir`, `secretsDir`, and — once
 * 1.4 fixes it — `brainDir`) calls this once, at the point the root is computed, and a violation
 * is a loud, immediate, fail-at-startup error instead of a silent structural mistake an audit
 * happens to notice months later. `SHELL` is exempt by construction (it's SUPPOSED to be inside
 * the repo) — this only ever fires for `PRIVATE`/`BRAIN`.
 *
 * Verified against the exact shape of the real `brainDir` bug this guardrail exists to catch (see
 * `lib/storage.test.mjs`): `resolve(__dirname_of_dashboard, "..", "brain")` (one level up — the
 * repo root) fails this check, while `resolve(MASTER_ROOT, "brain")` (MASTER_ROOT already being
 * one level further up, the repo's PARENT — the same anchor `transcriptDir`/`secretsDir` already
 * use correctly) passes it.
 */
export function assertZoneRoot(zone, absPath, repoRoot) {
  if ((zone === ZONE.PRIVATE || zone === ZONE.BRAIN) && isInsideRepo(absPath, repoRoot)) {
    throw new Error(
      `storage: zone "${zone}" root "${absPath}" must not be inside the repo ("${repoRoot}") — ` +
      `Zone 2/3 data must never leave the disk / ship with the shell.`
    );
  }
  return absPath;
}
