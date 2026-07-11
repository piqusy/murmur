-- Pluggable picker for murmur select/confirm operations.
-- Items: { { idx = N, text = "...", murmur = m }, ... }
-- Pref from config: "auto" | "snacks" | "telescope" | "fzf" | "builtin"
-- "auto" tries each backend (snacks → telescope → fzf → builtin).

local M = {}

function M.open(items, opts, on_choice)
  opts = opts or {}
  local pref = require("murmur.config").options.picker
  local auto = pref == "auto"

  if pref == "snacks" or auto then
    local ok, Snacks = pcall(require, "snacks")
    if ok and Snacks and Snacks.picker then
      Snacks.picker({
        title = opts.prompt or "Murmurs",
        items = items,
        format = function(it)
          return { { it.text, "MurmurBody" } }
        end,
        confirm = function(p, it)
          if it then on_choice(it.idx) end
          p:close()
        end,
      })
      return
    end
  end

  if pref == "telescope" or auto then
    local ok, _ = pcall(require, "telescope")
    if ok then
      local finders = require("telescope.finders")
      local actions = require("telescope.actions")
      local state = require("telescope.actions.state")
      local pick = require("telescope.pickers")
      local conf = require("telescope.config").values
      pick.new({}, {
        prompt_title = opts.prompt or "Murmurs",
        finder = finders.new_table({
          results = items,
          entry_maker = function(it)
            return {
              value = it.idx,
              display = it.text,
              ordinal = it.text,
            }
          end,
        }),
        sorter = conf.generic_sorter({}),
        attach_mappings = function(buf)
          local act = require("telescope.actions")
          local act_state = require("telescope.actions.state")
          act.select_default:replace(function()
            local sel = act_state.get_selected_entry()
            act.close(buf)
            if sel then on_choice(sel.value) end
          end)
          return true
        end,
      }):find()
      return
    end
  end

  if pref == "fzf" or auto then
    local ok, fzf = pcall(require, "fzf-lua")
    if ok then
      local labels = vim.tbl_map(function(it)
        return tostring(it.idx) .. "\t" .. it.text
      end, items)
      fzf.fzf_exec(labels, {
        prompt = (opts.prompt or "Murmurs") .. "> ",
        actions = {
          ["default"] = function(selected)
            if selected and selected[1] then
              local idx = tonumber(selected[1]:match("^(%d+)\t"))
              if idx then on_choice(idx) end
            end
          end,
        },
      })
      return
    end
  end

  -- builtin fallback (bare Neovim; enriched by dressing/noice/telescope-ui-select)
  local labels = vim.tbl_map(function(it) return it.text end, items)
  vim.ui.select(labels, { prompt = opts.prompt or "Murmurs" }, function(_, i)
    if i then on_choice(items[i].idx) end
  end)
end

return M
