#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: build-release-body.sh <version> <body-file> <changelog-file>}"
BODY_FILE="${2:?Usage: build-release-body.sh <version> <body-file> <changelog-file>}"
CHANGELOG_FILE="${3:?Usage: build-release-body.sh <version> <body-file> <changelog-file>}"

awk -v ver="$VERSION" '
    $0 ~ "^## \\[" ver "\\]" { flag=1 }
    flag && $0 ~ "^## \\[" && $0 !~ "^## \\[" ver "\\]" { exit }
    flag { print }
' CHANGELOG.md > "$CHANGELOG_FILE"

if [[ ! -s "$CHANGELOG_FILE" ]]; then
    echo "Missing changelog entry for version $VERSION in CHANGELOG.md" >&2
    exit 1
fi

{
    echo "## Changelog"
    echo
    cat "$CHANGELOG_FILE"
    echo
    echo "## Install"
    echo
    echo '```lua'
    echo '-- lazy.nvim'
    echo '{'
    echo '  "piqusy/murmur",'
    echo '  event = "VeryLazy",'
    echo '  config = function() require("murmur").setup() end,'
    echo '}'
    echo '```'
} > "$BODY_FILE"
