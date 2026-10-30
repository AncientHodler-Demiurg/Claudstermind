#!/bin/bash
# wasp SessionStart hook — prints active version + workspace/repo context banner.
# Stdout becomes additionalContext that Claude can see at session start.
# Silent exit if CWD is not wasp-managed (no .wasp/ at any level).

shopt -s nullglob

CWD="${CLAUDE_PROJECT_DIR:-$PWD}"
PLUGIN_JSON="${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"

# Read wasp version from plugin.json (the plugin we're running from is the source of truth)
WASP_VERSION="unknown"
if [ -f "$PLUGIN_JSON" ]; then
  WASP_VERSION=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' "$PLUGIN_JSON" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi

# Walk up CWD looking for .wasp/cross-pollinate.yml (workspace marker)
WORKSPACE_ROOT=""
dir="$CWD"
for i in 1 2 3 4 5; do
  if [ -f "$dir/.wasp/cross-pollinate.yml" ]; then
    WORKSPACE_ROOT="$dir"
    break
  fi
  parent=$(dirname "$dir")
  if [ "$parent" = "$dir" ]; then
    break
  fi
  dir="$parent"
done

# Detect repo context (CWD itself, or a member of a workspace)
REPO_CONTEXT=""
REPO_TYPE=""
if [ -f "$CWD/.wasp/config.json" ]; then
  REPO_NAME=$(basename "$CWD")
  REPO_TYPE=$(grep -oE '"repo_type"[[:space:]]*:[[:space:]]*"[^"]+"' "$CWD/.wasp/config.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  REPO_BRANCH="(no git)"
  if [ -d "$CWD/.git" ]; then
    REPO_BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(detached)")
  fi
  REPO_CONTEXT="$REPO_NAME ($REPO_TYPE, branch $REPO_BRANCH)"
fi

# Silent exit if no wasp data at any level
if [ -z "$WORKSPACE_ROOT" ] && [ -z "$REPO_CONTEXT" ]; then
  exit 0
fi

# Print banner — markdown headings so Claude can render it cleanly
echo "## 🐝 wasp v$WASP_VERSION active"
echo ""

if [ -n "$WORKSPACE_ROOT" ]; then
  WORKSPACE_NAME=$(basename "$WORKSPACE_ROOT")
  REPO_COUNT=$(grep -cE '^[[:space:]]*-[[:space:]]+path:' "$WORKSPACE_ROOT/.wasp/cross-pollinate.yml" 2>/dev/null | tr -d ' ' || echo "?")
  EDGE_COUNT=$(grep -cE '^[[:space:]]*-[[:space:]]+from:' "$WORKSPACE_ROOT/.wasp/cross-pollinate.yml" 2>/dev/null | tr -d ' ' || echo "?")
  echo "**Workspace:** $WORKSPACE_NAME ($REPO_COUNT repos, $EDGE_COUNT edges)"
  echo "  Root: $WORKSPACE_ROOT"
fi

if [ -n "$REPO_CONTEXT" ]; then
  echo "**Active repo:** $REPO_CONTEXT"
fi

# Alert on in-flight state.md (workspace level)
if [ -n "$WORKSPACE_ROOT" ] && [ -f "$WORKSPACE_ROOT/.wasp/state.md" ]; then
  STATUS=$(grep -oE '\*\*Status:\*\*[[:space:]]*[a-z\-]+' "$WORKSPACE_ROOT/.wasp/state.md" | head -1 | sed 's/.*[[:space:]]\([a-z\-]*\)$/\1/')
  if [ -n "$STATUS" ] && [ "$STATUS" != "complete" ]; then
    echo ""
    echo "⚠️  **In-flight cross-pollinate state:** status=$STATUS"
    echo "    Run \`/wasp:forensics --active\` to inspect, or \`/wasp:cross-pollinate --resume\` to continue."
  fi
fi

# Alert on in-flight state.md (per-repo)
if [ -f "$CWD/.wasp/state.md" ]; then
  STATUS=$(grep -oE '\*\*Status:\*\*[[:space:]]*[a-z\-]+' "$CWD/.wasp/state.md" | head -1 | sed 's/.*[[:space:]]\([a-z\-]*\)$/\1/')
  CMD=$(grep -oE '\*\*Command:\*\*[[:space:]]*[a-z\-]+' "$CWD/.wasp/state.md" | head -1 | sed 's/.*[[:space:]]\([a-z\-]*\)$/\1/')
  if [ -n "$STATUS" ] && [ "$STATUS" != "complete" ]; then
    echo ""
    echo "⚠️  **In-flight $CMD state (this repo):** status=$STATUS"
    echo "    Run \`/wasp:forensics --active\` to inspect, or \`/wasp:$CMD --resume\` to continue."
  fi
fi

echo ""
echo "Available: \`/wasp:health\` \`/wasp:cross-pollinate\` \`/wasp:pollinate\` \`/wasp:audit-prep\` \`/wasp:debug\` \`/wasp:forensics\`"
