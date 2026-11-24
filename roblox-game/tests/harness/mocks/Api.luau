--[[
	Class and member lookups over ApiData.luau (generated from the Roblox API dump).

	H.api.class(name) -> ClassInfo? { name, super, chain = {self, super, ...}, isA = {[className] = true},
	                                 tags = {[tag] = true}, own = {[memberName] = MemberInfo} }
	H.api.member(classInfo, name) -> MemberInfo?  (searches the inheritance chain)
	MemberInfo = { kind = "P" | "F" | "E" | "C" | "X", name, type?, readOnly?, deprecated?, hidden?, yields? }
	  P property, F function, E event, C callback, X exists in Roblox but game scripts may not use it.
]]
return function(H)
	local data = H.apiData
	local classes = H.cache.apiClasses -- parsed infos are immutable, so they are shared by every Env

	local Api = {}

	local function parseClass(name: string): any
		local raw = data[name]
		if not raw then
			return nil
		end
		local info = { name = name, super = nil, chain = {}, isA = {}, tags = {}, own = {} }
		if raw.s then
			info.super = Api.class(raw.s)
		end
		if raw.t then
			for _, tag in string.split(raw.t, " ") do
				info.tags[tag] = true
			end
		end
		local own = info.own
		if raw.p then
			for _, entry in string.split(raw.p, " ") do
				local parts = string.split(entry, ":")
				local flags = parts[3] or ""
				own[parts[1]] = {
					kind = "P",
					name = parts[1],
					type = parts[2],
					readOnly = string.find(flags, "r", 1, true) ~= nil,
					deprecated = string.find(flags, "d", 1, true) ~= nil,
					hidden = string.find(flags, "h", 1, true) ~= nil,
				}
			end
		end
		if raw.f then
			for _, entry in string.split(raw.f, " ") do
				local memberName = string.gsub(entry, "^[~*]+", "")
				own[memberName] = {
					kind = "F",
					name = memberName,
					deprecated = string.find(entry, "~", 1, true) ~= nil,
					yields = string.find(entry, "*", 1, true) ~= nil,
				}
			end
		end
		if raw.e then
			for _, entry in string.split(raw.e, " ") do
				local memberName = string.gsub(entry, "^~", "")
				own[memberName] = { kind = "E", name = memberName, deprecated = string.sub(entry, 1, 1) == "~" }
			end
		end
		if raw.c then
			for _, entry in string.split(raw.c, " ") do
				own[entry] = { kind = "C", name = entry }
			end
		end
		if raw.x then
			for _, entry in string.split(raw.x, " ") do
				if not own[entry] then
					own[entry] = { kind = "X", name = entry }
				end
			end
		end
		local current = info
		while current do
			table.insert(info.chain, current)
			info.isA[current.name] = true
			current = current.super
		end
		return info
	end

	function Api.class(name: string): any
		local info = classes[name]
		if info == nil then
			info = parseClass(name) or false
			classes[name] = info
		end
		return info or nil
	end

	function Api.member(info: any, name: string): any
		for _, class in info.chain do
			local member = class.own[name]
			if member then
				return member
			end
		end
		return nil
	end

	function Api.isService(name: string): boolean
		local info = Api.class(name)
		return info ~= nil and info.tags.Service == true
	end

	function Api.isCreatable(name: string): boolean
		local info = Api.class(name)
		return info ~= nil and not info.tags.NotCreatable
	end

	H.api = Api
	return Api
end
