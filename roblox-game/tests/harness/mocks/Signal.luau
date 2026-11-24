--[[
	RBXScriptSignal / RBXScriptConnection look-alikes.

	H.Signal.new(name, options?) creates a signal; the harness fires it with signal:_fire(...).
	Handlers run in their own threads through the scheduler: deferred until the current resumption finishes when
	config.signalBehavior == "Deferred" (default, like Workspace.SignalBehavior = Deferred), or immediately when
	"Immediate".  Either way an erroring handler is recorded in env.errors and never breaks the code that fired.

	options: buffer    - queue fires while nobody listens and deliver them to the first listener (remote events)
	         immediate - always run handlers immediately (Destroying)
	         onListeners(delta) - called when the number of listeners changes
	         check()   - called on Connect/Once/Wait; may raise (e.g. RenderStepped on the server)
]]
return function(H)
	local sched = H.sched
	local config = H.config

	local BUFFER_LIMIT = 512

	local Signal = {}
	Signal.__index = Signal
	Signal.__tostring = function(self)
		return "Signal " .. self._name
	end

	local Connection = {}
	Connection.__index = Connection
	Connection.__tostring = function()
		return "Connection"
	end

	H.typeNames[Signal] = "RBXScriptSignal"
	H.typeNames[Connection] = "RBXScriptConnection"

	function Signal.new(name: string, options: any?)
		local self = setmetatable({
			_name = name,
			_connections = {},
			_waiters = {},
			_buffer = nil,
			_buffering = false,
			_immediate = false,
			_onListeners = nil,
			_check = nil,
		}, Signal)
		if options then
			self._buffering = options.buffer == true
			self._immediate = options.immediate == true
			self._onListeners = options.onListeners
			self._check = options.check
		end
		return self
	end

	function Connection.Disconnect(self: any)
		if not self.Connected then
			return
		end
		self.Connected = false
		local signal = self._signal
		local connections = signal._connections
		local index = table.find(connections, self)
		if index then
			table.remove(connections, index)
			if signal._onListeners then
				signal._onListeners(-1)
			end
		end
	end
	-- deprecated lowercase alias exists in Roblox; game code must not use it, so it is intentionally absent

	local function connect(self: any, fn: any, once: boolean, level: number)
		if type(fn) ~= "function" then
			error("Attempt to connect failed: Passed value is not a function", level + 1)
		end
		if self._check then
			self._check()
		end
		local connection = setmetatable({ Connected = true, _signal = self, _fn = fn, _once = once }, Connection)
		table.insert(self._connections, connection)
		if self._onListeners then
			self._onListeners(1)
		end
		local buffer = self._buffer
		if buffer then
			-- deliver what was fired before anyone listened (only the first listener gets it, like remote queues)
			self._buffer = nil
			for _, args in buffer do
				if once then
					if connection.Connected then
						connection:Disconnect()
						sched.deferCall(fn, args)
					end
				else
					sched.deferCall(fn, args, connection)
				end
			end
		end
		return connection
	end

	function Signal.Connect(self: any, fn: any)
		return connect(self, fn, false, 2)
	end

	function Signal.Once(self: any, fn: any)
		return connect(self, fn, true, 2)
	end

	function Signal.ConnectParallel(self: any, fn: any)
		return connect(self, fn, false, 2)
	end

	function Signal.Wait(self: any): ...any
		if self._check then
			self._check()
		end
		local buffer = self._buffer
		if buffer and buffer[1] then
			local args = table.remove(buffer, 1)
			if #buffer == 0 then
				self._buffer = nil
			end
			return table.unpack(args, 1, args.n)
		end
		table.insert(self._waiters, coroutine.running())
		if self._onListeners then
			self._onListeners(1)
		end
		return sched.suspend()
	end

	function Signal._hasListeners(self: any): boolean
		return self._connections[1] ~= nil or self._waiters[1] ~= nil
	end

	function Signal._fire(self: any, ...)
		local connections = self._connections
		local count = #connections
		local waiters = self._waiters
		local waiterCount = #waiters
		if count == 0 and waiterCount == 0 then
			if self._buffering then
				local buffer = self._buffer
				if not buffer then
					buffer = {}
					self._buffer = buffer
				end
				if #buffer < BUFFER_LIMIT then
					table.insert(buffer, table.pack(...))
				end
			end
			return
		end
		local immediate = self._immediate or config.signalBehavior == "Immediate"
		if count > 0 then
			local args = if immediate then nil else table.pack(...)
			local snapshot = if count == 1 then { connections[1] } else table.clone(connections)
			for index = 1, count do
				local connection = snapshot[index]
				if connection.Connected then
					local fn = connection._fn
					if connection._once then
						-- disconnect now so a second fire before the queue drains cannot run it twice
						connection:Disconnect()
						if immediate then
							sched.spawn(fn, ...)
						else
							sched.deferCall(fn, args)
						end
					elseif immediate then
						sched.spawn(fn, ...)
					else
						sched.deferCall(fn, args, connection)
					end
				end
			end
		end
		if waiterCount > 0 then
			self._waiters = {}
			if self._onListeners then
				self._onListeners(-waiterCount)
			end
			for index = 1, waiterCount do
				if immediate then
					sched.spawn(waiters[index], ...)
				else
					sched.defer(waiters[index], ...)
				end
			end
		end
	end

	-- Disconnects every connection (used when an instance is destroyed). Waiting threads stay suspended forever.
	function Signal._disconnectAll(self: any)
		local connections = self._connections
		local count = #connections
		for index = 1, count do
			connections[index].Connected = false
		end
		local removed = count + #self._waiters
		self._connections = {}
		self._waiters = {}
		self._buffer = nil
		if removed > 0 and self._onListeners then
			self._onListeners(-removed)
		end
	end

	H.Signal = Signal
	return Signal
end
