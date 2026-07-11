local M = {}

M.defaults = {
  -- render mode: "box" (default) | "inline" (EOL shadow text)
  render_mode = "box",
  -- glyph shown in the sign column whenever a murmur exists
  sign_text = "◉",
  -- sidecar filename suffix
  sidecar_suffix = ".murmur.json",
  -- picker for list/delete/edit: "auto" | "snacks" | "telescope" | "fzf" | "builtin"
  picker = "auto",
  highlights = {
    header = { fg = "#a89984", italic = true },
    body   = { fg = "#ebdbb2" },
    border = { fg = "#928374" },
    sign   = { fg = "#d3869b" },
    orphan = { fg = "#fe8019", bold = true },
  },
}

M.options = vim.deepcopy(M.defaults)

function M.setup(opts)
  opts = opts or {}
  M.options = vim.tbl_deep_extend("force", vim.deepcopy(M.defaults), opts)
  -- validate render_mode
  if M.options.render_mode ~= "inline" then M.options.render_mode = "box" end
  return M.options
end

return M
