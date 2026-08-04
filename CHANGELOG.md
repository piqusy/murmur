# Changelog
## [0.4.0] — 2026-08-04

### Added
- Multiline murmurs: `:MurmurAdd` can anchor a visual selection as an inclusive `L:START-END` range, with start and end anchors that follow buffer edits.
- Optional `end_line` support for OMP, OpenCode, and `murmur.sh add` integrations.

### Changed
- Murmur range labels are rendered consistently in Neovim and harness output.

## [0.3.2] — 2026-08-03

### Fixed
- Mirror workflow (`mirror-lua.yml`) Layer step now uses `git add -A` instead of per-path `git add` with error-swallowing — new directories (`lua/`, `spec/`) were silently skipped, causing the mirror to publish empty content.

### Changed
- Mirror workflow supports `workflow_dispatch` with explicit `version` input (validated against `vMAJOR.MINOR.PATCH`) — `github.ref_name` is empty on manual dispatch, so backfilling a tag no longer requires re-pushing it.
- Mirror workflow resolves version once via a dedicated step and passes it as env to downstream steps.

### Added
- README Quick Start section: 4-step install + harness comparison table (auto-inject ✅ vs manual ⚠️) + verify step.
- README Troubleshooting / FAQ table (8 common issues with fixes).
- README v0.3.1 callout for `murmur.sh scan` / `murmur.sh list` (proactive project-wide index).


## [0.3.1] — 2026-07-29

### Changed
- OMP `read_murmur` wrapper now reports per-file status (`annotated` | `clear` | `invalid_sidecar` | `missing_source`) instead of collapsing every non-annotated case to "Clear to edit." — agents that hit a malformed sidecar or a deleted source file now see the actual condition.

### Fixed
- OMP `read_murmur` wrapper no longer hides `invalid_sidecar` / `missing_source` results behind the "Clear to edit." string.
- Documented `scanMurmurFiles` `maxDepth` default (`+Infinity`) and how to opt back into the legacy depth-6 cap.

### Added
- GitHub Actions workflow `.github/workflows/integration-ci.yml` — on PRs that touch `integrations/**` and on every `v*` tag push: runs `bun test spec/murmur_integration.spec.ts`, `bun scripts/murmur-core-smoke.ts`, and `node --check` on every integration module. Closes the CI gap that left OMP/OpenCode edits unverified.
- GitHub Actions workflow `.github/workflows/mirror-lua.yml` — on every `v*` tag push: clones `piqusy/murmur.nvim`, layers `lua/`, `spec/`, and `CHANGELOG.md` from the upstream tag, preserves the mirror's curated files (`README.md`, `LICENSE`, `.gitignore`, `.notes/`, `.github/`), force-pushes the resulting commit, and re-tags at the same version. Requires the `MIRROR_TOKEN` repository secret (fine-grained PAT scoped to `piqusy/murmur.nvim` with `Contents: write`); see `.github/MIRROR_TOKEN_SETUP.md` for the one-time provisioning steps.
- Behavioral coverage in `spec/murmur_integration.spec.ts` for `readMurmurFile` per-file status (annotated, clear, invalid_sidecar, missing_source, malformed-shape) — these tests reproduce the bug the `m.anchor` fix patched and guard against the same class of regression.
- Structural test that asserts the OMP `read_murmur` wrapper body no longer returns the unconditional "Clear to edit." string for non-`clear` statuses.


### Added
- `murmur.sh scan [dir]` (alias: `list`) — brings the project-wide read that
  OMP/OpenCode's `scan_murmurs` already had to Claude Code, Codex, and
  Antigravity, which previously had no proactive way to see a project's
  murmurs; the PreToolUse hook only surfaces them reactively, per file, on
  edit. Output matches `formatMurmurBatch` byte-for-byte (verified against
  the shared TS core across annotated/clear/invalid_sidecar/missing_source
  fixtures).

### Fixed
- `formatMurmur` in `integrations/shared/murmur-core.ts` referenced an
  undefined `m.anchor` instead of `murmur.anchor` — every call from
  `formatMurmurBatch` (i.e. every OMP/OpenCode `scan_murmurs`/`read_murmurs`
  call that hit a non-empty sidecar) would throw. Existing tests didn't
  catch it because they only assert exports exist, not runtime behavior.

## [0.3.0] — 2026-07-28

### Added
- Shared Murmur read core (`integrations/shared/murmur-core.ts`) used by OMP and OpenCode integrations — single parser/scanner/formatter for sidecars.
- `read_murmurs` (OMP and OpenCode) — batch read of one or more file sidecars with per-file status (`annotated` | `clear` | `invalid_sidecar` | `missing_source`).
- `scan_murmurs` (OMP and OpenCode) — refresh a project murmur index without restarting the session.
- OMP `tool_call` preflight — every `edit` / `write` / `multiedit` / `read` tool call now auto-injects only the murmurs whose sidecar hash changed since `before_agent_start`, including multi-file hashline edits.

### Fixed
- Invalidate OMP's startup murmur cache whenever `add_murmur` / `delete_file_murmurs` / `delete_all_murmurs` mutate the project; otherwise the preflight would skip the very change it just wrote.

## [0.2.0] — 2026-07-13

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
- Inline rendering mode — compact end-of-line shadow text (`Author: message`)
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
