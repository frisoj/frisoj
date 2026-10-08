-- Test de gedeelde logica: kansen, prijzen, getallen, wereldindeling, rebirths en events.
-- Gebruik: lune run tools/tests/shared.test.luau <projectmap>
local process = require("@lune/process")
local root = process.args[1] or "."
local load = require("./loader")(root)

local Slimes = load("Slimes")
local Format = load("Format")
local Layout = load("Layout")
local Rebirths = load("Rebirths")
local Events = load("Events")
local Config = load("Config")

local fails = 0
local function check(cond: boolean, msg: string)
	if not cond then
		fails += 1
		print("FAIL: " .. msg)
	end
end
local function near(a: number, b: number, eps: number): boolean
	return math.abs(a - b) <= eps
end

-- Kansen tellen op tot precies 100% (Roblox-regel voor paid random items)
for _, luck in { 1, 2, 5, 10 } do
	local total = 0
	for _, o in Slimes.speciesOdds(luck) do
		total += o.chance
	end
	check(near(total, 1, 1e-9), "rivierkansen tellen op tot 1 bij geluk " .. luck .. ": " .. total)
end
for egg in Slimes.EGGS do
	for _, luck in { 1, 2 } do
		local total, lowest = 0, math.huge
		for _, o in Slimes.eggOdds(egg, luck) do
			total += o.chance
			lowest = math.min(lowest, Slimes.rarityOrder(Slimes.BY_ID[o.id].rarity))
		end
		check(near(total, 1, 1e-9), egg .. " kansen tellen op tot 1")
		check(lowest == Slimes.rarityOrder(Slimes.EGGS[egg].minRarity), egg .. " bevat niets onder " .. Slimes.EGGS[egg].minRarity)
	end
end
-- Geluk maakt zeldzaam echt waarschijnlijker
local function chanceOf(odds, rarity)
	local c = 0
	for _, o in odds do
		if Slimes.BY_ID[o.id].rarity == rarity then
			c += o.chance
		end
	end
	return c
end
-- x2 geluk op Rare+ geeft na herverdeling ~1,6x de absolute kans; de ODDS-knop toont de echte getallen.
check(chanceOf(Slimes.speciesOdds(2), "Mythic") > chanceOf(Slimes.speciesOdds(1), "Mythic") * 1.5, "Server Luck x2 maakt Mythic flink waarschijnlijker")
check(near(chanceOf(Slimes.speciesOdds(1), "Common"), 0.52, 1e-9), "Common is 52%")
check(chanceOf(Slimes.eggOdds("LuckyEgg", 2), "Secret") > chanceOf(Slimes.eggOdds("LuckyEgg", 1), "Secret"), "Lucky Charm helpt in eieren")

-- Trekken volgt de kansen (Monte Carlo)
math.randomseed(7)
local rng = { NextNumber = function() return math.random() end }
local counts: { [string]: number } = {}
local N = 200000
for _ = 1, N do
	local s = Slimes.roll(function() return rng.NextNumber() end, 1)
	local r = Slimes.BY_ID[s].rarity
	counts[r] = (counts[r] or 0) + 1
end
check(near((counts.Common or 0) / N, 0.52, 0.01), "Common rond 52%: " .. (counts.Common or 0) / N)
check(near((counts.Rare or 0) / N, 0.13, 0.006), "Rare rond 13%: " .. (counts.Rare or 0) / N)
local forced = Slimes.roll(function() return rng.NextNumber() end, 1, "Mythic")
check(Slimes.rarityOrder(Slimes.BY_ID[forced].rarity) >= Slimes.rarityOrder("Mythic"), "gegarandeerde Mythic is minstens Mythic")

-- Inkomen, prijs, namen, fusie
check(Slimes.income({ s = "Bouncer", m = nil, f = 0 }) == 28, "Bouncer verdient 28/s")
check(Slimes.income({ s = "Bouncer", m = "Lava", f = 1 }) == 28 * 6 * 4, "Lava Giant Bouncer = 28 x 6 x 4")
check(Slimes.price({ s = "Gloop", m = "Gold", f = 0 }) == 24, "Gold Gloop kost 2x")
check(Slimes.displayName({ s = "KingGloop", m = "Rainbow", f = 2 }) == "Rainbow Titan King Gloop", "naam met mutatie en fusie")
check(Slimes.bestMutation("Gold", "Galaxy") == "Galaxy" and Slimes.bestMutation("Lava", nil) == "Lava", "beste mutatie")
for _, s in Slimes.LIST do
	check(Slimes.RARITIES[s.rarity] ~= nil, s.id .. " heeft een geldige zeldzaamheid")
	check(s.price > s.income * 5, s.id .. " is niet te goedkoop")
end
-- Terugverdientijd loopt op met de zeldzaamheid
local prev = 0
for _, r in Slimes.RARITY_ORDER do
	local worst = 0
	for _, s in Slimes.BY_RARITY[r] do
		worst = math.max(worst, s.price / s.income)
	end
	check(worst >= prev, "terugverdientijd van " .. r .. " is niet korter dan de vorige")
	prev = worst
end
local stormCounts: { [string]: number } = {}
for _ = 1, 50000 do
	local m = Slimes.rollStorm(function() return rng.NextNumber() end)
	stormCounts[m] = (stormCounts[m] or 0) + 1
end
check((stormCounts.Gold or 0) > (stormCounts.Rainbow or 0) * 8, "Gold-storm komt veel vaker dan Rainbow")

-- Getallen
check(Format.number(999) == "999", "999")
check(Format.number(1000) == "1K", "1K: " .. Format.number(1000))
check(Format.number(1234) == "1.23K", "1.23K: " .. Format.number(1234))
check(Format.number(100000) == "100K", "100K: " .. Format.number(100000))
check(Format.number(1.5e6) == "1.5M", "1.5M: " .. Format.number(1.5e6))
check(Format.number(25e9) == "25B", "25B: " .. Format.number(25e9))
check(Format.number(2.5e12) == "2.5T", "2.5T: " .. Format.number(2.5e12))
check(Format.time(75) == "1:15" and Format.time(3725) == "1:02:05", "tijden")
check(Format.chance(0.52) == "52.00%" and Format.chance(0.0001) == "0.0100%", "kansen: " .. Format.chance(0.0001))

-- Wereldindeling
local x0, z0 = Layout.riverAt(0)
local x1 = Layout.riverAt(Layout.RIVER_LENGTH)
check(near(x0, Layout.RIVER_START, 0.01) and near(x1, Layout.RIVER_END, 0.01), "rivier loopt van portal naar recycler")
check(math.abs(z0) < 15, "rivier begint in het midden")
for i, lab in Layout.LABS do
	for _, p in Layout.PADS do
		local x, z = Layout.toWorld(lab, p.x, p.z)
		local lx, lz = Layout.toLocal(lab, x, z)
		check(near(lx, p.x, 1e-9) and near(lz, p.z, 1e-9), "toWorld/toLocal zijn elkaars omgekeerde")
		check(Layout.inLab(lab, x, z), "platform ligt in lab " .. i)
	end
	for _, spot in { Layout.COLLECT, Layout.LOCK, Layout.FUSE, Layout.SPAWN } do
		local x, z = Layout.toWorld(lab, spot.x, spot.z)
		check(Layout.inLab(lab, x, z), "knoppen liggen in lab " .. i)
	end
	-- Geen lab overlapt de rivier of een ander lab
	for d = 0, Layout.RIVER_LENGTH, 6 do
		local rx, rz = Layout.riverAt(d)
		check(not Layout.inLab(lab, rx, rz, Layout.RIVER_HALF_WIDTH), "lab " .. i .. " ligt niet op de rivier")
	end
	for j, other in Layout.LABS do
		if j ~= i then
			check(not Layout.inLab(lab, other.x, other.z, 0), "lab " .. i .. " overlapt lab " .. j .. " niet")
		end
	end
	-- De ingang wijst naar de rivier
	local gx, gz = Layout.toWorld(lab, 0, Layout.LAB_HALF_Z)
	check(math.abs(gz) < math.abs(lab.z), "ingang van lab " .. i .. " wijst naar de rivier")
	local _ = gx
end
check(#Layout.PADS == Config.MAX_PADS, "aantal platforms klopt met MAX_PADS")

-- Rebirths
check(Rebirths.next(0) ~= nil and Rebirths.next(Rebirths.MAX) == nil, "rebirth-lijst")
local req1 = Rebirths.next(0)
check(Rebirths.meets({ s = "Ninja", m = nil, f = 0 }, req1) and not Rebirths.meets({ s = "Sparky", m = nil, f = 0 }, req1), "rebirth 1 wil een Epic")
local req6 = Rebirths.LIST[6]
check(not Rebirths.meets({ s = "GalaxyGel", m = nil, f = 0 }, req6) and Rebirths.meets({ s = "GalaxyGel", m = nil, f = 1 }, req6), "rebirth 6 wil een Mythic Giant")
for i = 2, Rebirths.MAX do
	check(Rebirths.LIST[i].goo > Rebirths.LIST[i - 1].goo, "rebirth " .. i .. " is duurder")
end

-- Slime Storm Saturday (zaterdag 10 oktober 2026, 18:00 UTC)
local sat = 1791655200
check((Events.saturday(sat + 60)), "zaterdag 18:01 is het event")
check(not (Events.saturday(sat - 60)), "zaterdag 17:59 nog niet")
check(not (Events.saturday(sat + 31 * 60)), "na 30 minuten voorbij")
local _, untilNext = Events.saturday(sat - 3600)
check(untilNext == 3600, "aftellen naar het event")
check(Events.gooMultiplier(sat + 10) == 2 and Events.gooMultiplier(sat - 10) == 1, "dubbel Goo tijdens het event")

-- Config: elke prijs bestaat voor elk product en elke pass
for key in Config.PRODUCTS do
	check(Config.PRICES[key] ~= nil, "prijs voor product " .. key)
end
for key in Config.PASSES do
	check(Config.PRICES[key] ~= nil, "prijs voor pass " .. key)
end

print(fails == 0 and "ALLE TESTS GESLAAGD" or (fails .. " MISLUKT"))
if fails > 0 then
	process.exit(1)
end
