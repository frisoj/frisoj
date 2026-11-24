--!strict
--[[
	TableUtil — small, pure table helpers shared by server and client (runs under Lune tests).

	Nothing here mutates its input except setPath. Functions that need randomness take a Random (anything with
	NextInteger/NextNumber works at runtime, which lets tests pass a deterministic stub).
]]

local TableUtil = {}

local function copyInto(value: any, seen: { [any]: any }): any
	if type(value) ~= "table" then
		return value
	end
	local existing = seen[value]
	if existing ~= nil then
		return existing
	end
	local copy = {}
	seen[value] = copy
	for key, child in value do
		copy[copyInto(key, seen)] = copyInto(child, seen)
	end
	return copy
end

-- Recursive copy of plain data (keys and values; metatables are not copied). Shared and cyclic references are
-- preserved as shared/cyclic references inside the copy. Non-table values are returned as they are.
function TableUtil.deepCopy<T>(value: T): T
	return copyInto(value, {})
end

-- Structural equality for plain, acyclic data. NaN is not equal to anything (as in Luau).
function TableUtil.deepEqual(a: any, b: any): boolean
	if a == b then
		return true
	end
	if type(a) ~= "table" or type(b) ~= "table" then
		return false
	end
	for key, value in a do
		if not TableUtil.deepEqual(value, b[key]) then
			return false
		end
	end
	for key in b do
		if a[key] == nil then
			return false
		end
	end
	return true
end

-- Reads tbl[path[1]][path[2]]...; nil as soon as a step is missing or not a table. An empty path returns tbl.
-- Keys are used exactly as given: strings address dictionary keys, numbers address array slots ("1" ~= 1).
function TableUtil.getPath(tbl: any, path: { any }): any
	local current = tbl
	for _, key in path do
		if type(current) ~= "table" then
			return nil
		end
		current = current[key]
	end
	return current
end

-- Writes value at the path, creating intermediate tables (a non-table value in the way is replaced by a table).
-- value == nil removes the final key; in that case missing intermediate tables are not created.
-- Errors on an empty path or a non-table root, because there is nothing to assign into.
function TableUtil.setPath(tbl: any, path: { any }, value: any)
	local depth = #path
	if type(tbl) ~= "table" then
		error("TableUtil.setPath: root must be a table, got " .. typeof(tbl), 2)
	end
	if depth == 0 then
		error("TableUtil.setPath: path must not be empty", 2)
	end
	local current = tbl
	for index = 1, depth - 1 do
		local key = path[index]
		local child = current[key]
		if type(child) ~= "table" then
			if value == nil then
				return
			end
			child = {}
			current[key] = child
		end
		current = child
	end
	current[path[depth]] = value
end

-- Number of keys (array part and dictionary part).
function TableUtil.count(tbl: { [any]: any }): number
	local total = 0
	for _ in tbl do
		total += 1
	end
	return total
end

function TableUtil.isEmpty(tbl: { [any]: any }): boolean
	return next(tbl) == nil
end

-- Keys in unspecified order (use sortedKeys when the order matters).
function TableUtil.keys<K, V>(tbl: { [K]: V }): { K }
	local result: { K } = {}
	for key in tbl do
		table.insert(result, key)
	end
	return result
end

-- Keys sorted ascending (numbers before strings), for deterministic iteration over dictionaries.
function TableUtil.sortedKeys<K, V>(tbl: { [K]: V }): { K }
	local result: { any } = {}
	for key in tbl do
		table.insert(result, key)
	end
	table.sort(result, function(a: any, b: any): boolean
		local typeA, typeB = type(a), type(b)
		if typeA ~= typeB then
			return typeA < typeB
		end
		if typeA == "number" or typeA == "string" then
			return a < b
		end
		return tostring(a) < tostring(b)
	end)
	return result
end

-- Values in unspecified order.
function TableUtil.values<K, V>(tbl: { [K]: V }): { V }
	local result: { V } = {}
	for _, value in tbl do
		table.insert(result, value)
	end
	return result
end

-- New array with fn(value, index) of every element; nil results are skipped (the result stays dense).
function TableUtil.map<T, U>(array: { T }, fn: (value: T, index: number) -> U): { U }
	local result: { U } = table.create(#array)
	for index, value in ipairs(array) do
		local mapped = fn(value, index)
		if mapped ~= nil then
			table.insert(result, mapped)
		end
	end
	return result
end

-- New array with the elements for which fn(value, index) is truthy, in the original order.
function TableUtil.filter<T>(array: { T }, fn: (value: T, index: number) -> any): { T }
	local result: { T } = {}
	for index, value in ipairs(array) do
		if fn(value, index) then
			table.insert(result, value)
		end
	end
	return result
end

-- Returns a shuffled copy (Fisher-Yates); the input array is left untouched so shared config is never reordered.
function TableUtil.shuffle<T>(array: { T }, rng: Random): { T }
	local result = table.clone(array)
	for index = #result, 2, -1 do
		local other = rng:NextInteger(1, index)
		result[index], result[other] = result[other], result[index]
	end
	return result
end

local function isFiniteNumber(value: any): boolean
	return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

-- Validates untrusted or loaded numbers: anything that is not a finite number (nil, strings, NaN, ±inf) becomes
-- `default`; finite numbers are clamped to [min, max]. An empty range (min > max) also yields `default`.
function TableUtil.clampNumber(value: any, min: number, max: number, default: number): number
	if not isFiniteNumber(value) or min > max then
		return default
	end
	return math.clamp(value, min, max)
end

-- clampNumber for whole numbers: finite values are floored before clamping.
function TableUtil.clampInteger(value: any, min: number, max: number, default: number): number
	if not isFiniteNumber(value) or min > max then
		return default
	end
	return math.clamp(math.floor(value), min, max)
end

return TableUtil
