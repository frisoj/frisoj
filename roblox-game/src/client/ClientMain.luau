--!strict
--[[
	ClientMain — boots the client (spec §8). ClientMain.start():
	  1. loads the core modules (state mirror, windows, notifications, sound ...), which start themselves,
	  2. waits until the player's replicated state has arrived,
	  3. requires every controller and window module from the fixed lists below,
	  4. calls Init() on all of them in order, then Start() on all of them in order,
	  5. sets the Player attribute "ClientReady" (the loading screen waits for it).

	Feature modules return { Init: (() -> ())?, Start: (() -> ())? }. Each one is required and run inside pcall:
	a module that is missing, throws while loading or throws in Init/Start produces one clear warning and is
	skipped, so a single broken feature can never take the whole client down.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Client = ReplicatedStorage:WaitForChild("Client")
local Core = Client:WaitForChild("Core")
local ClientState = require(Core:WaitForChild("ClientState"))

-- Required for their side effects: they build the shared ScreenGui, handle the global server events and start
-- tracking as soon as they load, before any feature module runs.
require(Core:WaitForChild("Sound"))
require(Core:WaitForChild("WindowManager"))
require(Core:WaitForChild("Notifications"))
require(Core:WaitForChild("FloatingText"))
require(Core:WaitForChild("ClientEvents"))
require(Core:WaitForChild("ZoneTracker"))

local ClientMain = {}

-- Fixed load order (spec §8). Controllers live in Client/Controllers, windows in Client/Windows.
ClientMain.Controllers = table.freeze({
	"HammerVisuals",
	"NodeVisuals",
	"CombatController",
	"BossHud",
	"GateController",
	"PetFollowController",
	"EggController",
	"TutorialController",
	"PurchaseController",
	"ChatTags",
	"AmbienceController",
	"HudController",
})

ClientMain.Windows = table.freeze({
	"ShopWindow",
	"PetsWindow",
	"HammersWindow",
	"UpgradesWindow",
	"ZonesWindow",
	"QuestsWindow",
	"RebirthWindow",
	"DailyWindow",
	"GiftsWindow",
	"CodesWindow",
	"SettingsWindow",
	"StatsWindow",
})

type Feature = { name: string, module: { [string]: any }, failed: boolean }

-- Seconds without player data after which a reminder is logged (the wait itself has no limit: without data
-- there is nothing to show, and the server kicks players whose data cannot be loaded).
local STATE_REMINDER_SECONDS = 30

local started = false
local ready = false
local loadedNames: { string } = {}

local function traceback(message: any): string
	return debug.traceback(tostring(message), 2)
end

local function loadFeature(folderName: string, name: string): Feature?
	local folder = Client:FindFirstChild(folderName)
	local instance = if folder then folder:FindFirstChild(name) else nil
	if not instance or not instance:IsA("ModuleScript") then
		warn(`[ClientMain] {folderName}/{name} is missing; skipped`)
		return nil
	end
	local ok, result = xpcall(function(): any
		-- Dynamic require: the module is looked up by name so that a missing one is not fatal.
		return (require :: any)(instance)
	end, traceback)
	if not ok then
		warn(`[ClientMain] {folderName}/{name} failed to load; skipped: {tostring(result)}`)
		return nil
	end
	if type(result) ~= "table" then
		warn(`[ClientMain] {folderName}/{name} must return a table, got {typeof(result)}; skipped`)
		return nil
	end
	return { name = `{folderName}/{name}`, module = result, failed = false }
end

local function loadAll(): { Feature }
	local features: { Feature } = {}
	for _, name in ClientMain.Controllers do
		local feature = loadFeature("Controllers", name)
		if feature then
			table.insert(features, feature)
		end
	end
	for _, name in ClientMain.Windows do
		local feature = loadFeature("Windows", name)
		if feature then
			table.insert(features, feature)
		end
	end
	return features
end

local function initAll(features: { Feature })
	for _, feature in features do
		local init = feature.module.Init
		if type(init) == "function" then
			local ok, message = xpcall(init, traceback)
			if not ok then
				feature.failed = true
				warn(`[ClientMain] {feature.name}.Init failed; its Start is skipped: {tostring(message)}`)
			end
		end
	end
end

local function startAll(features: { Feature })
	for _, feature in features do
		local start = feature.module.Start
		if type(start) == "function" and not feature.failed then
			-- Own thread: a Start that yields (or loops forever) must not hold up the others.
			task.spawn(function()
				local ok, message = xpcall(start, traceback)
				if not ok then
					warn(`[ClientMain] {feature.name}.Start failed: {tostring(message)}`)
				end
			end)
		end
	end
end

-- Boots the client. Yields until the player's state has arrived and every feature module has been initialised
-- and started. Calling it again does nothing.
function ClientMain.start()
	if started then
		return
	end
	started = true

	-- After game.Loaded every initial instance has replicated, so a module that is not there is really missing.
	if not game:IsLoaded() then
		game.Loaded:Wait()
	end

	task.delay(STATE_REMINDER_SECONDS, function()
		if not ClientState.isReady() then
			warn(`[ClientMain] still waiting for player data after {STATE_REMINDER_SECONDS} seconds`)
		end
	end)
	ClientState.waitUntilReady()

	local features = loadAll()
	initAll(features)
	startAll(features)
	for _, feature in features do
		if not feature.failed then
			table.insert(loadedNames, feature.name)
		end
	end

	ready = true
	Players.LocalPlayer:SetAttribute("ClientReady", true)
end

-- True once start() has finished (the "ClientReady" attribute is set at the same moment).
function ClientMain.isReady(): boolean
	return ready
end

-- Names ("Controllers/HudController", "Windows/ShopWindow" ...) of the feature modules that loaded and
-- initialised without errors.
function ClientMain.getLoaded(): { string }
	return table.clone(loadedNames)
end

return ClientMain
