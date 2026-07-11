#!/usr/bin/env bash
# murmur hook: Codex CLI PreToolUse — injects user-pinned line constraints
# into the agent's context before Edit/Write/MultiEdit tool calls.
# Reads JSON from stdin { tool_name, tool_input: { file_path } },
# checks for a .murmur.json sidecar, and outputs hookSpecificOutput
# with the formatted constraints as additionalContext.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only intercept file-modifying tools.
case "$TOOL_NAME" in
  Edit|Write|MultiEdit)
    ;;
  *)
    exit 0
    ;;
esac

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

MURMUR_FILE="${FILE_PATH}.murmur.json"

if [ ! -f "$MURMUR_FILE" ]; then
  exit 0
fi

if [ ! -s "$MURMUR_FILE" ]; then
  exit 0
fi

MURMURS=$(cat "$MURMUR_FILE")

# Validate it's a non-empty array.
FIRST_CHAR=$(echo "$MURMURS" | head -c 1)
if [ "$FIRST_CHAR" != "[" ]; then
  exit 0
fi

if echo "$MURMURS" | jq -e '. | length == 0' >/dev/null 2>&1; then
  exit 0
fi

# Build the constraint block.
CONSTRAINTS=$(echo "$MURMURS" | jq -r '
  map("Line \(.line) [\(.author // "User")] — \(.message // "") (anchored: \"\(.anchor // "")\")")
  | .[]' | while IFS= read -r line; do
    echo "    $line"
  done
)

BLOCK=$(cat <<EOF
Murmurs for $FILE_PATH — user-pinned constraints you must honor:
$CONSTRAINTS
EOF
)

# Output in the format Codex CLI expects for PreToolUse hooks.
jq -n -c \
  --arg context "$BLOCK" \
  '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": $context}}'
