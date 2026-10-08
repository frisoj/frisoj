--!strict
-- Start van de server: alle onderdelen opstarten en spelers laden, plaatsen en opslaan.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local Server = script.Parent
local Remotes = require(Server:WaitForChild("Remotes"))
local PlayerData = require(Server:WaitForChild("PlayerData"))
local Passes = require(Server:WaitForChild("Passes"))
local Economy = require(Server:WaitForChild("Economy"))
local Labs = require(Server:WaitForChild("Labs"))
local Stream = require(Server:WaitForChild("Stream"))
local Movement = require(Server:WaitForChild("Movement"))
local Steal = require(Server:WaitForChild("Steal"))
local Fuse = require(Server:WaitForChild("Fuse"))
local Weather = require(Server:WaitForChild("Weather"))
local Monetization = require(Server:WaitForChild("Monetization"))
local Leaderboards = require(Server:WaitForChild("Leaderboards"))
local Bonker = require(Server:WaitForChild("Bonker"))
local World = require(Server:WaitForChild("World"))

local _ = Remotes

World.start()
Passes.start()
Economy.start()
Labs.start()
Stream.start()
Movement.start()
Steal.start()
Fuse.init()
Weather.start()
Monetization.start()
Leaderboards.start()
Bonker.start()

local ready: { [Player]: boolean } = {}

local function onCharacter(player: Player, character: Model)
	local humanoid = character:WaitForChild("Humanoid", 10)
	if not humanoid or not ready[player] then
		return
	end
	task.defer(function()
		Labs.spawnAt(player)
		Movement.refresh(player)
		Bonker.give(player)
	end)
end

local function onJoin(player: Player)
	player.CharacterAdded:Connect(function(character)
		onCharacter(player, character)
	end)

	local data = PlayerData.load(player)
	if player.Parent == nil then
		return
	end
	if not data then
		player:Kick("Your save could not be loaded. Please rejoin in a minute.")
		return
	end
	if not Labs.assign(player) then
		player:Kick("This server is full. Please join another server.")
		return
	end
	Passes.load(player)
	Monetization.checkPolicy(player)
	Economy.onJoin(player)
	Economy.placeStorage(player)
	ready[player] = true
	if player.Character then
		onCharacter(player, player.Character)
	end
	Economy.pushState(player)
end

local function onLeave(player: Player)
	ready[player] = nil
	Steal.onLeave(player)
	Labs.release(player)
	Economy.onLeave(player)
	Passes.unload(player)
	PlayerData.release(player)
end

Players.PlayerAdded:Connect(onJoin)
Players.PlayerRemoving:Connect(onLeave)
for _, player in Players:GetPlayers() do
	task.spawn(onJoin, player)
end

-- Automatisch opslaan, verspreid over de minuut zodat de DataStore niet piekt.
task.spawn(function()
	while true do
		task.wait(Config.AUTOSAVE_SECONDS)
		for player in PlayerData.all() do
			if player.Parent then
				task.spawn(PlayerData.save, player)
				task.wait(0.5)
			end
		end
	end
end)

game:BindToClose(function()
	local pending = 0
	for player in PlayerData.all() do
		pending += 1
		task.spawn(function()
			Steal.onLeave(player)
			PlayerData.release(player)
			pending -= 1
		end)
	end
	local start = os.clock()
	while pending > 0 and os.clock() - start < 25 do
		task.wait(0.2)
	end
end)
