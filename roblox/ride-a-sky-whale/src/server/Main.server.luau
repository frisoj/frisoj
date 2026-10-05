--!strict
-- Start van de server: koppelt alle onderdelen aan elkaar.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local Server = script.Parent
local Remotes = require(Server:WaitForChild("Remotes"))
local PlayerData = require(Server:WaitForChild("PlayerData"))
local Economy = require(Server:WaitForChild("Economy"))
local NestService = require(Server:WaitForChild("NestService"))
local DriftlingService = require(Server:WaitForChild("DriftlingService"))
local WorldService = require(Server:WaitForChild("WorldService"))
local Monetization = require(Server:WaitForChild("Monetization"))

NestService.init()
WorldService.start()
Monetization.start()
DriftlingService.start()
Remotes.Action.OnServerEvent:Connect(Economy.handleAction)

local function onPlayerAdded(player: Player)
	local data = PlayerData.load(player)
	if data == nil then
		player:Kick("We couldn't load your save. Please rejoin in a minute.")
		return
	end
	if player.Parent == nil then
		-- Speler ging weg tijdens het laden.
		PlayerData.release(player)
		return
	end
	NestService.assign(player)
	Monetization.loadPasses(player)
	Economy.onJoin(player)
	NestService.render(player)
	Economy.recomputeFriends()
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

Players.PlayerRemoving:Connect(function(player)
	NestService.release(player)
	Economy.onLeave(player)
	PlayerData.release(player)
	task.defer(Economy.recomputeFriends)
end)

-- Inkomen: elke seconde
task.spawn(function()
	local last = os.clock()
	while true do
		task.wait(1)
		local now = os.clock()
		local dt = now - last
		local ok, err = pcall(function(): any
			Economy.tick(dt)
			return nil
		end)
		if not ok then
			warn("[Economy]", err)
		end
		last = now
	end
end)

-- Automatisch opslaan
task.spawn(function()
	while true do
		task.wait(Config.AUTOSAVE_SECONDS)
		for player in PlayerData.all() do
			task.spawn(PlayerData.save, player)
		end
	end
end)

-- Server sluit: iedereen nog snel opslaan.
game:BindToClose(function()
	local pending = 0
	for player in PlayerData.all() do
		pending += 1
		task.spawn(function()
			PlayerData.save(player)
			pending -= 1
		end)
	end
	local started = os.clock()
	while pending > 0 and os.clock() - started < 25 do
		task.wait(0.1)
	end
end)
