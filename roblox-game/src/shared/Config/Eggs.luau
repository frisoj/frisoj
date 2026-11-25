--!strict
--[[
	Config.Eggs — one egg per zone, bought with coins at that zone's egg stand. `pets` lists what can hatch,
	Common first; the weights are percentages and add up to 100 (the egg panel shows them exactly, with the
	player's luck applied by PetLogic.odds).

	Shape: Eggs.list (in zone order), Eggs.byId[eggId].

	Economy: price = zone.nodeCoins * costCrystals ("this many small crystals of its zone"), so egg prices
	follow Config.Zones when it is retuned.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))
local Zones = require(Shared:WaitForChild("Config"):WaitForChild("Zones"))

type EggDef = Types.EggDef
type EggEntry = Types.EggEntry

-- Hatch chances in percent, by position: Common, Uncommon, Rare, Epic, Legendary (, Mythic).
local WEIGHTS_FIVE = { 50, 30, 15, 4.5, 0.5 }
local WEIGHTS_SIX = { 49.95, 30, 15, 4.5, 0.5, 0.05 }

-- Rounds to two significant digits (whole numbers only): 3840 -> 3800.
local function nice(value: number): number
	if value <= 0 then
		return 0
	end
	local magnitude = math.max(1, 10 ^ math.floor(math.log10(value) - 1))
	return math.floor(value / magnitude + 0.5) * magnitude
end

local function rgb(r: number, g: number, b: number): Color3
	return Color3.fromRGB(r, g, b)
end

type EggSpec = {
	id: string,
	name: string,
	zoneId: string,
	costCrystals: number, -- price in small crystals of its zone
	petIds: { string }, -- Common first; 5 pets (zones 1-4) or 6 pets including a Mythic (zones 5-8)
	color: Color3,
	spotColor: Color3,
}

local SPECS: { EggSpec } = {
	{
		id = "meadow_egg",
		name = "Meadow Egg",
		zoneId = "meadow",
		costCrystals = 25,
		petIds = { "clover_bunny", "daisy_pup", "honey_cat", "meadow_fox", "sun_dragon" },
		color = rgb(170, 230, 120),
		spotColor = rgb(255, 240, 150),
	},
	{
		id = "dunes_egg",
		name = "Dune Egg",
		zoneId = "dunes",
		costCrystals = 36,
		petIds = { "pebble_blob", "cactus_cat", "fennec_scout", "scarab_golem", "mirage_phoenix" },
		color = rgb(240, 200, 120),
		spotColor = rgb(60, 200, 190),
	},
	{
		id = "peaks_egg",
		name = "Frost Egg",
		zoneId = "peaks",
		costCrystals = 115,
		petIds = { "snowball_bunny", "husky_pup", "polar_cub", "frost_owl", "glacier_dragon" },
		color = rgb(200, 235, 255),
		spotColor = rgb(120, 170, 255),
	},
	{
		id = "grove_egg",
		name = "Spore Egg",
		zoneId = "grove",
		costCrystals = 350,
		petIds = { "spore_blob", "toadstool_bear", "glowcap_cat", "moss_golem", "fae_unicorn" },
		color = rgb(255, 100, 120),
		spotColor = rgb(255, 245, 230),
	},
	{
		id = "forge_egg",
		name = "Magma Egg",
		zoneId = "forge",
		costCrystals = 1100,
		petIds = { "ember_pup", "cinder_fox", "lava_blob", "forge_bot", "volcano_dragon", "eternal_phoenix" },
		color = rgb(70, 56, 60),
		spotColor = rgb(255, 120, 30),
	},
	{
		id = "caverns_egg",
		name = "Geode Egg",
		zoneId = "caverns",
		costCrystals = 3700,
		petIds = { "quartz_bunny", "geode_bear", "sapphire_cat", "prism_golem", "diamond_drake", "aurora_unicorn" },
		color = rgb(90, 100, 160),
		spotColor = rgb(120, 240, 255),
	},
	{
		id = "sanctuary_egg",
		name = "Cloud Egg",
		zoneId = "sanctuary",
		costCrystals = 12000,
		petIds = { "cloud_puff", "breeze_bunny", "angel_cat", "gale_falcon", "seraph_unicorn", "celestial_dragon" },
		color = rgb(250, 248, 255),
		spotColor = rgb(255, 215, 110),
	},
	{
		id = "nexus_egg",
		name = "Void Egg",
		zoneId = "nexus",
		costCrystals = 45000,
		petIds = { "shadow_blob", "void_hound", "wisp_ghost", "nebula_bot", "eclipse_dragon", "galaxy_titan" },
		color = rgb(50, 30, 90),
		spotColor = rgb(170, 70, 255),
	},
}

local list: { EggDef } = {}
local byId: { [string]: EggDef } = {}

for _, spec in SPECS do
	local weights = if #spec.petIds == #WEIGHTS_SIX then WEIGHTS_SIX else WEIGHTS_FIVE
	local pets: { EggEntry } = {}
	for index, petId in spec.petIds do
		pets[index] = { petId = petId, weight = weights[index] }
	end

	local zone = Zones.byId[spec.zoneId]
	local egg: EggDef = {
		id = spec.id,
		name = spec.name,
		zoneId = spec.zoneId,
		cost = nice(zone.nodeCoins * spec.costCrystals),
		pets = pets,
		color = spec.color,
		spotColor = spec.spotColor,
	}
	table.insert(list, egg)
	byId[egg.id] = egg
end

return {
	list = list,
	byId = byId,
}
