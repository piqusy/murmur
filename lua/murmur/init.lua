-- Murmur: user→agent line annotations rendered as inline virtual-text boxes.
-- Sidecar storage: <file>.murmur.json (gitignored globally). Line drift is
-- tracked via extmarks (which move with text) synced back to the sidecar, plus
-- a content anchor (line text) that re-locates murmurs after external edits.
local M = {}

local uv = vim.uv
local config = require("murmur.config")
local picker = require("murmur.picker")

local ns_id = vim.api.nvim_create_namespace("Murmur")

-- bufnr → array of murmur tables (in-memory truth while buffer is open)
local mem = {}
-- bufnr → { [murmur_id] = extmark_id }
local extmarks = {}
-- bufnr → uv_fs_event handle
local watchers = {}
-- bufnr → bool (nil/true = visible content, false = content hidden, sign always on)
local visible = {}
-- bufnr → uv_timer (debounced CursorHold sync)
local sync_timers = {}
-- bufnr → bool (suppress watcher during own writes)
local suppress = {}
-- bufnr → bool (true when viewing a non-worktree git revision: staged/HEAD/commit)
local foreign = {}
-- bufnr → rev string (for visual badge), nil for worktree
local rev_info = {}
-- render mode: "box" (default) | "inline" — toggled by M.toggle_mode.
-- A ◉ sign is always shown in the sign column when a murmur exists.
local render_mode = config.options.render_mode
local state_path = vim.fn.stdpath("data") .. "/murmur.json"

-- Resolve a buffer to its real source file and git revision.
-- Returns { path = string, rev = string?, foreign = bool } or nil.
local function resolve_source(bufnr)
  local name = vim.api.nvim_buf_get_name(bufnr)

  -- Fugitive: fugitive://<repo>/.git//<rev>/<relpath>
  --   rev "0" = index/staged, "HEAD" = HEAD, "<sha>" = commit
  local repo, rev, rel = name:match("^fugitive://(.+)/%.git//([^/]+)/(.+)$")
  if repo and rel then
    return {
      path = repo .. "/" .. rel,
      rev = rev,
      foreign = true,
    }
  end

  -- Gitsigns: gitsigns://<repo>/.git//:<rev>:<relpath>
  --   rev "0" = index/staged, "<sha>" = commit
  local gs_repo, gs_rev, gs_rel = name:match("^gitsigns://(.+)/%.git//:([^:]+):(.+)$")
  if gs_repo and gs_rel then
    return {
      path = gs_repo .. "/" .. gs_rel,
      rev = gs_rev,
      foreign = true,
    }
  end

  -- Plain file (worktree)
  if name ~= "" then
    return { path = name, rev = nil, foreign = false }
  end
  return nil
end

-- Gate: should murmur attach to this buffer?
-- Normal files (buftype "") and diff-view buffers (fugitive, gitsigns) only.
local function should_attach(bufnr)
  if not resolve_source(bufnr) then return false end
  local bt = vim.bo[bufnr].buftype
  if bt == "" then return true end
  if bt == "nofile" then
    local name = vim.api.nvim_buf_get_name(bufnr)
    return name:match("^fugitive://") ~= nil or name:match("^gitsigns://") ~= nil
  end
  return false
end

-- Human-readable rev label for the visual badge.
local function rev_label(rev)
  if not rev then return nil end
  local labels = { ["0"] = "staged", HEAD = "HEAD" }
  return labels[rev] or rev:sub(1, 7)
end

-- helpers -------------------------------------------------------------------

local function setup_highlights()
  local hl = config.options.highlights
  vim.api.nvim_set_hl(0, "MurmurUserHeader", hl.user_header)
  vim.api.nvim_set_hl(0, "MurmurUserSign", hl.user_sign)
  vim.api.nvim_set_hl(0, "MurmurAgentHeader", hl.agent_header)
  vim.api.nvim_set_hl(0, "MurmurAgentSign", hl.agent_sign)
  vim.api.nvim_set_hl(0, "MurmurBody", hl.body)
  vim.api.nvim_set_hl(0, "MurmurBorder", hl.border)
  vim.api.nvim_set_hl(0, "MurmurOrphan", hl.orphan)
  vim.api.nvim_set_hl(0, "MurmurForeign", hl.foreign)
end

local function sidecar_path(bufnr)
  local src = resolve_source(bufnr)
  if not src or src.path == "" then return nil end
  return src.path .. config.options.sidecar_suffix
end

local function gen_id()
  local ok, id = pcall(vim.fn.uuid)
  if ok and id and id ~= "" then return id end
  return string.format("%x-%x", uv.hrtime(), math.random(0, 0xffffff))
end

local function iso_now()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function trim(s)
  s = s or ""
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function norm(s)
  return trim(s):lower()
end

local function read_sidecar(path)
  if not path then return {} end
  local f = io.open(path, "r")
  if not f then return {} end
  local content = f:read("*a")
  f:close()
  if content == "" then return {} end
  local ok, parsed = pcall(vim.json.decode, content)
  if not ok or type(parsed) ~= "table" then return {} end
  return parsed
end

local function write_sidecar(bufnr, path, data)
  if not path then return false end
  suppress[bufnr] = true
  -- Empty data: delete the sidecar rather than writing "[]" to avoid
  -- overwriting a valid sidecar with an empty array on accidental calls.
  if not data or #data == 0 then
    pcall(os.remove, path)
    suppress[bufnr] = false
    return true
  end
  -- Atomic write: write to temp file, then rename over the target.
  -- Prevents partial writes if Neovim crashes or is killed mid-write.
  local tmp = path .. ".tmp"
  local f = io.open(tmp, "w")
  if not f then
    suppress[bufnr] = false
    vim.notify("murmur: could not write " .. path, vim.log.levels.ERROR)
    return false
  end
  f:write(vim.json.encode(data))
  f:close()
  os.rename(tmp, path)
  suppress[bufnr] = false
  return true
end

local function sort_murmurs(murmurs)
  table.sort(murmurs, function(a, b)
    return (tonumber(a.line) or 0) < (tonumber(b.line) or 0)
  end)
end

-- load: read sidecar into mem, validate anchors (relocate drift / mark orphan)

local function load_murmurs(bufnr)
  if not vim.api.nvim_buf_is_valid(bufnr) then return {} end
  local src = resolve_source(bufnr)
  foreign[bufnr] = src and src.foreign or false
  rev_info[bufnr] = src and src.rev or nil
  local path = sidecar_path(bufnr)
  local murmurs = read_sidecar(path)
  if #murmurs == 0 then
    mem[bufnr] = {}
    return {}
  end

  local linecount = vim.api.nvim_buf_line_count(bufnr)
  local changed = false

  for _, m in ipairs(murmurs) do
    local line = tonumber(m.line) or 0
    local anchor = m.anchor or ""
    m.orphaned = false

    local current = ""
    if line > 0 and line <= linecount then
      current = (vim.api.nvim_buf_get_lines(bufnr, line - 1, line, false)[1] or "")
    end

    -- backfill anchor for murmurs created by older code
    if anchor == "" and current ~= "" then
      m.anchor = current
      anchor = current
      changed = true
    end
    if anchor ~= "" and norm(current) == norm(anchor) then
      -- no drift: anchor matches the stored line
    else
      -- search ±20 rows for the anchor text
      local lo = math.max(0, line - 21)
      local hi = math.min(linecount, line + 20)
      local found = nil
      if hi > lo then
        local region = vim.api.nvim_buf_get_lines(bufnr, lo, hi, false)
        for i, text in ipairs(region) do
          if anchor ~= "" and norm(text) == norm(anchor) then
            found = lo + i - 1
            break
          end
        end
      end
      if found then
        m.line = found + 1
        m.anchor = trim(vim.api.nvim_buf_get_lines(bufnr, found, found + 1, false)[1] or "")
        changed = true
      else
        m.orphaned = true
      end
    end
  end

  sort_murmurs(murmurs)

  if changed and not foreign[bufnr] then
    write_sidecar(bufnr, path, murmurs)
  end
  mem[bufnr] = murmurs
  return murmurs
end

-- sync_back: read current extmark positions into mem, persist to sidecar

local function sync_back(bufnr)
  local murmurs = mem[bufnr]
  if not murmurs or #murmurs == 0 then return end
  local marks = extmarks[bufnr] or {}
  local linecount = vim.api.nvim_buf_line_count(bufnr)
  local changed = false

  for _, m in ipairs(murmurs) do
    local mark_id = marks[m.id]
    if mark_id then
      local ok, pos = pcall(vim.api.nvim_buf_get_extmark_by_id, bufnr, ns_id, mark_id, {})
      if ok and pos and pos[1] ~= nil then
        local new_line = pos[1] + 1
        if new_line ~= m.line then
          -- sync the anchor text (use the sign-only extmark position — still tracks the line)
          m.line = new_line
          m.anchor = trim(vim.api.nvim_buf_get_lines(bufnr, pos[1], pos[2], false)[1] or "")
          changed = true
        end
      end
    end
  end

  if changed and not foreign[bufnr] then
    sort_murmurs(murmurs)
    write_sidecar(bufnr, sidecar_path(bufnr), murmurs)
  end
end

-- wrap_text: word wrap with hard-break fallback for over-long words ----------

local function wrap_text(text, width)
  width = math.max(1, width)
  local function hard_break(s)
    local out, cur, cur_w = {}, {}, 0
    for _, ch in ipairs(vim.fn.split(s, "\\zs")) do
      local cw = vim.fn.strdisplaywidth(ch)
      if cur_w > 0 and cur_w + cw > width then
        table.insert(out, table.concat(cur))
        cur, cur_w = {}, 0
      end
      table.insert(cur, ch)
      cur_w = cur_w + cw
    end
    if cur_w > 0 then table.insert(out, table.concat(cur)) end
    return out
  end
  local lines, cur, cur_w = {}, {}, 0
  for word in tostring(text):gmatch("%S+") do
    local ww = vim.fn.strdisplaywidth(word)
    if ww > width then
      if cur_w > 0 then
        table.insert(lines, table.concat(cur, " "))
        cur, cur_w = {}, 0
      end
      vim.list_extend(lines, hard_break(word))
    elseif cur_w == 0 then
      cur, cur_w = { word }, ww
    elseif cur_w + 1 + ww <= width then
      table.insert(cur, word)
      cur_w = cur_w + 1 + ww
    else
      table.insert(lines, table.concat(cur, " "))
      cur, cur_w = { word }, ww
    end
  end
  if cur_w > 0 then table.insert(lines, table.concat(cur, " ")) end
  if #lines == 0 then lines = { "" } end
  return lines
end

-- render: draw extmarks from mem (sign always, content when visible) --------

function M.render(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(bufnr) then return end
  vim.api.nvim_buf_clear_namespace(bufnr, ns_id, 0, -1)
  -- sign always placed regardless of visible[bufnr]; only content is gated

  local murmurs = mem[bufnr] or {}
  if #murmurs == 0 then return end
  local linecount = vim.api.nvim_buf_line_count(bufnr)
  if linecount == 0 then return end
  local marks = {}
  local show_content = visible[bufnr] ~= false

  for _, m in ipairs(murmurs) do
    local line = tonumber(m.line)
    if line and line > 0 then
      local row = math.max(0, math.min(line - 1, linecount - 1))
      local author = m.author or "User"
      local message = m.message or ""
      local orphan = m.orphaned
      local is_agent = author ~= "User"
      local is_foreign = foreign[bufnr] or false
      local sign_hl = orphan and "MurmurOrphan" or (is_foreign and "MurmurForeign" or (is_agent and "MurmurAgentSign" or "MurmurUserSign"))
      local header_hl = orphan and "MurmurOrphan" or (is_foreign and "MurmurForeign" or (is_agent and "MurmurAgentHeader" or "MurmurUserHeader"))
      local opts = {
        sign_text = config.options.sign_text,
        sign_hl_group = sign_hl,
      }

      if show_content then
        if render_mode == "inline" then
          opts.virt_text = {
            { "  " .. (orphan and "⚠ " or is_foreign and "⊞ " or ""), orphan and "MurmurOrphan" or (is_foreign and "MurmurForeign" or header_hl) },
            { author .. ": ", header_hl },
            { message, "MurmurBody" },
          }
          opts.virt_text_pos = "eol"
        else -- "box"
          local prefix = orphan and "⚠ ORPHANED " or ""
          if is_foreign then
            prefix = prefix .. "⊞ " .. (rev_label(rev_info[bufnr]) or "diff") .. " "
          end
          local header_label = " ╭─ [" .. author .. "] " .. prefix
          -- cap box width to the buffer's window; -14 ≈ signcol(2)+numcol(≤6)+frame(3)+margin(3)
          local win = vim.fn.bufwinid(bufnr)
          local win_w = (win ~= -1) and vim.api.nvim_win_get_width(win) or vim.o.columns
          local cap = math.min(80, math.max(28, win_w - 14))
          -- wrap message to inner text width (cap minus the 2-space indent)
          local body_lines = wrap_text(message, math.max(1, cap - 2))
          local content_w = vim.fn.strdisplaywidth(header_label)
          for _, l in ipairs(body_lines) do
            content_w = math.max(content_w, vim.fn.strdisplaywidth(l) + 2)
          end
          content_w = math.max(28, content_w) + 2
          -- header: embed line number on the right when there is room
          local linetext = ":" .. tostring(line)
          local linetxt_w = vim.fn.strdisplaywidth(linetext)
          local gap_w = content_w - vim.fn.strdisplaywidth(header_label) + 2
          local right_side
          if linetxt_w + 4 <= gap_w then
            right_side = string.rep("─", gap_w - linetxt_w - 3) .. " " .. linetext .. " ─╮"
          else
            right_side = string.rep("─", gap_w) .. "╮"
          end
          -- build header: border parts are gray, [author] is colored
          local header_chunks = {
            { " ╭─ [", "MurmurBorder" },
            { author, header_hl },
            { "] ", "MurmurBorder" },
          }
          if orphan then
            table.insert(header_chunks, { "⚠ ORPHANED ", "MurmurOrphan" })
          end
          if is_foreign then
            table.insert(header_chunks, { "⊞ " .. (rev_label(rev_info[bufnr]) or "diff") .. " ", "MurmurForeign" })
          end
          table.insert(header_chunks, { right_side, "MurmurBorder" })
          local vl = { header_chunks }
          for _, l in ipairs(body_lines) do
            local inner = "  " .. l .. string.rep(" ", content_w - 2 - vim.fn.strdisplaywidth(l))
            table.insert(vl, { { " │", "MurmurBorder" }, { inner, "MurmurBody" }, { "│", "MurmurBorder" } })
          end
          local footer_line = " ╰" .. string.rep("─", content_w) .. "╯"
          table.insert(vl, { { footer_line, "MurmurBorder" } })
          opts.virt_lines = vl
          opts.virt_lines_above = false
        end
      end

      local ok, id = pcall(vim.api.nvim_buf_set_extmark, bufnr, ns_id, row, 0, opts)
      if ok then marks[m.id] = id end
    end
  end
  extmarks[bufnr] = marks
end


function M.toggle_mode()
  render_mode = render_mode == "box" and "inline" or "box"
  for _, b in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(b) and mem[b] then M.render(b) end
  end
  local f = io.open(state_path, "w")
  if f then
    f:write(vim.json.encode({ render_mode = render_mode }))
    f:close()
  end
  vim.notify("murmur mode: " .. render_mode, vim.log.levels.INFO)
end

-- public actions ------------------------------------------------------------

-- M.add: programmatic (non-interactive) murmur creation — the agent API.
-- opts: { bufnr?, line?, author?, message }
function M.add(opts)
  opts = opts or {}
  local bufnr = opts.bufnr or vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(bufnr) then return false end
  if foreign[bufnr] then return false end
  local path = sidecar_path(bufnr)
  if not path then return false end
  sync_back(bufnr)
  local row = opts.line or vim.api.nvim_win_get_cursor(0)[1]
  local linecount = vim.api.nvim_buf_line_count(bufnr)
  row = math.max(1, math.min(row, linecount))
  local anchor = trim(vim.api.nvim_buf_get_lines(bufnr, row - 1, row, false)[1] or "")
  local murmurs = mem[bufnr] or {}
  table.insert(murmurs, {
    id = gen_id(),
    line = row,
    anchor = anchor,
    author = opts.author or "Agent",
    message = opts.message or "",
    created_at = iso_now(),
    orphaned = false,
  })
  sort_murmurs(murmurs)
  mem[bufnr] = murmurs
  write_sidecar(bufnr, path, murmurs)
  M.render(bufnr)
  return true
end

function M.add_murmur()
  local bufnr = vim.api.nvim_get_current_buf()
  if not sidecar_path(bufnr) then
    vim.notify("murmur: buffer has no file path", vim.log.levels.WARN)
    return
  end
  if foreign[bufnr] then
    vim.notify("murmur: read-only diff view — edit the worktree buffer", vim.log.levels.WARN)
    return
  end
  vim.ui.input({ prompt = "Instruction for agent: " }, function(input)
    if not input or vim.trim(input) == "" then return end
    vim.schedule(function()
      M.add({ bufnr = bufnr, author = "User", message = input })
    end)
  end)
end

function M.delete_murmur()
  local bufnr = vim.api.nvim_get_current_buf()
  if foreign[bufnr] then
    vim.notify("murmur: read-only diff view — edit the worktree buffer", vim.log.levels.WARN)
    return
  end
  local murmurs = mem[bufnr] or {}
  if #murmurs == 0 then
    vim.notify("murmur: no murmurs in this buffer", vim.log.levels.INFO)
    return
  end
  local items = {}
  for i, m in ipairs(murmurs) do
    table.insert(items, {
      idx = i,
      text = string.format("L%d [%s] %s", tonumber(m.line) or 0, m.author or "User", m.message or ""),
      murmur = m,
    })
  end
  picker.open(items, { prompt = "Delete murmur:" }, function(idx)
    if not idx then return end
    vim.schedule(function()
      local m = murmurs[idx]
      table.remove(murmurs, idx)
      mem[bufnr] = murmurs
      write_sidecar(bufnr, sidecar_path(bufnr), murmurs)
      M.render(bufnr)
      vim.notify("Deleted murmur at L" .. tostring(m.line), vim.log.levels.INFO)
    end)
  end)
end

function M.edit_murmur()
  local bufnr = vim.api.nvim_get_current_buf()
  if foreign[bufnr] then
    vim.notify("murmur: read-only diff view — edit the worktree buffer", vim.log.levels.WARN)
    return
  end
  local murmurs = mem[bufnr] or {}
  if #murmurs == 0 then
    vim.notify("murmur: no murmurs in this buffer", vim.log.levels.INFO)
    return
  end
  local items = {}
  for i, m in ipairs(murmurs) do
    table.insert(items, {
      idx = i,
      text = string.format("L%d [%s] %s", tonumber(m.line) or 0, m.author or "User", m.message or ""),
      murmur = m,
    })
  end
  picker.open(items, { prompt = "Edit murmur:" }, function(idx)
    if not idx then return end
    vim.schedule(function()
      local m = murmurs[idx]
      local old = m.line
      vim.ui.input({ prompt = "Instruction for agent: ", default = m.message or "" }, function(input)
        if not input or vim.trim(input) == "" then return end
        vim.schedule(function()
          m.message = input
          m.updated_at = os.date("!%Y-%m-%dT%H:%M:%SZ")
          write_sidecar(bufnr, sidecar_path(bufnr), murmurs)
          M.render(bufnr)
          vim.notify("Updated murmur at L" .. tostring(m.line), vim.log.levels.INFO)
        end)
      end)
    end)
  end)
end

function M.list_murmurs()
  local bufnr = vim.api.nvim_get_current_buf()
  local murmurs = mem[bufnr] or {}
  if #murmurs == 0 then
    vim.notify("murmur: no murmurs in this buffer", vim.log.levels.INFO)
    return
  end
  local items = {}
  for i, m in ipairs(murmurs) do
    table.insert(items, {
      idx = i,
      text = string.format("L%d  %s", tonumber(m.line) or 0, m.message or ""),
      murmur = m,
    })
  end
  picker.open(items, { prompt = "Murmurs" }, function(idx)
    if idx and murmurs[idx] then
      vim.api.nvim_win_set_cursor(0, { tonumber(murmurs[idx].line) or 1, 0 })
    end
  end)
end

-- M.list_all_murmurs: scan all sidecar files in the project, show every murmur
-- in a picker. On selection, open the file and jump to the line.
function M.list_all_murmurs()
  local cwd = vim.fn.getcwd()
  local suffix = config.options.sidecar_suffix
  local ignore_dirs = { ".git", "node_modules", ".venv", "vendor", "dist", "build", ".next", ".deps" }
  local ignore_set = {}
  for _, d in ipairs(ignore_dirs) do ignore_set[d] = true end

  local sidecars = vim.fs.find(function(name, path)
    if name:sub(-#suffix) ~= suffix then return false end
    for seg in (path .. "/" .. name):gmatch("[^/]+") do
      if ignore_set[seg] then return false end
    end
    return true
  end, { limit = 200, type = "file", path = cwd })

  local results = {}
  for _, sc in ipairs(sidecars) do
    local murmurs = read_sidecar(sc)
    local base = sc:sub(1, -#suffix - 1)
    local rel = vim.fn.fnamemodify(base, ":.")
    for _, m in ipairs(murmurs) do
      table.insert(results, {
        file = base,
        line = tonumber(m.line) or 1,
        text = string.format("%s:%d  [%s] %s", rel, tonumber(m.line) or 0, m.author or "User", m.message or ""),
      })
    end
  end

  if #results == 0 then
    vim.notify("murmur: no murmurs found in project", vim.log.levels.INFO)
    return
  end

  local items = {}
  for i, r in ipairs(results) do
    items[i] = { idx = i, text = r.text }
  end
  table.sort(items, function(a, b) return a.text < b.text end)

  picker.open(items, { prompt = "All Murmurs (" .. #results .. ")" }, function(idx)
    if not idx then return end
    local r = results[idx]
    if r then
      vim.schedule(function()
        vim.cmd("edit " .. vim.fn.fnameescape(r.file))
        local lc = vim.api.nvim_buf_line_count(0)
        vim.api.nvim_win_set_cursor(0, { math.max(1, math.min(r.line, lc)), 0 })
      end)
    end
  end)
end

function M.toggle()
  local bufnr = vim.api.nvim_get_current_buf()
  if visible[bufnr] == false then
    visible[bufnr] = nil
  else
    visible[bufnr] = false
  end
  M.render(bufnr)
  vim.notify("murmur content " .. (visible[bufnr] == false and "hidden" or "visible"), vim.log.levels.INFO)
end


-- M.delete_file_murmurs: delete all murmurs in a single buffer (persistent).
-- Removes in-memory state, visual extmarks, and the sidecar file.
-- Returns the count of murmurs removed.
function M.delete_file_murmurs(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(bufnr) then return 0 end
  if foreign[bufnr] then return 0 end
  local count = #(mem[bufnr] or {})
  if count == 0 then return 0 end
  mem[bufnr] = {}
  extmarks[bufnr] = {}
  vim.api.nvim_buf_clear_namespace(bufnr, ns_id, 0, -1)
  local path = sidecar_path(bufnr)
  if path then
    suppress[bufnr] = true
    pcall(os.remove, path)
    suppress[bufnr] = false
  end
  return count
end

-- M.delete_all_murmurs: delete all murmurs across every open buffer (persistent).
-- Returns the total count of murmurs removed.
function M.delete_all_murmurs()
  local total = 0
  for _, b in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(b) and mem[b] and #mem[b] > 0 and not foreign[b] then
      total = total + M.delete_file_murmurs(b)
    end
  end
  return total
end
-- watcher --------------------------------------------------------------------

local function stop_watcher(bufnr)
  if watchers[bufnr] then
    pcall(function()
      watchers[bufnr]:stop()
    end)
    watchers[bufnr] = nil
  end
end

local function start_watcher(bufnr, path)
  stop_watcher(bufnr)
  local w = uv.new_fs_event()
  if not w then return end
  watchers[bufnr] = w
  w:start(path, {}, vim.schedule_wrap(function(err)
    if err then
      stop_watcher(bufnr)
      return
    end
    if suppress[bufnr] then return end
    load_murmurs(bufnr)
    M.render(bufnr)
  end))
end

-- refresh: load + render + watch (used by BufReadPost/BufEnter)

local function refresh(bufnr)
  load_murmurs(bufnr)
  M.render(bufnr)
  local path = sidecar_path(bufnr)
  if path and vim.fn.filereadable(path) == 1 then
    start_watcher(bufnr, path)
  end
end

-- debounced sync for CursorHold ---------------------------------------------

local function debounced_sync(bufnr)
  if sync_timers[bufnr] then
    sync_timers[bufnr]:stop()
    sync_timers[bufnr]:close()
  end
  local t = uv.new_timer()
  sync_timers[bufnr] = t
  t:start(500, 0, vim.schedule_wrap(function()
    t:stop()
    t:close()
    if sync_timers[bufnr] == t then sync_timers[bufnr] = nil end
    if vim.api.nvim_buf_is_valid(bufnr) then
      sync_back(bufnr)
    end
  end))
end

-- setup ----------------------------------------------------------------------

function M.setup(opts)
  config.setup(opts)
  render_mode = config.options.render_mode
  setup_highlights()
  local group = vim.api.nvim_create_augroup("MurmurGroup", { clear = true })

  vim.api.nvim_create_autocmd({ "BufReadPost", "BufEnter" }, {
    group = group,
    pattern = "*",
    callback = function(args)
      if not should_attach(args.buf) then return end
      refresh(args.buf)
    end,
  })

  vim.api.nvim_create_autocmd("BufWritePost", {
    group = group,
    pattern = "*",
    callback = function(args)
      if not should_attach(args.buf) or foreign[args.buf] then return end
      if mem[args.buf] then sync_back(args.buf) end
    end,
  })

  vim.api.nvim_create_autocmd("CursorHold", {
    group = group,
    pattern = "*",
    callback = function(args)
      if not should_attach(args.buf) or foreign[args.buf] then return end
      if mem[args.buf] and #mem[args.buf] > 0 then
        debounced_sync(args.buf)
      end
    end,
  })

  vim.api.nvim_create_autocmd("BufDelete", {
    group = group,
    pattern = "*",
    callback = function(args)
      stop_watcher(args.buf)
      if sync_timers[args.buf] then
        sync_timers[args.buf]:stop()
        sync_timers[args.buf]:close()
        sync_timers[args.buf] = nil
      end
      mem[args.buf] = nil
      extmarks[args.buf] = nil
      visible[args.buf] = nil
      foreign[args.buf] = nil
      rev_info[args.buf] = nil
      suppress[args.buf] = nil
    end,
  })

  -- re-apply highlights on colorscheme change
  vim.api.nvim_create_autocmd("ColorScheme", {
    group = group,
    callback = setup_highlights,
  })

  vim.api.nvim_create_user_command("MurmurAdd", function() M.add_murmur() end, {})
  vim.api.nvim_create_user_command("MurmurDelete", function() M.delete_murmur() end, {})
  vim.api.nvim_create_user_command("MurmurDeleteFile", function()
    local n = M.delete_file_murmurs()
    vim.notify(
      n > 0 and ("murmur: deleted " .. n .. " murmur(s) in this file")
        or "murmur: no murmurs in this buffer",
      vim.log.levels.INFO
    )
  end, {})
  vim.api.nvim_create_user_command("MurmurDeleteAll", function()
    vim.ui.select({ "yes", "no" }, { prompt = "Delete all murmurs in every open buffer?" }, function(choice)
      if choice ~= "yes" then return end
      vim.schedule(function()
        local n = M.delete_all_murmurs()
        vim.notify(
          n > 0 and ("murmur: deleted " .. n .. " murmur(s) across all buffers")
            or "murmur: no murmurs found",
          vim.log.levels.INFO
        )
      end)
    end)
  end, {})
  vim.api.nvim_create_user_command("MurmurEdit", function() M.edit_murmur() end, {})
  vim.api.nvim_create_user_command("MurmurList", function() M.list_murmurs() end, {})
  vim.api.nvim_create_user_command("MurmurListAll", function() M.list_all_murmurs() end, {})
  vim.api.nvim_create_user_command("MurmurToggle", function() M.toggle() end, {})
  vim.api.nvim_create_user_command("MurmurMode", function() M.toggle_mode() end, {})
  vim.api.nvim_create_user_command("MurmurClear", function()
    vim.api.nvim_buf_clear_namespace(0, ns_id, 0, -1)
  end, {})

  -- restore persisted render mode from stdpath('data')/murmur.json
  local f = io.open(state_path, "r")
  if f then
    local ok, data = pcall(vim.json.decode, f:read("*a"))
    f:close()
    if ok and data.render_mode == "inline" then
      render_mode = "inline"
    end
  end
  -- setup runs at VeryLazy, after the initial BufReadPost/BufEnter already
  -- fired; load sidecars for buffers already open so startup isn't a no-op.
  for _, b in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(b) and should_attach(b) then
      refresh(b)
    end
  end
end

-- expose internals for testability
M._wrap = wrap_text
M._read_sidecar = read_sidecar
M._write_sidecar = write_sidecar
M._config = config
M._load_murmurs = load_murmurs
M._resolve_source = resolve_source

return M
