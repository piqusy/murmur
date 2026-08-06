-- spec/sidecar_spec.lua
-- Run: nvim --headless --noplugin -u NORC -c "set rtp+=~/development/murmur" -c "set rtp+=<plenary>" -c "lua require('plenary.busted')" -c "qa"
local M = require("murmur")
local uv = vim.uv

describe("read_sidecar", function()
  it("returns empty table for missing path", function()
    assert.are.same({}, M._read_sidecar("/tmp/murmur_does_not_exist.json"))
  end)

  it("returns empty table for nil path", function()
    assert.are.same({}, M._read_sidecar(nil))
  end)

  it("returns empty table for malformed JSON", function()
    local tmp = "/tmp/murmur_malformed.json"
    local f = io.open(tmp, "w")
    f:write("{not valid json")
    f:close()
    assert.are.same({}, M._read_sidecar(tmp))
    os.remove(tmp)
  end)
end)

describe("write_sidecar + read_sidecar roundtrip", function()
  it("persists and restores murmur data", function()
    local tmp = "/tmp/murmur_roundtrip.json"
    local data = {
      { id = "abc", line = 5, anchor = "def foo():", author = "User", message = "hello" },
      { id = "def", line = 10, anchor = "return True", author = "Reviewer", message = "world" },
    }
    local ok = M._write_sidecar(0, tmp, data)
    assert.is_true(ok)
    local restored = M._read_sidecar(tmp)
    assert.are.equal(2, #restored)
    assert.are.same("hello", restored[1].message)
    assert.are.same("Reviewer", restored[2].author)
    os.remove(tmp)
  end)

  it("returns false for nil path", function()
    assert.is_false(M._write_sidecar(0, nil, {}))
  end)
end)

describe("multiline murmurs", function()
  it("persists visual command range boundaries", function()
    M.setup()
    local file = vim.fn.tempname()
    vim.fn.writefile({ "one", "two", "three", "four" }, file)
    vim.cmd("edit " .. vim.fn.fnameescape(file))
    vim.ui.input = function(_, callback) callback("review selection") end

    vim.cmd("normal! 2G0V4G")
    M.add_visual_murmur()
    assert.is_true(vim.wait(100, function()
      return vim.fn.filereadable(file .. ".murmur.json") == 1
    end))

    local murmurs = M._read_sidecar(file .. ".murmur.json")
    assert.are.equal(1, #murmurs)
    assert.are.equal(2, murmurs[1].line)
    assert.are.equal(4, murmurs[1].end_line)
    assert.are.equal("two", murmurs[1].anchor)
    assert.are.equal("four", murmurs[1].end_anchor)
    local has_range_label = false
    for _, extmark in ipairs(vim.api.nvim_buf_get_extmarks(0, -1, 0, -1, { details = true })) do
      local details = extmark[4]
      if details.virt_lines then
        local header = ""
        for _, chunk in ipairs(details.virt_lines[1]) do
          header = header .. chunk[1]
        end
        has_range_label = header:find("L:2%-4", 1) ~= nil
      end
    end
    assert.is_true(has_range_label)
    vim.api.nvim_buf_set_lines(0, 0, 0, false, { "zero" })
    vim.cmd("write")

    local moved_murmurs = M._read_sidecar(file .. ".murmur.json")
    assert.are.equal(3, moved_murmurs[1].line)
    assert.are.equal(5, moved_murmurs[1].end_line)
    vim.cmd("bwipeout!")
    os.remove(file)
    os.remove(file .. ".murmur.json")
  end)
end)

describe("write_sidecar empty-data handling", function()
  it("deletes the sidecar for empty data instead of writing []", function()
    local tmp = "/tmp/murmur_empty_delete.json"
    M._write_sidecar(0, tmp, { { id = "x", line = 1, message = "test" } })
    assert.is_true(vim.fn.filereadable(tmp) == 1)
    M._write_sidecar(0, tmp, {})
    assert.is_false(vim.fn.filereadable(tmp) == 1)
    os.remove(tmp)
  end)

  it("returns true for empty data with valid path", function()
    assert.is_true(M._write_sidecar(0, "/tmp/murmur_empty_ok.json", {}))
  end)

  it("leaves no .tmp artifact after successful write", function()
    local tmp = "/tmp/murmur_no_tmp.json"
    M._write_sidecar(0, tmp, { { id = "y", line = 1, message = "z" } })
    assert.is_false(vim.fn.filereadable(tmp .. ".tmp") == 1)
    assert.is_true(vim.fn.filereadable(tmp) == 1)
    os.remove(tmp)
  end)
end)
