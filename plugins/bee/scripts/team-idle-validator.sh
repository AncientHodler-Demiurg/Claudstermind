#!/bin/bash
# TeammateIdle hook for bee Agent Teams.
# Catches teammates that stop without producing a final deliverable (silent abandonment).
# Exits 2 with feedback to keep teammate working.
# Exits 0 silently for non-bee teams.
#
# Hook input (stdin JSON): { session_id, transcript_path, cwd, hook_event_name }
#
# Strategy: bee teammates always have a documented output contract (write to {output_path},
# emit ## Task Notes, etc.). If a teammate is about to go idle without ANY of:
#   - a `## Task Notes` section in last message
#   - a `## ROOT CAUSE FOUND` heading (debug team consensus)
#   - a `## Project Pattern Deviations` or `**Total: X` line (review team)
# then it likely abandoned mid-investigation. Block + nudge.

set -uo pipefail

INPUT=$(cat 2>/dev/null || echo '{}')

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# Agent Teams fast-exit: TaskCompleted/TeammateIdle are team-only events. In the
# common solo workflow (teams not enabled in config), skip the transcript scan +
# team lookup entirely.
_BEE_CFG="${CLAUDE_PROJECT_DIR:-$PWD}/.bee/config.json"
if [ -f "$_BEE_CFG" ]; then
  [ "$(jq -r '.agent_teams.status // "unavailable"' "$_BEE_CFG" 2>/dev/null)" = "enabled" ] || exit 0
fi

TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Detect bee team
BEE_TEAM_FOUND=0
if [ -d "$HOME/.claude/teams" ]; then
  for team_dir in "$HOME"/.claude/teams/bee-*; do
    [ -d "$team_dir" ] || continue
    BEE_TEAM_FOUND=1
    break
  done
fi

if [ "$BEE_TEAM_FOUND" -eq 0 ]; then
  exit 0
fi

if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  exit 0
fi

# Skip if THIS teammate's transcript is the skill probe (per-teammate detection by transcript
# content, not directory-presence — works even if probe coexists with a real team or probe dir
# is orphaned). The probe question signature is uniquely identified by this fragment.
if grep -qF "Locate the section heading that starts with 'TDD is mandatory'" "$TRANSCRIPT_PATH" 2>/dev/null; then
  exit 0
fi

# CC transcripts: JSONL with { "type": "assistant", "message": { "content": [{"type":"text","text":"..."}] } }
LAST_MESSAGE=$(tail -n 200 "$TRANSCRIPT_PATH" 2>/dev/null \
  | jq -rs 'map(select(.type == "assistant"))
            | last
            | (.message.content // [])
            | map(select(.type == "text") | .text)
            | join("\n")' 2>/dev/null)

if [ -z "$LAST_MESSAGE" ]; then
  exit 0
fi

# Check for any deliverable signature -- list mirrors documented agent contracts in hooks.json.
# When adding a new SubagentStop validator, add its top-level heading here too.
if echo "$LAST_MESSAGE" | grep -qE '^##[[:space:]]+(Task Notes|ROOT CAUSE FOUND|CHECKPOINT REACHED|INVESTIGATION INCONCLUSIVE|Project Pattern Deviations|Bugs Detected|Stack Best Practice Violations|Plan Compliance Findings|Plan Compliance Review|Test Generation Summary|Test Gap Analysis|Endpoint Inventory|Dependency Health Report|Assumptions|Risk Matrix|Fix Report|Validation Summary|Spec Review|Discussion Summary|Relevant Files|Bug Detection Summary|Swarm Review Consolidation|Audit Summary|Security Audit Summary|Database Audit Summary|Architecture Audit Summary|API Audit Summary|Frontend Audit Summary|Performance Audit Summary|Error Handling Audit Summary|Integration Audit Summary)' ; then
  exit 0
fi

# Generalised Total-line: catches "**Total: N critical, ..., M medium**", "**Total: N deviations**",
# "**Total: N violations**", and any other "**Total: N <noun>(, N <noun>)*\*\*" pattern that
# documented bee agents emit as a summary line.
if echo "$LAST_MESSAGE" | grep -qE '\*\*Total: [0-9]+( [a-z]+)+(, [0-9]+ [a-z]+)*\*\*' ; then
  exit 0
fi

# Explicit clean-result phrases (case-insensitive)
if echo "$LAST_MESSAGE" | grep -qiE '^(BLOCKED:|No bugs detected\.|No project pattern deviations found\.|No stack best practice violations found\.|No plan compliance findings\.|No findings\.)' ; then
  exit 0
fi

# No deliverable signature found — likely abandoned
cat >&2 <<'EOF'
[bee] Teammate going idle without producing a deliverable.

bee Agent Team teammates must produce one of these before going idle:
  - `## Task Notes` section (implementers/fixers)
  - `## ROOT CAUSE FOUND` / `## CHECKPOINT REACHED` / `## INVESTIGATION INCONCLUSIVE` (debug team)
  - `## Bugs Detected` / `## Project Pattern Deviations` / `## Stack Best Practice Violations` /
    `## Plan Compliance Findings` (review team — any specialist heading)
  - `**Total: N <noun>(, M <noun>)*\*\*` summary line (any review/audit total)
  - `## Fix Report` (fixer team)
  - `## Audit Summary` / `## <Domain> Audit Summary` (audit team)
  - Explicit `BLOCKED:` signal (architectural stop)
  - Explicit `No bugs detected.` / `No project pattern deviations found.` /
    `No stack best practice violations found.` / `No findings.` (clean result)

If you finished, append the appropriate deliverable to your message and try again.
If you are stuck, emit a `BLOCKED:` signal with the architectural reason.
EOF

exit 2
