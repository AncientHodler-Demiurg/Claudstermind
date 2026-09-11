#!/bin/bash
# TaskCompleted hook for bee Agent Teams.
# Validates that bee-spawned team tasks emit a `## Task Notes` section before being marked complete.
# Exits 2 with stderr feedback if validation fails — teammate keeps working.
# Exits 0 silently for non-bee teams (user's manually-created teams pass through).
#
# Hook input (stdin JSON): { session_id, transcript_path, cwd, hook_event_name }
# Hook does NOT receive task_id or teammate_name — must infer from transcript + ~/.claude/teams/.

set -uo pipefail

# Read hook input
INPUT=$(cat 2>/dev/null || echo '{}')

# Quick exit if jq unavailable (defensive — should be present in dev environments)
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

# Step 1: detect if this is a bee-spawned team task
# Look for ANY active team matching `bee-*` in ~/.claude/teams/
BEE_TEAM_FOUND=0
if [ -d "$HOME/.claude/teams" ]; then
  for team_dir in "$HOME"/.claude/teams/bee-*; do
    [ -d "$team_dir" ] || continue
    BEE_TEAM_FOUND=1
    break
  done
fi

# Skip validation for non-bee teams (user's own teams pass through)
if [ "$BEE_TEAM_FOUND" -eq 0 ]; then
  exit 0
fi

# Step 2: Inspect last assistant message in transcript for Task Notes heading
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  # Cannot inspect — pass through (don't block on missing data)
  exit 0
fi

# Skip validation if THIS teammate's transcript is the skill probe (per-teammate detection,
# not directory-presence — works even if probe and real team coexist or probe dir is orphaned).
# The probe question (per skills/agent-teams/SKILL.md) is uniquely identified by this fragment.
if grep -qF "Locate the section heading that starts with 'TDD is mandatory'" "$TRANSCRIPT_PATH" 2>/dev/null; then
  exit 0
fi

# Read the last 200 lines of the transcript and look for the most recent assistant message.
# CC transcripts are JSONL (line-delimited). Each line is one event with shape:
#   { "type": "assistant", "message": { "content": [ { "type": "text", "text": "..." }, ... ] }, ... }
# Use --slurp + --raw-output and traverse the content-block array to extract text.
LAST_MESSAGE=$(tail -n 200 "$TRANSCRIPT_PATH" 2>/dev/null \
  | jq -rs 'map(select(.type == "assistant"))
            | last
            | (.message.content // [])
            | map(select(.type == "text") | .text)
            | join("\n")' 2>/dev/null)

if [ -z "$LAST_MESSAGE" ]; then
  # No assistant message found in tail window — pass through
  exit 0
fi

# Check for `## Task Notes` heading (load-bearing per bee implementer agents)
if echo "$LAST_MESSAGE" | grep -qE '^##[[:space:]]+Task Notes' ; then
  # Validation passed
  exit 0
fi

# Validation failed — block completion + send feedback to teammate
cat >&2 <<'EOF'
[bee] Task completion blocked: missing `## Task Notes` section.

bee Agent Team teammates must emit a `## Task Notes` section before marking
a task complete. The conductor and SubagentStop hook chain consume this
section to update TASKS.md `notes:` fields.

Required shape (one line, no narrative paragraphs):
  T{ID} {OK|FAILED|BLOCKED} | files: a,b | tests: N/M | blocker: <reason|none>

Append a `## Task Notes` section to your final message and try again.
EOF

exit 2
