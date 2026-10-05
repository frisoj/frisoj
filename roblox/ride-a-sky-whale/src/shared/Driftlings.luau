--!strict
-- Alle Driftling-soorten, hun zeldzaamheid en de kansberekening.

export type Rarity = { id: string, weight: number, islandWeight: number, size: number, color: Color3 }

export type Species = {
	id: string,
	name: string,
	rarity: string,
	rate: number, -- Parels per minuut, zonder mutatie
	color: Color3,
	accent: Color3,
	features: { string },
	zone: string, -- "sky" | "island" | "soon"
	biome: string?, -- alleen in deze lucht
	boostBiome: string?, -- vaker in deze lucht
}

local rgb = Color3.fromRGB

local Driftlings = {}

-- Basiskansen in procenten. Deze cijfers staan ook in de Sky-dex.
Driftlings.RARITIES = {
	{ id = "Common", weight = 60, islandWeight = 30, size = 3.5, color = rgb(200, 205, 215) },
	{ id = "Uncommon", weight = 25, islandWeight = 40, size = 4, color = rgb(110, 210, 140) },
	{ id = "Rare", weight = 10, islandWeight = 20, size = 4.8, color = rgb(110, 170, 255) },
	{ id = "Epic", weight = 4, islandWeight = 8, size = 5.5, color = rgb(190, 130, 255) },
	{ id = "Legendary", weight = 0.9, islandWeight = 1.8, size = 6.5, color = rgb(255, 200, 70) },
	{ id = "Mythic", weight = 0.1, islandWeight = 0.2, size = 8, color = rgb(255, 120, 200) },
} :: { Rarity }

Driftlings.RARITY_BY_ID = {} :: { [string]: Rarity }
for _, r in Driftlings.RARITIES do
	Driftlings.RARITY_BY_ID[r.id] = r
end

Driftlings.ORDER = {
	"NimbusPup",
	"Breezle",
	"Jellyfloat",
	"PuffinPilot",
	"KiteRay",
	"CloudEel",
	"Thunderkoi",
	"Owlbatross",
	"LanternSquid",
	"AuroraMoth",
	"CometNarwhal",
	"Whalelet",
}

Driftlings.SPECIES = {
	NimbusPup = {
		id = "NimbusPup", name = "Nimbus Pup", rarity = "Common", rate = 5,
		color = rgb(240, 245, 255), accent = rgb(170, 200, 235), features = { "ears" }, zone = "sky",
	},
	Breezle = {
		id = "Breezle", name = "Breezle", rarity = "Common", rate = 5,
		color = rgb(170, 225, 255), accent = rgb(255, 255, 255), features = { "wings" }, zone = "sky",
	},
	Jellyfloat = {
		id = "Jellyfloat", name = "Jellyfloat", rarity = "Uncommon", rate = 15,
		color = rgb(255, 165, 220), accent = rgb(255, 120, 200), features = { "tentacles" }, zone = "sky",
		boostBiome = "Starfall",
	},
	PuffinPilot = {
		id = "PuffinPilot", name = "Puffin Pilot", rarity = "Uncommon", rate = 15,
		color = rgb(45, 45, 55), accent = rgb(255, 140, 50), features = { "wings", "beak" }, zone = "island",
	},
	KiteRay = {
		id = "KiteRay", name = "Kite Ray", rarity = "Rare", rate = 50,
		color = rgb(80, 115, 200), accent = rgb(255, 90, 90), features = { "bigwings" }, zone = "sky",
	},
	CloudEel = {
		id = "CloudEel", name = "Cloud Eel", rarity = "Rare", rate = 50,
		color = rgb(200, 230, 240), accent = rgb(120, 170, 200), features = { "fins" }, zone = "soon",
	},
	Thunderkoi = {
		id = "Thunderkoi", name = "Thunderkoi", rarity = "Epic", rate = 200,
		color = rgb(255, 215, 60), accent = rgb(255, 255, 255), features = { "fins" }, zone = "sky",
		biome = "Thunderfront",
	},
	Owlbatross = {
		id = "Owlbatross", name = "Owlbatross", rarity = "Epic", rate = 200,
		color = rgb(185, 150, 110), accent = rgb(250, 240, 220), features = { "bigwings", "ears", "beak" }, zone = "island",
		biome = "GoldenHour",
	},
	LanternSquid = {
		id = "LanternSquid", name = "Lantern Squid", rarity = "Epic", rate = 200,
		color = rgb(255, 170, 90), accent = rgb(255, 230, 150), features = { "tentacles" }, zone = "soon",
	},
	AuroraMoth = {
		id = "AuroraMoth", name = "Aurora Moth", rarity = "Legendary", rate = 1000,
		color = rgb(120, 255, 200), accent = rgb(170, 120, 255), features = { "bigwings", "ears" }, zone = "sky",
		biome = "Aurora",
	},
	CometNarwhal = {
		id = "CometNarwhal", name = "Comet Narwhal", rarity = "Legendary", rate = 1000,
		color = rgb(200, 210, 255), accent = rgb(255, 250, 220), features = { "horn", "fins" }, zone = "sky",
		biome = "Starfall",
	},
	Whalelet = {
		id = "Whalelet", name = "Whalelet", rarity = "Mythic", rate = 10000,
		color = rgb(100, 150, 215), accent = rgb(215, 230, 245), features = { "fluke" }, zone = "sky",
	},
} :: { [string]: Species }

local function eligible(species: Species, rarity: string, zone: string, biome: string): boolean
	if species.rarity ~= rarity or species.zone == "soon" then
		return false
	end
	if species.zone == "island" and zone ~= "island" then
		return false
	end
	return species.biome == nil or species.biome == biome
end

-- Kiest een soort. Bestaat er in deze lucht geen soort van de gerolde
-- zeldzaamheid (bijvoorbeeld Legendarisch buiten Aurora en Starfall), dan
-- schuift de rol één zeldzaamheid omlaag.
function Driftlings.roll(rng: Random, zone: string, biome: string): string
	-- Op eilanden en tijdens de eclips gelden de hogere eilandkansen.
	local boosted = zone == "island" or biome == "Eclipse"
	local total = 0
	for _, r in Driftlings.RARITIES do
		total += if boosted then r.islandWeight else r.weight
	end
	local pick = rng:NextNumber(0, total)
	local index = 1
	for i, r in Driftlings.RARITIES do
		pick -= if boosted then r.islandWeight else r.weight
		if pick <= 0 then
			index = i
			break
		end
	end

	for i = index, 1, -1 do
		local rarity = Driftlings.RARITIES[i].id
		local candidates: { { id: string, w: number } } = {}
		local sum = 0
		for _, id in Driftlings.ORDER do
			local s = Driftlings.SPECIES[id]
			if eligible(s, rarity, zone, biome) then
				local w = 1
				if s.boostBiome == biome then
					w = 3
				end
				if zone == "island" and s.zone == "island" then
					w *= 3
				end
				table.insert(candidates, { id = id, w = w })
				sum += w
			end
		end
		if #candidates > 0 then
			local r = rng:NextNumber(0, sum)
			for _, c in candidates do
				r -= c.w
				if r <= 0 then
					return c.id
				end
			end
			return candidates[#candidates].id
		end
	end
	return "NimbusPup"
end

return Driftlings
