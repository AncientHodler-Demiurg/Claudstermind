#!/bin/bash
# PostToolUse hook: detect and run project linter on edited file
# Receives JSON on stdin with tool_input.file_path
# Exit 0 = silent success, Exit 2 = stderr fed to Claude as feedback

# Do NOT use set -euo pipefail -- hook must handle errors gracefully
# (non-zero exit before handler runs can block all file writes)

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip if no file path (shouldn't happen for Write|Edit, but safety check)
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Skip non-source files
case "$FILE_PATH" in
  *.php|*.js|*.ts|*.jsx|*.tsx|*.vue|*.css|*.scss|*.svelte|*.mjs|*.mts|*.less)
    # Continue to lint
    ;;
  *)
    exit 0
    ;;
esac

# Skip if file doesn't exist (was deleted)
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

PROJECT_DIR="$CLAUDE_PROJECT_DIR"

# Determine linter based on file extension (avoids running PHP linter on JS files in monorepos)
EXT="${FILE_PATH##*.}"

case "$EXT" in
    php)
        if [ -f "$PROJECT_DIR/vendor/bin/pint" ]; then
            OUTPUT=$("$PROJECT_DIR/vendor/bin/pint" "$FILE_PATH" 2>&1) || {
                echo "$OUTPUT" >&2
                exit 2
            }
        fi
        ;;
    js|ts|jsx|tsx|vue|svelte|mjs|mts)
        if [ -f "$PROJECT_DIR/node_modules/.bin/eslint" ]; then
            OUTPUT=$("$PROJECT_DIR/node_modules/.bin/eslint" --fix "$FILE_PATH" 2>&1) || {
                echo "$OUTPUT" >&2
                exit 2
            }
        elif [ -f "$PROJECT_DIR/node_modules/.bin/prettier" ]; then
            OUTPUT=$("$PROJECT_DIR/node_modules/.bin/prettier" --write "$FILE_PATH" 2>&1) || {
                echo "$OUTPUT" >&2
                exit 2
            }
        elif [ -f "$PROJECT_DIR/node_modules/.bin/biome" ]; then
            OUTPUT=$("$PROJECT_DIR/node_modules/.bin/biome" check --write "$FILE_PATH" 2>&1) || {
                echo "$OUTPUT" >&2
                exit 2
            }
        fi
        ;;
    css|scss|less)
        if [ -f "$PROJECT_DIR/node_modules/.bin/prettier" ]; then
            OUTPUT=$("$PROJECT_DIR/node_modules/.bin/prettier" --write "$FILE_PATH" 2>&1) || {
                echo "$OUTPUT" >&2
                exit 2
            }
        elif [ -f "$PROJECT_DIR/node_modules/.bin/biome" ]; then
            OUTPUT=$("$PROJECT_DIR/node_modules/.bin/biome" check --write "$FILE_PATH" 2>&1) || {
                echo "$OUTPUT" >&2
                exit 2
            }
        fi
        ;;
esac

# No linter found or linter succeeded -- silent exit
exit 0
