--[[
	The Instance tree, implemented in plain Luau.

	An Instance seen by game code is a userdata proxy; its state lives in a record:
		{ class, name, parent, children, values (property values), attributes, tags, signals, callbacks, state }
	Member access goes through one resolver per class which combines (a) mocks registered with H.class(className),
	(b) the Roblox API data: properties are stored and type-checked generically, events become signals,
	callbacks are stored, and functions without a mock raise "HARNESS: X.Y is not mocked", (c) children by name.
	Anything else raises Roblox's "X is not a valid member of Y" error, so typos fail exactly like in Studio.

	Mocking API for the other harness modules (and for whoever needs to add a missing member):
		local Part = H.class("BasePart")              -- applies to the class and everything inheriting from it
		Part.methods.GetMass = function(self) ... end
		Part.props.Position = { get = function(self) ... end, set = function(self, value) ... end }
		Part.defaults.Anchored = false                -- default value (otherwise Lune's reflection default)
		Part.changed.Health = function(self, new, old) end   -- after a stored property changed
		Part.signals.Touched = function(self) return { buffer = true } end   -- Signal options
		Part.callbacks.OnInvoke = function(self, fn) end     -- after a callback member was assigned
		Part.init / Part.destroyed / Part.cloned(original, clone)
		Part.anyMethod = function(name) return fn or nil end  -- catch-all for unmocked functions
	Helpers: H.raw(self, prop), H.rawset(self, prop, value) (bypass getters/setters/read-only, fires Changed),
	H.state(self) (free-form per-instance table), H.fire(self, event, ...), H.signal(self, event),
	H.create(className, props?) (also for NotCreatable classes), H.isInstance(v), H.sideOf(self).
]]
return function(H)
	local api = H.api
	local sched = H.sched
	local Signal = H.Signal
	local config = H.config
	local roblox = H.roblox
	local Enum = roblox.Enum
	local realTypeof = typeof
	local recordOf = H.recordOf -- proxy -> record (weak keys)
	local proxyOf = setmetatable({}, { __mode = "kv" }) -- record -> proxy

	local PROP, METHOD, EVENT, CALLBACK, UNMOCKED = "prop", "method", "event", "callback", "unmocked"

	local Instances = {}
	local gameRecord: any = nil

	-- number of listeners per tree event in the whole Env: lets Parent changes skip all event work when unused
	local listeners = { ChildAdded = 0, ChildRemoved = 0, DescendantAdded = 0, DescendantRemoving = 0, AncestryChanged = 0 }
	-- CollectionService bookkeeping (tags only count while the instance is inside the DataModel)
	local tags = { used = false, index = {}, added = {}, removed = {} }
	H.tags = tags

	--------------------------------------------------------------------------------------------------------------
	-- mock definitions and classes
	--------------------------------------------------------------------------------------------------------------
	local mockDefs: { [string]: any } = {}
	local classes: { [string]: any } = {}
	local defsVersion = 0

	function H.class(className: string): any
		local def = mockDefs[className]
		if not def then
			if not api.class(className) then
				error(`H.class: "{className}" is not a Roblox class`, 2)
			end
			def = { props = {}, methods = {}, defaults = {}, changed = {}, signals = {}, callbacks = {} }
			mockDefs[className] = def
		end
		defsVersion += 1 -- definitions may change after this call: resolved member caches are rebuilt lazily
		return def
	end

	local function getClass(className: string): any
		local class = classes[className]
		if class == nil then
			local info = api.class(className)
			if not info then
				return nil
			end
			class = { name = className, info = info, isA = info.isA, members = {}, defs = {}, version = -1, valueBase = info.isA.ValueBase == true }
			classes[className] = class
		end
		return class
	end

	-- Mock definitions that apply to a class, most derived first.
	local function defsOf(class: any): { any }
		if class.version ~= defsVersion then
			class.version = defsVersion
			table.clear(class.members)
			local defs = {}
			for _, info in class.info.chain do
				local def = mockDefs[info.name]
				if def then
					table.insert(defs, def)
				end
			end
			class.defs = defs
		end
		return class.defs
	end

	--------------------------------------------------------------------------------------------------------------
	-- property types
	--------------------------------------------------------------------------------------------------------------
	local scratch = buffer.create(4)
	local function toFloat32(value: number): number
		buffer.writef32(scratch, 0, value)
		return buffer.readf32(scratch, 0)
	end

	local function toNumber(value: any): number?
		if type(value) == "number" then
			return value
		elseif type(value) == "string" then
			return tonumber(value)
		end
		return nil
	end

	local PASSTHROUGH = function(value: any)
		return true, value
	end
	local STRINGLIKE = function(value: any)
		if type(value) == "string" then
			return true, value
		elseif type(value) == "number" then
			return true, tostring(value)
		end
		return false, "string"
	end
	local coercers: { [string]: (any) -> (boolean, any) } = {
		bool = function(value)
			if type(value) == "boolean" then
				return true, value
			end
			return false, "bool"
		end,
		int = function(value)
			local number = toNumber(value)
			if number == nil or number ~= number then
				return false, "int"
			end
			return true, if number >= 0 then math.floor(number) else math.ceil(number)
		end,
		float = function(value)
			local number = toNumber(value)
			if number == nil then
				return false, "float"
			end
			return true, toFloat32(number)
		end,
		double = function(value)
			local number = toNumber(value)
			if number == nil then
				return false, "double"
			end
			return true, number
		end,
		string = STRINGLIKE,
		ContentId = STRINGLIKE,
		ProtectedString = STRINGLIKE,
		BinaryString = STRINGLIKE,
		Content = function(value)
			if realTypeof(value) == "Content" then
				return true, value
			elseif type(value) == "string" then
				return true, roblox.Content.fromUri(value)
			end
			return false, "Content"
		end,
		PhysicalProperties = function(value)
			if value == nil or realTypeof(value) == "PhysicalProperties" then
				return true, value
			end
			return false, "PhysicalProperties"
		end,
	}
	coercers.int64 = coercers.int
	-- datatypes that only need a typeof check
	for _, name in
		{
			"Vector3", "Vector2", "CFrame", "Color3", "BrickColor", "UDim", "UDim2", "Rect", "NumberRange",
			"NumberSequence", "ColorSequence", "Font", "Faces", "Axes", "Ray", "Region3", "Region3int16",
			"Vector3int16", "Vector2int16",
		}
	do
		coercers[name] = function(value)
			if realTypeof(value) == name then
				return true, value
			end
			return false, name
		end
	end

	local function enumCoercer(enumName: string)
		local okEnum, enum = pcall(function()
			return (Enum :: any)[enumName]
		end)
		if not okEnum or not enum then
			return PASSTHROUGH -- newer enum than Lune knows: accept anything
		end
		local items = enum:GetEnumItems()
		return function(value: any)
			local kind = realTypeof(value)
			if kind == "EnumItem" then
				if value.EnumType == enum then
					return true, value
				end
				return false, "Enum." .. enumName
			elseif kind == "string" then
				for _, item in items do
					if item.Name == value then
						return true, item
					end
				end
			elseif kind == "number" then
				for _, item in items do
					if item.Value == value then
						return true, item
					end
				end
			end
			return false, "Enum." .. enumName
		end
	end

	local function refCoercer(className: string)
		return function(value: any)
			if value == nil then
				return true, nil
			end
			local record = recordOf[value]
			if record and record.class.isA[className] then
				return true, value
			end
			return false, className
		end
	end

	local function coercerFor(typeName: string?): (any) -> (boolean, any)
		if not typeName then
			return PASSTHROUGH
		end
		local coercer = coercers[typeName]
		if not coercer then
			local first = string.sub(typeName, 1, 1)
			if first == "@" then
				coercer = refCoercer(string.sub(typeName, 2))
			elseif string.sub(typeName, 1, 2) == "E." then
				coercer = enumCoercer(string.sub(typeName, 3))
			else
				coercer = PASSTHROUGH
			end
			coercers[typeName] = coercer
		end
		return coercer
	end

	local typeDefaults: { [string]: any } = {
		bool = false,
		int = 0,
		int64 = 0,
		float = 0,
		double = 0,
		string = "",
		ContentId = "",
		ProtectedString = "",
		BinaryString = "",
		Vector3 = roblox.Vector3.zero,
		Vector2 = roblox.Vector2.zero,
		CFrame = roblox.CFrame.identity,
		Color3 = roblox.Color3.new(0, 0, 0),
		UDim = roblox.UDim.new(0, 0),
		UDim2 = roblox.UDim2.new(0, 0, 0, 0),
		Rect = roblox.Rect.new(0, 0, 0, 0),
		NumberRange = roblox.NumberRange.new(0),
		NumberSequence = roblox.NumberSequence.new(1),
		ColorSequence = roblox.ColorSequence.new(roblox.Color3.new(1, 1, 1)),
		BrickColor = roblox.BrickColor.new("Medium stone grey"),
		Font = roblox.Font.fromEnum(Enum.Font.SourceSans),
		Content = roblox.Content.none,
	}

	local function typeDefault(typeName: string?): any
		if not typeName then
			return nil
		end
		local value = typeDefaults[typeName]
		if value == nil and string.sub(typeName, 1, 2) == "E." then
			local ok, enum = pcall(function()
				return (Enum :: any)[string.sub(typeName, 3)]
			end)
			if ok and enum then
				local items = enum:GetEnumItems()
				value = items[1]
				for _, item in items do
					if item.Value == 0 then
						value = item
						break
					end
				end
			end
		end
		return value
	end

	-- Default value from Lune's reflection database: read it off a throw-away instance of the class.
	local NO_DEFAULT = table.freeze({})
	local function reflectionDefault(className: string, key: string): any
		local perClass = H.cache.defaults[className]
		if not perClass then
			perClass = {}
			H.cache.defaults[className] = perClass
		end
		local cached = perClass[key]
		if cached == nil then
			local prototype = H.cache.prototypes[className]
			if prototype == nil then
				local ok, instance = pcall(roblox.Instance.new, className)
				prototype = if ok then instance else false
				H.cache.prototypes[className] = prototype
			end
			cached = NO_DEFAULT
			if prototype then
				local ok, value = pcall(function()
					return (prototype :: any)[key]
				end)
				if ok and value ~= nil and realTypeof(value) ~= "Instance" then
					cached = value
				end
			end
			perClass[key] = cached
		end
		return cached
	end

	-- Fills descriptor.default / descriptor.hasDefault (once per class and property).
	local function resolveDefault(class: any, descriptor: any)
		descriptor.defaultResolved = true
		local key = descriptor.name
		for _, def in defsOf(class) do
			local value = def.defaults[key]
			if value ~= nil then
				descriptor.default, descriptor.hasDefault = value, true
				return
			end
		end
		local typeName = descriptor.type
		if typeName and string.sub(typeName, 1, 1) == "@" then
			descriptor.default, descriptor.hasDefault = nil, true
			return
		end
		local value = reflectionDefault(class.name, key)
		if value ~= NO_DEFAULT then
			-- run it through the coercer so defaults have the same representation as assigned values
			local ok, coerced = descriptor.coerce(value)
			descriptor.default, descriptor.hasDefault = if ok then coerced else value, true
			return
		end
		if descriptor.readOnly then
			-- engine-computed value nobody mocked: reading it must fail loudly instead of returning a guess
			descriptor.hasDefault = false
			return
		end
		descriptor.default, descriptor.hasDefault = typeDefault(typeName), true
	end

	--------------------------------------------------------------------------------------------------------------
	-- member resolution
	--------------------------------------------------------------------------------------------------------------
	local function resolveMember(class: any, key: any): any
		local defs = defsOf(class)
		if type(key) ~= "string" then
			return false
		end
		local member = api.member(class.info, key)
		local mockProp, mockMethod
		for _, def in defs do
			mockProp = def.props[key]
			if mockProp then
				break
			end
			mockMethod = def.methods[key]
			if mockMethod then
				break
			end
		end
		local descriptor: any = false
		if mockMethod then
			descriptor = { kind = METHOD, fn = mockMethod }
		elseif mockProp or (member and member.kind == "P") then
			if member and member.deprecated and not mockProp then
				descriptor = { kind = UNMOCKED, reason = "deprecated" }
			else
				descriptor = {
					kind = PROP,
					name = key,
					type = member and member.type,
					readOnly = member ~= nil and member.readOnly,
					get = mockProp and mockProp.get,
					set = mockProp and mockProp.set,
					coerce = coercerFor(member and member.type),
					defaultResolved = false,
					hasDefault = false,
					default = nil,
					changed = nil,
				}
				for _, def in defs do
					if def.changed[key] then
						descriptor.changed = def.changed[key]
						break
					end
				end
			end
		elseif member then
			if member.kind == "E" then
				descriptor = if member.deprecated then { kind = UNMOCKED, reason = "deprecated" } else { kind = EVENT }
			elseif member.kind == "C" then
				descriptor = { kind = CALLBACK, hook = nil }
				for _, def in defs do
					if def.callbacks[key] then
						descriptor.hook = def.callbacks[key]
						break
					end
				end
			elseif member.kind == "F" then
				for _, def in defs do
					if def.anyMethod then
						local fn = def.anyMethod(key, member)
						if fn then
							descriptor = { kind = METHOD, fn = fn }
							break
						end
					end
				end
				if not descriptor then
					descriptor = { kind = UNMOCKED, reason = if member.deprecated then "deprecated" else "function" }
				end
			else
				descriptor = { kind = UNMOCKED, reason = "restricted" }
			end
		end
		class.members[key] = descriptor
		return descriptor
	end

	local function unmockedError(class: any, key: string, descriptor: any, level: number)
		if descriptor.reason == "deprecated" then
			error(
				`HARNESS: {class.name}.{key} is deprecated in Roblox and is not mocked (use the modern member; mocks live in tests/harness/Mocks.luau)`,
				level + 1
			)
		elseif descriptor.reason == "restricted" then
			error(`HARNESS: {class.name}.{key} cannot be used by game scripts (Roblox-internal or plugin-only member)`, level + 1)
		end
		error(`HARNESS: {class.name}.{key} is not mocked (add it in tests/harness/Mocks.luau)`, level + 1)
	end

	--------------------------------------------------------------------------------------------------------------
	-- proxies
	--------------------------------------------------------------------------------------------------------------
	local index, newindex
	-- side name -> { [base record] = view proxy }: extra proxies that report another side (see Instances.sideView)
	local sideViews: { [string]: { [any]: any } } = {}

	local function baseOf(record: any): any
		return record.base or record
	end

	local function fullName(record: any): string
		local parts = { record.name }
		local parent = record.parent
		while parent and parent ~= gameRecord do
			table.insert(parts, 1, parent.name)
			parent = parent.parent
		end
		return table.concat(parts, ".")
	end

	local function tostringInstance(proxy: any): string
		return recordOf[proxy].name
	end

	local function equals(a: any, b: any): boolean
		local recordA, recordB = recordOf[a], recordOf[b]
		return recordA ~= nil and recordB ~= nil and baseOf(recordA) == baseOf(recordB)
	end

	local function makeProxy(record: any): any
		local proxy = newproxy(true)
		local meta = getmetatable(proxy)
		meta.__index = index
		meta.__newindex = newindex
		meta.__tostring = tostringInstance
		meta.__eq = equals
		meta.__metatable = "The metatable is locked"
		recordOf[proxy] = record
		proxyOf[record] = proxy
		return proxy
	end

	local function toProxy(record: any): any
		return proxyOf[record] or makeProxy(record)
	end

	-- record (never a side view) of an Instance argument, or nil
	local function toRecord(value: any): any
		local record = recordOf[value]
		return record and (record.base or record)
	end

	local function getSignal(record: any, name: string): any
		local signals = record.signals
		if not signals then
			signals = {}
			record.signals = signals
		end
		local signal = signals[name]
		if not signal then
			local options: any = nil
			for _, def in defsOf(record.class) do
				local make = def.signals[name]
				if make then
					options = make(toProxy(record))
					break
				end
			end
			if listeners[name] ~= nil then
				options = options or {}
				options.onListeners = function(delta: number)
					listeners[name] += delta
				end
			elseif name == "Destroying" then
				options = options or {}
				options.immediate = true
			end
			signal = Signal.new(record.class.name .. "." .. name, options)
			signals[name] = signal
		end
		return signal
	end

	local function fireIfExists(record: any, name: string, ...)
		local signals = record.signals
		if signals then
			local signal = signals[name]
			if signal then
				signal:_fire(...)
			end
		end
	end

	local function notifyChanged(record: any, descriptor: any?, key: string, value: any, old: any)
		if descriptor and descriptor.changed then
			descriptor.changed(toProxy(record), value, old)
		end
		local signals = record.signals
		if signals then
			local changed = signals.Changed
			if changed then
				if record.class.valueBase then
					if key == "Value" then
						changed:_fire(value)
					end
				else
					changed:_fire(key)
				end
			end
		end
		local propSignals = record.propSignals
		if propSignals then
			local signal = propSignals[key]
			if signal then
				signal:_fire()
			end
		end
	end

	local function readStored(record: any, descriptor: any, key: string, level: number): any
		local values = record.values
		if values then
			local value = values[key]
			if value ~= nil then
				return value
			end
		end
		if not descriptor.defaultResolved then
			resolveDefault(record.class, descriptor)
		end
		if not descriptor.hasDefault then
			error(`HARNESS: {record.class.name}.{key} is not mocked (add it in tests/harness/Mocks.luau)`, level + 1)
		end
		return descriptor.default
	end

	local function writeStored(record: any, descriptor: any, key: string, value: any)
		local values = record.values
		if not values then
			values = {}
			record.values = values
		end
		local old = values[key]
		if old == nil then
			if not descriptor.defaultResolved then
				resolveDefault(record.class, descriptor)
			end
			old = descriptor.default
		end
		if old == value then
			return
		end
		values[key] = value
		notifyChanged(record, descriptor, key, value, old)
	end

	local function findChild(record: any, name: any): any
		local children = record.children
		if children then
			for position = 1, #children do
				local child = children[position]
				if child.name == name then
					return child
				end
			end
		end
		return nil
	end

	index = function(proxy: any, key: any): any
		local record = recordOf[proxy]
		local class = record.class
		local descriptor = class.members[key]
		if descriptor == nil or class.version ~= defsVersion then
			descriptor = resolveMember(class, key)
		end
		if descriptor then
			local kind = descriptor.kind
			if kind == PROP then
				local getter = descriptor.get
				if getter then
					return getter(proxy)
				end
				return readStored(record, descriptor, key, 2)
			elseif kind == METHOD then
				return descriptor.fn
			elseif kind == EVENT then
				return getSignal(record, key)
			elseif kind == CALLBACK then
				error(`{key} is a callback member of {class.name}; you can only set the callback value, get is not available`, 2)
			end
			unmockedError(class, key, descriptor, 2)
		end
		local child = findChild(record, key)
		if child then
			local side = record.side
			if side then
				return sideViews[side][child] or toProxy(child)
			end
			return toProxy(child)
		end
		error(`{tostring(key)} is not a valid member of {class.name} "{fullName(record)}"`, 2)
	end

	newindex = function(proxy: any, key: any, value: any)
		local record = recordOf[proxy]
		local class = record.class
		local descriptor = class.members[key]
		if descriptor == nil or class.version ~= defsVersion then
			descriptor = resolveMember(class, key)
		end
		if not descriptor then
			error(`{tostring(key)} is not a valid member of {class.name} "{fullName(record)}"`, 2)
		end
		local kind = descriptor.kind
		if kind == PROP then
			if descriptor.set then
				descriptor.set(proxy, value)
				return
			end
			if descriptor.readOnly then
				error(`Unable to assign property {key}. Property is read only`, 2)
			end
			local ok, coerced = descriptor.coerce(value)
			if not ok then
				error(`Unable to assign property {key}. {coerced} expected, got {H.typeof(value)}`, 2)
			end
			writeStored(baseOf(record), descriptor, key, coerced)
		elseif kind == CALLBACK then
			if value ~= nil and type(value) ~= "function" then
				error(`Unable to assign callback {key}. function expected, got {H.typeof(value)}`, 2)
			end
			local callbacks = record.callbacks
			if not callbacks then
				callbacks = {}
				record.callbacks = callbacks
			end
			callbacks[key] = value
			if descriptor.hook then
				descriptor.hook(proxy, value)
			end
		elseif kind == UNMOCKED then
			unmockedError(class, key, descriptor, 2)
		else
			error(`Unable to assign {key}: it is {if kind == EVENT then "an event" else "a function"} of {class.name}`, 2)
		end
	end

	--------------------------------------------------------------------------------------------------------------
	-- helpers for mock modules
	--------------------------------------------------------------------------------------------------------------
	function H.isInstance(value: any): boolean
		return recordOf[value] ~= nil
	end

	function H.sideOf(proxy: any): string
		return recordOf[proxy].side or "server"
	end

	local function descriptorOf(record: any, key: string): any
		local class = record.class
		local descriptor = class.members[key]
		if descriptor == nil or class.version ~= defsVersion then
			descriptor = resolveMember(class, key)
		end
		return descriptor
	end

	-- Stored value (or default) of a property, bypassing mock getters.
	function H.raw(proxy: any, key: string): any
		local record = recordOf[proxy]
		local descriptor = descriptorOf(record, key)
		if not descriptor or descriptor.kind ~= PROP then
			error(`H.raw: {record.class.name}.{key} is not a property`, 2)
		end
		local values = record.values
		if values and values[key] ~= nil then
			return values[key]
		end
		if not descriptor.defaultResolved then
			resolveDefault(record.class, descriptor)
		end
		return descriptor.default
	end

	-- Stores a property value without validation, bypassing setters and read-only checks. Fires Changed.
	function H.rawset(proxy: any, key: string, value: any)
		local record = recordOf[proxy]
		local descriptor = descriptorOf(record, key)
		if not descriptor or descriptor.kind ~= PROP then
			error(`H.rawset: {record.class.name}.{key} is not a property`, 2)
		end
		writeStored(baseOf(record), descriptor, key, value)
	end

	-- Fires Changed / GetPropertyChangedSignal for a computed property (AbsoluteSize, ViewportSize ...).
	function H.notify(proxy: any, key: string)
		local record = baseOf(recordOf[proxy])
		notifyChanged(record, nil, key, nil, nil)
	end

	function H.state(proxy: any): any
		local record = recordOf[proxy]
		local state = record.state
		if not state then
			state = {}
			record.state = state
		end
		return state
	end

	function H.signal(proxy: any, name: string): any
		local record = recordOf[proxy]
		local descriptor = descriptorOf(record, name)
		if not descriptor or descriptor.kind ~= EVENT then
			error(`{name} is not an event of {record.class.name}`, 2)
		end
		return getSignal(record, name)
	end

	function H.fire(proxy: any, name: string, ...)
		H.signal(proxy, name):_fire(...)
	end

	function H.callback(proxy: any, name: string): any
		local callbacks = recordOf[proxy].callbacks
		return callbacks and callbacks[name]
	end

	--------------------------------------------------------------------------------------------------------------
	-- tree
	--------------------------------------------------------------------------------------------------------------
	local function isInGame(record: any): boolean
		while record.parent do
			record = record.parent
		end
		return record == gameRecord
	end

	-- Pre-order list of the descendants of a record.
	local function descendantsOf(record: any, out: { any }?): { any }
		local list = out or {}
		local children = record.children
		if children then
			for position = 1, #children do
				local child = children[position]
				list[#list + 1] = child
				if child.children then
					descendantsOf(child, list)
				end
			end
		end
		return list
	end

	local function tagEntry(tag: string): any
		local entry = tags.index[tag]
		if not entry then
			entry = { list = {}, position = {} }
			tags.index[tag] = entry
		end
		return entry
	end

	local function indexTag(record: any, tag: string, present: boolean)
		local entry = tagEntry(tag)
		local position = entry.position[record]
		if present then
			if not position then
				table.insert(entry.list, record)
				entry.position[record] = #entry.list
				local signal = tags.added[tag]
				if signal then
					signal:_fire(toProxy(record))
				end
			end
		elseif position then
			local last = entry.list[#entry.list]
			entry.list[position] = last
			entry.position[last] = position
			entry.list[#entry.list] = nil
			entry.position[record] = nil
			local signal = tags.removed[tag]
			if signal then
				signal:_fire(toProxy(record))
			end
		end
	end

	local function indexSubtreeTags(record: any, present: boolean)
		local function visit(node: any)
			if node.tags then
				for _, tag in node.tags do
					indexTag(node, tag, present)
				end
			end
		end
		visit(record)
		if record.children then
			for _, node in descendantsOf(record) do
				visit(node)
			end
		end
	end

	local function resumeChildWaiters(parent: any, child: any)
		local waiters = parent.childWaiters
		if not waiters then
			return
		end
		local remaining = nil
		for _, waiter in waiters do
			if not waiter.done and waiter.name == child.name then
				waiter.done = true
				sched.defer(waiter.thread, toProxy(child))
			elseif not waiter.done then
				remaining = remaining or {}
				table.insert(remaining, waiter)
			end
		end
		parent.childWaiters = remaining
	end

	-- Fires `eventName` on `start` and its ancestors for `moved` and each of its descendants.
	local function fireUpTree(start: any, eventName: string, moved: any)
		local subtree = nil
		local ancestor = start
		while ancestor do
			local signals = ancestor.signals
			local signal = signals and signals[eventName]
			if signal and signal:_hasListeners() then
				if not subtree then
					subtree = descendantsOf(moved)
					table.insert(subtree, 1, moved)
				end
				for _, node in subtree do
					signal:_fire(toProxy(node))
				end
			end
			ancestor = ancestor.parent
		end
	end

	local function setParent(record: any, newParent: any)
		local oldParent = record.parent
		if oldParent == newParent then
			return
		end
		local trackTags = tags.used
		local wasInGame = trackTags and oldParent ~= nil and isInGame(oldParent)
		if oldParent then
			if listeners.DescendantRemoving > 0 then
				fireUpTree(oldParent, "DescendantRemoving", record)
			end
			local siblings = oldParent.children
			for position = #siblings, 1, -1 do
				if siblings[position] == record then
					table.remove(siblings, position)
					break
				end
			end
		end
		record.parent = newParent
		if newParent then
			local children = newParent.children
			if not children then
				children = {}
				newParent.children = children
			end
			children[#children + 1] = record
		end
		if oldParent and listeners.ChildRemoved > 0 then
			fireIfExists(oldParent, "ChildRemoved", toProxy(record))
		end
		if newParent then
			if listeners.ChildAdded > 0 then
				fireIfExists(newParent, "ChildAdded", toProxy(record))
			end
			if listeners.DescendantAdded > 0 then
				fireUpTree(newParent, "DescendantAdded", record)
			end
			if newParent.childWaiters then
				resumeChildWaiters(newParent, record)
			end
		end
		if listeners.AncestryChanged > 0 then
			local parentProxy = newParent and toProxy(newParent)
			local proxy = toProxy(record)
			fireIfExists(record, "AncestryChanged", proxy, parentProxy)
			if record.children then
				for _, node in descendantsOf(record) do
					fireIfExists(node, "AncestryChanged", proxy, parentProxy)
				end
			end
		end
		if trackTags then
			local nowInGame = newParent ~= nil and isInGame(newParent)
			if wasInGame ~= nowInGame then
				indexSubtreeTags(record, nowInGame)
			end
		end
		notifyChanged(record, nil, "Parent", nil, nil)
	end

	local function newRecord(class: any, name: string): any
		return {
			class = class,
			name = name,
			parent = nil,
			children = nil,
			values = nil,
			attributes = nil,
			tags = nil,
			signals = nil,
			propSignals = nil,
			attrSignals = nil,
			callbacks = nil,
			state = nil,
			childWaiters = nil,
			destroyed = false,
		}
	end

	local function runInit(record: any)
		local defs = defsOf(record.class)
		for position = #defs, 1, -1 do
			local init = defs[position].init
			if init then
				init(toProxy(record))
			end
		end
	end

	-- Creates an instance of any class (including NotCreatable ones). `props` may contain Parent (applied last).
	function H.create(className: string, props: { [string]: any }?): any
		local class = getClass(className)
		if not class then
			error(`H.create: "{className}" is not a Roblox class`, 2)
		end
		local record = newRecord(class, className)
		local proxy = toProxy(record)
		runInit(record)
		if props then
			for key, value in props do
				if key ~= "Parent" then
					proxy[key] = value
				end
			end
			if props.Parent then
				proxy.Parent = props.Parent
			end
		end
		return proxy
	end

	local InstanceLibrary = table.freeze({
		new = function(className: any, parent: any?)
			if type(className) ~= "string" then
				error(`Instance.new: expected a class name string, got {H.typeof(className)}`, 2)
			end
			local class = getClass(className)
			if not class or class.info.tags.NotCreatable then
				error(`Unable to create an Instance of type "{className}"`, 2)
			end
			local record = newRecord(class, className)
			local proxy = toProxy(record)
			runInit(record)
			if parent ~= nil then
				proxy.Parent = parent
			end
			return proxy
		end,
	})
	H.datatypes.Instance = InstanceLibrary

	local function disconnectAll(group: { [string]: any }?)
		if group then
			for _, signal in group do
				signal:_disconnectAll()
			end
		end
	end

	local function destroy(record: any)
		if record.destroyed then
			return
		end
		local subtree = descendantsOf(record)
		table.insert(subtree, 1, record)
		for _, node in subtree do
			node.destroyed = true
			fireIfExists(node, "Destroying")
		end
		setParent(record, nil) -- fires ChildRemoved / DescendantRemoving / AncestryChanged like any reparent
		for _, node in subtree do
			for _, def in defsOf(node.class) do
				if def.destroyed then
					def.destroyed(toProxy(node))
				end
			end
			disconnectAll(node.signals)
			disconnectAll(node.propSignals)
			disconnectAll(node.attrSignals)
			node.parent = nil
			node.children = nil
			node.childWaiters = nil
		end
	end

	local function cloneRecord(record: any, map: { [any]: any }): any
		local copy = newRecord(record.class, record.name)
		map[record] = copy
		if record.values then
			copy.values = table.clone(record.values)
		end
		if record.attributes then
			copy.attributes = table.clone(record.attributes)
		end
		if record.tags then
			copy.tags = table.clone(record.tags)
		end
		local children = record.children
		if children then
			local copies = {}
			for _, child in children do
				local values = child.values
				if not (values and values.Archivable == false) then
					local childCopy = cloneRecord(child, map)
					childCopy.parent = copy
					table.insert(copies, childCopy)
				end
			end
			copy.children = copies
		end
		return copy
	end

	local cloneHooks: { (original: any, clone: any) -> () } = {}
	-- Registers fn(original, clone), called for every instance copied by Clone (after the whole tree exists).
	function H.onClone(fn: (original: any, clone: any) -> ())
		table.insert(cloneHooks, fn)
	end

	local function clone(record: any): any
		local map = {}
		local copy = cloneRecord(record, map)
		for original, cloned in map do
			-- references into the copied tree must point at the copies (PrimaryPart, Part0/Part1, Adornee ...)
			local values = cloned.values
			if values then
				for key, value in values do
					local target = recordOf[value]
					if target and map[baseOf(target)] then
						values[key] = toProxy(map[baseOf(target)])
					end
				end
			end
			local originalProxy, clonedProxy = toProxy(original), toProxy(cloned)
			for _, def in defsOf(cloned.class) do
				if def.cloned then
					def.cloned(originalProxy, clonedProxy)
				end
			end
			for _, hook in cloneHooks do
				hook(originalProxy, clonedProxy)
			end
		end
		return copy
	end

	--------------------------------------------------------------------------------------------------------------
	-- Object / Instance members
	--------------------------------------------------------------------------------------------------------------
	local function need(self: any, method: string): any
		local record = recordOf[self]
		if not record then
			error(`Expected ':' not '.' calling member function {method}`, 3)
		end
		return record.base or record
	end

	-- An instance found through a side view (the client's `game`) is returned as that side's view when it has one.
	local function sided(self: any, found: any): any
		if found ~= nil then
			local side = recordOf[self].side
			if side then
				return sideViews[side][toRecord(found)] or found
			end
		end
		return found
	end

	local Object = H.class("Object")
	local Instance = H.class("Instance")

	Object.props.ClassName = {
		get = function(self)
			return recordOf[self].class.name
		end,
		set = function()
			error("Unable to assign property ClassName. Property is read only", 3)
		end,
	}

	function Object.methods.IsA(self: any, className: string): boolean
		return need(self, "IsA").class.isA[className] == true
	end

	function Object.methods.GetPropertyChangedSignal(self: any, property: string): any
		local record = need(self, "GetPropertyChangedSignal")
		local descriptor = descriptorOf(record, property)
		if not descriptor or descriptor.kind ~= PROP then
			error(`{tostring(property)} is not a valid property name.`, 2)
		end
		local propSignals = record.propSignals
		if not propSignals then
			propSignals = {}
			record.propSignals = propSignals
		end
		local signal = propSignals[property]
		if not signal then
			signal = Signal.new(record.class.name .. "." .. property .. " changed")
			propSignals[property] = signal
		end
		return signal
	end

	Instance.props.Name = {
		get = function(self)
			return recordOf[self].name
		end,
		set = function(self, value)
			if type(value) ~= "string" and type(value) ~= "number" then
				error(`Unable to assign property Name. string expected, got {H.typeof(value)}`, 3)
			end
			local record = baseOf(recordOf[self])
			local name = tostring(value)
			if record.name ~= name then
				record.name = name
				notifyChanged(record, nil, "Name", name, nil)
				local parent = record.parent
				if parent and parent.childWaiters then
					resumeChildWaiters(parent, record)
				end
			end
		end,
	}

	Instance.props.Parent = {
		get = function(self)
			local parent = recordOf[self].parent
			return parent and toProxy(parent) or nil
		end,
		set = function(self, value)
			local record = baseOf(recordOf[self])
			local parent = nil
			if value ~= nil then
				parent = toRecord(value)
				if not parent then
					error(`Unable to assign property Parent. Instance expected, got {H.typeof(value)}`, 3)
				end
			end
			if record.destroyed then
				if parent == nil then
					return
				end
				error(
					`The Parent property of {record.name} is locked, current parent: NULL, new parent {parent.name}`,
					3
				)
			end
			if record == gameRecord or record.class.info.tags.Service then
				if parent ~= record.parent then
					error(`Cannot change Parent of type {record.class.name}`, 3)
				end
				return
			end
			if parent then
				if parent.destroyed then
					error(`Cannot set Parent of {record.name} to a destroyed instance ({parent.name})`, 3)
				end
				local ancestor = parent
				while ancestor do
					if ancestor == record then
						error(
							`Attempt to set parent of {fullName(record)} to {fullName(parent)} would result in circular reference`,
							3
						)
					end
					ancestor = ancestor.parent
				end
			end
			setParent(record, parent)
		end,
	}

	function Instance.methods.Destroy(self: any)
		local record = need(self, "Destroy")
		if record == gameRecord or record.class.info.tags.Service then
			error(`Cannot destroy {record.class.name}`, 2)
		end
		destroy(record)
	end

	function Instance.methods.ClearAllChildren(self: any)
		local record = need(self, "ClearAllChildren")
		local children = record.children
		if children then
			for _, child in table.clone(children) do
				destroy(child)
			end
		end
	end

	function Instance.methods.Clone(self: any): any
		local record = need(self, "Clone")
		local values = record.values
		if values and values.Archivable == false then
			return nil
		end
		if record == gameRecord or record.class.info.tags.Service then
			error(`{record.class.name} cannot be cloned`, 2)
		end
		return toProxy(clone(record))
	end

	function Instance.methods.GetChildren(self: any): { any }
		local children = need(self, "GetChildren").children
		local result = {}
		if children then
			for position = 1, #children do
				result[position] = toProxy(children[position])
			end
		end
		return result
	end

	function Instance.methods.GetDescendants(self: any): { any }
		local list = descendantsOf(need(self, "GetDescendants"))
		for position = 1, #list do
			list[position] = toProxy(list[position])
		end
		return list
	end

	function Instance.methods.GetFullName(self: any): string
		return fullName(need(self, "GetFullName"))
	end

	local function findDescendant(record: any, predicate: (any) -> boolean): any
		local children = record.children
		if children then
			for position = 1, #children do
				local child = children[position]
				if predicate(child) then
					return child
				end
				local found = findDescendant(child, predicate)
				if found then
					return found
				end
			end
		end
		return nil
	end

	local function find(record: any, recursive: any, predicate: (any) -> boolean): any
		local found
		if recursive == true then
			found = findDescendant(record, predicate)
		else
			local children = record.children
			if children then
				for position = 1, #children do
					if predicate(children[position]) then
						found = children[position]
						break
					end
				end
			end
		end
		return found and toProxy(found) or nil
	end

	function Instance.methods.FindFirstChild(self: any, name: any, recursive: boolean?): any
		local record = need(self, "FindFirstChild")
		if type(name) == "number" then
			name = tostring(name)
		elseif type(name) ~= "string" then
			error(`FindFirstChild: name must be a string, got {H.typeof(name)}`, 2)
		end
		if recursive ~= true then
			local child = findChild(record, name)
			return sided(self, child and toProxy(child) or nil)
		end
		return find(record, true, function(child)
			return child.name == name
		end)
	end

	function Instance.methods.FindFirstDescendant(self: any, name: string): any
		return find(need(self, "FindFirstDescendant"), true, function(child)
			return child.name == name
		end)
	end

	function Instance.methods.FindFirstChildOfClass(self: any, className: string): any
		return sided(
			self,
			find(need(self, "FindFirstChildOfClass"), false, function(child)
				return child.class.name == className
			end)
		)
	end

	function Instance.methods.FindFirstChildWhichIsA(self: any, className: string, recursive: boolean?): any
		return sided(
			self,
			find(need(self, "FindFirstChildWhichIsA"), recursive, function(child)
				return child.class.isA[className] == true
			end)
		)
	end

	local function findAncestor(self: any, method: string, predicate: (any) -> boolean): any
		local ancestor = need(self, method).parent
		while ancestor do
			if predicate(ancestor) then
				return toProxy(ancestor)
			end
			ancestor = ancestor.parent
		end
		return nil
	end

	function Instance.methods.FindFirstAncestor(self: any, name: string): any
		return findAncestor(self, "FindFirstAncestor", function(ancestor)
			return ancestor.name == name
		end)
	end

	function Instance.methods.FindFirstAncestorOfClass(self: any, className: string): any
		return findAncestor(self, "FindFirstAncestorOfClass", function(ancestor)
			return ancestor.class.name == className
		end)
	end

	function Instance.methods.FindFirstAncestorWhichIsA(self: any, className: string): any
		return findAncestor(self, "FindFirstAncestorWhichIsA", function(ancestor)
			return ancestor.class.isA[className] == true
		end)
	end

	function Instance.methods.IsDescendantOf(self: any, ancestor: any): boolean
		local record = need(self, "IsDescendantOf")
		local target = toRecord(ancestor)
		if not target then
			return false
		end
		local current = record.parent
		while current do
			if current == target then
				return true
			end
			current = current.parent
		end
		return false
	end

	function Instance.methods.IsAncestorOf(self: any, descendant: any): boolean
		local record = need(self, "IsAncestorOf")
		local current = toRecord(descendant)
		current = current and current.parent
		while current do
			if current == record then
				return true
			end
			current = current.parent
		end
		return false
	end

	function Instance.methods.GetActor(_self: any): any
		return nil
	end

	function Instance.methods.WaitForChild(self: any, name: any, timeout: number?): any
		local record = need(self, "WaitForChild")
		if type(name) == "number" then
			name = tostring(name)
		elseif type(name) ~= "string" then
			error(`WaitForChild: name must be a string, got {H.typeof(name)}`, 2)
		end
		local child = findChild(record, name)
		if child then
			return sided(self, toProxy(child))
		end
		if timeout ~= nil and type(timeout) ~= "number" then
			error(`WaitForChild: timeout must be a number, got {H.typeof(timeout)}`, 2)
		end
		if not coroutine.isyieldable() then
			error(`WaitForChild("{name}") would yield outside a coroutine: {fullName(record)} has no child "{name}"`, 2)
		end
		local waiter = { name = name, thread = coroutine.running(), done = false }
		local waiters = record.childWaiters
		if not waiters then
			waiters = {}
			record.childWaiters = waiters
		end
		table.insert(waiters, waiter)
		local limit = timeout or config.waitForChildTimeout
		sched.delay(limit, function()
			if not waiter.done then
				waiter.done = true
				sched.spawn(waiter.thread, nil)
			end
		end)
		local found = sched.suspend()
		waiter.done = true
		if found == nil and timeout == nil then
			-- Roblox would warn "Infinite yield possible" and wait forever; tests should fail fast instead
			error(
				`HARNESS: infinite yield: {fullName(record)}:WaitForChild("{name}") found nothing after {limit} s (missing instance or wrong name?)`,
				2
			)
		end
		return sided(self, found)
	end

	--------------------------------------------------------------------------------------------------------------
	-- attributes
	--------------------------------------------------------------------------------------------------------------
	local ATTRIBUTE_TYPES = {
		string = true,
		boolean = true,
		number = true,
		UDim = true,
		UDim2 = true,
		BrickColor = true,
		Color3 = true,
		Vector2 = true,
		Vector3 = true,
		CFrame = true,
		NumberSequence = true,
		ColorSequence = true,
		NumberRange = true,
		Rect = true,
		Font = true,
		EnumItem = true,
	}

	local function checkAttributeName(name: any, level: number)
		if type(name) ~= "string" then
			error(`Attribute name must be a string, got {H.typeof(name)}`, level + 1)
		end
		if #name == 0 or #name > 100 or string.find(name, "[^%w_]") or string.sub(name, 1, 3) == "RBX" then
			error(`Attribute name "{name}" is invalid (letters, digits and underscores only, at most 100 characters, not starting with RBX)`, level + 1)
		end
	end

	function Instance.methods.GetAttribute(self: any, name: string): any
		local attributes = need(self, "GetAttribute").attributes
		if type(name) ~= "string" then
			error(`Attribute name must be a string, got {H.typeof(name)}`, 2)
		end
		return attributes and attributes[name]
	end

	function Instance.methods.GetAttributes(self: any): { [string]: any }
		local attributes = need(self, "GetAttributes").attributes
		return if attributes then table.clone(attributes) else {}
	end

	function Instance.methods.SetAttribute(self: any, name: string, value: any)
		local record = need(self, "SetAttribute")
		checkAttributeName(name, 2)
		if value ~= nil and not ATTRIBUTE_TYPES[realTypeof(value)] then
			error(`{H.typeof(value)} is not a supported attribute type`, 2)
		end
		local attributes = record.attributes
		if not attributes then
			if value == nil then
				return
			end
			attributes = {}
			record.attributes = attributes
		end
		if attributes[name] == value then
			return
		end
		attributes[name] = value
		fireIfExists(record, "AttributeChanged", name)
		local attrSignals = record.attrSignals
		if attrSignals and attrSignals[name] then
			attrSignals[name]:_fire()
		end
	end

	function Instance.methods.GetAttributeChangedSignal(self: any, name: string): any
		local record = need(self, "GetAttributeChangedSignal")
		checkAttributeName(name, 2)
		local attrSignals = record.attrSignals
		if not attrSignals then
			attrSignals = {}
			record.attrSignals = attrSignals
		end
		local signal = attrSignals[name]
		if not signal then
			signal = Signal.new(record.class.name .. " attribute " .. name .. " changed")
			attrSignals[name] = signal
		end
		return signal
	end

	--------------------------------------------------------------------------------------------------------------
	-- tags
	--------------------------------------------------------------------------------------------------------------
	local function addTag(record: any, tag: any, level: number)
		if type(tag) ~= "string" or tag == "" then
			error(`Tag must be a non-empty string, got {H.typeof(tag)}`, level + 1)
		end
		local list = record.tags
		if not list then
			list = {}
			record.tags = list
			tags.used = true
		elseif table.find(list, tag) then
			return
		end
		table.insert(list, tag)
		if isInGame(record) then
			indexTag(record, tag, true)
		end
	end

	local function removeTag(record: any, tag: any)
		local list = record.tags
		local position = list and table.find(list, tag)
		if not position then
			return
		end
		table.remove(list, position)
		if #list == 0 then
			record.tags = nil
		end
		indexTag(record, tag, false)
	end

	function Instance.methods.AddTag(self: any, tag: string)
		addTag(need(self, "AddTag"), tag, 2)
	end

	function Instance.methods.RemoveTag(self: any, tag: string)
		removeTag(need(self, "RemoveTag"), tag)
	end

	function Instance.methods.HasTag(self: any, tag: string): boolean
		local list = need(self, "HasTag").tags
		return list ~= nil and table.find(list, tag) ~= nil
	end

	function Instance.methods.GetTags(self: any): { string }
		local list = need(self, "GetTags").tags
		return if list then table.clone(list) else {}
	end

	-- used by CollectionService
	function Instances.getTagged(tag: string): { any }
		local entry = tags.index[tag]
		local result = {}
		if entry then
			for position, record in entry.list do
				result[position] = toProxy(record)
			end
		end
		return result
	end

	function Instances.tagSignal(kind: "added" | "removed", tag: string): any
		local signal = tags[kind][tag]
		if not signal then
			signal = Signal.new(`CollectionService instance {kind} "{tag}"`)
			tags[kind][tag] = signal
		end
		return signal
	end

	Instances.addTag = function(proxy: any, tag: string)
		addTag(toRecord(proxy), tag, 3)
	end
	Instances.removeTag = function(proxy: any, tag: string)
		removeTag(toRecord(proxy), tag)
	end

	--------------------------------------------------------------------------------------------------------------
	-- DataModel root, services, side views
	--------------------------------------------------------------------------------------------------------------
	local SERVICE_NAMES = { RunService = "Run Service" } -- services whose Name differs from their ClassName

	-- Creates the DataModel record. Called once by H.boot.
	function Instances.createGame(): any
		local record = newRecord(getClass("DataModel"), "Game")
		gameRecord = record
		return toProxy(record)
	end

	-- game:GetService semantics. Returns nil for unknown names unless `create` is set (then it errors).
	function Instances.getService(className: any, create: boolean): any
		if type(className) ~= "string" or not api.isService(className) then
			if create then
				error(`'{tostring(className)}' is not a valid Service name`, 3)
			end
			return nil
		end
		local children = gameRecord.children
		if children then
			for _, child in children do
				if child.class.name == className then
					return toProxy(child)
				end
			end
		end
		if not create then
			return nil
		end
		local record = newRecord(getClass(className), SERVICE_NAMES[className] or className)
		local proxy = toProxy(record)
		record.parent = gameRecord
		gameRecord.children = gameRecord.children or {}
		table.insert(gameRecord.children, record)
		runInit(record)
		return proxy
	end

	-- A second proxy for the same instance that reports another side (the client's view of game, RunService and
	-- Players). Mock methods tell the views apart with H.sideOf(self); state and signals are shared.
	function Instances.sideView(proxy: any, side: string): any
		local record = toRecord(proxy)
		local views = sideViews[side]
		if not views then
			views = {}
			sideViews[side] = views
		end
		local viewProxy = views[record]
		if not viewProxy then
			local view = setmetatable({ side = side, base = record }, { __index = record, __newindex = record })
			viewProxy = makeProxy(view)
			views[record] = viewProxy
		end
		return viewProxy
	end

	-- The view of `proxy` for a side, or the proxy itself when the instance has no separate view.
	function Instances.viewFor(proxy: any, side: string): any
		local views = sideViews[side]
		return views and views[toRecord(proxy)] or proxy
	end

	-- canonical proxy of an instance (maps a side view back to the shared one)
	function Instances.canonical(proxy: any): any
		return toProxy(toRecord(proxy))
	end

	function Instances.isInGame(proxy: any): boolean
		return isInGame(toRecord(proxy))
	end

	Instances.fullName = function(proxy: any): string
		return fullName(toRecord(proxy))
	end

	H.instances = Instances

	-- test API -----------------------------------------------------------------------------------------------------
	local mocks = H.mocks
	-- fire(instance, "EventName", ...): fire any Roblox event of an instance, then run the handlers
	function mocks.fire(instance: any, eventName: string, ...)
		if not recordOf[instance] then
			error("env.mocks.fire: first argument must be an Instance", 2)
		end
		H.fire(instance, eventName, ...)
		sched.flush()
	end
	-- fireChanged(instance, "Property"): fire Changed/GetPropertyChangedSignal for an engine-computed property
	function mocks.fireChanged(instance: any, property: string)
		H.notify(instance, property)
		sched.flush()
	end

	return Instances
end
