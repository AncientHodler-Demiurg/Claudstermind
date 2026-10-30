#!/usr/bin/env node
// migrate-brain — Ch.1.4: move the distillation feature's output (`brain/`) from its old, wrong-
// zone location (inside the repo — see docs/work/exocortex/secrets-audit.md §2 and
// docs/work/exocortex/three-zone-model.md) to its correct one, `<MASTER_ROOT>/brain` — the same
// outside-the-repo anchor `transcriptDir`/`secretsDir` already use, fixed in
// `dashboard/server.mjs`'s `BRAIN_DIR` in this same slice.
//
// COPY-ONLY. NEVER DELETES THE OLD (repo-tracked) COPY — see lib/brainMigration.mjs's header for
// why: deleting those files is a step toward the still-open `docs/work/exocortex/plan.md` 1.2b
// decision (whether/how to also address git history), which is the repo owner's call, not this
// script's. Running this script only makes the NEW, correct location populated and ready; the old
// `brain/` stays exactly as it is on disk (and in git) until 1.2b is decided separately.
//
// DRY RUN BY DEFAULT. Prints what it would copy and changes nothing. Pass --confirm to actually
// copy. Safe to run repeatedly either way — idempotent (lib/brainMigration.mjs: a file already
// present at the destination with identical content is skipped, not re-copied).
//
//   node scripts/migrate-brain.mjs                # dry run (default)
//   node scripts/migrate-brain.mjs --confirm      # actually copy
//   node scripts/migrate-brain.mjs --old <path> --new <path>   # override the default locations
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planBrainMigration, migrateBrain } from "../lib/brainMigration.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dir, "..");
const MASTER_ROOT = resolve(__dir, "..", "..");

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const CONFIRM = argv.includes("--confirm");
const OLD_DIR = flagValue("--old") || join(REPO_ROOT, "brain");
const NEW_DIR = flagValue("--new") || join(MASTER_ROOT, "brain");

console.log(`old (repo-tracked) location: ${OLD_DIR}`);
console.log(`new (outside-the-repo) location: ${NEW_DIR}`);
console.log("");

const result = CONFIRM ? migrateBrain(OLD_DIR, NEW_DIR, { execute: true }) : planBrainMigration(OLD_DIR, NEW_DIR);

if (!result.oldExists) {
  console.log("Nothing to migrate — the old location doesn't exist (already migrated, or never existed here).");
  process.exit(0);
}

console.log(`${result.copied.length} file(s) ${CONFIRM ? "copied" : "would be copied"}:`);
for (const f of result.copied) console.log(`  + ${f}`);
console.log(`${result.alreadyPresent.length} file(s) already present at the destination (identical content, skipped).`);
if (result.conflicts.length) {
  console.log(`\n⚠ ${result.conflicts.length} CONFLICT(s) — destination already has DIFFERENT content, neither side touched:`);
  for (const f of result.conflicts) console.log(`  ! ${f}`);
  console.log("These need a human to look at them directly; re-run after resolving.");
}

console.log("");
console.log(CONFIRM
  ? `APPLIED. The old location at ${OLD_DIR} was left untouched — see this script's header for why.`
  : "Dry run — nothing changed. Re-run with --confirm to actually copy.");

process.exitCode = result.conflicts.length ? 1 : 0;
