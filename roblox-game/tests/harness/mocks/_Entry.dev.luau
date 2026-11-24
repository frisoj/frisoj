--[[
	Headless Roblox mock environment (entry point).  Env.new() loads this file and calls Mocks.install(env).

	Lune only gives us datatypes (Vector3, CFrame, Enum ...); everything else Roblox game code expects is built here
	in plain Luau: an Instance tree with validated properties and every Roblox event, a virtual-time task scheduler,
	two script "sides" (server / client) with their own globals and module caches, and behaving services
	(Players, DataStoreService, MarketplaceService, remotes, TweenService ...).  See README.md in this folder for
	the test-author API (everything under env.mocks) and the list of limitations.

	The implementation lives in tests/harness/mocks/*.luau.  Every module there is `return function(H) ... end`
	where H is the per-Env harness context (shared helpers + state); modules extend H and H.mocks.  To mock a missing
	member, find the class in one of those modules (or add a new module to MODULES below) and use H.class(...).
]]
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")
local stdio = require("@lune/stdio")
local realTask = require("@lune/task")

-- Load order matters: later modules use what earlier ones put on H.
local MODULES = {
	"Api", -- class/member lookups over the generated ApiData
	"Scheduler", -- virtual clock + task library
	"Signal", -- RBXScriptSignal / RBXScriptConnection
	"Datatypes", -- Random, TweenInfo, DateTime, RaycastParams ... and typeof
	"Instances", -- the Instance tree: proxies, properties, attributes, tags, tree events, Clone/Destroy
	"Sides", -- server/client globals, require, running scripts
	"RunService", -- frame signals, DataModel members (BindToClose, PlaceId ...)
	"World", -- BasePart, Model, Workspace, Camera, Attachment, Sound, effects
	"Characters", -- Humanoid, Animator, character rigs
	"Players", -- Players service + Player objects
	"Remotes", -- RemoteEvent / RemoteFunction / UnreliableRemoteEvent / Bindables
	"DataStores", -- DataStoreService with failure injection
	"Marketplace", -- MarketplaceService, receipts, prompts
	"Tween", -- TweenService + Debris
	"Gui", -- layout approximations, buttons, text boxes, StarterGui, GuiService
	"Input", -- UserInputService, ContextActionService, ProximityPrompt
	"Services", -- HttpService, CollectionService, PolicyService, BadgeService, SocialService, AnalyticsService ...
}

-- Compiled module factories and reflection defaults are shared by every Env of this process (they are immutable).
local CACHE_KEY = "__CrystalSmashersHarnessCache"
local cache = _G[CACHE_KEY]
if not cache then
	cache = { factories = {}, apiClasses = {}, prototypes = {}, defaults = {} }
	_G[CACHE_KEY] = cache
end

local Mocks = {}

local function loadFactory(harnessDir: string, name: string): any
	local path = harnessDir .. "/mocks/" .. name .. ".luau"
	local factory = cache.factories[path]
	if not factory then
		factory = luau.load(fs.readFile(path), { debugName = "tests/harness/mocks/" .. name })()
		cache.factories[path] = factory
	end
	return factory
end

function Mocks.install(env: any)
	local harnessDir = env.projectRoot .. "/tests/harness"
	local options = env.options or {}

	local H = {
		env = env,
		options = options,
		cache = cache,
		harnessDir = harnessDir,
		-- Lune libraries (modules must not require them directly so they stay easy to read)
		fs = fs,
		luau = luau,
		process = process,
		roblox = roblox,
		serde = serde,
		stdio = stdio,
		realTask = realTask,
		-- test-author API, exposed as env.mocks
		mocks = {},
		loaded = {},
		-- metatable -> typeof() name for mock objects implemented as tables (signals, TweenInfo, Random ...)
		typeNames = {},
	}

	local verbose = options.verbose == true or process.env.HARNESS_VERBOSE == "1"
	-- Knobs tests may change at any time (env.mocks.config).  Modules add their own defaults below these.
	H.config = {
		verbose = verbose,
		printErrors = options.printErrors ~= false, -- unhandled thread errors go to stderr as well as env.errors
		signalBehavior = options.signalBehavior or "Deferred", -- or "Immediate"
		waitForChildTimeout = 2, -- seconds before WaitForChild without a timeout argument errors
		randomSeed = 12345, -- seed source for Random.new() without arguments and math.random
		epoch = 1767268800, -- os.time() when the Env starts: 2026-01-01 12:00:00 UTC (deterministic tests)
	}
	H.mocks.config = H.config
	H.mocks.harness = H

	env.errors = env.errors or {}
	env.warnings = {}
	env.output = {}
	env.mocks = H.mocks

	-- Records an error that nobody caught (thread bodies, signal handlers, harness callbacks).
	function H.reportError(err: any, context: string?)
		local message = tostring(err)
		message = string.gsub(message, "^runtime error: ", "")
		if context then
			message = context .. ": " .. message
		end
		table.insert(env.errors, message)
		if H.config.printErrors then
			stdio.ewrite("[harness] unhandled error: " .. message .. "\n")
		end
	end

	-- Records a warning (game code calling warn(), or the harness flagging suspicious use).
	function H.warn(message: string)
		table.insert(env.warnings, message)
		if H.config.verbose then
			stdio.ewrite("[warn] " .. message .. "\n")
		end
	end

	function H.import(name: string): any
		local loaded = H.loaded[name]
		if loaded == nil then
			loaded = loadFactory(harnessDir, name)(H)
			if loaded == nil then
				loaded = true
			end
			H.loaded[name] = loaded
		end
		return loaded
	end

	H.apiData = cache.apiData
	if not H.apiData then
		H.apiData = luau.load(fs.readFile(harnessDir .. "/mocks/ApiData.luau"), { debugName = "tests/harness/mocks/ApiData" })()
		cache.apiData = H.apiData
	end

	for _, name in MODULES do
		H.import(name)
	end

	-- Everything is defined: adopt the DataModel Env built from default.project.json and wire up the Env API.
	H.boot()
end

return Mocks
