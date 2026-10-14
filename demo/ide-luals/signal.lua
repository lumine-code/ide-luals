local samples = { 0.2, 0.8, -0.4, 0.5, 1.0 }

local function average(values)
  local total = 0
  for _, value in ipairs(values) do total = total + value end
  return total / #values
end

---@type number
local amplitude = "high"
print(average(samples), amplitude)
