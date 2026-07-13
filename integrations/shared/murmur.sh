#!/usr/bin/env bash
# murmur CLI — universal write path for harnesses that can't register native
# tools (Claude Code, Codex, Antigravity). Agents invoke this via their shell
# tool to add or delete murmurs by manipulating sidecar JSON directly.
#
# Usage:
#   murmur.sh add <file> <line> <author> <message>
#   murmur.sh delete-file <file>
#   murmur.sh delete-all [dir]
#
# Requires: jq, date, sed. UUID via uuidgen, /proc/sys/kernel/random/uuid,
# or python3 fallback.

set -euo pipefail

SIDECAR_SUFFIX=".murmur.json"

gen_uuid() {
  if command -v uuidgen &>/dev/null; then
    uuidgen | tr 'A-Z' 'a-z'
  elif [ -f /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  else
    python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null || \
      printf '%x-%x-%x' "$(date +%s)" "$RANDOM" "$RANDOM"
  fi
}

cmd_add() {
  local file="$1" line="$2" author="$3" message="$4"
  local sidecar="${file}${SIDECAR_SUFFIX}"

  if [ ! -f "$file" ]; then
    echo "Error: source file not found: $file" >&2
    exit 1
  fi

  # Extract anchor (trimmed text of the target line)
  local anchor
  anchor=$(sed -n "${line}p" "$file" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

  local id ts
  id=$(gen_uuid)
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Read existing murmurs (empty array if no sidecar or corrupt)
  local murmurs='[]'
  if [ -f "$sidecar" ] && [ -s "$sidecar" ]; then
    if echo "$(cat "$sidecar")" | jq -e 'type == "array"' >/dev/null 2>&1; then
      murmurs=$(cat "$sidecar")
    fi
  fi

  # Append, sort by line, write atomically
  echo "$murmurs" | jq \
    --arg id "$id" \
    --argjson line "$line" \
    --arg anchor "$anchor" \
    --arg author "$author" \
    --arg message "$message" \
    --arg ts "$ts" \
    '. + [{"id":$id,"line":$line,"anchor":$anchor,"author":$author,"message":$message,"created_at":$ts,"orphaned":false}] | sort_by(.line)' \
    > "${sidecar}.tmp" && mv "${sidecar}.tmp" "$sidecar"

  echo "Added murmur at ${file}:${line} [${author}] ${message}"
}

cmd_delete_file() {
  local file="$1"
  local sidecar="${file}${SIDECAR_SUFFIX}"
  if [ -f "$sidecar" ]; then
    local count
    count=$(jq 'length' "$sidecar" 2>/dev/null || echo 0)
    rm "$sidecar"
    echo "Deleted ${count} murmur(s) from ${file}"
  else
    echo "No sidecar found for ${file}"
  fi
}

cmd_delete_all() {
  local dir="${1:-.}"
  local count=0
  while IFS= read -r -d '' f; do
    rm "$f"
    count=$((count + 1))
  done < <(find "$dir" -name "*${SIDECAR_SUFFIX}" \
    -not -path '*/node_modules/*' \
    -not -path '*/.git/*' \
    -not -path '*/.venv/*' \
    -not -path '*/vendor/*' \
    -not -path '*/dist/*' \
    -not -path '*/build/*' \
    -not -path '*/.next/*' \
    -print0 2>/dev/null)
  echo "Deleted ${count} sidecar file(s) under ${dir}"
}

case "${1:-}" in
  add)
    [ "$#" -lt 5 ] && { echo "Usage: murmur.sh add <file> <line> <author> <message>" >&2; exit 1; }
    cmd_add "$2" "$3" "$4" "$5"
    ;;
  delete-file)
    [ "$#" -lt 2 ] && { echo "Usage: murmur.sh delete-file <file>" >&2; exit 1; }
    cmd_delete_file "$2"
    ;;
  delete-all)
    cmd_delete_all "${2:-.}"
    ;;
  *)
    echo "Usage: murmur.sh {add|delete-file|delete-all} ..." >&2
    echo "  add <file> <line> <author> <message>  — append a murmur to the file's sidecar" >&2
    echo "  delete-file <file>                     — remove the file's sidecar" >&2
    echo "  delete-all [dir]                       — remove all sidecars under dir (default: .)" >&2
    exit 1
    ;;
esac
