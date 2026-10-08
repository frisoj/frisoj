-- Laadt de gedeelde modules buiten Roblox, met een nep-`script` zodat
-- `require(script.Parent:WaitForChild("Slimes"))` werkt.
local fs = require("@lune/fs")
local luau = require("@lune/luau")

return function(root: string)
	local cache = {}
	local function load(name: string): any
		if cache[name] ~= nil then
			return cache[name]
		end
		local parent = { WaitForChild = function(_, child) return { __shared = child } end }
		local env = setmetatable({
			script = { Parent = parent },
			require = function(x)
				assert(type(x) == "table" and x.__shared, "onverwachte require")
				return load(x.__shared)
			end,
		}, { __index = _G })
		local module = luau.load(fs.readFile(root .. "/src/shared/" .. name .. ".luau"), { debugName = name, environment = env })()
		cache[name] = module
		return module
	end
	return load
end
