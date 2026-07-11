-- spec/wrap_spec.lua
-- Run: nvim --headless --noplugin -u NORC -c "set rtp+=~/development/murmur" -c "set rtp+=<plenary>" -c "lua require('plenary.busted')" -c "qa"
local M = require("murmur")

describe("wrap_text", function()
  it("short text returns one line", function()
    local res = M._wrap("hello", 20)
    assert.are.same(1, #res)
    assert.are.same("hello", res[1])
  end)

  it("long text wraps to multiple lines each <= width", function()
    local width = 10
    local res = M._wrap("this is a long annotation that should wrap", width)
    assert.is_true(#res >= 2)
    for _, line in ipairs(res) do
      local w = vim.fn.strdisplaywidth(line)
      assert.is_true(w <= width, "line width " .. tostring(w) .. " exceeds " .. tostring(width))
    end
  end)

  it("overlong word hard-breaks", function()
    local res = M._wrap("supercalifragilisticexpialidocious", 10)
    assert.is_true(#res >= 2)
    for _, line in ipairs(res) do
      assert.is_true(vim.fn.strdisplaywidth(line) <= 10)
    end
  end)

  it("empty string returns one empty line", function()
    local res = M._wrap("", 10)
    assert.are.same(1, #res)
    assert.are.same("", res[1])
  end)

  it("nil string returns one empty line", function()
    local res = M._wrap(nil, 10)
    assert.are.same(1, #res)
  end)
end)
