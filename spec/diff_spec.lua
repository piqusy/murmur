-- spec/diff_spec.lua
-- Run: nvim --headless --noplugin -u NORC -c "set rtp+=~/development/murmur" -c "set rtp+=<plenary>" -c "lua require('plenary.busted')" -c "qa"
local M = require("murmur")

describe("resolve_source", function()
  after_each(function()
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
      if vim.api.nvim_buf_is_valid(b) and b > 1 then
        pcall(vim.api.nvim_buf_delete, b, { force = true })
      end
    end
  end)

  it("resolves fugitive staged buffer to real path + rev", function()
    local bufnr = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_name(bufnr, "fugitive:///tmp/repo/.git//0/src/file.lua")
    local src = M._resolve_source(bufnr)
    assert.is.equal("/tmp/repo/src/file.lua", src.path)
    assert.is.equal("0", src.rev)
    assert.is_true(src.foreign)
  end)

  it("resolves fugitive HEAD buffer", function()
    local bufnr = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_name(bufnr, "fugitive:///tmp/repo/.git//HEAD/src/file.lua")
    local src = M._resolve_source(bufnr)
    assert.is.equal("/tmp/repo/src/file.lua", src.path)
    assert.is.equal("HEAD", src.rev)
    assert.is_true(src.foreign)
  end)

  it("resolves gitsigns staged buffer to real path + rev", function()
    local bufnr = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_name(bufnr, "gitsigns:///tmp/repo/.git//:0:src/file.lua")
    local src = M._resolve_source(bufnr)
    assert.is.equal("/tmp/repo/src/file.lua", src.path)
    assert.is.equal("0", src.rev)
    assert.is_true(src.foreign)
  end)

  it("resolves gitsigns commit buffer", function()
    local bufnr = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_name(bufnr, "gitsigns:///tmp/repo/.git//:abc1234:src/file.lua")
    local src = M._resolve_source(bufnr)
    assert.is.equal("/tmp/repo/src/file.lua", src.path)
    assert.is.equal("abc1234", src.rev)
    assert.is_true(src.foreign)
  end)

  it("resolves plain file as worktree (no rev, not foreign)", function()
    local tmpfile = "/tmp/murmur_resolve_plain.lua"
    local f = io.open(tmpfile, "w"); f:write("hello\n"); f:close()
    vim.cmd("edit " .. tmpfile)
    local bufnr = vim.api.nvim_get_current_buf()
    local src = M._resolve_source(bufnr)
    assert.is.equal(vim.fn.resolve(tmpfile), src.path)
    assert.is_nil(src.rev)
    assert.is_false(src.foreign)
    pcall(vim.cmd, "bdelete! " .. bufnr)
    os.remove(tmpfile)
  end)

  it("returns nil for unnamed buffers", function()
    local bufnr = vim.api.nvim_create_buf(false, true)
    assert.is_nil(M._resolve_source(bufnr))
  end)
end)

describe("diff-view sidecar resolution + read-only guard", function()
  local tmpfile, sidecar, worktree_buf, fugitive_buf

  before_each(function()
    tmpfile = "/tmp/murmur_diff_test.lua"
    sidecar = tmpfile .. ".murmur.json"
    os.remove(sidecar)

    local f = io.open(tmpfile, "w")
    f:write("alpha\nbeta\ngamma\n")
    f:close()
    vim.cmd("edit " .. tmpfile)
    worktree_buf = vim.api.nvim_get_current_buf()
    M.add({ bufnr = worktree_buf, line = 1, author = "User", message = "worktree note" })

    fugitive_buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_lines(fugitive_buf, 0, -1, false, { "alpha", "beta", "gamma" })
    vim.api.nvim_buf_set_name(fugitive_buf, "fugitive:///tmp/.git//0/murmur_diff_test.lua")
  end)

  after_each(function()
    pcall(vim.cmd, "bdelete! " .. worktree_buf)
    pcall(vim.api.nvim_buf_delete, fugitive_buf, { force = true })
    os.remove(tmpfile)
    os.remove(sidecar)
  end)

  it("fugitive buffer loads worktree sidecar via resolved path", function()
    M._load_murmurs(fugitive_buf)
    -- mem[fugitive_buf] is populated by _load_murmurs; verify via the read-only guard
    -- which only triggers if foreign[bufnr] was set (proving load ran)
    assert.is_false(M.add({ bufnr = fugitive_buf, line = 2, message = "should fail" }))
  end)

  it("foreign buffer is read-only — add returns false", function()
    M._load_murmurs(fugitive_buf)
    assert.is_false(M.add({ bufnr = fugitive_buf, line = 1, author = "Agent", message = "x" }))
  end)

  it("delete_file_murmurs skips foreign buffers — sidecar untouched", function()
    M._load_murmurs(fugitive_buf)
    local n = M.delete_file_murmurs(fugitive_buf)
    assert.is.equal(0, n)
    assert.is_true(vim.fn.filereadable(sidecar) == 1)
  end)

  it("worktree buffer remains writable after fugitive view", function()
    M._load_murmurs(fugitive_buf)
    assert.is_true(M.add({ bufnr = worktree_buf, line = 2, author = "User", message = "still works" }))
  end)
end)
