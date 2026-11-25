--!strict
--[[
	Config.Zones — the eight floating islands in unlock order: requirements, crystal stats and the visual theme
	the world builder and the ambience controller read.

	Shape: Zones.list (ordered by `order`), Zones.byId[zoneId], Zones.firstId (the hub zone everybody owns).

	Economy: crystal stats are not typed in by hand. Each zone multiplies the previous zone's small-crystal
	health / coins / XP by a growth factor, and its unlock price is "this many small crystals of the previous
	zone" (before multipliers). Hammers and Eggs derive their damage and prices from the same zone numbers, so
	retuning a growth factor here keeps the whole economy consistent.

	First-pass pacing these numbers were chosen for (greedy free player, see spec §10): zone 2 after about
	5 min, zone 3 at 15 min, zone 4 at 35 min, zone 5 at 75 min, zone 6 at 2.5 h, zone 7 at 5 h, zone 8 at 9 h,
	with the level requirement met shortly after the coins are there. XP grows much slower than health from
	zone 3 on because the level curve (Config.Game.xp*) is what stretches the later zones.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type ZoneDef = Types.ZoneDef
type ZoneTheme = Types.ZoneTheme

---------------------------------------------------------------------------------------------------
-- Economy knobs

local BASE_HEALTH = 24 -- health of a small crystal in zone 1 (the starter hammer breaks it in 5 hits)
local BASE_COINS = 10 -- coins for fully smashing a small crystal in zone 1
local BASE_XP = 5 -- XP for fully smashing a small crystal in zone 1

type Economy = {
	levelReq: number, -- level needed to unlock the zone
	healthGrowth: number, -- small-crystal health relative to the previous zone (= product of its hammer steps)
	coinGrowth: number, -- small-crystal coins relative to the previous zone
	xpGrowth: number, -- small-crystal XP relative to the previous zone
	unlockCrystals: number, -- unlock price, in small crystals of the PREVIOUS zone (0 = free)
	nodeCount: number, -- crystals alive on the island
}

local function economy(
	levelReq: number,
	healthGrowth: number,
	coinGrowth: number,
	xpGrowth: number,
	unlockCrystals: number,
	nodeCount: number
): Economy
	return {
		levelReq = levelReq,
		healthGrowth = healthGrowth,
		coinGrowth = coinGrowth,
		xpGrowth = xpGrowth,
		unlockCrystals = unlockCrystals,
		nodeCount = nodeCount,
	}
end

-- One row per zone: economy(levelReq, healthGrowth, coinGrowth, xpGrowth, unlockCrystals, nodeCount).
-- Health grows x11 into a zone that sells three hammers and x9 into one that sells two (Config.Hammers).
-- Coins grow slower than health, so each zone pays less per point of damage and stronger hammers stay needed.
local ECONOMY: { [string]: Economy } = {
	meadow = economy(1, 1, 1, 1, 0, 30),
	dunes = economy(5, 11, 8, 13.5, 300, 30),
	peaks = economy(12, 11, 8, 3.2, 750, 30),
	grove = economy(20, 11, 8, 2.9, 2350, 30),
	forge = economy(30, 9, 7, 3.2, 7400, 28),
	caverns = economy(42, 9, 7, 2.5, 21000, 28),
	sanctuary = economy(55, 9, 7, 3.2, 90000, 26),
	nexus = economy(70, 9, 7, 2.8, 300000, 26),
}

-- Rounds to two significant digits (whole numbers only) so prices and stats read nicely: 19965 -> 20000.
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

---------------------------------------------------------------------------------------------------
-- Content

type ZoneSpec = {
	id: string,
	name: string,
	description: string,
	icon: string,
	eggId: string,
	theme: ZoneTheme,
}

local SPECS: { ZoneSpec } = {
	{
		id = "meadow",
		name = "Sunny Meadow",
		description = "Rolling green hills where every smasher begins.",
		icon = "🌼",
		eggId = "meadow_egg",
		theme = {
			decor = "meadow",
			ground = rgb(104, 189, 82),
			groundMaterial = Enum.Material.Grass,
			cliff = rgb(132, 96, 68),
			accent = rgb(255, 213, 79),
			accent2 = rgb(255, 138, 174),
			crystalColors = { rgb(93, 211, 255), rgb(120, 255, 190), rgb(255, 150, 220) },
			fogColor = rgb(198, 232, 255),
			ambient = rgb(128, 136, 150),
			outdoorAmbient = rgb(150, 160, 170),
			brightness = 2.6,
			clockTime = 13.5,
			fogDensity = 0.25,
		},
	},
	{
		id = "dunes",
		name = "Sandy Dunes",
		description = "Sun-baked sands hiding amber and turquoise treasures.",
		icon = "🏜️",
		eggId = "dunes_egg",
		theme = {
			decor = "desert",
			ground = rgb(237, 201, 128),
			groundMaterial = Enum.Material.Sand,
			cliff = rgb(196, 136, 84),
			accent = rgb(64, 168, 110),
			accent2 = rgb(255, 122, 69),
			crystalColors = { rgb(255, 176, 46), rgb(48, 214, 200), rgb(255, 107, 107) },
			fogColor = rgb(255, 226, 178),
			ambient = rgb(150, 132, 110),
			outdoorAmbient = rgb(176, 158, 132),
			brightness = 3,
			clockTime = 15.5,
			fogDensity = 0.3,
		},
	},
	{
		id = "peaks",
		name = "Frost Peaks",
		description = "Snowy summits where ice crystals sparkle in the cold.",
		icon = "❄️",
		eggId = "peaks_egg",
		theme = {
			decor = "snow",
			ground = rgb(236, 244, 255),
			groundMaterial = Enum.Material.Snow,
			cliff = rgb(140, 170, 205),
			accent = rgb(150, 220, 255),
			accent2 = rgb(52, 110, 120),
			crystalColors = { rgb(140, 220, 255), rgb(190, 170, 255), rgb(240, 250, 255) },
			fogColor = rgb(214, 232, 250),
			ambient = rgb(134, 150, 176),
			outdoorAmbient = rgb(156, 172, 196),
			brightness = 2.2,
			clockTime = 10,
			fogDensity = 0.35,
		},
	},
	{
		id = "grove",
		name = "Mushroom Grove",
		description = "A twilight forest of giant glowing mushrooms.",
		icon = "🍄",
		eggId = "grove_egg",
		theme = {
			decor = "mushroom",
			ground = rgb(66, 134, 116),
			groundMaterial = Enum.Material.LeafyGrass,
			cliff = rgb(74, 52, 96),
			accent = rgb(255, 92, 122),
			accent2 = rgb(130, 240, 220),
			crystalColors = { rgb(190, 110, 255), rgb(110, 255, 200), rgb(255, 120, 190) },
			fogColor = rgb(120, 90, 160),
			ambient = rgb(104, 88, 138),
			outdoorAmbient = rgb(112, 100, 150),
			brightness = 1.6,
			clockTime = 18.3,
			fogDensity = 0.42,
		},
	},
	{
		id = "forge",
		name = "Lava Forge",
		description = "A smouldering volcano island veined with molten rock.",
		icon = "🌋",
		eggId = "forge_egg",
		theme = {
			decor = "lava",
			ground = rgb(62, 52, 56),
			groundMaterial = Enum.Material.Basalt,
			cliff = rgb(40, 32, 36),
			accent = rgb(255, 110, 30),
			accent2 = rgb(255, 208, 70),
			crystalColors = { rgb(255, 90, 40), rgb(255, 190, 50), rgb(255, 60, 110) },
			fogColor = rgb(120, 50, 30),
			ambient = rgb(120, 78, 66),
			outdoorAmbient = rgb(132, 90, 76),
			brightness = 1.5,
			clockTime = 19.2,
			fogDensity = 0.45,
		},
	},
	{
		id = "caverns",
		name = "Crystal Caverns",
		description = "Deep blue caves glittering with gems on every wall.",
		icon = "💎",
		eggId = "caverns_egg",
		theme = {
			decor = "cavern",
			ground = rgb(52, 60, 92),
			groundMaterial = Enum.Material.Slate,
			cliff = rgb(36, 40, 66),
			accent = rgb(90, 230, 255),
			accent2 = rgb(200, 120, 255),
			crystalColors = { rgb(80, 240, 255), rgb(170, 110, 255), rgb(255, 110, 230), rgb(120, 255, 170) },
			fogColor = rgb(30, 40, 80),
			ambient = rgb(84, 96, 150),
			outdoorAmbient = rgb(90, 104, 160),
			brightness = 1.2,
			clockTime = 0.5,
			fogDensity = 0.5,
		},
	},
	{
		id = "sanctuary",
		name = "Sky Sanctuary",
		description = "Marble temples drifting above a golden sea of clouds.",
		icon = "☁️",
		eggId = "sanctuary_egg",
		theme = {
			decor = "sky",
			ground = rgb(250, 246, 235),
			groundMaterial = Enum.Material.Marble,
			cliff = rgb(214, 200, 240),
			accent = rgb(255, 215, 110),
			accent2 = rgb(150, 205, 255),
			crystalColors = { rgb(255, 225, 120), rgb(160, 220, 255), rgb(255, 170, 210) },
			fogColor = rgb(190, 225, 255),
			ambient = rgb(150, 150, 170),
			outdoorAmbient = rgb(178, 176, 190),
			brightness = 3,
			clockTime = 7.4,
			fogDensity = 0.2,
		},
	},
	{
		id = "nexus",
		name = "Void Nexus",
		description = "The edge of everything, where starlight turns to crystal.",
		icon = "🌌",
		eggId = "nexus_egg",
		theme = {
			decor = "void",
			ground = rgb(30, 24, 52),
			groundMaterial = Enum.Material.Basalt,
			cliff = rgb(16, 12, 30),
			accent = rgb(170, 70, 255),
			accent2 = rgb(60, 255, 220),
			crystalColors = { rgb(190, 80, 255), rgb(70, 255, 225), rgb(255, 70, 170), rgb(90, 120, 255) },
			fogColor = rgb(20, 10, 40),
			ambient = rgb(92, 70, 140),
			outdoorAmbient = rgb(100, 80, 150),
			brightness = 1,
			clockTime = 0,
			fogDensity = 0.55,
		},
	},
}

---------------------------------------------------------------------------------------------------
-- Derivation

local list: { ZoneDef } = {}
local byId: { [string]: ZoneDef } = {}

-- Raw (unrounded) running products, so one changed growth factor shifts every later zone consistently.
local health, coins, xp = BASE_HEALTH, BASE_COINS, BASE_XP
local previousCoins = 0

for order, spec in SPECS do
	local knobs = ECONOMY[spec.id]
	health *= knobs.healthGrowth
	coins *= knobs.coinGrowth
	xp *= knobs.xpGrowth

	local zone: ZoneDef = {
		id = spec.id,
		order = order,
		name = spec.name,
		description = spec.description,
		icon = spec.icon,
		levelReq = knobs.levelReq,
		cost = nice(previousCoins * knobs.unlockCrystals),
		nodeHealth = nice(health),
		nodeCoins = nice(coins),
		nodeXP = nice(xp),
		nodeCount = knobs.nodeCount,
		eggId = spec.eggId,
		theme = spec.theme,
	}
	previousCoins = zone.nodeCoins

	list[order] = zone
	byId[zone.id] = zone
end

return {
	list = list,
	byId = byId,
	firstId = list[1].id,
}
