# murmur.nvim

Inline line and range annotations for Neovim - leave instructions for your AI agent (or future-you) directly on source lines or visual selections. Murmurs render as boxed virtual text below the anchored line, or as compact end-of-line shadow text, with a persistent sign-column indicator so you always know where annotations live.

## Quick Start

**Two minutes to working murmurs:**

1. **Install the Neovim plugin** (lazy.nvim example):
   ```lua
   { "piqusy/murmur", event = "VeryLazy", config = function() require("murmur").setup() end }
   ```
   *Other managers: [packer](https://github.com/wbthomason/packer.nvim) `use "piqusy/murmur"`, [vim-plug](https://github.com/junegunn/vim-plug) `Plug 'piqusy/murmur'`, [minpac](https://github.com/k-takata/minpac) `call minpac#add('piqusy/murmur')`*

2. **Ignore sidecar files globally** (one-time, prevents accidental commits):
   ```bash
   echo "*.murmur.json" >> ~/.gitignore_global
   git config --global core.excludesfile ~/.gitignore_global
   ```

3. **Pick ONE AI harness integration** — install the matching hook/tools:

   | Harness | Install | Auto-injects murmurs? |
   |---|---|---|
   | **Oh My Pi / Pi** | `mkdir -p ~/.omp/agent/extensions/murmur && ln -s /path/to/murmur/integrations/omp/index.ts ~/.omp/agent/extensions/murmur/ && ln -s /path/to/murmur/integrations/omp/package.json ~/.omp/agent/extensions/murmur/` | ✅ Yes — scans ALL project murmurs at session start |
   | **Claude Code** | Symlink `integrations/claude-code/pre_tool_use.sh` + `integrations/shared/murmur.sh` to `~/.claude/hooks/murmur/`, add to `settings.json` | ✅ Yes — `PreToolUse` hook before every edit |
   | **Codex** | Enable hooks in `~/.codex/config.toml`, copy hook + `murmur.sh` to `~/.codex/hooks/murmur/`, add to `hooks.json` | ✅ Yes — `PreToolUse` hook before edits |
   | **Antigravity** | `cp -r integrations/antigravity ~/.config/agy/plugins/murmur && agy plugin install ~/.config/agy/plugins/murmur` | ✅ Yes — plugin `PreToolUse` hook |
   | **OpenCode** | Copy `integrations/opencode/*.ts` to `.opencode/tools/` or `~/.config/opencode/tools/`, add rule to `AGENTS.md` | ⚠️ Manual — agent must call `read_murmur` explicitly |

   > **Replace `/path/to/murmur`** with your local clone of this repo (e.g. `~/src/murmur` or `~/development/murmur`).

4. **Verify**: Open a file, run `:MurmurAdd`, type a message. You'll see a teal `◉` sign and a boxed annotation. Ask your agent to edit that file — it will see your murmur.

---

## Features

- **Box mode** - closed `╭─│─╰` frame with author, message, and source line number
- **Inline mode** - compact EOL shadow text (`Author: message`)
- **Always-on sign indicator** - `◉` in the sign column whenever a murmur exists
- **Content wrapping** - long messages wrap to fit the window (box mode)
- **Line-drift tracking** - extmarks follow text edits; a content anchor re-locates murmurs after external edits
- **Visual-range annotations** - run `:MurmurAdd` on a visual line selection to anchor a murmur from `L:10-14`
- **Sidecar storage** - `<file>.murmur.json` alongside each file (gitignored globally)
- **Pluggable picker** - snacks / telescope / fzf-lua / builtin `vim.ui.select`
- **Zero dependencies** - works on bare Neovim

## Requirements

- **Neovim ≥ 0.10**
- No plugins required. [snacks.nvim](https://github.com/folke/snacks.nvim), [telescope.nvim](https://github.com/nvim-telescope/telescope.nvim), [fzf-lua](https://github.com/ibhagwan/fzf-lua), [dressing.nvim](https://github.com/stevearc/dressing.nvim), or [noice.nvim](https://github.com/folke/noice.nvim) enhance the UI but are optional.

## Installation

### [lazy.nvim](https://github.com/folke/lazy.nvim)

```lua
{
  "piqusy/murmur",
  event = "VeryLazy",
  config = function()
    require("murmur").setup()
  end,
  keys = {
    { "<leader>ma", "<cmd>MurmurAdd<cr>",    desc = "Murmur Add" },
    { "<leader>md", "<cmd>MurmurDelete<cr>", desc = "Murmur Delete" },
    { "<leader>me", "<cmd>MurmurEdit<cr>",   desc = "Murmur Edit" },
    { "<leader>ml", "<cmd>MurmurList<cr>",   desc = "Murmur List" },
    { "<leader>mL", "<cmd>MurmurListAll<cr>", desc = "Murmur List All" },
    { "<leader>mt", "<cmd>MurmurToggle<cr>", desc = "Murmur Toggle" },
    { "<leader>mm", "<cmd>MurmurMode<cr>",   desc = "Murmur Mode" },
    { "<leader>mD", "<cmd>MurmurDeleteFile<cr>", desc = "Murmur Delete File" },
    { "<leader>mA", "<cmd>MurmurDeleteAll<cr>",  desc = "Murmur Delete All" },
  },
}
```

## Commands

| Command | Description |
|---|---|
| `:MurmurAdd` | Add a murmur on the current line, or on the selected visual line range |
| `:MurmurDelete` | Select and delete a single murmur |
| `:MurmurDeleteFile` | Delete all murmurs in the current file |
| `:MurmurDeleteAll` | Delete all murmurs across every open buffer (with confirm) |
| `:MurmurEdit` | Select and edit a murmur's message |
| `:MurmurList` | List and jump to a murmur (current buffer) |
| `:MurmurListAll` | List and jump to any murmur in the project (all sidecar files) |
| `:MurmurToggle` | Toggle content visibility (sign stays) |
| `:MurmurMode` | Toggle box ↔ inline render mode |
| `:MurmurClear` | Clear all murmur extmarks in the buffer (visual only) |

## Configuration

```lua
require("murmur").setup({
  render_mode = "box",        -- "box" | "inline"
  sign_text = "◉",            -- sign-column glyph
  sidecar_suffix = ".murmur.json",
  picker = "auto",            -- "auto" | "snacks" | "telescope" | "fzf" | "builtin"
  highlights = {
    user_header  = { fg = "#4dbd9f", italic = true }, -- teal
    user_sign    = { fg = "#4dbd9f" },
    agent_header = { fg = "#d3869b", italic = true }, -- purple
    agent_sign   = { fg = "#d3869b" },
    body   = { fg = "#ebdbb2" },
    border = { fg = "#928374" },
    orphan = { fg = "#fe8019", bold = true },
    foreign = { fg = "#928374", italic = true }, -- gray, dimmed (diff-view foreign revision)
  },
})
```

The render mode persists across restarts (`stdpath('data')/murmur.json`).

User and agent murmurs are visually distinct: user = teal, agent = purple
(both sign glyph and header). Author is determined by the `author` field -
`"User"` gets user styling, anything else gets agent styling.


## Diff view support

Murmur resolves diff buffers from both fugitive (`:Gdiff`, `:Gvdiffsplit`) and
gitsigns (`:Gitsigns diffthis`) to their real source file, so murmurs from the
working-tree sidecar appear on the staged/HEAD side too. Line differences are
handled by the existing anchor-based relocation — the anchor text is searched
in the target buffer and the murmur relocates automatically.

Foreign-revision buffers (staged `//0`, `HEAD`, specific commits) are
**read-only**: you can see murmurs but not add, edit, or delete them. They
render with a dimmed gray style and a `⊞ staged` / `⊞ HEAD` badge in the box
header so you always know which side you're looking at.

To pin or modify murmurs, switch to the worktree buffer (the real file).
## AI Harness Integration

Murmur ships a sidecar JSON contract that any agent harness can read and write.
Ready-made integrations for popular harnesses are included in this repo under
[`integrations/`](integrations/).

### Sidecar JSON format

Each file `src/foo.ts` has a sidecar `src/foo.ts.murmur.json` — a JSON array of
murmur objects:

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "line": 42,
    "anchor": "function authenticate(user) {",
    "author": "Claude",
    "message": "Refactored — see commit abc123",
    "created_at": "2026-06-15T10:30:00Z",
    "orphaned": false
  }
]
```

| Field | Type | Description |
|---|---|---|
| `id` | string | UUID, stable across sessions |
| `line` | number | 1-indexed source line |
| `anchor` | string | Line text for drift correction after external edits |
| `author` | string | `"User"` gets user styling (teal); anything else gets agent styling (purple) |
| `message` | string | Annotation text, no length limit |
| `created_at` | string | ISO 8601 UTC timestamp |
| `orphaned` | boolean | `true` when the anchor text can't be relocated within ±20 lines |

### Reading murmurs (harness side)

Before editing a file, the harness checks for a sidecar and surfaces existing
murmurs to the agent:

1. Resolve the file to annotate (e.g. `src/auth.ts`)
2. Check if `src/auth.ts.murmur.json` exists
3. Read and parse the JSON array
4. Present each murmur's `author`, `message`, and `line` to the agent
5. When the agent is done, write any new murmurs back to the sidecar

### Writing murmurs (harness side)

Agents write murmurs by appending to the sidecar JSON array. The file watcher
in Neovim detects the change and re-renders automatically — no Neovim RPC
needed.

Write a new murmur object with:
- `line`: the 1-indexed starting line
- `end_line`: optional inclusive final line for a multiline murmur
- `anchor`: the exact trimmed text of the starting line (used for drift recovery)
- `end_anchor`: the exact trimmed text of the final line for a multiline murmur
- `author`: your agent name (e.g. `"Claude"`, `"OMP"`)
- `message`: the annotation
- `created_at`: ISO 8601 UTC
- `orphaned`: `false`

Append to the array and write the whole file. Keep the array sorted by `line`
ascending for readability (Neovim re-sorts on load regardless).

**Read-before-write discipline:** agents SHOULD read the existing sidecar,
append, then write the full array back. This is a cooperative file — agents
add, never replace.

### Writing murmurs (Neovim-in-process API)

When the agent runs inside Neovim (e.g. via a headless Lua invocation), use the
programmatic API directly:

```lua
require("murmur").add({
  author = "Claude",   -- anything other than "User" gets agent styling
  message = "Refactored — see commit abc123",
  line = 42,           -- optional, defaults to cursor line
  end_line = 48,       -- optional inclusive final line for a multiline murmur
  bufnr = 0,           -- optional, defaults to current buffer
```

Delete all murmurs in a single file (returns count removed):

```lua
require("murmur").delete_file_murmurs(bufnr) -- bufnr optional, defaults to current
```

Delete all murmurs across every open buffer (returns total count):

```lua
require("murmur").delete_all_murmurs()
```

Both remove the in-memory state, clear visual extmarks, and delete the
sidecar file — the change persists across restarts.

### Writing murmurs (agent tools)

Dedicated tools handle UUID generation, ISO timestamps, anchor extraction, and
read-before-write — so agents don't manipulate sidecar JSON directly.

**OMP** — three registered tools:

| Tool | Parameters | Effect |
|---|---|---|
| `add_murmur` | `filepath`, `line`, `end_line?`, `author`, `message` | Append a murmur to the file's sidecar; `end_line` creates an inclusive multiline range |
| `delete_file_murmurs` | `filepath` | Remove the file's sidecar |
| `delete_all_murmurs` | `dir?` (defaults to cwd) | Remove all sidecars in the project |

**OpenCode** — same three tools, registered as separate files in `.opencode/tools/`:
`add_murmur.ts`, `delete_file_murmurs.ts`, `delete_all_murmurs.ts`.

**Claude Code / Codex / Antigravity** — a CLI script the agent invokes via its
shell tool:

```bash
murmur.sh add src/auth.ts 42 Claude "Refactored — see commit abc123" 48
murmur.sh delete-file src/auth.ts
murmur.sh delete-all .
murmur.sh scan .          # project-wide read, alias: list — the PreToolUse
                          # hook is reactive (per file, on edit); this isn't
murmur.sh list .          # alias for scan
```

> **New in v0.3.1**: `murmur.sh scan` (alias `list`) gives agents a proactive project-wide murmur index — the PreToolUse hook only surfaces murmurs reactively, per file, on edit. Use this for on-demand full-project reads.

Install `murmur.sh` alongside the PreToolUse hook (see per-harness instructions
below). The hook output includes the CLI path when murmurs exist.

### Oh My Pi / Pi

An [echo extension](https://github.com/mariozechner/pi-coding-agent) registers
read hooks and write tools. The extension ships in this repo at
[`integrations/omp/`](integrations/omp/):

| File | Installs to | Purpose |
|---|---|---|
| [`integrations/omp/index.ts`](integrations/omp/index.ts) | `~/.omp/agent/extensions/murmur/index.ts` | Echo extension: `before_agent_start` hook + `read_murmur`/`add_murmur`/`delete_file_murmurs`/`delete_all_murmurs` tools + `/murmur-scan` command |
| [`integrations/omp/package.json`](integrations/omp/package.json) | `~/.omp/agent/extensions/murmur/package.json` | Extension manifest (`"pi": {"extensions": ["./index.ts"]}`) |

**What it does:**

1. **`before_agent_start` hook** (auto-inject) — at session start, scans the
   project root recursively for all `*.murmur.json` sidecars (skipping
   `node_modules`, `.git`, `.venv`, `vendor`, `dist`, `build`, `.next`, max
   6 directory levels deep) and injects every found murmur into the agent's
   system prompt as pinned line constraints. This is the reliable delivery
   path — the agent never skips it.

2. **`read_murmur` tool** (per-file lookup) — a registered tool the agent calls
   before modifying any file. It checks for a sidecar at
   `<filepath>.murmur.json` and returns formatted murmurs or
   `"No murmurs for <file>. Clear to edit."`

3. **`/murmur-scan` slash command** — manual rescan that reports how many
   sidecar files exist in the project.

4. **`add_murmur` tool** (write) — appends a murmur to a file's sidecar with
   automatic UUID, timestamp, and anchor extraction. The Neovim file watcher
   re-renders on change.

5. **`delete_file_murmurs` / `delete_all_murmurs` tools** (write) — remove a
   single file's sidecar or all sidecars in the project.

To install, symlink from your clone of this repo:

```bash
# Replace ~/src/murmur with your clone path
# OMP
mkdir -p ~/.omp/agent/extensions/murmur
ln -s ~/src/murmur/integrations/omp/index.ts      ~/.omp/agent/extensions/murmur/index.ts
ln -s ~/src/murmur/integrations/omp/package.json  ~/.omp/agent/extensions/murmur/package.json

# Pi (same files, different config dir)
mkdir -p ~/.pi/agent/extensions/murmur
ln -s ~/src/murmur/integrations/omp/index.ts      ~/.pi/agent/extensions/murmur/index.ts
ln -s ~/src/murmur/integrations/omp/package.json  ~/.pi/agent/extensions/murmur/package.json
```

### Claude Code

A [PreToolUse hook](https://docs.anthropic.com/en/docs/claude-code/overview#hooks)
injects murmurs into the agent's context before every file-modifying tool call.
The hook ships in this repo at
[`integrations/claude-code/pre_tool_use.sh`](integrations/claude-code/pre_tool_use.sh).

**What it does:**
- Triggers before `Edit` / `Write` / `MultiEdit` tool calls
- Reads `<target-file>.murmur.json` and formats each murmur as
  `Line N [Author] — message (anchored: "...")`
- Returns the block as `hookSpecificOutput.additionalContext` so Claude Code
  sees it as a constraint before writing
- Silently exits when no sidecar exists — zero overhead per call
- Includes the `murmur.sh` CLI path in the output so the agent can add or
  delete murmurs via its shell tool

To install, symlink the hook into your Claude config and register it:

```bash
# Replace ~/src/murmur with your clone path
mkdir -p ~/.claude/hooks/murmur
ln -s ~/src/murmur/integrations/claude-code/pre_tool_use.sh \
      ~/.claude/hooks/murmur/pre_tool_use.sh
ln -s ~/src/murmur/integrations/shared/murmur.sh \
      ~/.claude/hooks/murmur/murmur.sh
```

Then add this to your `~/.claude/settings.json` or
`~/.claude/settings.user.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/.claude/hooks/murmur/pre_tool_use.sh"
          }
        ]
      }
    ]
  }
}
```

The `matcher` restricts the hook to file-modifying tools only (the script also
filters internally as a safety net). Use an absolute path to the hook script.

### OpenCode

A [custom tool](https://opencode.ai/docs/custom-tools/) registers `read_murmur`,
`add_murmur`, `delete_file_murmurs`, and `delete_all_murmurs` tools. The tools
ship in this repo at [`integrations/opencode/`](integrations/opencode/).

**What it does:**
- Registers tools via `@opencode-ai/plugin`'s `tool()` helper
- `read_murmur` — checks for a sidecar at `<filepath>.murmur.json` and returns
  formatted murmurs or `"No murmurs for <file>. Clear to edit."`
- `add_murmur` — appends a murmur with automatic UUID, timestamp, and anchor
- `delete_file_murmurs` — removes a single file's sidecar
- `delete_all_murmurs` — removes all sidecars in the project

To install, copy from your clone of this repo (symlinking won't work —
OpenCode resolves `@opencode-ai/plugin` from the file's real path):

```bash
# Replace ~/src/murmur with your clone path
# Project-level (per-project)
mkdir -p .opencode/tools
cp ~/src/murmur/integrations/opencode/*.ts .opencode/tools/

# Or global (all projects)
mkdir -p ~/.config/opencode/tools
cp ~/src/murmur/integrations/opencode/*.ts ~/.config/opencode/tools/
```

Then add this to your `AGENTS.md` so the agent knows to use it:

```markdown
Before editing any file, call `read_murmur` with the filepath to check for
user-pinned line constraints. Honor any murmurs returned. To leave a murmur on
a line, use `add_murmur`. To remove murmurs, use `delete_file_murmurs` or
`delete_all_murmurs`.
```

### Codex CLI

A [PreToolUse hook](https://learn.chatgpt.com/docs/config-file/config-reference) (lifecycle hooks)
injects murmurs into the agent's context before file-modifying tool calls.
The hook ships in this repo at
[`integrations/codex/`](integrations/codex/).

**What it does:**
- Triggers before `Edit` / `Write` / `MultiEdit` tool calls
- Reads `<target-file>.murmur.json` and returns formatted constraints as
  `hookSpecificOutput.additionalContext`
- Silently exits when no sidecar exists — zero overhead per call
- Includes the `murmur.sh` CLI path in the output so the agent can add or
  delete murmurs via its shell tool

**Prerequisite:** Enable hooks in `~/.codex/config.toml`:

```toml
[features]
hooks = true
```

To install, copy the hook script and merge the hooks config:

```bash
# Replace ~/src/murmur with your clone path
mkdir -p ~/.codex/hooks/murmur
cp ~/src/murmur/integrations/codex/pre_tool_use.sh ~/.codex/hooks/murmur/pre_tool_use.sh
cp ~/src/murmur/integrations/shared/murmur.sh ~/.codex/hooks/murmur/murmur.sh
```

Then add the `PreToolUse` entry to `~/.codex/hooks.json` (merge with existing
hooks if any). See [`integrations/codex/hooks.json`](integrations/codex/hooks.json)
for the template — replace the command path with the absolute path to your copy.

On first run, Codex will prompt you to trust the hook.

### Antigravity CLI

A [plugin](https://docs.antigravity.ai) with a `PreToolUse` hook injects murmurs
before file-modifying tool calls. The plugin ships in this repo at
[`integrations/antigravity/`](integrations/antigravity/).

**What it does:**
- Registers a `PreToolUse` hook via the plugin system (same format as Claude Code)
- Triggers before `Edit` / `Write` / `MultiEdit` tool calls
- Reads `<target-file>.murmur.json` and returns formatted constraints as
  `hookSpecificOutput.additionalContext`
- Includes the `murmur.sh` CLI path in the output so the agent can add or
  delete murmurs via its shell tool

To install, copy the plugin directory and install it:

```bash
# Replace ~/src/murmur with your clone path
cp -r ~/src/murmur/integrations/antigravity ~/.config/agy/plugins/murmur
cp ~/src/murmur/integrations/shared/murmur.sh ~/.config/agy/plugins/murmur/murmur.sh

# Edit hooks.json to use the absolute path to pre_tool_use.sh, then:
agy plugin install ~/.config/agy/plugins/murmur
```

Verify with `agy plugin list`.

### Other harnesses

Any harness that can run a shell script or read JSON files can implement murmur
support in three steps:

1. **Before editing a file**, check for `<file>.murmur.json` and present its
   contents to the agent as line constraints
2. **Inject all project murmurs** at session start by globbing
   `**/*.murmur.json` (skipping `node_modules`, `.git`, `.venv`, `vendor`,
   `dist`, `build`, `.next`)
3. **Write murmurs** by appending new objects to the sidecar JSON array, or
   use the shared `murmur.sh` CLI (`integrations/shared/murmur.sh`) for robust
   UUID/timestamp/anchor handling

The sidecar contract is the universal integration surface — no Neovim RPC, no
external dependencies. The CLI and native tools are conveniences on top.

## How it works

Murmurs are stored in a sidecar file `<original-file>.murmur.json` next to each annotated file. Add `*.murmur.json` to your global gitignore so they never get committed:

```gitignore
# ~/.gitignore_global
*.murmur.json
```

## Troubleshooting / FAQ

| Symptom | Likely cause | Fix |
|---|---|---|
| `:MurmurAdd` does nothing / no `◉` sign | Plugin not loaded or `setup()` not called | Ensure `require("murmur").setup()` runs; check `:Lazy` or `:PackerCompile` |
| Agent says "Clear to edit" but murmurs exist in Neovim | Harness hook not firing or wrong file path | Verify hook/tool install; check absolute paths in hook config; ensure sidecar at `<file>.murmur.json` |
| Murmurs don't appear after agent writes sidecar | File watcher not triggering | Run `:MurmurToggle` twice, or `:edit` to force reload; ensure `murmur.sh` / tools write valid JSON |
| `murmur.sh scan` returns nothing | Wrong directory or no sidecars | Run from project root; `murmur.sh scan .` scans recursively (skips `node_modules`, `.git`, etc.) |
| Orphaned murmurs (⚠) after git pull / external edit | Anchor text moved >20 lines | Run `:MurmurListAll`, manually relocate with `:MurmurEdit`, or delete and re-add |
| Diff view shows dimmed `⊞` badge, can't add murmurs | Viewing staged/HEAD side (read-only) | Switch to worktree buffer (the real file) to pin/modify |
| OpenCode agent never calls `read_murmur` | Missing instruction in `AGENTS.md` | Add the rule from the OpenCode install section to your `AGENTS.md` |
| OMP/Pi extension not loading | Symlink path wrong or OMP not restarted | Verify `ls -la ~/.omp/agent/extensions/murmur/` points to your clone; restart OMP |

## Development

## License

MIT
