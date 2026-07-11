# murmur.nvim

Inline line annotations for Neovim - leave instructions for your AI agent (or future-you) directly on source lines. Murmurs render as boxed virtual text below the anchored line, or as compact end-of-line shadow text, with a persistent sign-column indicator so you always know where annotations live.

## Features

- **Box mode** - closed `╭─│─╰` frame with author, message, and source line number
- **Inline mode** - compact EOL shadow text (`Author: message`)
- **Always-on sign indicator** - `◉` in the sign column whenever a murmur exists
- **Content wrapping** - long messages wrap to fit the window (box mode)
- **Line-drift tracking** - extmarks follow text edits; a content anchor re-locates murmurs after external edits
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
    { "<leader>mt", "<cmd>MurmurToggle<cr>", desc = "Murmur Toggle" },
    { "<leader>mm", "<cmd>MurmurMode<cr>",   desc = "Murmur Mode" },
  },
}
```

## Commands

| Command | Description |
|---|---|
| `:MurmurAdd` | Add a murmur on the current line |
| `:MurmurDelete` | Select and delete a murmur |
| `:MurmurEdit` | Select and edit a murmur's message |
| `:MurmurList` | List and jump to a murmur |
| `:MurmurToggle` | Toggle content visibility (sign stays) |
| `:MurmurMode` | Toggle box ↔ inline render mode |
| `:MurmurClear` | Clear all murmur extmarks in the buffer |

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
  },
})
```

The render mode persists across restarts (`stdpath('data')/murmur.json`).

User and agent murmurs are visually distinct: user = teal, agent = purple
(both sign glyph and header). Author is determined by the `author` field -
`"User"` gets user styling, anything else gets agent styling.

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
- `id`: a unique UUID string
- `line`: the 1-indexed target line
- `anchor`: the exact trimmed text of that line (used for drift recovery)
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
  bufnr = 0,           -- optional, defaults to current buffer
})
```

### Oh My Pi / Pi

An [echo extension](https://github.com/mariozechner/pi-coding-agent) registers
three delivery paths. The extension ships in this repo at
[`integrations/omp/`](integrations/omp/):

| File | Installs to | Purpose |
|---|---|---|
| [`integrations/omp/index.ts`](integrations/omp/index.ts) | `~/.omp/agent/extensions/murmur/index.ts` | Echo extension: `before_agent_start` hook + `read_murmur` tool + `/murmur-scan` command |
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

To install, symlink the hook into your Claude config and register it:

```bash
# Replace ~/src/murmur with your clone path
mkdir -p ~/.claude/hooks/murmur
ln -s ~/src/murmur/integrations/claude-code/pre_tool_use.sh \
      ~/.claude/hooks/murmur/pre_tool_use.sh
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

A [custom tool](https://opencode.ai/docs/custom-tools/) registers a
`read_murmur` tool the agent calls before modifying files. The tool ships in
this repo at [`integrations/opencode/read_murmur.ts`](integrations/opencode/read_murmur.ts).

**What it does:**
- Registers a `read_murmur` tool via `@opencode-ai/plugin`'s `tool()` helper
- Checks for a sidecar at `<filepath>.murmur.json` relative to the project directory
- Returns formatted murmurs or `"No murmurs for <file>. Clear to edit."`

To install, copy from your clone of this repo (symlinking won't work —
OpenCode resolves `@opencode-ai/plugin` from the file's real path):

```bash
# Replace ~/src/murmur with your clone path
# Project-level (per-project)
mkdir -p .opencode/tools
cp ~/src/murmur/integrations/opencode/read_murmur.ts .opencode/tools/read_murmur.ts

# Or global (all projects)
mkdir -p ~/.config/opencode/tools
cp ~/src/murmur/integrations/opencode/read_murmur.ts ~/.config/opencode/tools/read_murmur.ts
```

Then add this to your `AGENTS.md` so the agent knows to use it:

```markdown
Before editing any file, call `read_murmur` with the filepath to check for
user-pinned line constraints. Honor any murmurs returned.
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

To install, copy the plugin directory and install it:

```bash
# Replace ~/src/murmur with your clone path
cp -r ~/src/murmur/integrations/antigravity ~/.config/agy/plugins/murmur

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
3. **Write murmurs** by appending new objects to the sidecar JSON array

The sidecar contract in this section is the only integration surface — no
plugin installation, no Neovim RPC, no external dependencies.

### Global gitignore

Sidecar files are local-only metadata. Ensure they never reach the repository:

```gitignore
# ~/.gitignore_global
*.murmur.json
```

## How it works

Murmurs are stored in a sidecar file `<original-file>.murmur.json` next to each annotated file. Add `*.murmur.json` to your global gitignore so they never get committed:

```gitignore
# ~/.gitignore_global
*.murmur.json
```

When a file is opened, the sidecar loads and extmarks are placed at each murmur's line. Extmarks move with text edits automatically. A content anchor (the line's text) lets murmurs re-locate if the file changed externally (e.g. a git pull). If the anchor can't be found within ±20 lines, the murmur is marked orphaned (⚠) for manual review.

## Development

Tests use [plenary.nvim](https://github.com/nvim-lua/plenary.nvim):

```bash
nvim --headless --noplugin -u NORC \
  -c "set rtp+=~/development/murmur" \
  -c "set rtp+=$(pwd)/.deps/plenary.nvim" \
  -c "lua require('plenary.busted')" \
  -c "qa"
```

## License

MIT
