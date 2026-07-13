# Changelog
## [Unreleased]

### Added
- `:MurmurDeleteFile` — delete all murmurs in the current file (persistent)
- `:MurmurDeleteAll` — delete all murmurs across every open buffer (with confirm)
- Programmatic API: `delete_file_murmurs(bufnr)` and `delete_all_murmurs()`
- Diff view support — fugitive (`:Gdiff`) and gitsigns (`:Gitsigns diffthis`) buffer paths resolved to real source file; murmurs visible on staged/HEAD side via anchor relocation; foreign-revision buffers are read-only with dimmed `⊞` badge
- `foreign` highlight group for diff-view murmur styling
- Exposed `M._resolve_source` and `M._load_murmurs` for testability
- `:MurmurListAll` — list and jump to any murmur in the project (scans all sidecar files, not just current buffer)
- Gitsigns diff buffer support (`gitsigns://` URI resolution)
- Agent write tools — `add_murmur`, `delete_file_murmurs`, `delete_all_murmurs` registered as native tools in OMP and OpenCode integrations
- Shared CLI (`integrations/shared/murmur.sh`) for hook-based harnesses (Claude Code, Codex, Antigravity) — agents invoke via shell tool to add/delete murmurs
- PreToolUse hooks now include the `murmur.sh` CLI path in their output when murmurs exist

### Fixed
- `write_sidecar` now deletes the sidecar file for empty data instead of writing `[]` — prevents accidental data loss from empty-table overwrites
- Atomic sidecar writes (temp file + rename) — prevents partial writes on crash
- `suppress` state cleaned up on `BufDelete` — prevents stale suppress flags on buffer number reuse


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
- **Oh My Pi / Pi** — Echo extension with `before_agent_start` auto-inject, `read_murmur`/`add_murmur`/`delete_file_murmurs`/`delete_all_murmurs` tools, and `/murmur-scan` slash command
- **Claude Code** — `PreToolUse` hook injecting sidecar constraints as `additionalContext` before file edits + `murmur.sh` CLI for writes
- **OpenCode** — Custom `read_murmur`, `add_murmur`, `delete_file_murmurs`, `delete_all_murmurs` tools using `@opencode-ai/plugin`'s `tool()` helper
- **Codex CLI** — `PreToolUse` lifecycle hook + `murmur.sh` CLI for writes
- **Antigravity CLI** — Plugin with `PreToolUse` hook + `murmur.sh` CLI for writes