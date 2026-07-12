-- spec/delete_spec.lua
-- Run: nvim --headless --noplugin -u NORC -c "set rtp+=~/development/murmur" -c "set rtp+=<plenary>" -c "lua require('plenary.busted')" -c "qa"
local M = require("murmur")

-- Write a temp file and load it into a real buffer; return bufnr.
local function make_file(path, lines)
  local f = io.open(path, "w")
  f:write(table.concat(lines, "\n") .. "\n")
  f:close()
  vim.cmd("edit " .. path)
  return vim.api.nvim_get_current_buf()
end

describe("delete_file_murmurs", function()
  local tmpfile, sidecar, bufnr

  before_each(function()
    tmpfile = "/tmp/murmur_del_test.lua"
    sidecar = tmpfile .. ".murmur.json"
    os.remove(sidecar)
    bufnr = make_file(tmpfile, { "alpha", "beta", "gamma" })
  end)

  after_each(function()
    pcall(vim.cmd, "bdelete! " .. bufnr)
    os.remove(tmpfile)
    os.remove(sidecar)
  end)

  it("removes all murmurs and deletes the sidecar file", function()
    M.add({ bufnr = bufnr, line = 1, author = "User", message = "first" })
    M.add({ bufnr = bufnr, line = 3, author = "Agent", message = "second" })
    assert.is_true(vim.fn.filereadable(sidecar) == 1)

    local n = M.delete_file_murmurs(bufnr)

    assert.is.equal(2, n)
    assert.is_false(vim.fn.filereadable(sidecar) == 1)
    assert.are.same({}, M._read_sidecar(sidecar))
  end)

  it("returns 0 when the buffer has no murmurs", function()
    assert.is.equal(0, M.delete_file_murmurs(bufnr))
  end)

  it("is idempotent — second call returns 0", function()
    M.add({ bufnr = bufnr, line = 1, author = "User", message = "x" })
    M.delete_file_murmurs(bufnr)
    assert.is.equal(0, M.delete_file_murmurs(bufnr))
  end)

  it("defaults to current buffer when bufnr omitted", function()
    M.add({ bufnr = bufnr, line = 1, author = "User", message = "cursor" })
    assert.is.equal(1, M.delete_file_murmurs())
  end)
end)

describe("delete_all_murmurs", function()
  local f1, f2, s1, s2, b1, b2

  before_each(function()
    f1 = "/tmp/murmur_del_all_1.lua"
    f2 = "/tmp/murmur_del_all_2.lua"
    s1 = f1 .. ".murmur.json"
    s2 = f2 .. ".murmur.json"
    os.remove(s1)
    os.remove(s2)
    b1 = make_file(f1, { "one", "two" })
    b2 = make_file(f2, { "three", "four" })
    M.add({ bufnr = b1, line = 1, author = "User", message = "a" })
    M.add({ bufnr = b1, line = 2, author = "User", message = "b" })
    M.add({ bufnr = b2, line = 1, author = "Agent", message = "c" })
  end)

  after_each(function()
    pcall(vim.cmd, "bdelete! " .. b1)
    pcall(vim.cmd, "bdelete! " .. b2)
    os.remove(f1)
    os.remove(f2)
    os.remove(s1)
    os.remove(s2)
  end)

  it("removes murmurs across all open buffers", function()
    local n = M.delete_all_murmurs()

    assert.is.equal(3, n)
    assert.is_false(vim.fn.filereadable(s1) == 1)
    assert.is_false(vim.fn.filereadable(s2) == 1)
  end)

  it("returns 0 when no murmurs remain", function()
    M.delete_all_murmurs()
    assert.is.equal(0, M.delete_all_murmurs())
  end)
end)
