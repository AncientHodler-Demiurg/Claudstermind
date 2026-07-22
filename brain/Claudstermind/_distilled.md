# Distilled knowledge — Claudstermind

_Claude-distilled from 1 conversation(s). Raw kept in .claude/workspace._

## Facts
- Claudstermind is a cross-repo "brain" system: a `SessionStart:startup` hook injects a summary of recent work state across multiple repos into every new session.
- Brain output format: most-recent-first list of `<org>/<category>/<repo>: <branch> @ <short-sha> ("<commit msg>") · <N> file(s) [· diff stat] · <date>`, each with a `last:` line showing the last user message snippet in that repo.
- A "Recent worklog" section follows, listing the same repo/branch/commit/dirty-file-count/last-message data in chronological order.
- Each tracked repo's full knowledge base + auto-state lives at `Claudstermind/brain/<repo>/`.
- The brain/worklog is maintained by a component called **brain-sync**.
- Repos observed under Claudstermind's tracking (org/category/repo): `AncientPantheon/websites/Pantheon`, `AncientPantheon/automatons/Mnemosyne`, `Tools/wasp-dev`, `StoaChain/_infra/stoa-js`, `StoaChain/daimons/StoaWallet`, `AncientPantheon/constructors/Pythia`, `AncientPantheon/constructors/Codex`.

## Decisions
- (none surfaced in this conversation)

## Gotchas
- (none surfaced in this conversation)

## Skills
- (none surfaced — conversation was a trivial "TUNNEL-OK" connectivity check with no procedural work performed)