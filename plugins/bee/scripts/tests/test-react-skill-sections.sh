#!/usr/bin/env bash
# Test: React SKILL.md structured sections validation
# Validates that the react stack skill has 5 required sections with min 5 entries each,
# all existing content is preserved, and specific must-have entries exist.

set -euo pipefail

SKILL_FILE="$(dirname "$0")/../../skills/stacks/react/SKILL.md"
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

echo "=== React SKILL.md Structured Sections Tests ==="
echo ""

# --- Test: Existing content is preserved ---
echo "-- Existing Content Preservation --"

assert "Frontmatter preserved" \
    "$(grep -q '^name: react$' "$SKILL_FILE" && echo true || echo false)"

assert "Component Architecture section preserved" \
    "$(grep -q '## Component Architecture' "$SKILL_FILE" && echo true || echo false)"

assert "Hooks section preserved" \
    "$(grep -q '## Hooks' "$SKILL_FILE" && echo true || echo false)"

assert "State Management section preserved" \
    "$(grep -q '## State Management' "$SKILL_FILE" && echo true || echo false)"

assert "Routing section preserved" \
    "$(grep -q '## Routing' "$SKILL_FILE" && echo true || echo false)"

assert "Build and Tooling section preserved" \
    "$(grep -q '## Build and Tooling' "$SKILL_FILE" && echo true || echo false)"

assert "Testing section preserved" \
    "$(grep -q '## Testing' "$SKILL_FILE" && echo true || echo false)"

assert "Common Pitfalls section preserved" \
    "$(grep -q '## Common Pitfalls' "$SKILL_FILE" && echo true || echo false)"

assert "Context7 Instructions section preserved" \
    "$(grep -q '## Context7 Instructions' "$SKILL_FILE" && echo true || echo false)"

echo ""

# --- Test: 5 required sections exist ---
echo "-- Required Sections Exist --"

assert "Must-Haves section exists" \
    "$(grep -q '## Must-Haves' "$SKILL_FILE" && echo true || echo false)"

assert "Good Practices section exists" \
    "$(grep -q '## Good Practices' "$SKILL_FILE" && echo true || echo false)"

assert "Common Bugs section exists" \
    "$(grep -q '## Common Bugs' "$SKILL_FILE" && echo true || echo false)"

assert "Anti-Patterns section exists" \
    "$(grep -q '## Anti-Patterns' "$SKILL_FILE" && echo true || echo false)"

assert "Standards section exists" \
    "$(grep -q '## Standards' "$SKILL_FILE" && echo true || echo false)"

echo ""

# --- Test: Minimum 5 entries per section ---
# Entries are lines starting with "- " within a section (between ## headings)
echo "-- Minimum 5 Entries Per Section --"

count_entries() {
    local section="$1"
    # Extract lines between the section heading and the next ## heading, count "- " lines
    # Use sed to extract the section content (exclude the heading itself and next heading)
    local count
    count=$(sed -n "/^## ${section}/,/^## /{ /^## /d; /^- /p; }" "$SKILL_FILE" | wc -l | tr -d '[:space:]')
    echo "${count:-0}"
}

MUST_HAVES_COUNT=$(count_entries "Must-Haves")
assert "Must-Haves has >= 5 entries (found: $MUST_HAVES_COUNT)" \
    "$([ "$MUST_HAVES_COUNT" -ge 5 ] && echo true || echo false)"

GOOD_PRACTICES_COUNT=$(count_entries "Good Practices")
assert "Good Practices has >= 5 entries (found: $GOOD_PRACTICES_COUNT)" \
    "$([ "$GOOD_PRACTICES_COUNT" -ge 5 ] && echo true || echo false)"

COMMON_BUGS_COUNT=$(count_entries "Common Bugs")
assert "Common Bugs has >= 5 entries (found: $COMMON_BUGS_COUNT)" \
    "$([ "$COMMON_BUGS_COUNT" -ge 5 ] && echo true || echo false)"

ANTI_PATTERNS_COUNT=$(count_entries "Anti-Patterns")
assert "Anti-Patterns has >= 5 entries (found: $ANTI_PATTERNS_COUNT)" \
    "$([ "$ANTI_PATTERNS_COUNT" -ge 5 ] && echo true || echo false)"

STANDARDS_COUNT=$(count_entries "Standards")
assert "Standards has >= 5 entries (found: $STANDARDS_COUNT)" \
    "$([ "$STANDARDS_COUNT" -ge 5 ] && echo true || echo false)"

echo ""

# --- Test: Must-Haves specific required entries ---
echo "-- Must-Haves Required Content --"

must_haves_section() {
    sed -n '/^## Must-Haves$/,/^## /{ /^## /d; p; }' "$SKILL_FILE"
}

assert "Must-Haves includes TypeScript" \
    "$(must_haves_section | grep -qi 'typescript' && echo true || echo false)"

assert "Must-Haves includes function components" \
    "$(must_haves_section | grep -qi 'function component' && echo true || echo false)"

assert "Must-Haves includes custom hooks for stateful logic" \
    "$(must_haves_section | grep -qi 'custom hook' && echo true || echo false)"

assert "Must-Haves includes TDD/Vitest" \
    "$(must_haves_section | grep -qi 'vitest' && echo true || echo false)"

assert "Must-Haves includes key props" \
    "$(must_haves_section | grep -qi 'key' && echo true || echo false)"

echo ""

# --- Test: Good Practices specific required entries ---
echo "-- Good Practices Required Content --"

good_practices_section() {
    sed -n '/^## Good Practices$/,/^## /{ /^## /d; p; }' "$SKILL_FILE"
}

assert "Good Practices includes composition over prop drilling" \
    "$(good_practices_section | grep -qi 'composition.*prop.drilling\|prop.drilling.*composition' && echo true || echo false)"

assert "Good Practices includes React.memo" \
    "$(good_practices_section | grep -qi 'React\.memo\|React.memo' && echo true || echo false)"

assert "Good Practices includes useCallback" \
    "$(good_practices_section | grep -qi 'useCallback' && echo true || echo false)"

assert "Good Practices includes splitting components" \
    "$(good_practices_section | grep -qi 'split' && echo true || echo false)"

assert "Good Practices includes colocating state" \
    "$(good_practices_section | grep -qi 'colocat' && echo true || echo false)"

echo ""

# --- Test: Common Bugs specific required entries ---
echo "-- Common Bugs Required Content --"

common_bugs_section() {
    sed -n '/^## Common Bugs$/,/^## /{ /^## /d; p; }' "$SKILL_FILE"
}

assert "Common Bugs includes stale closure in useEffect" \
    "$(common_bugs_section | grep -qi 'stale.*closure\|closure.*stale' && echo true || echo false)"

assert "Common Bugs includes missing deps" \
    "$(common_bugs_section | grep -qi 'missing.*dep\|dep.*missing' && echo true || echo false)"

assert "Common Bugs includes mutating state directly" \
    "$(common_bugs_section | grep -qi 'mutat.*state' && echo true || echo false)"

assert "Common Bugs includes missing key" \
    "$(common_bugs_section | grep -qi 'missing.*key\|key.*missing' && echo true || echo false)"

assert "Common Bugs includes async after unmount" \
    "$(common_bugs_section | grep -qi 'async.*unmount\|unmount.*async\|state.*unmount' && echo true || echo false)"

echo ""

# --- Test: Anti-Patterns specific required entries ---
echo "-- Anti-Patterns Required Content --"

anti_patterns_section() {
    sed -n '/^## Anti-Patterns$/,/^## /{ /^## /d; p; }' "$SKILL_FILE"
}

assert "Anti-Patterns includes class components" \
    "$(anti_patterns_section | grep -qi 'class.*component' && echo true || echo false)"

assert "Anti-Patterns includes any type" \
    "$(anti_patterns_section | grep -qi 'any.*type\|type.*any\|\bany\b' && echo true || echo false)"

assert "Anti-Patterns includes inline object creation in JSX" \
    "$(anti_patterns_section | grep -qi 'inline.*object\|inline.*JSX\|object.*JSX' && echo true || echo false)"

assert "Anti-Patterns includes mixing concerns" \
    "$(anti_patterns_section | grep -qi 'mix.*concern' && echo true || echo false)"

assert "Anti-Patterns includes useEffect for derived state" \
    "$(anti_patterns_section | grep -qi 'useEffect.*derived\|derived.*useEffect' && echo true || echo false)"

echo ""

# --- Test: Standards specific required entries ---
echo "-- Standards Required Content --"

standards_section() {
    sed -n '/^## Standards$/,/^## /{ /^## /d; p; }' "$SKILL_FILE"
}

assert "Standards includes PascalCase files" \
    "$(standards_section | grep -qi 'PascalCase' && echo true || echo false)"

assert "Standards includes camelCase hooks with use prefix" \
    "$(standards_section | grep -qi 'camelCase.*hook\|hook.*camelCase\|use.*prefix' && echo true || echo false)"

assert "Standards includes barrel exports" \
    "$(standards_section | grep -qi 'barrel.*export' && echo true || echo false)"

assert "Standards includes colocation of tests" \
    "$(standards_section | grep -qi 'colocat.*test\|test.*colocat' && echo true || echo false)"

echo ""

# --- Test: Sections appear AFTER existing content ---
echo "-- Section Ordering --"

PITFALLS_LINE=$(grep -n '## Common Pitfalls' "$SKILL_FILE" | head -1 | cut -d: -f1)
MUST_HAVES_LINE=$(grep -n '## Must-Haves' "$SKILL_FILE" | head -1 | cut -d: -f1)

assert "Must-Haves appears after Common Pitfalls section" \
    "$([ -n "$PITFALLS_LINE" ] && [ -n "$MUST_HAVES_LINE" ] && [ "$MUST_HAVES_LINE" -gt "$PITFALLS_LINE" ] && echo true || echo false)"

echo ""

# --- Summary ---
TOTAL=$((PASS + FAIL))
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
