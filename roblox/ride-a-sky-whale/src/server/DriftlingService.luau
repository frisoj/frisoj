--!strict
-- Laat Driftlings verschijnen in de lucht, boven het spuitgat en rond het
-- drijvende eiland, en controleert elke vangst op de server.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local CollectionService = game:GetService("CollectionService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Driftlings = require(Shared:WaitForChild("Driftlings"))
local Biomes = require(Shared:WaitForChild("Biomes"))
local SkyForecast = require(Shared:WaitForChild("SkyForecast"))

local Server = script.Parent
local DriftlingModel = require(Server:WaitForChild("DriftlingModel"))
local Economy = require(Server:WaitForChild("Economy"))
local Remotes = require(Server:WaitForChild("Remotes"))

local DriftlingService = {}

type Entry = { model: Model, species: string, expiresAt: number, zone: string }

local active: { [string]: Entry } = {}
local lastCatch: { [Player]: number } = {}
local nextId = 0
local rng = Random.new()
local currentBiome = ""
local island: Model? = nil

local skyFolder = Instance.new("Folder")
skyFolder.Name = "SkyDriftlings"
skyFolder.Parent = Workspace

local whale = Workspace:WaitForChild("SkyWhale")
local blowhole = whale:WaitForChild("Blowhole") :: BasePart

-- Hoe zeldzamer, hoe hoger in de lucht (zo loont het spuitgat).
local HEIGHTS: { [string]: { number } } = {
	Common = { 85, 150 },
	Uncommon = { 100, 175 },
	Rare = { 130, 210 },
	Epic = { 160, 235 },
	Legendary = { 180, 245 },
	Mythic = { 200, 250 },
}

local function serverNow(): number
	return Workspace:GetServerTimeNow()
end

local function spawnDriftling(speciesId: string, position: Vector3, zone: string, lifetime: number): string
	nextId += 1
	local id = "D" .. nextId
	local cf = CFrame.new(position) * CFrame.Angles(0, rng:NextNumber(0, math.pi * 2), 0)
	local model = DriftlingModel.build(speciesId, nil, cf)
	model.Name = id
	model:SetAttribute("Zone", zone)
	model.Parent = skyFolder
	active[id] = { model = model, species = speciesId, expiresAt = os.clock() + lifetime, zone = zone }
	return id
end

local function remove(id: string)
	local entry = active[id]
	if entry then
		active[id] = nil
		entry.model:Destroy()
	end
end

local function countZone(zone: string): number
	local n = 0
	for _, entry in active do
		if entry.zone == zone then
			n += 1
		end
	end
	return n
end

local function skyPosition(speciesId: string): Vector3
	local species = Driftlings.SPECIES[speciesId]
	-- Een kwart van de gewone Driftlings hangt laag boven de rug: vangbaar zonder te vliegen.
	if species.rarity == "Common" and rng:NextNumber() < 0.25 then
		return Vector3.new(rng:NextNumber(-150, 130), rng:NextNumber(82, 90), rng:NextNumber(-30, 30))
	end
	local h = HEIGHTS[species.rarity] or HEIGHTS.Common
	return Vector3.new(rng:NextNumber(-260, 260), rng:NextNumber(h[1], h[2]), rng:NextNumber(-170, 170))
end

local function spawnMultiplier(): number
	local mult = 1
	if ((tonumber(Workspace:GetAttribute("FeastEndsAt")) or 0)) > serverNow() then
		mult *= Config.FEAST_SPAWN_MULT
	end
	if ((tonumber(Workspace:GetAttribute("SongEndsAt")) or 0)) > serverNow() then
		mult *= Config.SONG_SPAWN_MULT
	end
	return mult
end

local function newPart(name: string, shape: Enum.PartType, size: Vector3, color: Color3, cf: CFrame, material: Enum.Material, parent: Instance): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Shape = shape
	p.Size = size
	p.Color = color
	p.CFrame = cf
	p.Material = material
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

-- Elk nieuw weer drijft er een eiland langs, met betere Driftlings eromheen
-- en een lanceerplatform terug naar de walvis.
local function spawnIsland(biomeId: string)
	if island then
		island:Destroy()
		island = nil
	end
	for id, entry in active do
		if entry.zone == "island" then
			remove(id)
		end
	end

	local side = if rng:NextNumber() < 0.5 then -1 else 1
	local center = Vector3.new(rng:NextNumber(-150, 200), rng:NextNumber(45, 100), side * rng:NextNumber(160, 230))
	local model = Instance.new("Model")
	model.Name = "Island"
	local vertical = CFrame.Angles(0, 0, math.rad(90))
	local base = CFrame.new(center)
	newPart("Grass", Enum.PartType.Cylinder, Vector3.new(4, 48, 48), Color3.fromRGB(106, 168, 92), base * vertical, Enum.Material.Grass, model)
	newPart("Rock", Enum.PartType.Cylinder, Vector3.new(10, 40, 40), Color3.fromRGB(130, 115, 100), base * CFrame.new(0, -7, 0) * vertical, Enum.Material.Slate, model)
	newPart("Rock", Enum.PartType.Cylinder, Vector3.new(10, 26, 26), Color3.fromRGB(115, 100, 88), base * CFrame.new(0, -16, 0) * vertical, Enum.Material.Slate, model)
	newPart("Rock", Enum.PartType.Cylinder, Vector3.new(8, 12, 12), Color3.fromRGB(100, 88, 78), base * CFrame.new(0, -24, 0) * vertical, Enum.Material.Slate, model)
	newPart("Chest", Enum.PartType.Block, Vector3.new(5, 3.5, 3.5), Color3.fromRGB(200, 150, 60), base * CFrame.new(10, 3.75, -6), Enum.Material.Wood, model)
	local pad = newPart("Launchpad", Enum.PartType.Cylinder, Vector3.new(1, 12, 12), Color3.fromRGB(120, 230, 255), base * CFrame.new(-8, 2.4, 6) * vertical, Enum.Material.Neon, model)
	pad.CanCollide = false
	pad:SetAttribute("LaunchVelocity", Config.LAUNCH_VELOCITY * 0.9)
	CollectionService:AddTag(pad, "Launcher")
	model.Parent = Workspace
	island = model

	for _ = 1, Config.ISLAND_COUNT do
		local speciesId = Driftlings.roll(rng, "island", biomeId)
		local a = rng:NextNumber(0, math.pi * 2)
		local r = rng:NextNumber(14, 30)
		local pos = center + Vector3.new(math.cos(a) * r, rng:NextNumber(6, 18), math.sin(a) * r)
		spawnDriftling(speciesId, pos, "island", SkyForecast.SLOT_SECONDS)
	end
end

local function rollMutation(biomeId: string): string?
	local biome = Biomes.get(biomeId)
	if biome.mutation and rng:NextNumber() < biome.chance then
		return biome.mutation
	end
	return nil
end

local function onCatch(player: Player, id: unknown)
	if typeof(id) ~= "string" then
		return
	end
	local entry = active[id]
	if entry == nil then
		return
	end
	local t = os.clock()
	if t - (lastCatch[player] or 0) < 0.1 then
		return
	end
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if root == nil then
		return
	end
	local range = ((tonumber(player:GetAttribute("NetRange")) or 12)) + Config.CATCH_TOLERANCE
	if (root.Position - entry.model:GetPivot().Position).Magnitude > range then
		return
	end
	lastCatch[player] = t
	remove(id)
	local biomeId = SkyForecast.current(serverNow())
	Economy.addDriftling(player, entry.species, rollMutation(biomeId))
end

local function tick()
	local clock = os.clock()
	for id, entry in active do
		if clock > entry.expiresAt then
			remove(id)
		end
	end

	local biomeId = SkyForecast.current(serverNow())
	if biomeId ~= currentBiome then
		currentBiome = biomeId
		spawnIsland(biomeId)
	end

	local players = #Players:GetPlayers()
	local target = math.min(Config.SKY_MAX, Config.SKY_BASE + Config.SKY_PER_PLAYER * players)
	target = math.floor(target * spawnMultiplier())
	local sky = countZone("sky")
	for _ = 1, math.min(3, target - sky) do
		local speciesId = Driftlings.roll(rng, "sky", biomeId)
		spawnDriftling(speciesId, skyPosition(speciesId), "sky", rng:NextNumber(150, 240))
	end

	if countZone("column") < Config.COLUMN_COUNT then
		local speciesId = Driftlings.roll(rng, "sky", biomeId)
		local pos = blowhole.Position + Vector3.new(rng:NextNumber(-5, 5), rng:NextNumber(50, 170), rng:NextNumber(-5, 5))
		spawnDriftling(speciesId, pos, "column", 120)
	end
end

function DriftlingService.start()
	Remotes.Catch.OnServerEvent:Connect(onCatch)
	Players.PlayerRemoving:Connect(function(player)
		lastCatch[player] = nil
	end)
	task.spawn(function()
		while true do
			local ok, err = pcall(function(): any
				tick()
				return nil
			end)
			if not ok then
				warn("[DriftlingService]", err)
			end
			task.wait(1)
		end
	end)
end

return DriftlingService
