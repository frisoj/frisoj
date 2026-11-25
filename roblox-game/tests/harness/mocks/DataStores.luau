--[[
	DataStoreService: in-memory stores shared by the whole Env.

	GetDataStore / GetGlobalDataStore / GetOrderedDataStore; GetAsync, SetAsync, UpdateAsync, RemoveAsync,
	IncrementAsync; OrderedDataStore:GetSortedAsync (pages with GetCurrentPage / IsFinished /
	AdvanceToNextPageAsync); GetRequestBudgetForRequestType.

	Like the real service, values are deep-copied on the way in and out and must be storable: only booleans,
	strings, finite numbers and tables that are either dense arrays or string-keyed dictionaries. Anything else
	(Instances, functions, NaN, mixed or sparse tables, cycles) raises an error - that is the point: data bugs
	should fail in tests, not in production.

	Test hooks: env.mocks.dataStores / orderedDataStores (raw contents), env.mocks.dataStoreCalls (request log),
	env.mocks.failDataStore(count, message?, filter?) (failure injection), env.mocks.dataStoreErrors (messages).
]]
return function(H)
	local sched = H.sched
	local config = H.config
	local mocks = H.mocks
	local Enum = H.roblox.Enum

	config.dataStoreBudget = 1000 -- value returned by GetRequestBudgetForRequestType

	-- raw contents: [storeName] = { [key] = value }; a store with a scope other than "global" is "name/scope"
	mocks.dataStores = {}
	mocks.orderedDataStores = {}
	-- every request in order: { method = "GetAsync", store = name, key = key, ordered = boolean, failed = boolean }
	mocks.dataStoreCalls = {}
	mocks.dataStoreErrors = table.freeze({
		-- Studio without "Enable Studio Access to API Services"
		studioApiAccess = "403: Cannot write to DataStore from Studio if API access is not enabled.",
		-- generic backend failure (retryable)
		apiServices = "502: API Services rejected request with error. HTTP 500 (Internal Server Error)",
		throttled = "304: Too many requests; request dropped because the queue is full.",
		unpublished = "You must publish this place to the web to access DataStore.",
	})

	local failure: any = nil -- { remaining = number, message = string, filter = fn? }

	local function request(method: string, store: any, key: string?)
		local entry = { method = method, store = store.name, key = key, ordered = store.ordered, failed = false }
		table.insert(mocks.dataStoreCalls, entry)
		H.yield()
		if failure and failure.remaining > 0 and (failure.filter == nil or failure.filter(method, store.name, key)) then
			failure.remaining -= 1
			entry.failed = true
			error(failure.message, 3)
		end
	end

	--------------------------------------------------------------------------------------------------------------
	-- value validation / copying
	--------------------------------------------------------------------------------------------------------------
	local function checkValue(value: any, path: string, seen: { [any]: boolean }): string?
		local kind = type(value)
		if kind == "nil" or kind == "boolean" then
			return nil
		elseif kind == "string" then
			if not utf8.len(value) then
				return `{path} is a string with invalid UTF-8`
			end
			return nil
		elseif kind == "number" then
			if value ~= value or value == math.huge or value == -math.huge then
				return `{path} is {tostring(value)} (NaN and infinity cannot be stored)`
			end
			return nil
		elseif kind == "table" then
			if seen[value] then
				return `{path} contains a cyclic table reference`
			end
			seen[value] = true
			local count, stringKeys = 0, 0
			for key in value do
				count += 1
				if type(key) == "string" then
					stringKeys += 1
				elseif type(key) ~= "number" then
					return `{path} has a key of type {H.typeof(key)} (keys must be strings, or 1..n for arrays)`
				end
			end
			if stringKeys > 0 and stringKeys ~= count then
				return `{path} mixes array indices and string keys`
			end
			if stringKeys == 0 and count ~= #value then
				return `{path} is a sparse array or has non-sequential numeric keys ({count} entries, length {#value})`
			end
			for key, item in value do
				local problem = checkValue(item, `{path}.{tostring(key)}`, seen)
				if problem then
					return problem
				end
			end
			seen[value] = nil
			return nil
		end
		return `{path} is a {H.typeof(value)} (only booleans, numbers, strings and tables can be stored)`
	end

	local function deepCopy(value: any): any
		if type(value) ~= "table" then
			return value
		end
		local copy = {}
		for key, item in value do
			copy[key] = deepCopy(item)
		end
		return copy
	end

	local function storable(value: any, method: string, level: number): any
		if value == nil then
			error(`{method}: cannot store nil`, level + 1)
		end
		local problem = checkValue(value, "value", {})
		if problem then
			error(`104: Cannot store {H.typeof(value)} in data store. Data stores can only accept valid UTF-8 characters. ({method}: {problem})`, level + 1)
		end
		return deepCopy(value)
	end

	local function checkKey(key: any, method: string, level: number)
		if type(key) ~= "string" then
			error(`{method}: key must be a string, got {H.typeof(key)}`, level + 1)
		elseif key == "" or #key > 50 then
			error(`102: Key name can't be empty or exceed 50 character limit. ({method})`, level + 1)
		end
	end

	--------------------------------------------------------------------------------------------------------------
	-- store objects
	--------------------------------------------------------------------------------------------------------------
	local DataStore = {}
	DataStore.__index = DataStore
	DataStore.__tostring = function(self)
		return "DataStore " .. self.name
	end
	H.typeNames[DataStore] = "Instance" -- GlobalDataStore objects are Instances in Roblox

	local KeyInfo = {}
	KeyInfo.__index = KeyInfo
	function KeyInfo.GetUserIds(self: any)
		return table.clone(self._userIds)
	end
	function KeyInfo.GetMetadata(self: any)
		return deepCopy(self._metadata)
	end

	local function keyInfo(store: any, key: string): any
		local meta = store.meta[key]
		if not meta then
			return nil
		end
		return setmetatable({
			CreatedTime = meta.created,
			UpdatedTime = meta.updated,
			Version = tostring(meta.version),
			_userIds = meta.userIds,
			_metadata = meta.metadata,
		}, KeyInfo)
	end

	local function touch(store: any, key: string, userIds: any?)
		local nowMillis = math.floor(sched.unixTime() * 1000)
		local meta = store.meta[key]
		if not meta then
			meta = { created = nowMillis, updated = nowMillis, version = 0, userIds = {}, metadata = {} }
			store.meta[key] = meta
		end
		meta.updated = nowMillis
		meta.version += 1
		if type(userIds) == "table" then
			meta.userIds = table.clone(userIds)
		end
	end

	-- Contents table of a store. Looked up on every request so tests may replace env.mocks.dataStores[name].
	local function dataOf(store: any): { [string]: any }
		local data = store.contents[store.name]
		if not data then
			data = {}
			store.contents[store.name] = data
		end
		return data
	end

	local function orderedValue(store: any, value: any, method: string, level: number): any
		if store.ordered and (type(value) ~= "number" or value % 1 ~= 0) then
			error(`103: {H.typeof(value)} is not allowed in data stores of type OrderedDataStore; only integers are ({method})`, level + 1)
		end
		return value
	end

	function DataStore.GetAsync(self: any, key: string, _options: any?): (any, any)
		checkKey(key, "GetAsync", 2)
		request("GetAsync", self, key)
		return deepCopy(dataOf(self)[key]), keyInfo(self, key)
	end

	function DataStore.SetAsync(self: any, key: string, value: any, userIds: any?, _options: any?): string
		checkKey(key, "SetAsync", 2)
		local stored = orderedValue(self, storable(value, "SetAsync", 2), "SetAsync", 2)
		request("SetAsync", self, key)
		dataOf(self)[key] = stored
		touch(self, key, userIds)
		return tostring(self.meta[key].version)
	end

	function DataStore.UpdateAsync(self: any, key: string, transform: (any, any) -> (any, any?, any?)): (any, any)
		checkKey(key, "UpdateAsync", 2)
		if type(transform) ~= "function" then
			error(`UpdateAsync: transform must be a function, got {H.typeof(transform)}`, 2)
		end
		request("UpdateAsync", self, key)
		-- the transform function must not yield: run it in its own coroutine to detect that
		local thread = coroutine.create(transform)
		local results = table.pack(coroutine.resume(thread, deepCopy(dataOf(self)[key]), keyInfo(self, key)))
		if not results[1] then
			error(`UpdateAsync: the transform function raised an error: {tostring(results[2])}`, 2)
		elseif coroutine.status(thread) ~= "dead" then
			pcall(coroutine.close, thread)
			error("UpdateAsync: the transform function cannot yield", 2)
		end
		local newValue, userIds = results[2], results[3]
		if newValue == nil then
			return nil, nil -- the update was cancelled
		end
		local stored = orderedValue(self, storable(newValue, "UpdateAsync", 2), "UpdateAsync", 2)
		dataOf(self)[key] = stored
		touch(self, key, userIds)
		return deepCopy(stored), keyInfo(self, key)
	end

	function DataStore.RemoveAsync(self: any, key: string): (any, any)
		checkKey(key, "RemoveAsync", 2)
		request("RemoveAsync", self, key)
		local data = dataOf(self)
		local old, info = data[key], keyInfo(self, key)
		data[key] = nil
		self.meta[key] = nil
		return deepCopy(old), info
	end

	function DataStore.IncrementAsync(self: any, key: string, delta: number?, userIds: any?, _options: any?): (number, any)
		checkKey(key, "IncrementAsync", 2)
		local amount = if delta == nil then 1 else delta
		if type(amount) ~= "number" or amount % 1 ~= 0 then
			error("IncrementAsync: delta must be an integer", 2)
		end
		request("IncrementAsync", self, key)
		local data = dataOf(self)
		local current = data[key]
		if current ~= nil and (type(current) ~= "number" or current % 1 ~= 0) then
			error("IncrementAsync: the stored value is not an integer", 2)
		end
		data[key] = (current or 0) + amount
		touch(self, key, userIds)
		return data[key], keyInfo(self, key)
	end

	-- OrderedDataStore pages -----------------------------------------------------------------------------------
	local Pages = {}
	Pages.__index = Pages
	H.typeNames[Pages] = "Instance"

	function Pages.GetCurrentPage(self: any): { any }
		local page = {}
		for position = self._offset + 1, math.min(self._offset + self._pageSize, #self._entries) do
			local entry = self._entries[position]
			table.insert(page, { key = entry.key, value = entry.value })
		end
		return page
	end

	function Pages.AdvanceToNextPageAsync(self: any)
		request("AdvanceToNextPageAsync", self._store, nil)
		if self.IsFinished then
			error("No pages to advance to", 2)
		end
		self._offset += self._pageSize
		self.IsFinished = self._offset + self._pageSize >= #self._entries
	end

	function DataStore.GetSortedAsync(self: any, ascending: boolean, pageSize: number, minValue: number?, maxValue: number?): any
		if not self.ordered then
			error("GetSortedAsync is not a valid member of GlobalDataStore (only OrderedDataStore has it)", 2)
		end
		if type(ascending) ~= "boolean" then
			error(`GetSortedAsync: ascending must be a boolean, got {H.typeof(ascending)}`, 2)
		end
		if type(pageSize) ~= "number" or pageSize % 1 ~= 0 or pageSize < 1 or pageSize > 100 then
			error("GetSortedAsync: PageSize must be an integer within range [1, 100]", 2)
		end
		request("GetSortedAsync", self, nil)
		local entries = {}
		for key, value in dataOf(self) do
			if (minValue == nil or value >= minValue) and (maxValue == nil or value <= maxValue) then
				table.insert(entries, { key = key, value = value })
			end
		end
		table.sort(entries, function(a, b)
			if a.value == b.value then
				return a.key < b.key
			end
			if ascending then
				return a.value < b.value
			end
			return a.value > b.value
		end)
		return setmetatable({
			IsFinished = #entries <= pageSize,
			_entries = entries,
			_offset = 0,
			_pageSize = pageSize,
			_store = self,
		}, Pages)
	end

	--------------------------------------------------------------------------------------------------------------
	-- service
	--------------------------------------------------------------------------------------------------------------
	local stores: { [string]: any } = {}

	local function getStore(name: any, scope: any, ordered: boolean, method: string): any
		if type(name) ~= "string" or name == "" or #name > 50 then
			error(`{method}: data store name must be a string of 1-50 characters`, 3)
		end
		if scope ~= nil and (type(scope) ~= "string" or scope == "" or #scope > 50) then
			error(`{method}: scope must be a string of 1-50 characters`, 3)
		end
		local fullName = if scope == nil or scope == "global" then name else name .. "/" .. scope
		local cacheKey = (if ordered then "ordered:" else "standard:") .. fullName
		local store = stores[cacheKey]
		if not store then
			local contents = if ordered then mocks.orderedDataStores else mocks.dataStores
			store = setmetatable({ name = fullName, ordered = ordered, contents = contents, meta = {} }, DataStore)
			dataOf(store)
			stores[cacheKey] = store
		end
		return store
	end

	local DataStoreService = H.class("DataStoreService")
	function DataStoreService.methods.GetDataStore(_self: any, name: string, scope: string?, _options: any?): any
		return getStore(name, scope, false, "GetDataStore")
	end
	function DataStoreService.methods.GetGlobalDataStore(_self: any): any
		return getStore("__global", nil, false, "GetGlobalDataStore")
	end
	function DataStoreService.methods.GetOrderedDataStore(_self: any, name: string, scope: string?): any
		return getStore(name, scope, true, "GetOrderedDataStore")
	end
	function DataStoreService.methods.GetRequestBudgetForRequestType(_self: any, requestType: any): number
		if typeof(requestType) ~= "EnumItem" or requestType.EnumType ~= Enum.DataStoreRequestType then
			error("GetRequestBudgetForRequestType expects an Enum.DataStoreRequestType", 2)
		end
		return config.dataStoreBudget
	end

	--------------------------------------------------------------------------------------------------------------
	-- test API
	--------------------------------------------------------------------------------------------------------------

	-- failDataStore(count, message?, filter?): make the next `count` data store requests raise `message`
	-- (default: dataStoreErrors.apiServices). count = true fails every request until failDataStore(0).
	-- filter(method, storeName, key) -> boolean limits which requests fail (e.g. only "UpdateAsync").
	function mocks.failDataStore(count: number | boolean, message: string?, filter: ((method: string, store: string, key: string?) -> boolean)?)
		local remaining = if count == true then math.huge elseif type(count) == "number" then count else 0
		if remaining <= 0 then
			failure = nil
			return
		end
		failure = { remaining = remaining, message = message or mocks.dataStoreErrors.apiServices, filter = filter }
	end

	return nil
end
