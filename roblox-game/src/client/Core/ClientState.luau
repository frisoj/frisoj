--!strict
--[[
	ClientState — the client's mirror of its own replicated state (saved data + session, spec §4.1 / §8).
	The server sends the whole state once (StateInit) and then small ordered deltas (StateDelta); this module
	applies them and tells observers which top-level key changed, at most once per frame per key.

	    ClientState.waitUntilReady()                         -- yields until StateInit arrived
	    local state = ClientState.get()                      -- Types.ReplicatedState, treat as READ-ONLY
	    local stop = ClientState.observe("coins", function(coins, state) label.Text = tostring(coins) end)
	    stop()                                               -- disconnect
	    ClientState.Changed:Connect(function(topKey) end)    -- same notifications as a signal

	observe(topKey, fn) calls fn right away when the state is ready and again whenever anything under that
	top-level key changes ("session" covers passes, boosts and stats; "pets" covers the whole inventory ...).
	Observers must not yield; an observer that errors is reported with a warning and never affects the others.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))
local Net = require(Shared:WaitForChild("Net"))
local Signal = require(Shared:WaitForChild("Util"):WaitForChild("Signal"))

export type Observer = (value: any, state: Types.ReplicatedState) -> ()

type ObserverEntry = { fn: Observer, connected: boolean }

local ClientState = {}

local Changed: Signal.Signal<string> = Signal.new()
ClientState.Changed = Changed -- (topKey: string), fired once per frame per changed top-level key

local state: Types.ReplicatedState? = nil
-- Copy-on-write lists, so observing or disconnecting from inside an observer never disturbs a running flush.
local observers: { [string]: { ObserverEntry } } = {}
local dirty: { [string]: boolean } = {}
local hasDirty = false
local waiting: { thread } = {}
-- Deltas that arrive before StateInit (should not happen, but must not be lost if it does).
local pendingDeltas: { any } = {}
local MAX_PENDING_DELTAS = 200

local function traceback(message: any): string
	return debug.traceback(tostring(message), 2)
end

local function notifyKey(current: Types.ReplicatedState, topKey: string)
	local list = observers[topKey]
	if list then
		local value = (current :: any)[topKey]
		for _, entry in list do
			if entry.connected then
				local ok, message = xpcall(entry.fn :: (...any) -> ...any, traceback, value, current)
				if not ok then
					warn(`[ClientState] observer of "{topKey}" failed: {message}`)
				end
			end
		end
	end
	Changed:Fire(topKey)
end

-- Arrays (quests.list, purchases.history) are indexed by number while paths may carry the index as a string;
-- pick the numeric key when that is what the container actually uses.
local function resolveKey(container: { [any]: any }, key: any): any
	if type(key) == "string" and container[key] == nil then
		local index = tonumber(key)
		if index and index % 1 == 0 and index >= 1 then
			local length = #container
			if container[index] ~= nil or (length > 0 and index == length + 1) then
				return index
			end
		end
	end
	return key
end

-- Writes one { path, value } change into the mirror. Returns the top-level key, or nil for a malformed change.
local function applyChange(current: Types.ReplicatedState, change: any): string?
	if type(change) ~= "table" then
		return nil
	end
	local path = change.path
	if type(path) ~= "table" then
		return nil
	end
	local depth = #path
	if depth == 0 then
		return nil
	end
	for index = 1, depth do
		local keyType = type(path[index])
		if keyType ~= "string" and keyType ~= "number" then
			return nil
		end
	end
	local value = change.value
	local container: { [any]: any } = current :: any
	for index = 1, depth - 1 do
		local key = resolveKey(container, path[index])
		local child = container[key]
		if type(child) ~= "table" then
			if value == nil then
				-- Deleting below something that does not exist: nothing to do.
				return tostring(path[1])
			end
			child = {}
			container[key] = child
		end
		container = child
	end
	container[resolveKey(container, path[depth])] = value
	return tostring(path[1])
end

local function applyDelta(current: Types.ReplicatedState, changes: any)
	if type(changes) ~= "table" then
		return
	end
	for _, change in changes do
		local topKey = applyChange(current, change)
		if topKey then
			dirty[topKey] = true
			hasDirty = true
		end
	end
end

local function flush()
	local current = state
	if not hasDirty or not current then
		return
	end
	local keys = dirty
	dirty = {}
	hasDirty = false
	for topKey in keys do
		notifyKey(current, topKey)
	end
end

local function onStateInit(newState: any)
	if type(newState) ~= "table" then
		warn("[ClientState] StateInit carried no state table; ignoring it")
		return
	end
	local current = newState :: Types.ReplicatedState
	state = current
	dirty = {}
	hasDirty = false

	-- Everything is new: tell every observer (also those of keys the new state does not have) exactly once.
	local keys: { [string]: boolean } = {}
	for key in pairs(current) do
		keys[tostring(key)] = true
	end
	for key in observers do
		keys[key] = true
	end
	for key in keys do
		notifyKey(current, key)
	end

	if #pendingDeltas > 0 then
		local queued = pendingDeltas
		pendingDeltas = {}
		for _, changes in queued do
			applyDelta(current, changes)
		end
	end

	local threads = waiting
	waiting = {}
	for _, thread in threads do
		if coroutine.status(thread) == "suspended" then
			task.spawn(thread)
		end
	end
end

local function onStateDelta(changes: any)
	local current = state
	if current then
		applyDelta(current, changes)
	elseif #pendingDeltas < MAX_PENDING_DELTAS then
		table.insert(pendingDeltas, changes)
	end
end

-- True once the initial state has arrived.
function ClientState.isReady(): boolean
	return state ~= nil
end

-- Yields the calling thread until the initial state has arrived (returns immediately when it already has).
-- Any number of threads may wait at the same time.
function ClientState.waitUntilReady()
	while state == nil do
		table.insert(waiting, coroutine.running())
		coroutine.yield()
	end
end

-- The mirrored state. Errors when called before the state is ready — use waitUntilReady / isReady / observe.
-- Treat the returned table as read-only: it is the live mirror, changed in place by server deltas.
function ClientState.get(): Types.ReplicatedState
	local current = state
	if not current then
		error("ClientState.get() called before the state arrived; call ClientState.waitUntilReady() first", 2)
	end
	return current
end

-- Calls fn(value, state) immediately (if the state is ready) and whenever anything under state[topKey] changes,
-- coalesced to once per frame. Returns a function that stops the observation.
function ClientState.observe(topKey: string, fn: Observer): () -> ()
	if type(topKey) ~= "string" or type(fn) ~= "function" then
		error("ClientState.observe expects (topKey: string, fn: function)", 2)
	end
	local entry: ObserverEntry = { fn = fn, connected = true }
	local list = table.clone(observers[topKey] or {})
	table.insert(list, entry)
	observers[topKey] = list

	local current = state
	if current then
		local ok, message = xpcall(fn :: (...any) -> ...any, traceback, (current :: any)[topKey], current)
		if not ok then
			warn(`[ClientState] observer of "{topKey}" failed: {message}`)
		end
	end

	return function()
		if not entry.connected then
			return
		end
		entry.connected = false
		local remaining: { ObserverEntry } = {}
		local current = observers[topKey]
		if current then
			for _, other in current do
				if other ~= entry then
					table.insert(remaining, other)
				end
			end
		end
		if #remaining > 0 then
			observers[topKey] = remaining
		else
			observers[topKey] = nil
		end
	end
end

-- Observers are flushed from Heartbeat so a burst of deltas inside one frame produces one callback per key.
RunService.Heartbeat:Connect(flush)

-- Connecting waits for the remotes to replicate, so it must not block whoever requires this module.
-- StateInit is connected first: the engine queues events until the first listener exists, so the initial state
-- is always applied before any delta.
task.spawn(function()
	Net.onClientEvent("StateInit", onStateInit)
	Net.onClientEvent("StateDelta", onStateDelta)
end)

return ClientState
