#!/bin/bash
# SessionEnd hook: warn about memory files approaching consolidation limit
# SessionEnd hooks cannot block termination -- stderr shown to user only

BEE_DIR="$CLAUDE_PROJECT_DIR/.bee"

# Session metrics computation
if [ -f "$BEE_DIR/.session-start" ]; then
  SESSION_START=$(cat "$BEE_DIR/.session-start")
  SESSION_END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Compute duration in seconds (macOS and Linux compatible)
  if command -v gdate >/dev/null 2>&1; then
    DATE_CMD="gdate"
  else
    DATE_CMD="date"
  fi
  START_EPOCH=$($DATE_CMD -d "$SESSION_START" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$SESSION_START" +%s 2>/dev/null || echo "0")
  END_EPOCH=$($DATE_CMD -d "$SESSION_END" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$SESSION_END" +%s 2>/dev/null || echo "0")

  if [ "$START_EPOCH" != "0" ] && [ "$END_EPOCH" != "0" ]; then
    DURATION=$((END_EPOCH - START_EPOCH))
  else
    DURATION=0
  fi

  # Git activity since session start
  COMMITS=$(git log --since="$SESSION_START" --oneline 2>/dev/null | wc -l | tr -d ' ')
  if [ "${COMMITS:-0}" -gt 0 ]; then
    DIFFSTAT=$(git diff --stat HEAD~${COMMITS}..HEAD 2>/dev/null || echo "")
  else
    DIFFSTAT=""
  fi
  FILES_CHANGED=$(echo "$DIFFSTAT" | grep -c 'changed' 2>/dev/null || true)
  FILES_CHANGED=${FILES_CHANGED:-0}
  INSERTIONS=$(echo "$DIFFSTAT" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo "0")
  DELETIONS=$(echo "$DIFFSTAT" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo "0")

  # Generate session ID from date
  SESSION_DATE=$(echo "$SESSION_START" | cut -d'T' -f1)
  SESSIONS_DIR="$BEE_DIR/metrics/sessions"
  mkdir -p "$SESSIONS_DIR"

  # Find next session number for today
  EXISTING=$(ls "$SESSIONS_DIR"/session-${SESSION_DATE}-*.json 2>/dev/null | wc -l | tr -d ' ')
  SESSION_NUM=$((EXISTING + 1))

  # Write session metrics JSON
  cat > "$SESSIONS_DIR/session-${SESSION_DATE}-${SESSION_NUM}.json" << ENDJSON
{
  "session_id": "$(echo "$SESSION_START" | tr ':' '-' | tr -d 'Z')",
  "started_at": "$SESSION_START",
  "ended_at": "$SESSION_END",
  "duration_seconds": $DURATION,
  "git_activity": {
    "commits_made": ${COMMITS:-0},
    "files_changed": ${FILES_CHANGED:-0},
    "insertions": ${INSERTIONS:-0},
    "deletions": ${DELETIONS:-0}
  }
}
ENDJSON

  # Display session duration to user (stderr -- shown to user on session end)
  if [ "$DURATION" -gt 0 ]; then
    HOURS=$((DURATION / 3600))
    MINS=$(( (DURATION % 3600) / 60 ))
    if [ "$HOURS" -gt 0 ]; then
      echo "Session: ${HOURS}h ${MINS}m | ${COMMITS:-0} commits" >&2
    else
      echo "Session: ${MINS}m | ${COMMITS:-0} commits" >&2
    fi
  fi

  # Clean up session start marker
  rm -f "$BEE_DIR/.session-start"
fi

exit 0
