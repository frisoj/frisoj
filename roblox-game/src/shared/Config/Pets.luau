--!strict
--[[
	Config.Pets — every pet (power = coin bonus: equipped pets add their power to the coin multiplier,
	coinMult = 1 + sum of equipped power) and the three pet tiers reached by fusing.

	Shape: Pets.list (egg by egg, Common first, Exclusive pets last), Pets.byId[petId],
	Pets.tiers[tier] (1 Normal, 2 Golden, 3 Rainbow), Pets.maxTier, Pets.exclusiveIds (never in eggs).

	Economy: egg pets get their power from two knobs, the egg's position and the rarity:
	    power = EGG_BASE_POWER * EGG_POWER_GROWTH ^ (eggOrder - 1) * RARITY_POWER[rarity]
	so a Common of the next egg is as strong as an Uncommon of the previous one. Which pets an egg contains
	(and their odds) is Config.Eggs; the grouping below must match it (tests/unit/Config.spec checks that).
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type PetDef = Types.PetDef
type PetTierDef = Types.PetTierDef
type Rarity = Types.Rarity

---------------------------------------------------------------------------------------------------
-- Economy knobs

local EGG_BASE_POWER = 0.1 -- power of a Common pet from the first egg (+10 % coins)
local EGG_POWER_GROWTH = 1.5 -- power multiplier from one egg to the next

local RARITY_POWER: { [string]: number } = {
	Common = 1,
	Uncommon = 1.5,
	Rare = 2.2,
	Epic = 4,
	Legendary = 9,
	Mythic = 20,
}

-- Model size per rarity (PetVisual.scale); rarer pets are a little bigger.
local RARITY_SCALE: { [string]: number } = {
	Common = 0.9,
	Uncommon = 0.95,
	Rare = 1,
	Epic = 1.1,
	Legendary = 1.25,
	Mythic = 1.4,
	Exclusive = 1.3,
}

local tiers: { PetTierDef } = {
	{ tier = 1, name = "Normal", powerMult = 1 },
	{ tier = 2, name = "Golden", powerMult = 2.5 },
	{ tier = 3, name = "Rainbow", powerMult = 6 },
}

-- Rounds to two significant digits, keeping decimals: 0.3375 -> 0.34, 7.59 -> 7.6, 34.2 -> 34.
local function round2(value: number): number
	if value <= 0 then
		return 0
	end
	local scale = 10 ^ (1 - math.floor(math.log10(value)))
	return math.floor(value * scale + 0.5) / scale
end

local function rgb(r: number, g: number, b: number): Color3
	return Color3.fromRGB(r, g, b)
end

---------------------------------------------------------------------------------------------------
-- Content

type PetSpec = {
	id: string,
	name: string,
	rarity: Rarity,
	archetype: string, -- "blob","cat","dog","bunny","bear","fox","bird","dragon","golem","ghost","unicorn","robot"
	primary: Color3,
	secondary: Color3,
	flying: boolean,
	power: number?, -- only for Exclusive pets; egg pets derive it
}

local function pet(
	id: string,
	name: string,
	rarity: Rarity,
	archetype: string,
	primary: Color3,
	secondary: Color3,
	flying: boolean,
	power: number?
): PetSpec
	return {
		id = id,
		name = name,
		rarity = rarity,
		archetype = archetype,
		primary = primary,
		secondary = secondary,
		flying = flying,
		power = power,
	}
end

-- One group per egg, in egg (= zone) order.
local EGG_GROUPS: { { PetSpec } } = {
	-- 1: Meadow Egg
	{
		pet("clover_bunny", "Clover Bunny", "Common", "bunny", rgb(245, 245, 240), rgb(110, 200, 110), false),
		pet("daisy_pup", "Daisy Pup", "Uncommon", "dog", rgb(255, 236, 150), rgb(255, 255, 255), false),
		pet("honey_cat", "Honey Cat", "Rare", "cat", rgb(255, 184, 60), rgb(120, 72, 30), false),
		pet("meadow_fox", "Meadow Fox", "Epic", "fox", rgb(240, 130, 60), rgb(120, 210, 120), false),
		pet("sun_dragon", "Sun Dragon", "Legendary", "dragon", rgb(255, 200, 50), rgb(255, 110, 50), true),
	},
	-- 2: Dune Egg
	{
		pet("pebble_blob", "Pebble Blob", "Common", "blob", rgb(214, 180, 130), rgb(150, 120, 90), false),
		pet("cactus_cat", "Cactus Cat", "Uncommon", "cat", rgb(90, 180, 110), rgb(255, 130, 170), false),
		pet("fennec_scout", "Fennec Scout", "Rare", "fox", rgb(245, 214, 160), rgb(255, 250, 235), false),
		pet("scarab_golem", "Scarab Golem", "Epic", "golem", rgb(40, 170, 160), rgb(255, 196, 60), false),
		pet("mirage_phoenix", "Mirage Phoenix", "Legendary", "bird", rgb(255, 140, 60), rgb(60, 220, 210), true),
	},
	-- 3: Frost Egg
	{
		pet("snowball_bunny", "Snowball Bunny", "Common", "bunny", rgb(240, 248, 255), rgb(160, 210, 255), false),
		pet("husky_pup", "Husky Pup", "Uncommon", "dog", rgb(150, 165, 190), rgb(245, 250, 255), false),
		pet("polar_cub", "Polar Cub", "Rare", "bear", rgb(250, 250, 255), rgb(120, 190, 255), false),
		pet("frost_owl", "Frost Owl", "Epic", "bird", rgb(190, 225, 255), rgb(110, 130, 220), true),
		pet("glacier_dragon", "Glacier Dragon", "Legendary", "dragon", rgb(120, 210, 255), rgb(230, 245, 255), true),
	},
	-- 4: Spore Egg
	{
		pet("spore_blob", "Spore Blob", "Common", "blob", rgb(190, 120, 230), rgb(130, 240, 220), false),
		pet("toadstool_bear", "Toadstool Bear", "Uncommon", "bear", rgb(255, 100, 110), rgb(255, 245, 230), false),
		pet("glowcap_cat", "Glowcap Cat", "Rare", "cat", rgb(70, 60, 120), rgb(120, 255, 200), false),
		pet("moss_golem", "Moss Golem", "Epic", "golem", rgb(90, 150, 90), rgb(150, 110, 80), false),
		pet("fae_unicorn", "Fae Unicorn", "Legendary", "unicorn", rgb(255, 190, 235), rgb(150, 255, 220), true),
	},
	-- 5: Magma Egg
	{
		pet("ember_pup", "Ember Pup", "Common", "dog", rgb(230, 90, 50), rgb(60, 50, 50), false),
		pet("cinder_fox", "Cinder Fox", "Uncommon", "fox", rgb(80, 70, 75), rgb(255, 140, 40), false),
		pet("lava_blob", "Lava Blob", "Rare", "blob", rgb(255, 120, 30), rgb(255, 220, 80), false),
		pet("forge_bot", "Forge Bot", "Epic", "robot", rgb(110, 110, 125), rgb(255, 110, 30), false),
		pet("volcano_dragon", "Volcano Dragon", "Legendary", "dragon", rgb(190, 40, 40), rgb(255, 170, 40), true),
		pet("eternal_phoenix", "Eternal Phoenix", "Mythic", "bird", rgb(255, 80, 40), rgb(255, 230, 100), true),
	},
	-- 6: Geode Egg
	{
		pet("quartz_bunny", "Quartz Bunny", "Common", "bunny", rgb(235, 225, 250), rgb(255, 170, 220), false),
		pet("geode_bear", "Geode Bear", "Uncommon", "bear", rgb(110, 100, 130), rgb(170, 110, 255), false),
		pet("sapphire_cat", "Sapphire Cat", "Rare", "cat", rgb(60, 110, 230), rgb(150, 220, 255), false),
		pet("prism_golem", "Prism Golem", "Epic", "golem", rgb(120, 240, 255), rgb(255, 130, 230), false),
		pet("diamond_drake", "Diamond Drake", "Legendary", "dragon", rgb(190, 245, 255), rgb(120, 170, 255), true),
		pet("aurora_unicorn", "Aurora Unicorn", "Mythic", "unicorn", rgb(150, 255, 210), rgb(190, 120, 255), true),
	},
	-- 7: Cloud Egg
	{
		pet("cloud_puff", "Cloud Puff", "Common", "blob", rgb(250, 250, 255), rgb(180, 215, 255), true),
		pet("breeze_bunny", "Breeze Bunny", "Uncommon", "bunny", rgb(200, 235, 255), rgb(255, 255, 255), false),
		pet("angel_cat", "Angel Cat", "Rare", "cat", rgb(255, 250, 235), rgb(255, 215, 110), true),
		pet("gale_falcon", "Gale Falcon", "Epic", "bird", rgb(120, 170, 235), rgb(250, 246, 235), true),
		pet("seraph_unicorn", "Seraph Unicorn", "Legendary", "unicorn", rgb(255, 255, 250), rgb(255, 205, 90), true),
		pet("celestial_dragon", "Celestial Dragon", "Mythic", "dragon", rgb(255, 225, 140), rgb(150, 205, 255), true),
	},
	-- 8: Void Egg
	{
		pet("shadow_blob", "Shadow Blob", "Common", "blob", rgb(50, 40, 80), rgb(170, 70, 255), false),
		pet("void_hound", "Void Hound", "Uncommon", "dog", rgb(40, 30, 70), rgb(60, 255, 220), false),
		pet("wisp_ghost", "Wisp Ghost", "Rare", "ghost", rgb(190, 160, 255), rgb(70, 255, 225), true),
		pet("nebula_bot", "Nebula Bot", "Epic", "robot", rgb(90, 70, 170), rgb(255, 70, 170), false),
		pet("eclipse_dragon", "Eclipse Dragon", "Legendary", "dragon", rgb(30, 20, 50), rgb(255, 150, 50), true),
		pet("galaxy_titan", "Galaxy Titan", "Mythic", "golem", rgb(70, 50, 140), rgb(120, 220, 255), false),
	},
}

-- Exclusive pets are granted directly (starter pack, VIP pass, direct purchase) and never come from eggs.
-- Their power is fixed: roughly an Epic of egg 3, a Legendary of egg 4-5 and a Legendary of egg 7.
local EXCLUSIVES: { PetSpec } = {
	pet("starter_fox", "Sparkle Fox", "Exclusive", "fox", rgb(255, 150, 60), rgb(255, 240, 120), false, 0.8),
	pet("vip_unicorn", "Crown Unicorn", "Exclusive", "unicorn", rgb(255, 245, 250), rgb(255, 205, 60), true, 3.5),
	pet("royal_dragon", "Royal Dragon", "Exclusive", "dragon", rgb(140, 50, 200), rgb(255, 205, 60), true, 10),
}

---------------------------------------------------------------------------------------------------
-- Derivation

local list: { PetDef } = {}
local byId: { [string]: PetDef } = {}

local function add(spec: PetSpec, power: number)
	local def: PetDef = {
		id = spec.id,
		name = spec.name,
		rarity = spec.rarity,
		power = power,
		visual = {
			archetype = spec.archetype,
			primary = spec.primary,
			secondary = spec.secondary,
			flying = spec.flying,
			scale = RARITY_SCALE[spec.rarity] or 1,
		},
	}
	table.insert(list, def)
	byId[def.id] = def
end

for eggOrder, group in EGG_GROUPS do
	local eggPower = EGG_BASE_POWER * EGG_POWER_GROWTH ^ (eggOrder - 1)
	for _, spec in group do
		add(spec, round2(eggPower * (RARITY_POWER[spec.rarity] or 1)))
	end
end

local exclusiveIds: { string } = {}
for _, spec in EXCLUSIVES do
	add(spec, spec.power or 1)
	table.insert(exclusiveIds, spec.id)
end

return {
	list = list,
	byId = byId,
	tiers = tiers,
	maxTier = #tiers,
	exclusiveIds = exclusiveIds,
}
