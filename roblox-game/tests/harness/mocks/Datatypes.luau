--[[
	Datatypes and globals Lune's roblox library does not provide: Random, TweenInfo, DateTime, RaycastParams,
	OverlapParams, a few missing constructors, and a `typeof` that knows the harness' own objects.

	H.datatypes  -> { [globalName] = value } merged into every script environment
	H.typeof(v)  -> Roblox-style type name ("Instance", "RBXScriptSignal", "TweenInfo", "Vector3" ...)
	H.newRandom(seed?) -> deterministic Random object (also used by harness code that needs randomness)
]]
return function(H)
	local roblox = H.roblox
	local config = H.config
	local sched = H.sched
	local typeNames = H.typeNames

	local datatypes: { [string]: any } = {}
	for _, name in
		{
			"Axes", "BrickColor", "CFrame", "Color3", "ColorSequence", "ColorSequenceKeypoint", "Content", "Faces",
			"Font", "NumberRange", "NumberSequence", "NumberSequenceKeypoint", "PhysicalProperties", "Ray", "Rect",
			"Region3", "Region3int16", "UDim", "UDim2", "Vector2", "Vector2int16", "Vector3", "Vector3int16",
		}
	do
		datatypes[name] = (roblox :: any)[name]
	end
	local Enum = roblox.Enum
	local Vector3 = roblox.Vector3
	datatypes.Enum = Enum

	-- Lune's constructor tables are read-only; copy the ones that miss members.
	local function extend(base: any, extra: { [string]: any }): any
		local copy = {}
		for key, value in base do
			copy[key] = value
		end
		for key, value in extra do
			if copy[key] == nil then
				copy[key] = value
			end
		end
		return table.freeze(copy)
	end

	local NORMALS = {
		Right = Vector3.new(1, 0, 0),
		Left = Vector3.new(-1, 0, 0),
		Top = Vector3.new(0, 1, 0),
		Bottom = Vector3.new(0, -1, 0),
		Back = Vector3.new(0, 0, 1),
		Front = Vector3.new(0, 0, -1),
	}
	datatypes.Vector3 = extend(Vector3, {
		FromNormalId = function(normal: any)
			return NORMALS[normal.Name]
		end,
		FromAxis = function(axis: any)
			return if axis.Name == "X" then Vector3.xAxis elseif axis.Name == "Y" then Vector3.yAxis else Vector3.zAxis
		end,
	})

	--------------------------------------------------------------------------------------------------------------
	-- Random (mulberry32: small, fast, deterministic; NOT the same sequence as Roblox's PCG)
	--------------------------------------------------------------------------------------------------------------
	local Random = {}
	Random.__index = Random
	Random.__tostring = function()
		return "Random"
	end
	typeNames[Random] = "Random"

	local function imul(a: number, b: number): number
		local aLow, aHigh = bit32.band(a, 0xFFFF), bit32.rshift(a, 16)
		local bLow, bHigh = bit32.band(b, 0xFFFF), bit32.rshift(b, 16)
		local cross = bit32.band(aHigh * bLow + aLow * bHigh, 0xFFFF)
		return bit32.band(aLow * bLow + cross * 65536, 0xFFFFFFFF)
	end

	local function nextUnit(self: any): number
		local state = bit32.band(self._state + 0x6D2B79F5, 0xFFFFFFFF)
		self._state = state
		local t = imul(bit32.bxor(state, bit32.rshift(state, 15)), bit32.bor(state, 1))
		t = bit32.bxor(bit32.band(t + imul(bit32.bxor(t, bit32.rshift(t, 7)), bit32.bor(t, 61)), 0xFFFFFFFF), t)
		return bit32.bxor(t, bit32.rshift(t, 14)) / 4294967296
	end

	local seedCounter = 0
	local function newRandom(seed: number?)
		local value = seed
		if value == nil then
			-- unseeded generators are still deterministic per Env: each one gets the next seed in a fixed series
			seedCounter += 1
			value = config.randomSeed + seedCounter * 7919
		elseif type(value) ~= "number" then
			error(`Random.new: seed must be a number, got {typeof(value)}`, 3)
		end
		return setmetatable({ _state = bit32.band(math.floor(value) % 4294967296, 0xFFFFFFFF) }, Random)
	end

	function Random.NextNumber(self: any, min: number?, max: number?): number
		local unit = nextUnit(self)
		if min == nil and max == nil then
			return unit
		end
		if type(min) ~= "number" or type(max) ~= "number" then
			error("Random:NextNumber expects (min: number, max: number) or no arguments", 2)
		end
		return min + (max - min) * unit
	end

	function Random.NextInteger(self: any, min: number, max: number): number
		if type(min) ~= "number" or type(max) ~= "number" then
			error("Random:NextInteger expects (min: number, max: number)", 2)
		end
		if min % 1 ~= 0 or max % 1 ~= 0 then
			error("Random:NextInteger: bounds must be integers", 2)
		end
		if min > max then
			error("invalid argument #2 to 'NextInteger' (interval is empty)", 2)
		end
		return min + math.floor(nextUnit(self) * (max - min + 1))
	end

	function Random.NextUnitVector(self: any)
		local z = nextUnit(self) * 2 - 1
		local angle = nextUnit(self) * 2 * math.pi
		local radius = math.sqrt(math.max(1 - z * z, 0))
		return Vector3.new(radius * math.cos(angle), radius * math.sin(angle), z)
	end

	function Random.Shuffle(self: any, list: { any })
		if type(list) ~= "table" then
			error("Random:Shuffle expects a table", 2)
		end
		for index = #list, 2, -1 do
			local other = 1 + math.floor(nextUnit(self) * index)
			list[index], list[other] = list[other], list[index]
		end
	end

	function Random.Clone(self: any)
		return setmetatable({ _state = self._state }, Random)
	end

	datatypes.Random = table.freeze({
		new = function(seed: number?)
			return newRandom(seed)
		end,
	})
	H.newRandom = newRandom

	-- deterministic replacement for BrickColor.random / BrickColor.Random
	local brickColorRandom = newRandom(config.randomSeed + 7)
	local function randomBrickColor()
		return roblox.BrickColor.palette(brickColorRandom:NextInteger(1, 127))
	end
	local brickColorLibrary = {}
	for key, value in roblox.BrickColor :: any do
		brickColorLibrary[key] = value
	end
	brickColorLibrary.random = randomBrickColor
	brickColorLibrary.Random = randomBrickColor
	datatypes.BrickColor = table.freeze(brickColorLibrary)

	--------------------------------------------------------------------------------------------------------------
	-- TweenInfo
	--------------------------------------------------------------------------------------------------------------
	local TweenInfo = {}
	TweenInfo.__index = TweenInfo
	TweenInfo.__tostring = function(self)
		return `TweenInfo({self.Time}, {self.EasingStyle.Name}, {self.EasingDirection.Name})`
	end
	TweenInfo.__eq = function(a, b)
		return a.Time == b.Time
			and a.EasingStyle == b.EasingStyle
			and a.EasingDirection == b.EasingDirection
			and a.RepeatCount == b.RepeatCount
			and a.Reverses == b.Reverses
			and a.DelayTime == b.DelayTime
	end
	typeNames[TweenInfo] = "TweenInfo"

	local function expectEnum(value: any, enumName: string, argument: number)
		if typeof(value) ~= "EnumItem" or value.EnumType ~= (Enum :: any)[enumName] then
			error(`TweenInfo.new: argument #{argument} must be an Enum.{enumName}, got {tostring(value)}`, 3)
		end
	end

	datatypes.TweenInfo = table.freeze({
		new = function(time: number?, style: any, direction: any, repeatCount: number?, reverses: boolean?, delayTime: number?)
			if time ~= nil and type(time) ~= "number" then
				error(`TweenInfo.new: argument #1 must be a number, got {typeof(time)}`, 2)
			end
			if style ~= nil then
				expectEnum(style, "EasingStyle", 2)
			end
			if direction ~= nil then
				expectEnum(direction, "EasingDirection", 3)
			end
			if repeatCount ~= nil and type(repeatCount) ~= "number" then
				error(`TweenInfo.new: argument #4 must be a number, got {typeof(repeatCount)}`, 2)
			end
			if reverses ~= nil and type(reverses) ~= "boolean" then
				error(`TweenInfo.new: argument #5 must be a boolean, got {typeof(reverses)}`, 2)
			end
			if delayTime ~= nil and type(delayTime) ~= "number" then
				error(`TweenInfo.new: argument #6 must be a number, got {typeof(delayTime)}`, 2)
			end
			return table.freeze(setmetatable({
				Time = time or 1,
				EasingStyle = style or Enum.EasingStyle.Quad,
				EasingDirection = direction or Enum.EasingDirection.Out,
				RepeatCount = repeatCount or 0,
				Reverses = reverses or false,
				DelayTime = delayTime or 0,
			}, TweenInfo))
		end,
	})

	--------------------------------------------------------------------------------------------------------------
	-- DateTime
	--------------------------------------------------------------------------------------------------------------
	local DateTime = {}
	DateTime.__index = DateTime
	DateTime.__tostring = function(self)
		return tostring(self.UnixTimestampMillis)
	end
	DateTime.__eq = function(a, b)
		return a.UnixTimestampMillis == b.UnixTimestampMillis
	end
	DateTime.__lt = function(a, b)
		return a.UnixTimestampMillis < b.UnixTimestampMillis
	end
	DateTime.__le = function(a, b)
		return a.UnixTimestampMillis <= b.UnixTimestampMillis
	end
	typeNames[DateTime] = "DateTime"

	local function newDateTime(millis: number)
		local whole = math.floor(millis)
		return table.freeze(setmetatable({ UnixTimestamp = whole // 1000, UnixTimestampMillis = whole }, DateTime))
	end

	local function toParts(self: any): any
		local parts = os.date("!*t", self.UnixTimestamp) :: any
		return {
			Year = parts.year,
			Month = parts.month,
			Day = parts.day,
			Hour = parts.hour,
			Minute = parts.min,
			Second = parts.sec,
			Millisecond = self.UnixTimestampMillis % 1000,
		}
	end

	DateTime.ToUniversalTime = toParts
	DateTime.ToLocalTime = toParts -- the harness runs in UTC

	function DateTime.ToIsoDate(self: any): string
		return os.date("!%Y-%m-%dT%H:%M:%SZ", self.UnixTimestamp) :: string
	end

	local MONTHS = { "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December" }
	local function format(self: any, pattern: string): string
		local parts = toParts(self)
		local hour12 = parts.Hour % 12
		if hour12 == 0 then
			hour12 = 12
		end
		local tokens = {
			YYYY = string.format("%04d", parts.Year),
			YY = string.format("%02d", parts.Year % 100),
			MMMM = MONTHS[parts.Month],
			MMM = string.sub(MONTHS[parts.Month], 1, 3),
			MM = string.format("%02d", parts.Month),
			M = tostring(parts.Month),
			DD = string.format("%02d", parts.Day),
			D = tostring(parts.Day),
			HH = string.format("%02d", parts.Hour),
			H = tostring(parts.Hour),
			hh = string.format("%02d", hour12),
			h = tostring(hour12),
			mm = string.format("%02d", parts.Minute),
			m = tostring(parts.Minute),
			ss = string.format("%02d", parts.Second),
			s = tostring(parts.Second),
			SSS = string.format("%03d", parts.Millisecond),
			A = if parts.Hour < 12 then "AM" else "PM",
			a = if parts.Hour < 12 then "am" else "pm",
		}
		local result = string.gsub(pattern, "%a+", function(word: string)
			return tokens[word] or word
		end)
		return result
	end
	DateTime.FormatUniversalTime = function(self: any, pattern: string, _locale: string?)
		return format(self, pattern)
	end
	DateTime.FormatLocalTime = DateTime.FormatUniversalTime

	local function fromParts(year: number, month: number?, day: number?, hour: number?, minute: number?, second: number?, millisecond: number?)
		local seconds = os.time({
			year = year,
			month = month or 1,
			day = day or 1,
			hour = hour or 0,
			min = minute or 0,
			sec = second or 0,
		})
		return newDateTime(seconds * 1000 + (millisecond or 0))
	end

	datatypes.DateTime = table.freeze({
		now = function()
			return newDateTime(sched.unixTime() * 1000)
		end,
		fromUnixTimestamp = function(seconds: number)
			return newDateTime(seconds * 1000)
		end,
		fromUnixTimestampMillis = function(millis: number)
			return newDateTime(millis)
		end,
		fromUniversalTime = fromParts,
		fromLocalTime = fromParts,
		fromIsoDate = function(iso: string)
			local year, month, day, hour, minute, second = string.match(iso, "^(%d+)-(%d+)-(%d+)[T ]?(%d*):?(%d*):?(%d*)")
			if not year then
				return nil
			end
			return fromParts(tonumber(year) :: number, tonumber(month), tonumber(day), tonumber(hour), tonumber(minute), tonumber(second))
		end,
	})

	--------------------------------------------------------------------------------------------------------------
	-- RaycastParams / OverlapParams (strict field names so typos fail like they do in Roblox)
	--------------------------------------------------------------------------------------------------------------
	local function paramsType(typeName: string, defaults: () -> { [string]: any })
		local meta = {}
		typeNames[meta] = typeName
		local storage = setmetatable({}, { __mode = "k" })
		local methods = {
			AddToFilter = function(self: any, instances: any)
				local fields = storage[self]
				local list = table.clone(fields.FilterDescendantsInstances)
				if type(instances) == "table" then
					for _, instance in instances do
						table.insert(list, instance)
					end
				else
					table.insert(list, instances)
				end
				fields.FilterDescendantsInstances = list
			end,
		}
		meta.__index = function(self, key)
			local method = methods[key]
			if method then
				return method
			end
			local fields = storage[self]
			if fields[key] == nil and defaults()[key] == nil then
				error(`{key} is not a valid member of {typeName}`, 2)
			end
			return fields[key]
		end
		meta.__newindex = function(self, key, value)
			local fields = storage[self]
			if defaults()[key] == nil then
				error(`{key} is not a valid member of {typeName}`, 2)
			end
			if key == "FilterDescendantsInstances" and type(value) ~= "table" then
				error(`{typeName}.FilterDescendantsInstances must be an array of Instances`, 2)
			end
			fields[key] = value
		end
		meta.__tostring = function()
			return typeName
		end
		return table.freeze({
			new = function()
				local object = setmetatable({}, meta)
				storage[object] = defaults()
				return object
			end,
		})
	end

	datatypes.RaycastParams = paramsType("RaycastParams", function()
		return {
			FilterDescendantsInstances = {},
			FilterType = Enum.RaycastFilterType.Exclude,
			IgnoreWater = false,
			CollisionGroup = "Default",
			RespectCanCollide = false,
			BruteForceAllSlow = false,
		}
	end)
	datatypes.OverlapParams = paramsType("OverlapParams", function()
		return {
			FilterDescendantsInstances = {},
			FilterType = Enum.RaycastFilterType.Exclude,
			MaxParts = 0,
			CollisionGroup = "Default",
			RespectCanCollide = false,
			BruteForceAllSlow = false,
		}
	end)

	--------------------------------------------------------------------------------------------------------------
	-- typeof
	--------------------------------------------------------------------------------------------------------------
	local realTypeof = typeof
	-- Instance proxies are userdata made by the harness: proxy -> record (filled by the Instances module).
	local recordOf = setmetatable({}, { __mode = "k" })
	H.recordOf = recordOf

	local function harnessTypeof(value: any): string
		local name = realTypeof(value)
		if name == "userdata" then
			if recordOf[value] ~= nil then
				return "Instance"
			end
		elseif name == "table" then
			local meta = getmetatable(value)
			if meta ~= nil then
				return typeNames[meta] or name
			end
		end
		return name
	end
	H.typeof = harnessTypeof
	H.datatypes = datatypes

	return datatypes
end
