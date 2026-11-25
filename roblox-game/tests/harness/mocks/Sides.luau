--[[
	Script sides and globals.

	Server and client code share one DataModel but run as two "sides": each has its own global environment
	(its own `game`, `require`, `_G`, `shared` ...) and its own ModuleScript cache, like Roblox's separate server and
	client VMs.  The client's `game` is a side view (see Instances.sideView): the same DataModel, but
	game:GetService("RunService") / "Players" return views that answer IsClient() == true and have a LocalPlayer.

	This module also adopts the DataModel that Env built from default.project.json (H.boot) and replaces the Env
	methods that deal with scripts: env:require, env:requireAs, env:runScript, env:loadString, env:loadStringAs.
]]
return function(H)
	local env = H.env
	local Instances = H.instances
	local sched = H.sched
	local luau = H.luau
	local config = H.config
	local mocks = H.mocks

	local sides: { [string]: any } = {}
	H.sides = sides

	-- services with a client view
	local SIDED_SERVICES = { "RunService", "Players" }
	-- services every place has (so `game.Workspace`, `game.Players` ... resolve without GetService)
	local DEFAULT_SERVICES = {
		"Workspace", "Players", "Lighting", "MaterialService", "ReplicatedFirst", "ReplicatedStorage", "ServerScriptService",
		"ServerStorage", "StarterGui", "StarterPack", "StarterPlayer", "Teams", "SoundService", "TextChatService",
		"RunService",
	}

	--------------------------------------------------------------------------------------------------------------
	-- globals
	--------------------------------------------------------------------------------------------------------------
	local function joinArguments(...): string
		local count = select("#", ...)
		local parts = table.create(count)
		for position = 1, count do
			parts[position] = tostring((select(position, ...)))
		end
		return table.concat(parts, " ")
	end

	local function deprecatedGlobal(name: string, replacement: string)
		return function()
			error(`{name}() is deprecated and deliberately missing in the harness; use {replacement}`, 2)
		end
	end

	local function buildGlobals(side: any): { [string]: any }
		local globals: { [string]: any } = {}
		for name, value in H.datatypes do
			globals[name] = value
		end
		globals.game = side.game
		globals.workspace = H.workspace
		globals.task = sched.taskLibrary
		globals.typeof = H.typeof
		globals.shared = {}
		globals._G = {}
		globals.print = function(...)
			local line = joinArguments(...)
			table.insert(env.output, line)
			print(line)
		end
		globals.warn = function(...)
			H.warn(joinArguments(...))
		end
		globals.tick = sched.unixTime
		globals.time = sched.now
		globals.elapsedTime = sched.now
		globals.os = table.freeze({
			time = function(date: any?)
				if date ~= nil then
					return os.time(date)
				end
				return math.floor(sched.unixTime())
			end,
			clock = sched.now,
			date = function(format: string?, time: number?)
				return os.date(format or "%c", time or math.floor(sched.unixTime()))
			end,
			difftime = os.difftime,
		})
		-- math.random is seeded per side so runs are reproducible
		local random = H.newRandom(config.randomSeed + (if side.name == "server" then 1 else 2))
		local mathLibrary = table.clone(math)
		mathLibrary.random = function(low: number?, high: number?)
			if low == nil then
				return random:NextNumber()
			elseif high == nil then
				return random:NextInteger(1, low)
			end
			return random:NextInteger(low, high)
		end
		mathLibrary.randomseed = function(seed: number)
			random = H.newRandom(seed)
		end
		globals.math = table.freeze(mathLibrary)
		local debugLibrary = table.clone(debug)
		debugLibrary.profilebegin = function() end
		debugLibrary.profileend = function() end
		debugLibrary.setmemorycategory = function() end
		debugLibrary.resetmemorycategory = function() end
		globals.debug = table.freeze(debugLibrary)
		globals.wait = deprecatedGlobal("wait", "task.wait")
		globals.spawn = deprecatedGlobal("spawn", "task.spawn")
		globals.delay = deprecatedGlobal("delay", "task.delay")
		globals.UserSettings = function()
			return H.userSettings()
		end
		globals.version = function()
			return "0.0.0.0"
		end
		return globals
	end

	local function getSide(name: any): any
		local side = sides[name]
		if not side then
			error(`unknown side "{tostring(name)}" (expected "server" or "client")`, 3)
		end
		return side
	end

	local requireModule

	local function makeEnvironment(side: any, scriptInstance: any?): { [string]: any }
		local environment = table.clone(side.globals)
		environment.script = scriptInstance
		environment.require = function(target: any)
			return requireModule(side, target, 2)
		end
		return environment
	end

	--------------------------------------------------------------------------------------------------------------
	-- require
	--------------------------------------------------------------------------------------------------------------
	-- thread -> stack of modules that thread is currently loading (to tell a cycle from a concurrent require)
	local loadingStacks = setmetatable({}, { __mode = "k" })

	requireModule = function(side: any, target: any, level: number): any
		if not H.isInstance(target) then
			error(`Attempted to call require with invalid argument(s). (got {H.typeof(target)}; only ModuleScript instances can be required)`, level + 1)
		end
		local module = Instances.canonical(target)
		local info = env.scripts[module]
		if not info or info.kind ~= "Module" then
			if module.ClassName == "ModuleScript" then
				error(`require: ModuleScript {module:GetFullName()} has no source in the harness (only project files can be required)`, level + 1)
			end
			error(`Attempted to call require with invalid argument(s). ({module.ClassName} "{module:GetFullName()}" is not a ModuleScript)`, level + 1)
		end
		local cache = side.moduleCache
		local entry = cache[module]
		local thread = coroutine.running()
		while entry do
			if entry.loaded then
				return entry.value
			elseif entry.failed then
				error(`Requested module experienced an error while loading: {module:GetFullName()}`, level + 1)
			end
			local stack = loadingStacks[thread]
			if stack and table.find(stack, module) then
				local names = {}
				for _, loading in stack do
					table.insert(names, loading:GetFullName())
				end
				table.insert(names, module:GetFullName())
				error("Requested module was required recursively (cyclic require): " .. table.concat(names, " -> "), level + 1)
			end
			-- another thread is still running the module body: wait for it like Roblox does
			table.insert(entry.waiters, thread)
			sched.suspend()
			entry = cache[module]
		end
		entry = { loaded = false, failed = false, value = nil, waiters = {} }
		cache[module] = entry
		local stack = loadingStacks[thread]
		if not stack then
			stack = {}
			loadingStacks[thread] = stack
		end
		table.insert(stack, module)
		local results = table.pack(pcall(function()
			local chunk = luau.load(info.source, { debugName = info.path, environment = makeEnvironment(side, module) })
			return chunk()
		end))
		table.remove(stack)
		local failure: string? = nil
		if not results[1] then
			failure = tostring(results[2])
		elseif results.n ~= 2 then
			failure = `Module code did not return exactly one value ({module:GetFullName()})`
		end
		if failure then
			entry.failed = true
		else
			entry.loaded = true
			entry.value = results[2]
		end
		for _, waiter in entry.waiters do
			sched.defer(waiter)
		end
		entry.waiters = {}
		if failure then
			error(failure, 0)
		end
		return entry.value
	end

	--------------------------------------------------------------------------------------------------------------
	-- running scripts
	--------------------------------------------------------------------------------------------------------------
	local function sideOfScript(scriptInstance: any, info: any): string
		if info.kind == "Client" then
			return "client"
		elseif info.kind == "Server" and scriptInstance.RunContext == H.roblox.Enum.RunContext.Client then
			return "client"
		end
		return "server"
	end

	-- Runs a Script / LocalScript in a new thread on the side it belongs to (or `sideName`). Returns the thread.
	function H.runScript(scriptInstance: any, sideName: string?): thread
		if not H.isInstance(scriptInstance) then
			error("runScript: expected a Script or LocalScript instance", 2)
		end
		local target = Instances.canonical(scriptInstance)
		local info = env.scripts[target]
		if not info then
			error(`runScript: {target:GetFullName()} has no source in the harness`, 2)
		end
		if info.kind == "Module" then
			error(`runScript: {target:GetFullName()} is a ModuleScript; use env:require / env:requireAs`, 2)
		end
		local side = getSide(sideName or sideOfScript(target, info))
		local chunk = luau.load(info.source, { debugName = info.path, environment = makeEnvironment(side, target) })
		return sched.spawn(chunk)
	end

	-- test API -----------------------------------------------------------------------------------------------------

	-- newScript(className, name, source, parent?) -> instance: creates a "ModuleScript", "Script" or "LocalScript"
	-- whose source is the given string, so tests can require / run small inline scripts like project files.
	function mocks.newScript(className: string, name: string, source: string, parent: any?): any
		local kinds = { ModuleScript = "Module", Script = "Server", LocalScript = "Client" }
		local kind = kinds[className]
		if not kind then
			error(`env.mocks.newScript: className must be ModuleScript, Script or LocalScript, got {tostring(className)}`, 2)
		end
		if type(name) ~= "string" or type(source) ~= "string" then
			error("env.mocks.newScript expects (className, name: string, source: string, parent?)", 2)
		end
		local instance = H.datatypes.Instance.new(className)
		instance.Name = name
		env.scripts[instance] = { path = "inline/" .. name, source = source, kind = kind }
		if parent then
			instance.Parent = parent
		end
		return instance
	end

	-- startServer(): runs every enabled Script under ServerScriptService and Workspace (tree order)
	function mocks.startServer(): { thread }
		local threads = {}
		for _, serviceName in { "ServerScriptService", "Workspace" } do
			for _, descendant in H.game:GetService(serviceName):GetDescendants() do
				if descendant.ClassName == "Script" and env.scripts[descendant] and descendant.Enabled then
					table.insert(threads, H.runScript(descendant, "server"))
				end
			end
		end
		sched.flush()
		return threads
	end

	--------------------------------------------------------------------------------------------------------------
	-- boot
	--------------------------------------------------------------------------------------------------------------
	local userSettings: any = nil
	function H.userSettings(): any
		if not userSettings then
			userSettings = H.create("UserSettings")
		end
		return userSettings
	end
	local UserSettingsClass = H.class("UserSettings")
	function UserSettingsClass.methods.GetService(self: any, className: string): any
		local existing = self:FindFirstChildOfClass(className)
		if existing then
			return existing
		end
		if className ~= "UserGameSettings" then
			error(`'{tostring(className)}' is not a valid Service name`, 2)
		end
		return H.create(className, { Parent = self })
	end
	function UserSettingsClass.methods.IsUserFeatureEnabled(_self: any, _name: string): boolean
		return false
	end

	-- Copies the Lune DataModel that Env built (services, folders, scripts) into harness instances.
	local function adopt(rawNode: any, node: any, scripts: { [any]: any }, isRoot: boolean)
		for _, rawChild in rawNode:GetChildren() do
			local className = rawChild.ClassName
			local child
			if isRoot and H.api.isService(className) then
				child = Instances.getService(className, true)
			else
				child = node:FindFirstChild(rawChild.Name)
				if not child or child.ClassName ~= className then
					child = H.create(className)
					child.Name = rawChild.Name
					child.Parent = node
				end
			end
			local info = env.scripts[rawChild]
			if info then
				scripts[child] = info
			end
			adopt(rawChild, child, scripts, false)
		end
	end

	-- Applies "$properties" from default.project.json (Env only applies what Lune understands).
	local function applyProjectProperties(node: any, instance: any, isRoot: boolean)
		if type(node["$properties"]) == "table" then
			for key, value in node["$properties"] do
				local ok, err = pcall(function()
					instance[key] = value
				end)
				if not ok then
					H.warn(`default.project.json: could not apply {instance.ClassName}.{key}: {tostring(err)}`)
				end
			end
		end
		for key, child in node do
			if type(child) == "table" and string.sub(key, 1, 1) ~= "$" then
				local childInstance
				if isRoot and child["$className"] and H.api.isService(child["$className"]) then
					childInstance = Instances.getService(child["$className"], true)
				else
					childInstance = instance:FindFirstChild(key)
				end
				if childInstance then
					applyProjectProperties(child, childInstance, false)
				end
			end
		end
	end

	function H.boot()
		local rawGame = env.game
		local game = Instances.createGame()
		H.game = game
		for _, className in DEFAULT_SERVICES do
			Instances.getService(className, true)
		end
		H.workspace = Instances.getService("Workspace", true)

		local scripts = {}
		adopt(rawGame, game, scripts, true)
		local okProject, project = pcall(function()
			return H.serde.decode("json", H.fs.readFile(env.projectRoot .. "/default.project.json"))
		end)
		if okProject and type(project) == "table" and type(project.tree) == "table" then
			applyProjectProperties(project.tree, game, true)
		end

		sides.server = { name = "server", game = game, moduleCache = {} }
		sides.client = { name = "client", game = Instances.sideView(game, "client"), moduleCache = {} }
		for _, className in SIDED_SERVICES do
			Instances.sideView(Instances.getService(className, true), "client")
		end
		for _, side in sides do
			side.globals = buildGlobals(side)
		end

		for _, hook in H.bootHooks do
			hook()
		end

		-- Env API ------------------------------------------------------------------------------------------------
		env.rawGame = rawGame
		env.game = game
		env.scripts = scripts
		env.sides = sides
		env.globals = sides.server.globals
		env.moduleCache = sides.server.moduleCache

		env.makeEnvironment = function(_self: any, scriptInstance: any?, sideName: string?)
			return makeEnvironment(getSide(sideName or "server"), scriptInstance)
		end
		env.require = function(_self: any, target: any, sideName: string?)
			return requireModule(getSide(sideName or "server"), target, 2)
		end
		env.requireAs = function(_self: any, sideName: string, target: any)
			return requireModule(getSide(sideName), target, 2)
		end
		env.runScript = function(_self: any, scriptInstance: any, sideName: string?)
			return H.runScript(scriptInstance, sideName)
		end
		env.loadStringAs = function(_self: any, sideName: string, source: string, debugName: string?)
			return luau.load(source, {
				debugName = debugName or "loadString",
				environment = makeEnvironment(getSide(sideName), nil),
			})
		end
		env.loadString = function(self: any, source: string, debugName: string?)
			return self:loadStringAs("server", source, debugName)
		end
		table.insert(env.cleanups, function()
			sched.destroy()
		end)

		if H.options.ticker ~= false then
			sched.startTicker()
		end
	end

	-- functions other modules register to run at the end of boot (after the tree and sides exist)
	H.bootHooks = {}

	return sides
end
