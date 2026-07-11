# murmur.nvim

Inline line annotations for Neovim — leave instructions for your AI agent (or future-you) directly on source lines. Murmurs render as boxed virtual text below the anchored line, or as compact end-of-line shadow text, with a persistent sign-column indicator so you always know where annotations live.

## Features

- **Box mode** — closed `╭─│─╰` frame with author, message, and source line number
- **Inline mode** — compact EOL shadow text (`Author: message`)
- **Always-on sign indicator** — `◉` in the sign column whenever a murmur exists
- **Content wrapping** — long messages wrap to fit the window (box mode)
- **Line-drift tracking** — extmarks follow text edits; a content anchor re-locates murmurs after external edits
- **Sidecar storage** — `<file>.murmur.json` alongside each file (gitignored globally)
- **Pluggable picker** — snacks / telescope / fzf-lua / builtin `vim.ui.select`
- **Zero dependencies** — works on bare Neovim

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
    header = { fg = "#a89984", italic = true },
    body   = { fg = "#ebdbb2" },
    border = { fg = "#928374" },
    sign   = { fg = "#d3869b" },
    orphan = { fg = "#fe8019", bold = true },
  },
})
```

The render mode persists across restarts (`stdpath('data')/murmur.json`).

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
