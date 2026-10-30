#!/bin/bash
# Stop hook: check for unreviewed executed phases before ending session
# Exit 0 = silent success (no issues), Exit 2 = stderr fed to Claude as feedback
# Do NOT use set -euo pipefail -- handle missing files gracefully

BEE_DIR="$CLAUDE_PROJECT_DIR/.bee"

# Skip if .bee/ doesn't exist (not a bee project or fresh init)
if [ ! -d "$BEE_DIR" ]; then
  exit 0
fi

# Skip if config.json doesn't exist or require_review_before_next is not true
CONFIG_FILE="$BEE_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  exit 0
fi

REQUIRE_REVIEW=$(jq -r '.phases.require_review_before_next // false' "$CONFIG_FILE" 2>/dev/null)
if [ "$REQUIRE_REVIEW" != "true" ]; then
  exit 0
fi

# Skip if STATE.md doesn't exist (fresh project, no phases yet)
STATE_FILE="$BEE_DIR/STATE.md"
if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

# Parse the Phases table for rows where Status is EXECUTED but Reviewed is not Yes
# Table format: | # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |
# awk -F'|': $1="" $2="# " $3="Name " $4="Status " $5="Plan " $6="Plan Review " $7="Executed " $8="Reviewed " $9="Tested " $10="Committed "
UNREVIEWED=$(awk -F'|' '
  /EXECUTED/ {
    status = $4
    reviewed = $8
    gsub(/^[ \t]+|[ \t]+$/, "", status)
    gsub(/^[ \t]+|[ \t]+$/, "", reviewed)
    if (status == "EXECUTED" && reviewed !~ /^Yes/) {
      name = $3
      gsub(/^[ \t]+|[ \t]+$/, "", name)
      print name
    }
  }
' "$STATE_FILE")

if [ -n "$UNREVIEWED" ]; then
  # Use a marker file to prevent repeating this reminder in a loop.
  # The Stop hook fires every time Claude stops responding -- if we exit 2
  # (feedback to Claude), Claude responds, which triggers another Stop,
  # which fires the hook again, creating an infinite loop.
  MARKER="$BEE_DIR/.review-reminder-shown"
  if [ -f "$MARKER" ]; then
    # Already reminded this session -- stay silent
    exit 0
  fi
  touch "$MARKER"

  echo "REMINDER (do NOT auto-execute): Unreviewed executed phases detected:" >&2
  echo "$UNREVIEWED" | while read -r phase; do
    echo "  - $phase" >&2
  done
  echo "" >&2
  echo "Inform the user that these phases need review. Suggest they run /bee:review as their next step. Do NOT run the review command yourself." >&2
  exit 2
fi

exit 0
