--!strict
--[[
	Signal — a small, robust event object (pure Luau + task, runs under Lune tests).

	local changed: Signal.Signal<string, number> = Signal.new()   -- the annotation is optional (default ...any)
	local connection = changed:Connect(function(key, value) ... end)
	changed:Fire("coins", 5)
	connection:Disconnect()

	Guarantees: handlers run in connection order, each in its own task.spawn thread, so a handler that errors or
	yields never blocks the others or the caller of Fire. Connecting/disconnecting while a Fire is in progress is
	safe: handlers disconnected mid-fire are skipped, handlers connected mid-fire first run on the next Fire.
]]

type Handler = (...any) -> ...any

export type Connection = {
	Connected: boolean,
	Disconnect: (self: Connection) -> (),
}

export type Signal<T... = ...any> = {
	-- Calls handler(...) on every Fire until the returned connection is disconnected.
	Connect: (self: Signal<T...>, handler: (T...) -> ...any) -> Connection,
	-- Like Connect, but the handler runs for the next Fire only.
	Once: (self: Signal<T...>, handler: (T...) -> ...any) -> Connection,
	Fire: (self: Signal<T...>, T...) -> (),
	-- Yields the calling thread until the next Fire and returns its arguments. Returns nothing if the signal is
	-- destroyed while waiting; errors when called on an already destroyed signal (it could never return).
	Wait: (self: Signal<T...>) -> T...,
	-- Disconnects every Connect/Once handler. Threads blocked in Wait keep waiting.
	DisconnectAll: (self: Signal<T...>) -> (),
	-- DisconnectAll + wakes waiting threads. Afterwards Fire is a no-op and Connect returns a dead connection.
	Destroy: (self: Signal<T...>) -> (),
}

type ConnectionState = {
	Connected: boolean,
	_signal: SignalState?,
	_handler: Handler,
}

type SignalState = {
	-- Copy-on-write: this array is replaced, never mutated, so a running Fire keeps iterating its own snapshot.
	_handlers: { ConnectionState },
	_waiting: { thread },
	_destroyed: boolean,
}

local NO_HANDLERS: { ConnectionState } = table.freeze({})

local ConnectionMethods = {}
ConnectionMethods.__index = ConnectionMethods

function ConnectionMethods.Disconnect(self: ConnectionState)
	if not self.Connected then
		return
	end
	self.Connected = false
	local signal = self._signal
	self._signal = nil
	if not signal then
		return
	end
	local remaining: { ConnectionState } = {}
	for _, connection in signal._handlers do
		if connection ~= self then
			table.insert(remaining, connection)
		end
	end
	signal._handlers = if #remaining > 0 then remaining else NO_HANDLERS
end

local SignalMethods = {}
SignalMethods.__index = SignalMethods

function SignalMethods.Connect(self: SignalState, handler: Handler): Connection
	if type(handler) ~= "function" then
		error("Signal:Connect expects a function, got " .. typeof(handler), 2)
	end
	local connection: ConnectionState = {
		Connected = not self._destroyed,
		_signal = if self._destroyed then nil else self,
		_handler = handler,
	}
	if not self._destroyed then
		local handlers = table.clone(self._handlers)
		table.insert(handlers, connection)
		self._handlers = handlers
	end
	return (setmetatable(connection, ConnectionMethods) :: any) :: Connection
end

function SignalMethods.Once(self: SignalState, handler: Handler): Connection
	if type(handler) ~= "function" then
		error("Signal:Once expects a function, got " .. typeof(handler), 2)
	end
	local connection: Connection
	connection = SignalMethods.Connect(self, function(...: any)
		-- Disconnect before running so a re-entrant Fire from inside the handler cannot run it twice.
		connection:Disconnect()
		handler(...)
	end)
	return connection
end

function SignalMethods.Fire(self: SignalState, ...: any)
	local handlers = self._handlers
	for index = 1, #handlers do
		local connection = handlers[index]
		if connection.Connected then
			task.spawn(connection._handler, ...)
		end
	end
	local waiting = self._waiting
	if #waiting > 0 then
		self._waiting = {}
		for _, thread in waiting do
			-- A waiter can be cancelled (task.cancel) while it waits; resuming a dead thread would throw.
			if coroutine.status(thread) == "suspended" then
				task.spawn(thread, ...)
			end
		end
	end
end

-- Runs when a waiting thread resumes. If something other than Fire/Destroy resumed it (e.g. a timeout that
-- task.spawn-ed the thread), it is still registered and must be removed so a later Fire cannot resume it again.
local function finishWait(self: SignalState, thread: thread, ...: any): ...any
	local index = table.find(self._waiting, thread)
	if index then
		table.remove(self._waiting, index)
	end
	return ...
end

function SignalMethods.Wait(self: SignalState): ...any
	if self._destroyed then
		error("Signal:Wait called on a destroyed signal", 2)
	end
	local thread = coroutine.running()
	table.insert(self._waiting, thread)
	return finishWait(self, thread, coroutine.yield())
end

function SignalMethods.DisconnectAll(self: SignalState)
	local handlers = self._handlers
	self._handlers = NO_HANDLERS
	for _, connection in handlers do
		connection.Connected = false
		connection._signal = nil
	end
end

function SignalMethods.Destroy(self: SignalState)
	if self._destroyed then
		return
	end
	self._destroyed = true
	SignalMethods.DisconnectAll(self)
	local waiting = self._waiting
	self._waiting = {}
	for _, thread in waiting do
		if coroutine.status(thread) == "suspended" then
			task.spawn(thread)
		end
	end
end

local Signal = {}

-- Returns Signal<...any>, which converts to any Signal<A, B, ...> annotation: the checker then verifies Fire
-- arguments and handler parameters; without an annotation everything is accepted.
function Signal.new(): Signal
	local state: SignalState = {
		_handlers = NO_HANDLERS,
		_waiting = {},
		_destroyed = false,
	}
	return (setmetatable(state, SignalMethods) :: any) :: Signal
end

return Signal
