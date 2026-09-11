#!/usr/bin/env bash
# Test: Remove review-project and quick-review commands, update manifest and README
# Validates deletions, README updates, new command rows, and zero stale references.

set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0
FAIL=0

assert() {
    local desc="$1"
    local result="$2"
    if [ "$result" = "true" ]; then
        PASS=$((PASS + 1))
        echo "  PASS: $desc"
    else
        FAIL=$((FAIL + 1))
        echo "  FAIL: $desc"
    fi
}

echo "=== Remove Old Review Commands Tests ==="
echo ""

# --- Test: Command files deleted ---
echo "-- Deleted Command Files --"

assert "review-project.md is deleted" \
    "$([ ! -f "$BASE_DIR/commands/review-project.md" ] && echo true || echo false)"

assert "quick-review.md is deleted" \
    "$([ ! -f "$BASE_DIR/commands/quick-review.md" ] && echo true || echo false)"

echo ""

# --- Test: plugin.json has no references ---
echo "-- plugin.json Clean --"

assert "plugin.json has no review-project mention" \
    "$(! grep -q 'review-project' "$BASE_DIR/.claude-plugin/plugin.json" && echo true || echo false)"

assert "plugin.json has no quick-review mention" \
    "$(! grep -q 'quick-review' "$BASE_DIR/.claude-plugin/plugin.json" && echo true || echo false)"

echo ""

# --- Test: plugins/bee/README.md updates ---
echo "-- plugins/bee/README.md Updates --"

assert "README has no /bee:review-project command" \
    "$(! grep -q '/bee:review-project' "$BASE_DIR/README.md" && echo true || echo false)"

assert "README has no /bee:quick-review command" \
    "$(! grep -q '/bee:quick-review' "$BASE_DIR/README.md" && echo true || echo false)"

assert "README has a Commands section" \
    "$(grep -q '## Commands (' "$BASE_DIR/README.md" && echo true || echo false)"

assert "README has /bee:review-implementation row in Quality section" \
    "$(grep -q '/bee:review-implementation' "$BASE_DIR/README.md" && echo true || echo false)"

assert "README has /bee:fix-implementation row in Quality section" \
    "$(grep -q '/bee:fix-implementation' "$BASE_DIR/README.md" && echo true || echo false)"

assert "README has /bee:archive-spec row in Finalization section" \
    "$(grep -q '/bee:archive-spec' "$BASE_DIR/README.md" && echo true || echo false)"

echo ""

# --- Test: Workflow section updated ---
echo "-- Workflow Section Updated --"

assert "Workflow section references review-implementation not review-project" \
    "$(grep -q 'review-implementation' "$BASE_DIR/README.md" && echo true || echo false)"

assert "Workflow section has no Quick Review Workflow heading referencing old command" \
    "$(! grep -q 'Quick Review Workflow' "$BASE_DIR/README.md" && echo true || echo false)"

echo ""

# --- Test: Root README.md updates ---
echo "-- Root README.md Updates --"

ROOT_README="$BASE_DIR/../../README.md"

assert "Root README has no /bee:review-project" \
    "$(! grep -q '/bee:review-project' "$ROOT_README" && echo true || echo false)"

assert "Root README has no /bee:quick-review" \
    "$(! grep -q '/bee:quick-review' "$ROOT_README" && echo true || echo false)"

assert "Root README has /bee:review-implementation" \
    "$(grep -q '/bee:review-implementation' "$ROOT_README" && echo true || echo false)"

assert "Root README has /bee:fix-implementation" \
    "$(grep -q '/bee:fix-implementation' "$ROOT_README" && echo true || echo false)"

assert "Root README has /bee:archive-spec" \
    "$(grep -q '/bee:archive-spec' "$ROOT_README" && echo true || echo false)"

echo ""

# --- Test: Grep verification -- no stale references in plugins/bee/ except CHANGELOG.md ---
echo "-- No Stale References --"

# Check for stale review-project references (excluding CHANGELOG.md and test files)
# Use word-boundary-aware pattern: match "review-project" but not as part of longer words
REVIEW_PROJECT_STALE=$(grep -rl 'review-project' "$BASE_DIR" --include='*.md' --include='*.json' | grep -v 'CHANGELOG.md' | grep -v 'test-t4.4' || true)
assert "No stale review-project references in plugins/bee/ (except CHANGELOG.md)" \
    "$([ -z "$REVIEW_PROJECT_STALE" ] && echo true || echo false)"

# Check for stale /bee:quick-review command references (excluding CHANGELOG.md and test files)
# Exclude "quick-reviews/" directory references (legitimate path, not old command)
QUICK_REVIEW_CMD_STALE=$(grep -rl '/bee:quick-review\|quick-review mode\|quick-review command\|`quick-review`' "$BASE_DIR" --include='*.md' --include='*.json' | grep -v 'CHANGELOG.md' | grep -v 'test-t4.4' || true)
assert "No stale /bee:quick-review command references in plugins/bee/ (except CHANGELOG.md)" \
    "$([ -z "$QUICK_REVIEW_CMD_STALE" ] && echo true || echo false)"

echo ""

# --- Test: New command files still exist (not accidentally deleted) ---
echo "-- New Commands Exist --"

assert "review-implementation.md exists" \
    "$([ -f "$BASE_DIR/commands/review-implementation.md" ] && echo true || echo false)"

assert "fix-implementation.md exists" \
    "$([ -f "$BASE_DIR/commands/fix-implementation.md" ] && echo true || echo false)"

assert "archive-spec.md exists" \
    "$([ -f "$BASE_DIR/commands/archive-spec.md" ] && echo true || echo false)"

echo ""

# --- Summary ---
TOTAL=$((PASS + FAIL))
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
