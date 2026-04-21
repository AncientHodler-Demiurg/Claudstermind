# Skill — `::cmpush` (commit + push Claudstermind to its GitHub repo)

> **When:** the owner types `::cmpush` (or an equivalent phrase). This is the **explicit opt-in** for the otherwise-forbidden auto-commit/push behavior. **Never** auto-fired.
>
> **Goal:** snapshot the current state of Claudstermind to `github.com/StoaChain/Claudstermind`, preserving the accumulated brain.

## Why this skill exists

Continuous write-back ([`session-close.md`](session-close.md)) accumulates unpushed changes in Claudstermind's working tree throughout every session. Those changes are valuable — they're the cluster's growing brain — but living only on the owner's dev box is fragile. `::cmpush` is the operator-triggered snapshot that moves the brain to remote storage.

It works from **any** linked project's conversation. The agent may be running in `D:/_Claude/AncientHoldings/`, but the skill operates on `D:/_Claude/Claudstermind/` — always. The current project's cwd is irrelevant.

## Trigger keyword

**`::cmpush`** — the canonical command. Seven keystrokes, `::` prefix consistent with `::cmsync`.

### Accepted variants

- `::cmpush`
- `::cmcommit` — commit only, no push
- Prose forms: *"push Claudstermind"*, *"commit and push the cluster"*, *"snapshot Claudstermind"*

### What does NOT trigger this skill

- Regular project work — writes to Claudstermind stay staged, never auto-committed
- The word *"push"* in normal conversation — requires the `::cm…` prefix or an explicit cluster-referring phrase
- Session close, sync, or any other skill — each skill stays in its lane

## Preconditions the agent must verify

Before doing anything, the agent confirms:

1. **Claudstermind exists** at the expected path (`D:/_Claude/Claudstermind/`).
2. **It's a git repo** (`.git/` exists). If not → this is the first push; see §First-time setup below.
3. **Remote is configured.** `git -C <path> remote -v` shows `origin` pointing at `https://github.com/StoaChain/Claudstermind.git`.
4. **Token file exists and is readable:** `D:/_Claude/Claudstermind/.secret/github-token.txt` contains a valid PAT (see [`../.secret/README.md`](../.secret/README.md) for how the owner creates it).
5. **`.secret/` is gitignored.** `git -C Claudstermind check-ignore .secret/github-token.txt` should exit 0 and print the path. If it doesn't, **abort** — the token would be pushed to GitHub.

If any precondition fails, the agent stops and reports the exact failure — does **not** attempt to work around it.

## The push protocol

### Step 1 — inspect what's changed

```bash
git -C D:/_Claude/Claudstermind status --porcelain
git -C D:/_Claude/Claudstermind diff --stat
```

If output is empty → emit `::cmpush → nothing to commit.` and stop.

### Step 2 — compose a commit message

Auto-generate a summary from the diff. Format:

```
Claudstermind update YYYY-MM-DD

<terse summary of what changed, grouped by top-level folder>
- projects/<Name>: <short change list>
- meta/…: <short change list>
- skills/…: <short change list>
```

Examples:
- `Claudstermind update 2026-04-22\n\n- projects/AncientHoldings: LOG +2 entries, STATE refreshed to 0.7.6p-dev\n- meta/shared-conventions.md: added Rule zero (continuous write-back)`
- `Claudstermind update 2026-04-22\n\n- projects/OuronetCore: initial onboarding (add-project run)\n- MANIFEST.md: +OuronetCore linked`

Do NOT invent detail the diff doesn't support. If you can't produce a meaningful summary, fall back to `Claudstermind update YYYY-MM-DD — <N> files changed across <M> projects`.

### Step 3 — stage, safety-check, commit, push

**Stage everything** (the continuous write-back has accumulated changes across many files):

```bash
git -C D:/_Claude/Claudstermind add -A
```

**Safety check — NO secrets in staging.** Belt-and-suspenders on top of `.gitignore`:

```bash
git -C D:/_Claude/Claudstermind diff --cached --name-only | \
  grep -E '\.secret/|\.env|\.token$|\.key$|\.pem$|credentials' && \
  { echo "ABORT: secret-shaped file in staging area"; exit 1; } || true
```

If anything matches, **abort immediately** — something leaked past the `.gitignore`. Do not commit.

**Commit** with the auto-generated message (use HEREDOC for multi-line):

```bash
git -C D:/_Claude/Claudstermind commit -m "$(cat <<'EOF'
Claudstermind update 2026-04-22

- projects/AncientHoldings: LOG +2 entries, STATE refreshed to 0.7.6p-dev
- meta/shared-conventions.md: added Rule zero (continuous write-back)
EOF
)"
```

**Push using the token from `.secret/`** — inline URL, never persisted, never logged:

```bash
TOKEN=$(cat D:/_Claude/Claudstermind/.secret/github-token.txt)
git -C D:/_Claude/Claudstermind push "https://${TOKEN}@github.com/StoaChain/Claudstermind.git" HEAD
unset TOKEN
```

The `${TOKEN}` expansion happens once at push time, inside the Bash tool call. It is **never** persisted:
- Not saved into `.git/config` (because `origin` remote is never mutated — the URL is passed inline for this push only)
- Not echoed in logs (if the tool output includes the command line, GitHub's redaction normally masks PATs; the agent additionally avoids re-printing the command verbatim in the confirmation)
- Gone after `unset TOKEN` (or at shell exit)

**Do not use `--amend`.** Each push is a new commit; amending rewrites history and requires force-push, which is forbidden here.

**Do not use `--no-verify`.** If a pre-commit hook ever gets added, a failure means something needs fixing, not bypassing.

**Do not** `git remote set-url` to embed the token in the remote URL. The inline form above is specifically designed to avoid that.

### Step 4 — confirmation

Report concisely:

```
::cmpush → committed + pushed
  <commit SHA>  <first line of commit message>
  <N files changed, +L additions, -D deletions>
  https://github.com/StoaChain/Claudstermind/commit/<SHA>
```

If push fails (network, auth, branch divergence, etc.), surface the **exact** git error — do not paper over it. The owner decides next step.

## First-time setup (when Claudstermind isn't yet a git repo)

When the agent detects `.git/` missing, it **stops and asks**:

```
Claudstermind is not yet a git repo. First-time setup needs:
  1. Verify .gitignore is in place (it is — Claudstermind/.gitignore)
  2. Verify token file exists at .secret/github-token.txt (owner creates this — see .secret/README.md)
  3. git init
  4. git symbolic-ref HEAD refs/heads/main   ← sets branch name pre-commit; do NOT use `git branch -M main` here, it fails before any commit exists
  5. git remote add origin https://github.com/StoaChain/Claudstermind.git
  6. Initial commit with everything currently in the folder (safety-checked against secret-shaped files)
  7. First push with the token: git push -u "https://${TOKEN}@.../Claudstermind.git" main
Do you want me to run the above? (y/n)
```

Only proceed on explicit `y`. First-time setup is a privileged moment that the owner should consciously approve.

**If step 2 fails** (token file missing), stop and tell the owner to follow [`../.secret/README.md`](../.secret/README.md) to create it. Do not proceed without the token.

## What NOT to do

- **Don't push without an explicit `::cmpush` command.** Continuous write-back accumulates locally; pushing is deliberate.
- **Don't push secrets.** Staged files matching `.secret/`, `.env`, `*.key`, `*.pem`, `*.token`, or `credentials` abort the push. (The `.gitignore` is the first line of defense; the staging-area scan in Step 3 is belt-and-suspenders.)
- **Don't echo the token.** Never print the contents of `github-token.txt` or the full push URL (which contains the token) to the conversation. Confirmation message should show the commit SHA + message + GitHub commit URL, not the push command.
- **Don't write the token into `.git/config`** via `git remote set-url` or any other mechanism that persists it. The inline URL form (`push "https://${TOKEN}@…" HEAD`) is the only sanctioned path.
- **Don't force-push.** Ever. `--force` / `-f` are forbidden here.
- **Don't commit to a detached HEAD or an unexpected branch.** The push assumes `main`; if HEAD points elsewhere, stop and tell the owner.
- **Don't rewrite history with `--amend` or interactive rebase.** New commits only.
- **Don't silence git errors.** If push fails with "authentication required", "remote rejected", "updates were rejected because the tip of your current branch is behind", surface the full message (the agent can safely do this because the redacted-token form GitHub returns on auth failure is already masked).

## Edge cases

- **Remote has diverged** (someone pushed from another machine). Tell the owner: *"remote is ahead — pull first? (`git pull --rebase` or `git pull` — your call)."* Do not auto-merge.
- **Uncommitted changes in Claudstermind plus unpulled remote commits.** Same as above — stop, surface the situation, let the owner choose. Do not attempt heuristics.
- **Owner typed `::cmcommit` (commit only, no push).** Stop after Step 3's commit; skip the push. Useful for offline snapshots.
- **First `::cmpush` of the calendar day.** No special behavior — push happens as usual. The commit message's date-stamp is what distinguishes daily cadence.
- **Claudstermind path unresolvable.** Stop with a clear error: *"Claudstermind not found at D:/_Claude/Claudstermind/. Update the skill or the MANIFEST."*
