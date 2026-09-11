#!/bin/bash
# PreToolUse hook: validate linter/test gates before allowing git commit
# Receives JSON on stdin with tool_input.command
# Output contract (three shapes):
#   Exit 0 with no stdout                          = allow
#   Exit 0 with {"decision":"block","reason":...}  = block
#   Exit 0 with {"systemMessage":...}              = allow WITH a user-visible warning
#     (used only by the bee self-gate: baselined known-failing suites, budget skips,
#      and fail-open infrastructure notices must be visible without blocking)
# Do NOT use set -euo pipefail -- handle missing files gracefully
#
# Strategy:
#   - Lint only staged files matching each linter's extensions (skip the linter
#     entirely when no matching staged files exist; never accidentally run a
#     full-repo lint).
#   - For tests: vitest/jest use `related` / `--findRelatedTests` so only tests
#     that import the staged files run. Pest/PHPUnit fall back to the full
#     suite (deriving --filter from staged class names misses traits, factories,
#     observers and other indirect deps -- too brittle to be safe).
#   - Within each stack, lint and tests run in parallel (background jobs + wait).
#     Stacks themselves stay sequential for debuggability.
#   - Fast-path: when no source files are staged at all (markdown-only commits,
#     .bee/ writes, dotfiles, JSON/YAML), skip the gate entirely.
#   - Bee self-gate (runs BEFORE the fast path): when the repo being committed is
#     bee itself (stacks[0].name == "claude-code-plugin" AND plugins/bee/ exists),
#     markdown IS source -- staged paths (incl. deletions + both rename endpoints)
#     map to affected meta-test suites via affected-suites.js and run through
#     run-meta-tests.js's subset entry point with the known-failing baseline and
#     a 90s budget. Non-baselined failures block; baselined failures and budget
#     skips warn-and-allow; infrastructure failures (runner exit 2, mapper crash,
#     node absent, scripts not yet present) FAIL OPEN with a warning. Everything
#     it invokes resolves from $CLAUDE_PROJECT_DIR (the working tree) -- this
#     script itself runs from the installed plugin cache. Non-bee projects are
#     untouched: detection short-circuits and the original flow continues.
#
# Robustness:
#   - xargs reads null-delimited input so filenames with spaces or quotes pass
#     as single arguments.
#   - Stack paths starting with `/` or containing `..` are rejected -- a stack
#     always lives under the project root.
#   - vitest's `related` falls back to the full suite when no matching tests
#     are found (matched by error text or empty log) so genuine failures still
#     surface.
#   - When `timeout` is available, test commands are bounded to 100s -- well
#     under the hook's outer 120s cap, so hangs cannot leak orphaned processes.
#
# Backwards compatibility: legacy global `.linter` / `.testRunner` (no `stacks`
# array) is treated as one virtual stack at path "." with the global tools.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Skip if not a git commit command
if ! echo "$COMMAND" | grep -qE '\bgit\s+commit\b'; then
  exit 0
fi

# Skip if no .bee/config.json (not a bee project)
CONFIG_FILE="$CLAUDE_PROJECT_DIR/.bee/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

# --- Bee self-gate (before the fast path: bee's deliverables are markdown) ----
BEE_STACK=$(jq -r '.stacks[0].name // empty' "$CONFIG_FILE" 2>/dev/null)
if [ "$BEE_STACK" = "claude-code-plugin" ] && [ -d "$CLAUDE_PROJECT_DIR/plugins/bee" ]; then
  BEE_RUNNER="$CLAUDE_PROJECT_DIR/plugins/bee/scripts/run-meta-tests.js"
  BEE_MAPPER="$CLAUDE_PROJECT_DIR/plugins/bee/scripts/affected-suites.js"
  if [ -f "$BEE_RUNNER" ] && [ -f "$BEE_MAPPER" ] && command -v node >/dev/null 2>&1; then
    # Own staged list: include deletions and BOTH rename endpoints (a deleted or
    # renamed roster-pinned file is the highest-value mapping input). ALL_STAGED
    # below stays --diff-filter=ACM for the non-bee flow.
    BEE_STAGED=$(git diff --cached --name-status -M 2>/dev/null | awk -F'\t' '{ for (i=2; i<=NF; i++) print $i }')
    if [ -n "$BEE_STAGED" ]; then
      BEE_AFFECTED=$(echo "$BEE_STAGED" | node "$BEE_MAPPER" --root "$CLAUDE_PROJECT_DIR" --stdin 2>/dev/null)
      BEE_MAP_RC=$?
      if [ "$BEE_MAP_RC" != "0" ]; then
        # Fail open on tooling failure -- visible, never blocking.
        echo '{"systemMessage": "bee self-gate: affected-suites mapper failed -- commit allowed WITHOUT meta-test gating (fail-open). Run: node plugins/bee/scripts/run-meta-tests.js"}'
        exit 0
      fi
      if [ -n "$BEE_AFFECTED" ]; then
        BEE_OUT=$(echo "$BEE_AFFECTED" | node "$BEE_RUNNER" --root "$CLAUDE_PROJECT_DIR" --subset-stdin --budget-ms 90000 --suite-timeout-ms 60000 2>/dev/null)
        BEE_RC=$?
        if [ "$BEE_RC" = "1" ]; then
          BEE_FAILS=$(echo "$BEE_OUT" | grep '^FAIL ' | head -10)
          jq -nc --arg r "Pre-commit gate (bee meta-tests): non-baselined suite(s) failing -- fix before committing.
$BEE_FAILS" '{"decision":"block","reason":$r}'
          exit 0
        elif [ "$BEE_RC" = "2" ]; then
          echo '{"systemMessage": "bee self-gate: meta-test runner infrastructure failure -- commit allowed WITHOUT gating (fail-open). Run: node plugins/bee/scripts/run-meta-tests.js"}'
          exit 0
        fi
        BEE_NOTES=$(echo "$BEE_OUT" | grep -E '^(WARN|SKIP) ')
        if [ -n "$BEE_NOTES" ]; then
          jq -nc --arg m "bee self-gate: commit allowed with warnings:
$BEE_NOTES" '{"systemMessage":$m}'
          exit 0
        fi
      fi
    fi
    # Zero staged / zero affected / all PASS: fall through to the original flow
    # (purely additive -- bee's own linter/testRunner are "none", so the original
    # flow is a no-op for bee, but a future configured linter would still run).
  fi
  # Runner/mapper not present yet (pre-Phase-1 tree): fail open silently.
fi
# --- end bee self-gate ---------------------------------------------------------

# Fast-path: if no source files are staged, skip gate entirely so
# markdown-only / config-only / dotfile commits don't pay any lint/test cost.
ALL_STAGED=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)
SOURCE_FILES=$(echo "$ALL_STAGED" | grep -E '\.(php|js|ts|jsx|tsx|vue|css|scss|svelte|mjs|mts|cjs|cts|less|py|go|rs|rb)$')
if [ -z "$SOURCE_FILES" ]; then
  exit 0
fi

# Detect `timeout` binary (GNU coreutils on Linux, gtimeout on macOS+brew).
# When present, wrap test commands to bound runtime under the hook's 120s cap
# so a hung test can't leak background processes.
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout 100"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout 100"
else
  TIMEOUT_CMD=""
fi

# Read config in a single jq invocation
CONFIG_JSON=$(jq -c '{stacks: (.stacks // []), linter: (.linter // "none"), testRunner: (.testRunner // "none")}' "$CONFIG_FILE" 2>/dev/null)
[ -z "$CONFIG_JSON" ] && exit 0

STACKS=$(echo "$CONFIG_JSON" | jq -c '.stacks' 2>/dev/null)
GLOBAL_LINTER=$(echo "$CONFIG_JSON" | jq -r '.linter' 2>/dev/null)
GLOBAL_RUNNER=$(echo "$CONFIG_JSON" | jq -r '.testRunner' 2>/dev/null)

STACKS_LEN=$(echo "$STACKS" | jq 'length' 2>/dev/null)
[ -z "$STACKS_LEN" ] && STACKS_LEN=0

# Backwards compat: if no stacks array, synthesize one virtual stack at "."
# using the global linter/runner. Same fallback chain as before.
if [ "$STACKS_LEN" = "0" ]; then
  if [ "$GLOBAL_LINTER" = "none" ] && [ "$GLOBAL_RUNNER" = "none" ]; then
    exit 0
  fi
  STACKS=$(jq -nc --arg l "$GLOBAL_LINTER" --arg r "$GLOBAL_RUNNER" \
    '[{path: ".", linter: $l, testRunner: $r}]')
fi

LINT_FAILED=0
TEST_FAILED=0
LINT_OUTPUT=""
TEST_OUTPUT=""

# Cleanup helper for temp files
GATE_PID=$$
cleanup_tmp() {
  rm -f /tmp/lint.${GATE_PID}.*.log /tmp/lint.${GATE_PID}.*.rc \
        /tmp/test.${GATE_PID}.*.log /tmp/test.${GATE_PID}.*.rc 2>/dev/null
}
trap cleanup_tmp EXIT

# Helper: filter staged files by extension regex, restricted to a stack path.
# Outputs paths relative to the stack path (so linters/test runners receive
# correct relative paths when run from $WORK_DIR).
#   $1 = extension regex (e.g. '\.php$')
#   $2 = stack path (e.g. "." or "backend")
filter_staged() {
  local ext_re="$1"
  local stack_path="$2"
  if [ "$stack_path" = "." ]; then
    echo "$ALL_STAGED" | grep -E "$ext_re"
  else
    echo "$ALL_STAGED" | grep "^${stack_path}/" | grep -E "$ext_re" | sed "s|^${stack_path}/||"
  fi
}

# Pipe a newline-delimited list to xargs as null-delimited so filenames with
# spaces/quotes/tabs pass as single args. Each call site guards on
# `if [ -n "$FILES" ]` to ensure xargs never runs the command with no args
# (which for many linters means "lint everything"). Works on macOS (BSD) and
# Linux (GNU) -- both `tr` and `xargs -0` are POSIX-portable.
xargs0() {
  tr '\n' '\0' | xargs -0 "$@"
}

# Process each stack sequentially via process substitution (`done < <(...)`).
# Do NOT "simplify" to a pipe-while (`echo ... | while read`): a pipe creates
# a subshell where the LINT_FAILED / TEST_FAILED writes are silently dropped,
# letting failures escape the gate.
STACK_INDEX=0
while IFS= read -r STACK; do
    [ -z "$STACK" ] && continue
    STACK_INDEX=$((STACK_INDEX + 1))

    STACK_PATH=$(echo "$STACK" | jq -r '.path // "."')

    # Reject suspicious stack paths (defense in depth against a corrupted or
    # malicious .bee/config.json). Absolute paths and `..` traversal are never
    # legitimate -- a stack always lives under the project root.
    case "$STACK_PATH" in
        /*|*..*) continue ;;
    esac

    # Suffix with the loop index so name collisions (e.g. `frontend/web` and
    # `frontend.web` both sanitize to `frontend_web`) don't share temp files.
    STACK_NAME_BASE=$(echo "$STACK" | jq -r '.name // .path // "default"' | tr -c 'A-Za-z0-9_' '_')
    STACK_NAME="${STACK_NAME_BASE}_${STACK_INDEX}"
    STACK_LINTER=$(echo "$STACK" | jq -r '.linter // empty')
    STACK_RUNNER=$(echo "$STACK" | jq -r '.testRunner // empty')

    # Fallback to global values if per-stack not set (backwards compat)
    [ -z "$STACK_LINTER" ] && STACK_LINTER="$GLOBAL_LINTER"
    [ -z "$STACK_RUNNER" ] && STACK_RUNNER="$GLOBAL_RUNNER"

    # Skip stack if no staged files belong to it
    if [ "$STACK_PATH" = "." ]; then
        HAS_FILES=$(echo "$ALL_STAGED" | head -1)
    else
        HAS_FILES=$(echo "$ALL_STAGED" | grep "^${STACK_PATH}/" | head -1)
    fi
    [ -z "$HAS_FILES" ] && continue

    # Resolve working directory for this stack
    WORK_DIR="$CLAUDE_PROJECT_DIR"
    [ "$STACK_PATH" != "." ] && WORK_DIR="$CLAUDE_PROJECT_DIR/$STACK_PATH"

    LINT_LOG="/tmp/lint.${GATE_PID}.${STACK_NAME}.log"
    LINT_RC_FILE="/tmp/lint.${GATE_PID}.${STACK_NAME}.rc"
    TEST_LOG="/tmp/test.${GATE_PID}.${STACK_NAME}.log"
    TEST_RC_FILE="/tmp/test.${GATE_PID}.${STACK_NAME}.rc"
    LINT_PID=""
    TEST_PID=""

    # ---- Incremental lint (only staged files for this stack) ----
    if [ "$STACK_LINTER" != "none" ] && [ -n "$STACK_LINTER" ]; then
        case "$STACK_LINTER" in
            pint)
                if [ -f "$WORK_DIR/vendor/bin/pint" ]; then
                    PHP_FILES=$(filter_staged '\.php$' "$STACK_PATH")
                    if [ -n "$PHP_FILES" ]; then
                        ( cd "$WORK_DIR" && echo "$PHP_FILES" | xargs0 vendor/bin/pint --test > "$LINT_LOG" 2>&1; echo $? > "$LINT_RC_FILE" ) &
                        LINT_PID=$!
                    fi
                fi
                ;;
            eslint)
                if [ -f "$WORK_DIR/node_modules/.bin/eslint" ]; then
                    JS_FILES=$(filter_staged '\.(js|ts|jsx|tsx|vue|mjs|mts|cjs|cts)$' "$STACK_PATH")
                    if [ -n "$JS_FILES" ]; then
                        ( cd "$WORK_DIR" && echo "$JS_FILES" | xargs0 npx eslint > "$LINT_LOG" 2>&1; echo $? > "$LINT_RC_FILE" ) &
                        LINT_PID=$!
                    fi
                fi
                ;;
            prettier)
                if [ -f "$WORK_DIR/node_modules/.bin/prettier" ]; then
                    # Restrict prettier to code files only so unrelated .md /
                    # .json / .yml staged alongside don't trigger format noise
                    # outside the source change being committed.
                    PRETTIER_FILES=$(filter_staged '\.(js|ts|jsx|tsx|vue|css|scss|less|mjs|mts|cjs|cts)$' "$STACK_PATH")
                    if [ -n "$PRETTIER_FILES" ]; then
                        ( cd "$WORK_DIR" && echo "$PRETTIER_FILES" | xargs0 npx prettier --check > "$LINT_LOG" 2>&1; echo $? > "$LINT_RC_FILE" ) &
                        LINT_PID=$!
                    fi
                fi
                ;;
            biome)
                if [ -f "$WORK_DIR/node_modules/.bin/biome" ]; then
                    BIOME_FILES=$(filter_staged '\.(js|ts|jsx|tsx|json|jsonc|mjs|mts|cjs|cts)$' "$STACK_PATH")
                    if [ -n "$BIOME_FILES" ]; then
                        ( cd "$WORK_DIR" && echo "$BIOME_FILES" | xargs0 npx biome check > "$LINT_LOG" 2>&1; echo $? > "$LINT_RC_FILE" ) &
                        LINT_PID=$!
                    fi
                fi
                ;;
        esac
    fi

    # ---- Test impact analysis (vitest/jest); lint+tests run in parallel ----
    if [ "$STACK_RUNNER" != "none" ] && [ -n "$STACK_RUNNER" ]; then
        case "$STACK_RUNNER" in
            pest)
                # Pest has no clean related-tests equivalent -- fall back to full suite.
                # Deriving --filter from staged class names is too brittle (trait
                # users, factories, observers won't be picked up).
                if [ -f "$WORK_DIR/vendor/bin/pest" ]; then
                    PHP_TEST_FILES=$(filter_staged '\.php$' "$STACK_PATH")
                    if [ -n "$PHP_TEST_FILES" ]; then
                        ( cd "$WORK_DIR" && $TIMEOUT_CMD php artisan test --parallel > "$TEST_LOG" 2>&1; echo $? > "$TEST_RC_FILE" ) &
                        TEST_PID=$!
                    fi
                fi
                ;;
            phpunit)
                # Same caveat as pest -- no clean related-tests; full suite.
                if [ -f "$WORK_DIR/vendor/bin/phpunit" ]; then
                    PHP_TEST_FILES=$(filter_staged '\.php$' "$STACK_PATH")
                    if [ -n "$PHP_TEST_FILES" ]; then
                        ( cd "$WORK_DIR" && $TIMEOUT_CMD vendor/bin/phpunit > "$TEST_LOG" 2>&1; echo $? > "$TEST_RC_FILE" ) &
                        TEST_PID=$!
                    fi
                fi
                ;;
            vitest)
                if [ -f "$WORK_DIR/node_modules/.bin/vitest" ]; then
                    JS_TEST_FILES=$(filter_staged '\.(js|ts|jsx|tsx|vue|mjs|mts|cjs|cts)$' "$STACK_PATH")
                    if [ -n "$JS_TEST_FILES" ]; then
                        # `vitest related` runs only tests that import the staged
                        # files. Fall back to the full suite when the log matches
                        # a "no tests found" message OR is empty (vitest version
                        # mismatch on the error string) -- err on the side of
                        # running MORE rather than skipping a real failure.
                        ( cd "$WORK_DIR" && echo "$JS_TEST_FILES" | xargs0 $TIMEOUT_CMD npx vitest related --run > "$TEST_LOG" 2>&1
                          rc=$?
                          if [ $rc -ne 0 ]; then
                              if grep -qiE 'no test files|no tests found|no matching|no spec' "$TEST_LOG" 2>/dev/null || [ ! -s "$TEST_LOG" ]; then
                                  $TIMEOUT_CMD npx vitest run > "$TEST_LOG" 2>&1
                                  rc=$?
                              fi
                          fi
                          echo $rc > "$TEST_RC_FILE" ) &
                        TEST_PID=$!
                    fi
                fi
                ;;
            jest)
                if [ -f "$WORK_DIR/node_modules/.bin/jest" ]; then
                    JS_TEST_FILES=$(filter_staged '\.(js|ts|jsx|tsx|mjs|mts|cjs|cts)$' "$STACK_PATH")
                    if [ -n "$JS_TEST_FILES" ]; then
                        ( cd "$WORK_DIR" && echo "$JS_TEST_FILES" | xargs0 $TIMEOUT_CMD npx jest --findRelatedTests --passWithNoTests > "$TEST_LOG" 2>&1; echo $? > "$TEST_RC_FILE" ) &
                        TEST_PID=$!
                    fi
                fi
                ;;
        esac
    fi

    # Wait for both lint and tests for this stack (Fix 3).
    [ -n "$LINT_PID" ] && wait "$LINT_PID" 2>/dev/null
    [ -n "$TEST_PID" ] && wait "$TEST_PID" 2>/dev/null

    if [ -n "$LINT_PID" ]; then
        LINT_RC=$(cat "$LINT_RC_FILE" 2>/dev/null || echo 0)
        if [ "$LINT_RC" != "0" ]; then
            LINT_FAILED=1
            LINT_OUTPUT="$LINT_OUTPUT$(cat "$LINT_LOG" 2>/dev/null)\n"
        fi
    fi
    if [ -n "$TEST_PID" ]; then
        TEST_RC=$(cat "$TEST_RC_FILE" 2>/dev/null || echo 0)
        if [ "$TEST_RC" != "0" ]; then
            TEST_FAILED=1
            TEST_OUTPUT="$TEST_OUTPUT$(cat "$TEST_LOG" 2>/dev/null)\n"
        fi
    fi
done < <(echo "$STACKS" | jq -c '.[]' 2>/dev/null)

if [ "$LINT_FAILED" = "1" ]; then
    echo '{"decision": "block", "reason": "Pre-commit gate: linter errors found. Fix them before committing."}'
    exit 0
fi

if [ "$TEST_FAILED" = "1" ]; then
    echo '{"decision": "block", "reason": "Pre-commit gate: tests failing. Fix them before committing."}'
    exit 0
fi

# All gates passed -- allow commit
exit 0
