#!/bin/bash
# PreCompact hook: save compact session note to SESSION-CONTEXT.md
# STATE.md and config.json are already on disk and loaded separately at SessionStart
# This file only stores session-specific context not captured elsewhere

set -euo pipefail

BEE_DIR="$CLAUDE_PROJECT_DIR/.bee"

# Skip if .bee/ doesn't exist
if [ ! -d "$BEE_DIR" ]; then
  exit 0
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Extract the focused spec slug from STATE.md Current Spec Path (accurate source).
# If the Path line is "(none)" or missing, omit the Active spec line rather than
# printing a stale or malformed value.
CURRENT_SPEC_PATH=""
CURRENT_SPEC_STATUS=""
if [ -f "$BEE_DIR/STATE.md" ]; then
  CURRENT_SPEC_PATH=$(grep -m1 "^- Path:" "$BEE_DIR/STATE.md" 2>/dev/null | sed 's/^- Path:[[:space:]]*//' || true)
  CURRENT_SPEC_STATUS=$(grep -m1 "^- Status:" "$BEE_DIR/STATE.md" 2>/dev/null | sed 's/^- Status:[[:space:]]*//' || true)
fi

# Build the active-spec line only when STATE.md has a real, non-"(none)" path
# and the status is not NO_SPEC. Omit rather than print stale data.
ACTIVE_SPEC_LINE=""
if [ -n "$CURRENT_SPEC_PATH" ] && [ "$CURRENT_SPEC_PATH" != "(none)" ] && [ "$CURRENT_SPEC_STATUS" != "NO_SPEC" ]; then
  ACTIVE_SPEC_LINE="**Active spec:** $CURRENT_SPEC_PATH"
fi

# Determine the write path: per-spec if a valid slug and directory exist, else global.
CURRENT_SPEC_PATH_TRIMMED="${CURRENT_SPEC_PATH%/}"
SLUG=$(basename "$CURRENT_SPEC_PATH_TRIMMED" 2>/dev/null || true)
if [ -n "$SLUG" ] && [ "$SLUG" != "(none)" ] && [ "$CURRENT_SPEC_STATUS" != "NO_SPEC" ] && [ -d "$BEE_DIR/specs/$SLUG" ]; then
  SESSION_CONTEXT_PATH="$BEE_DIR/specs/$SLUG/SESSION-CONTEXT.md"
else
  SESSION_CONTEXT_PATH="$BEE_DIR/SESSION-CONTEXT.md"
fi

# Write compact session note (avoid duplicating STATE.md/config.json)
if [ -n "$ACTIVE_SPEC_LINE" ]; then
  cat > "$SESSION_CONTEXT_PATH" << EOF
# Session Context (auto-generated)

**Last compaction:** $TIMESTAMP
$ACTIVE_SPEC_LINE
EOF
else
  cat > "$SESSION_CONTEXT_PATH" << EOF
# Session Context (auto-generated)

**Last compaction:** $TIMESTAMP
EOF
fi

exit 0
