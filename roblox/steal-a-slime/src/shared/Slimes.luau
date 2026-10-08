--!strict
-- Alle slijmsoorten, zeldzaamheden, mutaties en fusies, plus de kansberekening.
-- Puur rekenwerk zonder Roblox-functies, zodat de tests het ook buiten Roblox kunnen draaien.
-- Kleuren zijn { r, g, b } (0-255); de client maakt er Color3 van.

export type RGB = { number }
export type Rarity = { id: string, weight: number, color: RGB, size: number, order: number }
export type Species = {
	id: string,
	name: string,
	rarity: string,
	income: number, -- Goo per seconde
	price: number,
	share: number, -- aandeel binnen de zeldzaamheid
	color: RGB,
	accent: RGB,
	style: string, -- welk accessoire de client tekent
}
export type Mutation = { id: string, name: string, mult: number, weight: number, color: RGB, storm: string }
export type Slime = { s: string, m: string?, f: number }
export type Odds = { { id: string, chance: number } }

local Slimes = {}

Slimes.RARITY_ORDER = { "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic", "Godly", "Secret" }

Slimes.RARITIES = {
	Common = { id = "Common", weight = 52, color = { 205, 214, 224 }, size = 4.4, order = 1 },
	Uncommon = { id = "Uncommon", weight = 26, color = { 110, 225, 130 }, size = 4.7, order = 2 },
	Rare = { id = "Rare", weight = 13, color = { 90, 170, 255 }, size = 5.1, order = 3 },
	Epic = { id = "Epic", weight = 6, color = { 190, 110, 255 }, size = 5.5, order = 4 },
	Legendary = { id = "Legendary", weight = 2.4, color = { 255, 196, 60 }, size = 6, order = 5 },
	Mythic = { id = "Mythic", weight = 0.5, color = { 255, 90, 160 }, size = 6.5, order = 6 },
	Godly = { id = "Godly", weight = 0.09, color = { 255, 240, 140 }, size = 7.3, order = 7 },
	Secret = { id = "Secret", weight = 0.01, color = { 40, 20, 60 }, size = 7.8, order = 8 },
} :: { [string]: Rarity }

local function sp(id: string, name: string, rarity: string, income: number, price: number, share: number, color: RGB, accent: RGB, style: string): Species
	return { id = id, name = name, rarity = rarity, income = income, price = price, share = share, color = color, accent = accent, style = style }
end

Slimes.LIST = {
	sp("Gloop", "Gloop", "Common", 1, 12, 5, { 120, 220, 120 }, { 70, 170, 80 }, "plain"),
	sp("Bubbles", "Bubbles", "Common", 2, 28, 3, { 120, 200, 255 }, { 220, 245, 255 }, "bubbles"),
	sp("Mossy", "Mossy", "Common", 3, 45, 2, { 150, 190, 90 }, { 80, 130, 50 }, "moss"),
	sp("Jellybean", "Jellybean", "Uncommon", 6, 140, 5, { 255, 120, 170 }, { 255, 210, 230 }, "bean"),
	sp("PuddlePup", "Puddle Pup", "Uncommon", 9, 230, 3, { 255, 200, 120 }, { 160, 100, 60 }, "pup"),
	sp("Sprout", "Sprout", "Uncommon", 13, 360, 2, { 170, 235, 110 }, { 60, 160, 60 }, "sprout"),
	sp("Bouncer", "Bouncer", "Rare", 28, 1100, 5, { 255, 150, 60 }, { 255, 230, 80 }, "spring"),
	sp("Frosty", "Frosty", "Rare", 42, 1900, 3, { 190, 235, 255 }, { 90, 170, 230 }, "frost"),
	sp("Sparky", "Sparky", "Rare", 65, 3200, 2, { 255, 235, 80 }, { 255, 160, 30 }, "spark"),
	sp("Ninja", "Ninja Goo", "Epic", 140, 11000, 5, { 70, 70, 90 }, { 230, 50, 60 }, "ninja"),
	sp("Pirate", "Pirate Goo", "Epic", 210, 18000, 3, { 80, 170, 200 }, { 40, 40, 50 }, "pirate"),
	sp("LavaLump", "Lava Lump", "Epic", 320, 30000, 2, { 120, 50, 40 }, { 255, 120, 30 }, "lava"),
	sp("KingGloop", "King Gloop", "Legendary", 800, 110000, 5, { 90, 220, 110 }, { 255, 205, 60 }, "king"),
	sp("Unicorn", "Unicorn Goo", "Legendary", 1250, 190000, 3, { 250, 230, 255 }, { 255, 140, 220 }, "unicorn"),
	sp("DragonDrip", "Dragon Drip", "Legendary", 2000, 340000, 2, { 230, 70, 70 }, { 255, 200, 80 }, "dragon"),
	sp("GalaxyGel", "Galaxy Gel", "Mythic", 6000, 1400000, 5, { 60, 40, 140 }, { 150, 220, 255 }, "galaxy"),
	sp("CyberSlime", "Cyber Slime", "Mythic", 9500, 2400000, 3, { 40, 50, 70 }, { 0, 255, 230 }, "cyber"),
	sp("PhoenixPuff", "Phoenix Puff", "Mythic", 15000, 4200000, 2, { 255, 110, 40 }, { 255, 230, 90 }, "phoenix"),
	sp("SlimeGod", "Slime God", "Godly", 60000, 25000000, 3, { 255, 250, 220 }, { 255, 215, 90 }, "god"),
	sp("GooKraken", "Goo Kraken", "Godly", 100000, 48000000, 2, { 140, 60, 200 }, { 255, 120, 200 }, "kraken"),
	sp("VoidBlob", "Void Blob", "Secret", 450000, 300000000, 3, { 20, 10, 30 }, { 190, 80, 255 }, "void"),
	sp("RainbowRoyale", "Rainbow Royale", "Secret", 800000, 600000000, 2, { 255, 120, 120 }, { 255, 230, 120 }, "rainbow"),
} :: { Species }

Slimes.BY_ID = {} :: { [string]: Species }
Slimes.BY_RARITY = {} :: { [string]: { Species } }
for _, s in Slimes.LIST do
	Slimes.BY_ID[s.id] = s
	local list = Slimes.BY_RARITY[s.rarity] or {}
	table.insert(list, s)
	Slimes.BY_RARITY[s.rarity] = list
end

Slimes.MUTATION_ORDER = { "Gold", "Diamond", "Candy", "Lava", "Galaxy", "Rainbow" }
Slimes.MUTATIONS = {
	Gold = { id = "Gold", name = "Gold", mult = 2, weight = 40, color = { 255, 205, 50 }, storm = "Gold Rush" },
	Diamond = { id = "Diamond", name = "Diamond", mult = 3, weight = 25, color = { 150, 235, 255 }, storm = "Diamond Hail" },
	Candy = { id = "Candy", name = "Candy", mult = 4, weight = 16, color = { 255, 120, 200 }, storm = "Candy Storm" },
	Lava = { id = "Lava", name = "Lava", mult = 6, weight = 10, color = { 255, 100, 30 }, storm = "Lava Rain" },
	Galaxy = { id = "Galaxy", name = "Galaxy", mult = 10, weight = 6, color = { 140, 90, 255 }, storm = "Starfall" },
	Rainbow = { id = "Rainbow", name = "Rainbow", mult = 15, weight = 3, color = { 255, 255, 255 }, storm = "Rainbow Surge" },
} :: { [string]: Mutation }

Slimes.FUSE_NAMES = { [0] = "", [1] = "Giant", [2] = "Titan" } :: { [number]: string }
Slimes.FUSE_MULT = { [0] = 1, [1] = 4, [2] = 16 } :: { [number]: number }
Slimes.FUSE_SIZE = { [0] = 1, [1] = 1.45, [2] = 1.95 } :: { [number]: number }
Slimes.MAX_FUSE = 2

function Slimes.mutationMult(m: string?): number
	if m then
		local mut = Slimes.MUTATIONS[m]
		if mut then
			return mut.mult
		end
	end
	return 1
end

function Slimes.income(slime: Slime): number
	local species = Slimes.BY_ID[slime.s]
	if not species then
		return 0
	end
	return species.income * Slimes.mutationMult(slime.m) * (Slimes.FUSE_MULT[slime.f] or 1)
end

-- Prijs op de rivier: duurder met een mutatie.
function Slimes.price(slime: Slime): number
	local species = Slimes.BY_ID[slime.s]
	if not species then
		return math.huge
	end
	return species.price * Slimes.mutationMult(slime.m) * (Slimes.FUSE_MULT[slime.f] or 1)
end

function Slimes.displayName(slime: Slime): string
	local species = Slimes.BY_ID[slime.s]
	local name = if species then species.name else slime.s
	local fuse = Slimes.FUSE_NAMES[slime.f] or ""
	if fuse ~= "" then
		name = fuse .. " " .. name
	end
	if slime.m then
		name = slime.m .. " " .. name
	end
	return name
end

function Slimes.rarityOrder(rarity: string): number
	local r = Slimes.RARITIES[rarity]
	return if r then r.order else 0
end

-- Kansen per zeldzaamheid. `luck` vermenigvuldigt het gewicht van alles vanaf `luckFrom`
-- (standaard Rare); `minRarity` laat lagere zeldzaamheden weg (eieren).
function Slimes.rarityOdds(luck: number, minRarity: string?, luckFrom: string?): Odds
	local minOrder = Slimes.rarityOrder(minRarity or "Common")
	local luckOrder = Slimes.rarityOrder(luckFrom or "Rare")
	local total = 0
	local weights: { [string]: number } = {}
	for _, id in Slimes.RARITY_ORDER do
		local r = Slimes.RARITIES[id]
		if r.order >= minOrder then
			local w = r.weight * (if r.order >= luckOrder then luck else 1)
			weights[id] = w
			total += w
		end
	end
	local out: Odds = {}
	for _, id in Slimes.RARITY_ORDER do
		local w = weights[id]
		if w then
			table.insert(out, { id = id, chance = w / total })
		end
	end
	return out
end

-- Kansen per soort (wat de ODDS-knop laat zien). Tellen samen op tot 1.
function Slimes.speciesOdds(luck: number, minRarity: string?, luckFrom: string?): Odds
	local out: Odds = {}
	for _, r in Slimes.rarityOdds(luck, minRarity, luckFrom) do
		local list = Slimes.BY_RARITY[r.id]
		local shares = 0
		for _, s in list do
			shares += s.share
		end
		for _, s in list do
			table.insert(out, { id = s.id, chance = r.chance * s.share / shares })
		end
	end
	return out
end

-- Kiest een uitkomst uit een kansenlijst met een getal tussen 0 en 1.
function Slimes.pick(odds: Odds, roll: number): string
	local acc = 0
	for _, o in odds do
		acc += o.chance
		if roll < acc then
			return o.id
		end
	end
	return odds[#odds].id
end

-- Een soort trekken. `rng` is een functie die een getal in [0, 1) teruggeeft.
function Slimes.roll(rng: () -> number, luck: number, minRarity: string?): string
	return Slimes.pick(Slimes.speciesOdds(luck, minRarity), rng())
end

-- Welke storm er komt, op gewicht.
function Slimes.rollStorm(rng: () -> number): string
	local total = 0
	for _, id in Slimes.MUTATION_ORDER do
		total += Slimes.MUTATIONS[id].weight
	end
	local roll = rng() * total
	for _, id in Slimes.MUTATION_ORDER do
		roll -= Slimes.MUTATIONS[id].weight
		if roll < 0 then
			return id
		end
	end
	return "Gold"
end

-- De betere van twee mutaties (voor fusies en stormen).
function Slimes.bestMutation(a: string?, b: string?): string?
	if Slimes.mutationMult(b) > Slimes.mutationMult(a) then
		return b
	end
	return a
end

-- Eieren: welke zeldzaamheden erin zitten.
Slimes.EGGS = {
	LuckyEgg = { name = "Lucky Egg", minRarity = "Rare" },
	MegaEgg = { name = "Mega Egg", minRarity = "Legendary" },
} :: { [string]: { name: string, minRarity: string } }

-- Lucky Charm verdubbelt het geluk in eieren vanaf de tweede zeldzaamheid in het ei.
function Slimes.eggOdds(egg: string, luck: number): Odds
	local info = Slimes.EGGS[egg]
	local nextRarity = Slimes.RARITY_ORDER[Slimes.rarityOrder(info.minRarity) + 1]
	return Slimes.speciesOdds(luck, info.minRarity, nextRarity)
end

return Slimes
