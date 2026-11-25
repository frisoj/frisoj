--!strict
--[[
	Config.Hammers — the 20 hammers, weakest to strongest. Each needs its zone (`zoneOrder`) unlocked and coins.

	Shape: Hammers.list (ordered by `order`), Hammers.byId[hammerId], Hammers.starterId (free, owned by default).

	Economy: every hammer is described relative to the zone it is sold for:
	  hits          hits it needs to break a SMALL crystal of that zone  -> damage = zone.nodeHealth / hits
	  costCrystals  its price in small crystals of that zone             -> cost = zone.nodeCoins * costCrystals
	so hammers follow automatically when Config.Zones is retuned. Damage grows about x2.2 per step in zones 1-4
	(three hammers each: 4.8 -> 2.2 -> 1 hits) and about x3 per step in zones 5-8 (two hammers each: 3.8 -> 1.27
	hits). The best hammer of the previous zone needs about 10 hits on arrival, so the first hammer of a zone
	is priced to come quickly. Keep the `hits` ratios in step with the zones' healthGrowth or the steps drift.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))
local Zones = require(Shared:WaitForChild("Config"):WaitForChild("Zones"))

type HammerDef = Types.HammerDef
type HammerVisual = Types.HammerVisual

-- Rounds to two significant digits (whole numbers only): 5882 -> 5900.
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
-- Economy knobs: hammer(id, name, zoneOrder, hits, costCrystals), weakest first

type HammerSpec = {
	id: string,
	name: string,
	zoneOrder: number,
	hits: number, -- hits to break a small crystal of its zone
	costCrystals: number, -- price in small crystals of its zone (0 = free)
}

local function hammer(id: string, name: string, zoneOrder: number, hits: number, costCrystals: number): HammerSpec
	return { id = id, name = name, zoneOrder = zoneOrder, hits = hits, costCrystals = costCrystals }
end

local SPECS: { HammerSpec } = {
	-- Zone 1: Sunny Meadow
	hammer("wood", "Wooden Mallet", 1, 4.8, 0),
	hammer("stone", "Stone Hammer", 1, 2.2, 18),
	hammer("iron", "Iron Hammer", 1, 1, 110),
	-- Zone 2: Sandy Dunes
	hammer("bronze", "Bronze Basher", 2, 4.8, 27),
	hammer("sandstone", "Sandstone Smasher", 2, 2.2, 90),
	hammer("gold", "Golden Gavel", 2, 1, 225),
	-- Zone 3: Frost Peaks
	hammer("steel", "Steel Sledge", 3, 4.8, 94),
	hammer("frost", "Frostbite Hammer", 3, 2.2, 285),
	hammer("glacier", "Glacier Crusher", 3, 1, 700),
	-- Zone 4: Mushroom Grove
	hammer("spore", "Sporecap Mallet", 4, 4.8, 260),
	hammer("emerald", "Emerald Thumper", 4, 2.2, 870),
	hammer("amethyst", "Amethyst Maul", 4, 1, 2100),
	-- Zone 5: Lava Forge
	hammer("obsidian", "Obsidian Breaker", 5, 3.8, 1100),
	hammer("magma", "Magma Maul", 5, 1.27, 5500),
	-- Zone 6: Crystal Caverns
	hammer("diamond", "Diamond Pulverizer", 6, 3.8, 3700),
	hammer("prism", "Prism Pounder", 6, 1.27, 18500),
	-- Zone 7: Sky Sanctuary
	hammer("thunder", "Thunder Striker", 7, 3.8, 12000),
	hammer("celestial", "Celestial Hammer", 7, 1.27, 58000),
	-- Zone 8: Void Nexus
	hammer("nebula", "Nebula Crusher", 8, 3.8, 45000),
	hammer("void", "Void Worldbreaker", 8, 1.27, 225000),
}

---------------------------------------------------------------------------------------------------
-- Looks: look(headColor, handleColor, material, shape, scale, glow). Bigger and shinier with every step.

local function look(
	headColor: Color3,
	handleColor: Color3,
	material: Enum.Material,
	shape: "block" | "cylinder" | "spike" | "crystal",
	scale: number,
	glow: boolean
): HammerVisual
	return {
		headColor = headColor,
		handleColor = handleColor,
		material = material,
		shape = shape,
		scale = scale,
		glow = glow,
	}
end

local Material = Enum.Material

local VISUALS: { [string]: HammerVisual } = {
	wood = look(rgb(176, 124, 80), rgb(120, 84, 56), Material.Wood, "block", 1, false),
	stone = look(rgb(140, 144, 150), rgb(120, 84, 56), Material.Slate, "block", 1.05, false),
	iron = look(rgb(190, 196, 206), rgb(92, 66, 48), Material.Metal, "block", 1.1, false),
	bronze = look(rgb(205, 127, 50), rgb(92, 60, 40), Material.Metal, "cylinder", 1.15, false),
	sandstone = look(rgb(226, 186, 120), rgb(150, 96, 60), Material.Sandstone, "block", 1.2, false),
	gold = look(rgb(255, 205, 60), rgb(120, 60, 40), Material.Foil, "cylinder", 1.25, false),
	steel = look(rgb(120, 134, 156), rgb(60, 64, 76), Material.DiamondPlate, "block", 1.3, false),
	frost = look(rgb(150, 220, 255), rgb(70, 110, 160), Material.Ice, "spike", 1.35, true),
	glacier = look(rgb(200, 240, 255), rgb(60, 90, 150), Material.Glacier, "crystal", 1.4, true),
	spore = look(rgb(255, 92, 122), rgb(230, 220, 200), Material.SmoothPlastic, "cylinder", 1.45, false),
	emerald = look(rgb(60, 220, 130), rgb(80, 56, 110), Material.Glass, "crystal", 1.5, true),
	amethyst = look(rgb(180, 100, 255), rgb(60, 44, 96), Material.Glass, "spike", 1.55, true),
	obsidian = look(rgb(36, 30, 44), rgb(255, 110, 30), Material.Basalt, "block", 1.6, false),
	magma = look(rgb(255, 110, 30), rgb(50, 40, 44), Material.CrackedLava, "spike", 1.65, true),
	diamond = look(rgb(150, 240, 255), rgb(220, 230, 255), Material.Glass, "crystal", 1.7, true),
	prism = look(rgb(255, 130, 230), rgb(90, 230, 255), Material.Neon, "crystal", 1.75, true),
	thunder = look(rgb(255, 230, 90), rgb(90, 110, 180), Material.Neon, "cylinder", 1.8, true),
	celestial = look(rgb(250, 246, 235), rgb(255, 215, 110), Material.Marble, "block", 1.85, true),
	nebula = look(rgb(120, 80, 255), rgb(40, 30, 80), Material.Neon, "spike", 1.9, true),
	void = look(rgb(170, 70, 255), rgb(20, 14, 40), Material.Neon, "crystal", 2, true),
}

---------------------------------------------------------------------------------------------------
-- Derivation

local list: { HammerDef } = {}
local byId: { [string]: HammerDef } = {}

for order, spec in SPECS do
	local zone = Zones.list[spec.zoneOrder]
	local def: HammerDef = {
		id = spec.id,
		order = order,
		name = spec.name,
		zoneOrder = spec.zoneOrder,
		cost = nice(zone.nodeCoins * spec.costCrystals),
		damage = nice(zone.nodeHealth / spec.hits),
		visual = VISUALS[spec.id],
	}
	list[order] = def
	byId[def.id] = def
end

return {
	list = list,
	byId = byId,
	starterId = list[1].id,
}
