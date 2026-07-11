# Changelog

## [0.1.0] — 2026-07-11

### Added
- Sidecar JSON storage (`<file>.murmur.json`) with line-drift tracking via content anchors
- Box rendering mode — closed `╭─│─╰` frame with author, message, and source line number
- Inline rendering mode — compact EOL shadow text (`Author: message`)
- Persistent sign-column indicator (`◉`)
- Content wrapping for long messages (box mode)
- Pluggable picker — snacks / telescope / fzf-lua / builtin `vim.ui.select`
- Orphan detection — marks murmurs whose anchor text can't be relocated within ±20 lines
- User (teal) vs agent (purple) visual distinction

### Integrations
- **Oh My Pi / Pi** — Echo extension with `before_agent_start` auto-inject, `read_murmur` tool, and `/murmur-scan` slash command
- **Claude Code** — `PreToolUse` hook injecting sidecar constraints as `additionalContext` before file edits
- **OpenCode** — Custom `read_murmur` tool using `@opencode-ai/plugin`'s `tool()` helper
- **Codex CLI** — `PreToolUse` lifecycle hook (same format as Claude Code)
- **Antigravity CLI** — Plugin with `PreToolUse` hook