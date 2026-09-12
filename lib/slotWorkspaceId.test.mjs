// node --test lib/slotWorkspaceId.test.mjs
//
// "Creating a new chat, I am shown as a workspace main#1 although that is no existing workspace;
//  coming back to main, this fake non-existing workspace is selected … I have to refresh."
//
// Multi-chat gives a side conversation its own identity by appending `#<n>` to the workspace id
// (`Claudstermind@main#1`). `parseWorkspaceId` split on the last `@` only, so the slot suffix landed
// in `worktree` — a worktree named "main#1" appeared in the picker, selectable, for a checkout that
// does not exist, and the key derived from it made the real conversation unreachable until a reload.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseWorkspaceId, workspaceId } from "./workspaceStore.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

test("a conversation slot is not a worktree", () => {
  assert.deepEqual(parseWorkspaceId("Claudstermind@main#1"),
    { repo: "Claudstermind", worktree: "main", slot: 1 });
  assert.deepEqual(parseWorkspaceId("Claudstermind@exocortex#2"),
    { repo: "Claudstermind", worktree: "exocortex", slot: 2 },
    "the slot rides on a REAL worktree and must not swallow its name");
  // A repo path contains slashes and the id splits on the last `@` — both must survive.
  assert.deepEqual(parseWorkspaceId("AncientPantheon/constructors/Codex@main#3"),
    { repo: "AncientPantheon/constructors/Codex", worktree: "main", slot: 3 });
});

test("ids without a slot are untouched, and `#` that is not a slot is left alone", () => {
  assert.deepEqual(parseWorkspaceId(workspaceId("Claudstermind", "main")),
    { repo: "Claudstermind", worktree: "main", slot: 0 });
  assert.deepEqual(parseWorkspaceId("bare-repo"), { repo: "bare-repo", worktree: "main", slot: 0 });
  // Only a trailing `#<digits>` is a slot. Anything else is part of the name, whatever it is.
  assert.deepEqual(parseWorkspaceId("weird#notanumber"),
    { repo: "weird#notanumber", worktree: "main", slot: 0 });
});

test("the client refuses a worktree that could not exist, so one bad frame cannot poison a pane", () => {
  // Belt and braces: the source is fixed, but the pane adopted `data.worktree` verbatim and the
  // picker then kept it as "the pane's own value" — which is how a phantom became *selected*.
  assert.match(app, /if \(data\.worktree && !String\(data\.worktree\)\.includes\("#"\)\) p\.worktree = data\.worktree;/,
    "`#` cannot appear in a real worktree name — createWorktree's SAFE_NAME is letters, digits and ._-");
  assert.ok(!/p\.worktree = data\.worktree \|\| p\.worktree;/.test(app),
    "the unguarded adopt is what put a workspace that does not exist into the picker");
});
