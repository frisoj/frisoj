--[[
	RemoteEvent, UnreliableRemoteEvent, RemoteFunction, BindableEvent, BindableFunction.

	Both sides live in one process, so "the network" is the deferred queue: a fire/invoke is delivered on the next
	resumption (never re-entrantly), with arguments copied the way Roblox serialises them (tables are copied,
	Instances pass by reference, functions/threads become nil, mixed tables lose their dictionary part, non-string
	dictionary keys become strings; the last two also record a warning in env.warnings because they are usually
	bugs).

	Server -> client traffic is delivered to the single local client (env.mocks.setLocalPlayer / bootClient) and
	always recorded in env.mocks.sent, so server-only tests can assert on what a player was sent.
	Events fired before anyone connected are queued and handed to the first connection, like in Roblox; what a
	player was sent before becoming the local player is kept (up to a limit) and delivered when their client boots.
]]
return function(H)
	local sched = H.sched
	local config = H.config
	local mocks = H.mocks

	config.invokeTimeout = 5 -- virtual seconds InvokeServer/InvokeClient wait for a missing callback before erroring
	mocks.sent = {} -- { { remote = name, instance = RemoteEvent, player = Player? (nil = all clients), args = {...} } }
	local SENT_LIMIT = 20000
	-- player -> { { remote, args } }: server -> client events for players whose client has not booted (yet)
	local backlog = setmetatable({}, { __mode = "k" })
	local BACKLOG_LIMIT = 2000

	--------------------------------------------------------------------------------------------------------------
	-- serialisation
	--------------------------------------------------------------------------------------------------------------
	local function copyValue(value: any, seen: { [any]: boolean }, where: string): any
		local kind = type(value)
		if kind == "table" then
			if seen[value] then
				error(`{where}: tables with cyclic references cannot be sent`, 0)
			end
			seen[value] = true
			local result = {}
			local length = #value
			if length > 0 then
				for position = 1, length do
					result[position] = copyValue(value[position], seen, where)
				end
				for key in value do
					if type(key) ~= "number" or key < 1 or key > length or key % 1 ~= 0 then
						H.warn(`{where}: mixed table sent through a remote; the non-array key {tostring(key)} is dropped by Roblox`)
						break
					end
				end
			else
				for key, item in value do
					if type(key) == "string" then
						result[key] = copyValue(item, seen, where)
					elseif type(key) == "number" then
						H.warn(`{where}: table with numeric key {key} but no array part sent through a remote; Roblox turns the key into a string`)
						result[tostring(key)] = copyValue(item, seen, where)
					else
						H.warn(`{where}: table key of type {H.typeof(key)} cannot be sent through a remote and is dropped`)
					end
				end
			end
			seen[value] = nil
			return result
		elseif kind == "function" or kind == "thread" then
			return nil
		end
		return value
	end

	-- Copies a packed argument list ({ n = count, ... }).
	local function copyArguments(args: any, where: string): any
		local copy = { n = args.n }
		for position = 1, args.n do
			copy[position] = copyValue(args[position], {}, where)
		end
		return copy
	end
	H.copyForNetwork = copyArguments

	local function requirePlayer(player: any, method: string)
		if not (H.isInstance(player) and player:IsA("Player")) then
			error(`{method}: player argument must be a Player object, got {H.typeof(player)}`, 3)
		end
	end

	local function localPlayer(method: string): any
		local player = H.localPlayer
		if not player then
			error(`{method} needs a LocalPlayer: call env.mocks.setLocalPlayer(player) or env.mocks.bootClient(player) first`, 3)
		end
		return player
	end

	local function record(remote: any, player: any?, args: any)
		local sent = mocks.sent
		if #sent >= SENT_LIMIT then
			table.move(sent, SENT_LIMIT // 2 + 1, #sent, 1)
			for position = #sent, SENT_LIMIT // 2 + 1, -1 do
				sent[position] = nil
			end
		end
		table.insert(sent, { remote = remote.Name, instance = remote, player = player, args = table.pack(table.unpack(args, 1, args.n)) })
	end

	--------------------------------------------------------------------------------------------------------------
	-- RemoteEvent / UnreliableRemoteEvent
	--------------------------------------------------------------------------------------------------------------
	local function buffered()
		return { buffer = true }
	end

	local function deliverToClient(remote: any, args: any)
		sched.deferCall(function()
			H.fire(remote, "OnClientEvent", table.unpack(args, 1, args.n))
		end, table.pack())
	end

	local function keepForLater(player: any, remote: any, args: any)
		local pending = backlog[player]
		if not pending then
			pending = {}
			backlog[player] = pending
		end
		if #pending >= BACKLOG_LIMIT then
			table.remove(pending, 1)
		end
		table.insert(pending, { remote, args })
	end

	table.insert(H.localPlayerHooks, function(player: any?)
		local pending = player and backlog[player]
		if pending then
			backlog[player] = nil
			for _, entry in pending do
				if not H.isDestroyed(entry[1]) then
					deliverToClient(entry[1], entry[2])
				end
			end
		end
	end)

	local function defineRemoteEvent(className: string)
		local class = H.class(className)
		class.signals.OnServerEvent = buffered
		class.signals.OnClientEvent = buffered

		function class.methods.FireServer(self: any, ...)
			local player = localPlayer(className .. ":FireServer")
			local args = copyArguments(table.pack(...), `{self.Name}:FireServer`)
			sched.deferCall(function()
				if player.Parent ~= nil then
					H.fire(self, "OnServerEvent", player, table.unpack(args, 1, args.n))
				end
			end, table.pack())
		end

		function class.methods.FireClient(self: any, player: any, ...)
			requirePlayer(player, className .. ":FireClient")
			local args = copyArguments(table.pack(...), `{self.Name}:FireClient`)
			record(self, player, args)
			if player == H.localPlayer then
				deliverToClient(self, args)
			elseif player.Parent ~= nil then
				keepForLater(player, self, args)
			end
		end

		function class.methods.FireAllClients(self: any, ...)
			local args = copyArguments(table.pack(...), `{self.Name}:FireAllClients`)
			record(self, nil, args)
			for _, player in H.game:GetService("Players"):GetPlayers() do
				if player == H.localPlayer then
					deliverToClient(self, args)
				else
					keepForLater(player, self, args)
				end
			end
		end
	end
	defineRemoteEvent("RemoteEvent")
	defineRemoteEvent("UnreliableRemoteEvent")

	--------------------------------------------------------------------------------------------------------------
	-- RemoteFunction
	--------------------------------------------------------------------------------------------------------------
	local RemoteFunction = H.class("RemoteFunction")

	-- Calls a callback member in the current (fresh) thread, waiting a little for it to be assigned.
	local function invokeCallback(remote: any, callbackName: string, args: any, ...): any
		local callback = H.callback(remote, callbackName)
		if not callback then
			local deadline = sched.frameTime() + config.invokeTimeout
			while not callback and sched.frameTime() < deadline do
				sched.wait(0)
				callback = H.callback(remote, callbackName)
			end
			if not callback then
				return table.pack(false, `HARNESS: {remote.ClassName} {remote:GetFullName()} has no {callbackName} callback (waited {config.invokeTimeout} s)`)
			end
		end
		local prefix = table.pack(...)
		local callArgs = table.create(prefix.n + args.n)
		for position = 1, prefix.n do
			callArgs[position] = prefix[position]
		end
		for position = 1, args.n do
			callArgs[prefix.n + position] = args[position]
		end
		return table.pack(pcall(callback, table.unpack(callArgs, 1, prefix.n + args.n)))
	end

	local function invoke(remote: any, callbackName: string, where: string, packed: any, ...): ...any
		local args = copyArguments(packed, where)
		local thread = coroutine.running()
		local prefix = table.pack(...)
		local results: any = nil
		local waitingForResult = false
		sched.deferCall(function()
			results = invokeCallback(remote, callbackName, args, table.unpack(prefix, 1, prefix.n))
			if waitingForResult then
				sched.defer(thread)
			end
		end, table.pack())
		if not results then
			waitingForResult = true
			sched.suspend()
		end
		if not results[1] then
			error(`{where} failed: {tostring(results[2])}`, 3)
		end
		local returned = copyArguments({ n = results.n - 1, table.unpack(results, 2, results.n) }, where)
		return table.unpack(returned, 1, returned.n)
	end

	function RemoteFunction.methods.InvokeServer(self: any, ...): ...any
		local player = localPlayer("RemoteFunction:InvokeServer")
		return invoke(self, "OnServerInvoke", `{self.Name}:InvokeServer`, table.pack(...), player)
	end

	function RemoteFunction.methods.InvokeClient(self: any, player: any, ...): ...any
		requirePlayer(player, "RemoteFunction:InvokeClient")
		if player ~= H.localPlayer then
			error(`InvokeClient: {player.Name} has no client in the harness (only the local player can be invoked)`, 2)
		end
		return invoke(self, "OnClientInvoke", `{self.Name}:InvokeClient`, table.pack(...))
	end

	--------------------------------------------------------------------------------------------------------------
	-- Bindables
	--------------------------------------------------------------------------------------------------------------
	local BindableEvent = H.class("BindableEvent")
	function BindableEvent.methods.Fire(self: any, ...)
		local args = copyArguments(table.pack(...), `{self.Name}:Fire`)
		H.fire(self, "Event", table.unpack(args, 1, args.n))
	end

	local BindableFunction = H.class("BindableFunction")
	function BindableFunction.methods.Invoke(self: any, ...): ...any
		local callback = H.callback(self, "OnInvoke")
		if not callback then
			error(`BindableFunction {self:GetFullName()} has no OnInvoke callback`, 2)
		end
		local args = copyArguments(table.pack(...), `{self.Name}:Invoke`)
		local results = table.pack(callback(table.unpack(args, 1, args.n)))
		local returned = copyArguments(results, `{self.Name}:Invoke`)
		return table.unpack(returned, 1, returned.n)
	end

	--------------------------------------------------------------------------------------------------------------
	-- test API
	--------------------------------------------------------------------------------------------------------------
	local function findRemote(remote: any, className: string): any
		if type(remote) == "string" then
			local found = H.game:GetService("ReplicatedStorage"):FindFirstChild(remote, true)
			if not found then
				error(`no instance named "{remote}" in ReplicatedStorage`, 3)
			end
			remote = found
		end
		if not (H.isInstance(remote) and remote:IsA(className)) then
			error(`expected a {className} (or its name), got {tostring(remote)}`, 3)
		end
		return remote
	end

	-- fireServer(player, remote, ...): as if `player`'s client called remote:FireServer(...). `remote` is the
	-- RemoteEvent / UnreliableRemoteEvent or its name (searched in ReplicatedStorage). Handlers run before return.
	function mocks.fireServer(player: any, remote: any, ...)
		requirePlayer(player, "env.mocks.fireServer")
		local target = findRemote(remote, "BaseRemoteEvent")
		local args = copyArguments(table.pack(...), `{target.Name}:FireServer`)
		H.fire(target, "OnServerEvent", player, table.unpack(args, 1, args.n))
		sched.flush()
	end

	-- invokeServer(player, remote, ...) -> results: as if `player`'s client called remote:InvokeServer(...).
	-- Runs the server's OnServerInvoke callback to completion (stepping virtual frames while it yields).
	function mocks.invokeServer(player: any, remote: any, ...): ...any
		requirePlayer(player, "env.mocks.invokeServer")
		local target = findRemote(remote, "RemoteFunction")
		local args = copyArguments(table.pack(...), `{target.Name}:InvokeServer`)
		local outcome = table.pack(sched.runToCompletion(60, function()
			return invokeCallback(target, "OnServerInvoke", args, player)
		end))
		if not outcome[1] then
			error(`env.mocks.invokeServer({target.Name}): {tostring(outcome[2])}`, 2)
		end
		local results = outcome[2]
		if not results[1] then
			error(`env.mocks.invokeServer({target.Name}): the server callback raised: {tostring(results[2])}`, 2)
		end
		local returned = copyArguments({ n = results.n - 1, table.unpack(results, 2, results.n) }, `{target.Name}:InvokeServer`)
		return table.unpack(returned, 1, returned.n)
	end

	-- sentTo(player, remoteName?) -> { args }: argument lists the server sent to `player` (FireClient to that
	-- player and FireAllClients), oldest first, optionally only for one remote name.
	function mocks.sentTo(player: any, remoteName: string?): { any }
		local list = {}
		for _, entry in mocks.sent do
			if (entry.player == nil or entry.player == player) and (remoteName == nil or entry.remote == remoteName) then
				table.insert(list, entry.args)
			end
		end
		return list
	end

	function mocks.clearSent()
		table.clear(mocks.sent)
	end

	return nil
end
