--!strict
-- De Goo-rivier: elke paar seconden komt er een slijmpje uit de Slime Portal dat naar de
-- Recycler hopt. De server bewaart alleen de gegevens (in ReplicatedStorage.Stream); de
-- client tekent en animeert ze. Bij kopen rekent de server zelf uit waar het slijmpje is.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Slimes = require(Shared:WaitForChild("Slimes"))
local Layout = require(Shared:WaitForChild("Layout"))
local Events = require(Shared:WaitForChild("Events"))
local Format = require(Shared:WaitForChild("Format"))

local Server = script.Parent
local PlayerData = require(Server:WaitForChild("PlayerData"))
local Economy = require(Server:WaitForChild("Economy"))
local Remotes = require(Server:WaitForChild("Remotes"))

local Stream = {}

type Entry = { folder: Configuration, slime: Slimes.Slime, spawn: number, price: number, sold: boolean }

local folder = Instance.new("Folder")
folder.Name = "Stream"
folder.Parent = ReplicatedStorage

local entries: { [string]: Entry } = {}
local nextId = 0
local rng = Random.new()
local lastLegendary = 0
local lastMythic = 0
local lastBuy: { [Player]: number } = {}

local function now(): number
	return Workspace:GetServerTimeNow()
end

------------------------------------------------------------------ geluk

function Stream.serverLuck(): number
	local ends = tonumber(Workspace:GetAttribute("ServerLuckEnds")) or 0
	if ends > now() then
		return tonumber(Workspace:GetAttribute("ServerLuck")) or 1
	end
	return 1
end

function Stream.luck(): number
	return Stream.serverLuck() * Events.luckMultiplier(now())
end

-- Server Luck kopen: de sterkste vermenigvuldiger blijft, de tijd telt op.
function Stream.addLuck(mult: number, seconds: number, buyer: Player)
	local t = now()
	local current = if (tonumber(Workspace:GetAttribute("ServerLuckEnds")) or 0) > t then tonumber(Workspace:GetAttribute("ServerLuck")) or 1 else 1
	local ends = math.max(t, tonumber(Workspace:GetAttribute("ServerLuckEnds")) or 0) + seconds
	Workspace:SetAttribute("ServerLuck", math.max(current, mult))
	Workspace:SetAttribute("ServerLuckEnds", ends)
	Economy.announce(string.format("%s gave the whole server x%d LUCK for %d minutes!", buyer.DisplayName, mult, seconds // 60), "#7CF6FF")
end

------------------------------------------------------------------ rivier

local function positionOf(entry: Entry, t: number): Vector3
	local dist = (t - entry.spawn) * Config.STREAM_SPEED
	local x, z = Layout.riverAt(dist)
	return Vector3.new(x, Layout.RIVER_Y + 2, z)
end

local function spawnOne(age: number?)
	local t = now()
	local minRarity: string? = nil
	if t - lastMythic >= Config.MYTHIC_EVERY then
		minRarity = "Mythic"
	elseif t - lastLegendary >= Config.LEGENDARY_EVERY then
		minRarity = "Legendary"
	end
	local species = Slimes.roll(function()
		return rng:NextNumber()
	end, Stream.luck(), minRarity)
	local info = Slimes.BY_ID[species]
	local order = Slimes.rarityOrder(info.rarity)
	if order >= Slimes.rarityOrder("Legendary") then
		lastLegendary = t
	end
	if order >= Slimes.rarityOrder("Mythic") then
		lastMythic = t
	end

	local mutation: string? = nil
	local storm = Workspace:GetAttribute("Weather")
	if typeof(storm) == "string" and storm ~= "" and rng:NextNumber() < Config.STORM_STREAM_CHANCE then
		mutation = storm
	elseif rng:NextNumber() < Config.CALM_GOLD_CHANCE then
		mutation = "Gold"
	end

	local slime: Slimes.Slime = { s = species, m = mutation, f = 0 }
	nextId += 1
	local id = "S" .. nextId
	local cfg = Instance.new("Configuration")
	cfg.Name = id
	cfg:SetAttribute("Species", species)
	cfg:SetAttribute("Mut", mutation or "")
	local spawnTime = t - (age or 0)
	cfg:SetAttribute("Spawn", spawnTime)
	cfg:SetAttribute("Price", Slimes.price(slime))
	cfg.Parent = folder
	entries[id] = { folder = cfg, slime = slime, spawn = spawnTime, price = Slimes.price(slime), sold = false }

	if order >= Slimes.rarityOrder("Legendary") and not age then
		Economy.announce(string.format("A %s %s is floating down the river!", string.upper(info.rarity), Slimes.displayName(slime)),
			if order >= Slimes.rarityOrder("Mythic") then "#FF6FB5" else "#FFD45A")
	end
end

local function cleanup()
	local t = now()
	for id, entry in entries do
		local gone = (t - entry.spawn) * Config.STREAM_SPEED > Layout.RIVER_LENGTH + 4
		if gone and not entry.sold then
			entries[id] = nil
			entry.folder:Destroy()
		end
	end
end

------------------------------------------------------------------ kopen

local function buy(player: Player, id: unknown)
	if typeof(id) ~= "string" then
		return
	end
	local t = os.clock()
	if (lastBuy[player] or 0) > t - 0.25 then
		return
	end
	lastBuy[player] = t
	local entry = entries[id :: string]
	local data = PlayerData.get(player)
	if not entry or entry.sold or not data then
		return
	end
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then
		return
	end
	local pos = positionOf(entry, now())
	local d = root.Position - pos
	if Vector2.new(d.X, d.Z).Magnitude > Config.BUY_RANGE then
		return
	end
	if not Economy.freePad(player) then
		Economy.notify(player, "Your lab is full! Sell or fuse slimes to make room.", "bad")
		return
	end
	if not Economy.spend(player, entry.price) then
		Economy.notify(player, "Not enough Goo! You need " .. Format.number(entry.price) .. ".", "bad")
		return
	end
	entry.sold = true
	local _, pad = Economy.addSlime(player, entry.slime)
	entry.folder:SetAttribute("Buyer", player.UserId)
	entry.folder:SetAttribute("BuyPad", pad or 0)
	entry.folder:SetAttribute("SoldAt", now())
	entries[id :: string] = nil
	task.delay(2, function()
		entry.folder:Destroy()
	end)
	if data.tutorial == 0 then
		data.tutorial = 1
	end
	Economy.notify(player, "You bought " .. Slimes.displayName(entry.slime) .. "!", "good")
	local info = Slimes.BY_ID[entry.slime.s]
	if Slimes.rarityOrder(info.rarity) >= Slimes.rarityOrder("Mythic") then
		Economy.announce(string.format("%s bought a %s %s!", player.DisplayName, string.upper(info.rarity), info.name), "#FF6FB5")
	end
end

function Stream.start()
	Workspace:SetAttribute("ServerLuck", 1)
	Workspace:SetAttribute("ServerLuckEnds", 0)
	local t = now()
	lastLegendary = t - Config.LEGENDARY_EVERY * 0.5
	lastMythic = t - Config.MYTHIC_EVERY * 0.3
	Remotes.Buy.OnServerEvent:Connect(buy)
	Players.PlayerRemoving:Connect(function(player)
		lastBuy[player] = nil
	end)
	-- Vul de rivier meteen, zodat er bij de eerste speler al slijmpjes drijven.
	local count = math.floor(Layout.RIVER_LENGTH / Config.STREAM_SPEED / Config.STREAM_INTERVAL)
	for i = count, 1, -1 do
		spawnOne(i * Config.STREAM_INTERVAL)
	end
	task.spawn(function()
		while true do
			local ok, err = pcall(function()
				spawnOne()
				cleanup()
			end)
			if not ok then
				warn("[Stream]", err)
			end
			task.wait(Config.STREAM_INTERVAL)
		end
	end)
end

return Stream
