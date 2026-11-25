-- Unit tests for Shared/Logic/Formulas: curves, costs, zone/hammer rules and computeStats.
-- Multipliers are checked against the numbers written in the spec (§3.2, §3.3, §9); economy values that the
-- balance pass may retune (hammer damage, pet power, prices) are read from Config.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Logic = Shared:WaitForChild("Logic")
local Formulas = require(Logic:WaitForChild("Formulas"))
local DataSchema = require(Logic:WaitForChild("DataSchema"))
local PetLogic = require(Logic:WaitForChild("PetLogic"))
local NumberFormat = require(Shared:WaitForChild("Util"):WaitForChild("NumberFormat"))

local G = Config.Game
local NAN = 0 / 0
local INF = math.huge

local PASSES = {
	"vip",
	"doubleCoins",
	"doubleXP",
	"doubleDamage",
	"autoSmash",
	"luckyEggs",
	"tripleHatch",
	"extraPets",
	"petStorage",
	"speed",
}
local BOOSTS = { "coins", "xp", "luck", "damage" }

local function newData()
	return DataSchema.default(0)
end

local function newSession()
	return DataSchema.defaultSession()
end

local function isFinite(value: any): boolean
	return type(value) == "number" and value == value and math.abs(value) ~= INF
end

local function unlockThrough(data, order: number)
	for _, zone in Config.Zones.list do
		if zone.order <= order then
			data.zones.unlocked[zone.id] = true
		end
	end
end

-- Adds an equipped pet and returns its power.
local function equip(data, petId: string, tier: number): number
	local pet = PetLogic.newInstance(data, petId, tier, 0)
	pet.equipped = true
	return Formulas.petPower(pet)
end

return function(t)
	---------------------------------------------------------------------------------------------
	-- Levels

	t.test("xpForLevel follows floor(xpBase * L^xpExponent * xpGrowth^(L-1))", function()
		t.equal(Formulas.xpForLevel(1), G.xpBase)
		for _, level in { 1, 2, 3, 10, 25, 70, 150 } do
			local expected = math.floor(G.xpBase * level ^ G.xpExponent * G.xpGrowth ^ (level - 1) + 1e-9)
			t.equal(Formulas.xpForLevel(level), expected, "level " .. level)
		end
	end)

	t.test("xpForLevel is strictly increasing, whole and finite up to the level cap", function()
		local previous = 0
		for level = 1, G.levelCap do
			local xp = Formulas.xpForLevel(level)
			t.truthy(isFinite(xp), "finite at level " .. level)
			t.truthy(xp > previous, "increasing at level " .. level)
			t.equal(xp, math.floor(xp), "whole at level " .. level)
			previous = xp
		end
	end)

	t.test("xpForLevel tolerates odd input", function()
		local first = Formulas.xpForLevel(1)
		t.equal(Formulas.xpForLevel(0), first)
		t.equal(Formulas.xpForLevel(-50), first)
		t.equal(Formulas.xpForLevel(NAN), first)
		t.equal(Formulas.xpForLevel(INF), first)
		t.equal(Formulas.xpForLevel(nil :: any), first)
		t.equal(Formulas.xpForLevel("7" :: any), first)
		t.equal(Formulas.xpForLevel(2.9), Formulas.xpForLevel(2))
		t.equal(Formulas.xpForLevel(G.levelCap + 500), Formulas.xpForLevel(G.levelCap))
	end)

	t.test("levelUpGems = min(max, floor(base + perLevel * level)) and never decreases", function()
		for _, level in { 2, 5, 9, 10, 11, 20, 100, 369, 370, 371, 999 } do
			local expected = math.min(G.levelUpGemMax, math.floor(G.levelUpGemBase + G.levelUpGemPerLevel * level + 1e-9))
			t.equal(Formulas.levelUpGems(level), expected, "level " .. level)
		end
		local previous = 0
		for level = 2, G.levelCap do
			local gems = Formulas.levelUpGems(level)
			t.truthy(gems >= previous and gems >= 1 and gems <= G.levelUpGemMax, "level " .. level)
			previous = gems
		end
		t.equal(Formulas.levelUpGems(NAN), Formulas.levelUpGems(1))
		t.equal(Formulas.levelUpGems(1e300), G.levelUpGemMax)
	end)

	t.test("applyXP levels up, carries the remainder and sums the gems", function()
		local need1, need2, need3 = Formulas.xpForLevel(1), Formulas.xpForLevel(2), Formulas.xpForLevel(3)

		t.equal({ Formulas.applyXP(1, 0, need1 - 1) }, { 1, need1 - 1, 0, 0 })
		t.equal({ Formulas.applyXP(1, 0, need1) }, { 2, 0, 1, Formulas.levelUpGems(2) })
		t.equal({ Formulas.applyXP(1, 10, need1) }, { 2, 10, 1, Formulas.levelUpGems(2) })

		local level, xp, gained, gems = Formulas.applyXP(1, 5, need1 + need2 + need3 + 7)
		t.equal(level, 4)
		t.equal(xp, 12)
		t.equal(gained, 3)
		t.equal(gems, Formulas.levelUpGems(2) + Formulas.levelUpGems(3) + Formulas.levelUpGems(4))
	end)

	t.test("applyXP stops at the level cap and ignores odd amounts", function()
		local level, xp, gained = Formulas.applyXP(G.levelCap - 1, 0, 1e300)
		t.equal(level, G.levelCap)
		t.equal(xp, 0)
		t.equal(gained, 1)
		t.equal({ Formulas.applyXP(G.levelCap, 500, 1e9) }, { G.levelCap, 0, 0, 0 })

		t.equal({ Formulas.applyXP(3, 20, NAN) }, { 3, 20, 0, 0 })
		t.equal({ Formulas.applyXP(3, 20, -100) }, { 3, 20, 0, 0 })
		t.equal({ Formulas.applyXP(3, 20, INF) }, { 3, 20, 0, 0 })
		t.equal({ Formulas.applyXP(NAN, NAN, 5) }, { 1, 5, 0, 0 })

		-- A huge grant from level 1 terminates and lands on the cap.
		local capped = { Formulas.applyXP(1, 0, 1e300) }
		t.equal(capped[1], G.levelCap)
		t.equal(capped[3], G.levelCap - 1)
		t.truthy(isFinite(capped[4]))
	end)

	t.test("levelProgress returns (xp into level, xp needed)", function()
		local data = newData()
		t.equal({ Formulas.levelProgress(data) }, { 0, Formulas.xpForLevel(1) })
		data.level, data.xp = 7, 123
		t.equal({ Formulas.levelProgress(data) }, { 123, Formulas.xpForLevel(7) })
		data.xp = 1e30 -- more than needed (curve retuned): the bar is full, never over
		t.equal({ Formulas.levelProgress(data) }, { Formulas.xpForLevel(7), Formulas.xpForLevel(7) })
		data.xp = NAN
		t.equal({ Formulas.levelProgress(data) }, { 0, Formulas.xpForLevel(7) })
		data.level, data.xp = G.levelCap, 0
		t.equal({ Formulas.levelProgress(data) }, { 1, 1 })
	end)

	---------------------------------------------------------------------------------------------
	-- Upgrades and rebirth

	t.test("upgradeCost = floor(baseCost * costGrowth^level), increasing on every track", function()
		local treeTotal = 0
		for _, def in Config.Upgrades.list do
			t.equal(Formulas.upgradeCost(def, 0), def.baseCost, def.id)
			local previous = 0
			for level = 0, def.maxLevel - 1 do
				local cost = Formulas.upgradeCost(def, level)
				local expected = math.floor(def.baseCost * def.costGrowth ^ level + 1e-9)
				t.equal(cost, expected, def.id .. " level " .. level)
				t.truthy(cost > previous, def.id .. " must get more expensive at level " .. level)
				t.equal(cost, math.floor(cost))
				previous = cost
				treeTotal += cost
			end
		end
		t.truthy(isFinite(treeTotal) and treeTotal > 10000, "the full tree is a long-term goal: " .. treeTotal)
	end)

	t.test("upgradeCost and upgradeLevel tolerate odd input", function()
		local def = Config.Upgrades.byId.power
		t.equal(Formulas.upgradeCost(def, -3), def.baseCost)
		t.equal(Formulas.upgradeCost(def, NAN), def.baseCost)
		t.equal(Formulas.upgradeCost(def, 2.9), Formulas.upgradeCost(def, 2))
		t.equal(Formulas.upgradeCost(def, 1e9), Formulas.upgradeCost(def, def.maxLevel))

		local data = newData()
		t.equal(Formulas.upgradeLevel(data, "power"), 0)
		data.upgrades.power = 12
		t.equal(Formulas.upgradeLevel(data, "power"), 12)
		data.upgrades.power = def.maxLevel + 40
		t.equal(Formulas.upgradeLevel(data, "power"), def.maxLevel)
		data.upgrades.power = -4
		t.equal(Formulas.upgradeLevel(data, "power"), 0)
		data.upgrades.power = NAN
		t.equal(Formulas.upgradeLevel(data, "power"), 0)
		data.upgrades.power = "9" :: any
		t.equal(Formulas.upgradeLevel(data, "power"), 0)
		data.upgrades.nope = 5
		t.equal(Formulas.upgradeLevel(data, "nope"), 0)
	end)

	t.test("canBuyUpgrade checks the maximum level and the gems", function()
		local def = Config.Upgrades.byId.petSlots
		local data = newData()
		local cost = Formulas.upgradeCost(def, 0)
		t.equal({ Formulas.canBuyUpgrade(data, def) }, { false, "Need " .. NumberFormat.abbreviate(cost) .. " more gems" })
		data.gems = cost - 1
		t.equal({ Formulas.canBuyUpgrade(data, def) }, { false, "Need 1 more gem" })
		data.gems = cost
		t.equal({ Formulas.canBuyUpgrade(data, def) }, { true })
		data.upgrades.petSlots = def.maxLevel
		data.gems = 1e12
		t.equal({ Formulas.canBuyUpgrade(data, def) }, { false, "Max level" })
	end)

	t.test("rebirthCost = floor(base * growth^rebirths), strictly increasing", function()
		t.equal(Formulas.rebirthCost(0), G.rebirthCostBase)
		t.equal(Formulas.rebirthCost(1), math.floor(G.rebirthCostBase * G.rebirthCostGrowth))
		t.equal(Formulas.rebirthCost(4), math.floor(G.rebirthCostBase * G.rebirthCostGrowth ^ 4 + 1e-9))
		local previous = 0
		for rebirths = 0, 300 do
			local cost = Formulas.rebirthCost(rebirths)
			t.truthy(isFinite(cost) and cost > previous, "rebirth " .. rebirths)
			previous = cost
		end
		t.equal(Formulas.rebirthCost(-2), G.rebirthCostBase)
		t.equal(Formulas.rebirthCost(NAN), G.rebirthCostBase)
		t.truthy(Formulas.rebirthCost(1e9) == Formulas.rebirthCost(1e9), "never NaN")
	end)

	t.test("rebirthGems = min(max, base + perRebirth * (n - 1)) and never decreases", function()
		t.equal(Formulas.rebirthGems(1), G.rebirthGemBase)
		t.equal(Formulas.rebirthGems(2), G.rebirthGemBase + G.rebirthGemPerRebirth)
		t.equal(Formulas.rebirthGems(0), G.rebirthGemBase)
		t.equal(Formulas.rebirthGems(NAN), G.rebirthGemBase)
		t.equal(Formulas.rebirthGems(1e9), G.rebirthGemMax)
		local previous = 0
		for n = 1, 200 do
			local gems = Formulas.rebirthGems(n)
			t.truthy(gems >= previous and gems <= G.rebirthGemMax, "rebirth " .. n)
			previous = gems
		end
	end)

	t.test("canRebirth needs the coins", function()
		local data = newData()
		local ok, reason = Formulas.canRebirth(data)
		t.equal(ok, false)
		t.equal(reason, "Need " .. NumberFormat.abbreviate(G.rebirthCostBase) .. " more coins")
		data.coins = G.rebirthCostBase
		t.equal({ Formulas.canRebirth(data) }, { true })
		data.rebirths = 1
		t.equal((Formulas.canRebirth(data)), false)
		data.coins = Formulas.rebirthCost(1)
		t.equal((Formulas.canRebirth(data)), true)
	end)

	---------------------------------------------------------------------------------------------
	-- Zones and hammers

	t.test("bestZone, nextZone and zoneByOrder", function()
		local zones = Config.Zones.list
		local data = newData()
		t.equal(Formulas.bestZone(data).id, Config.Zones.firstId)
		t.equal((Formulas.nextZone(data) :: any).id, zones[2].id)

		unlockThrough(data, 3)
		t.equal(Formulas.bestZone(data).id, zones[3].id)
		t.equal((Formulas.nextZone(data) :: any).id, zones[4].id)

		unlockThrough(data, #zones)
		t.equal(Formulas.bestZone(data).id, zones[#zones].id)
		t.equal(Formulas.nextZone(data), nil)

		-- Nothing marked at all (odd data) still gives the hub.
		data.zones.unlocked = {}
		t.equal(Formulas.bestZone(data).id, Config.Zones.firstId)
		data.zones.unlocked = { nowhere = true }
		t.equal(Formulas.bestZone(data).id, Config.Zones.firstId)

		for order, zone in zones do
			t.equal((Formulas.zoneByOrder(order) :: any).id, zone.id)
		end
		t.equal(Formulas.zoneByOrder(0), nil)
		t.equal(Formulas.zoneByOrder(#zones + 1), nil)
	end)

	t.test("coinScale and xpScale follow the best zone and the rebirths", function()
		local data = newData()
		local meadow, peaks = Config.Zones.list[1], Config.Zones.list[3]
		t.equal(Formulas.coinScale(data), meadow.nodeCoins)
		t.equal(Formulas.xpScale(data), meadow.nodeXP)
		unlockThrough(data, 3)
		data.rebirths = 4
		t.near(Formulas.coinScale(data), peaks.nodeCoins * (1 + 0.5 * 4), 1e-6)
		t.near(Formulas.xpScale(data), peaks.nodeXP * (1 + 0.25 * 4), 1e-6)
		data.rebirths = NAN
		t.equal(Formulas.coinScale(data), peaks.nodeCoins)
		data.rebirths = -3
		t.equal(Formulas.xpScale(data), peaks.nodeXP)
	end)

	t.test("canUnlockZone gives precise reasons in order: previous zone, level, coins", function()
		local zones = Config.Zones.list
		local dunes, peaks = zones[2], zones[3]
		local data = newData()

		t.equal({ Formulas.canUnlockZone(data, zones[1]) }, { false, "Already unlocked" })
		t.equal({ Formulas.canUnlockZone(data, peaks) }, { false, "Unlock " .. dunes.name .. " first" })
		t.equal({ Formulas.canUnlockZone(data, dunes) }, { false, "Reach level " .. dunes.levelReq })

		data.level = dunes.levelReq
		t.equal(
			{ Formulas.canUnlockZone(data, dunes) },
			{ false, "Need " .. NumberFormat.abbreviate(dunes.cost) .. " more coins" }
		)
		data.coins = dunes.cost - 1
		t.equal({ Formulas.canUnlockZone(data, dunes) }, { false, "Need 1 more coin" })
		data.coins = dunes.cost - 0.25
		t.equal({ Formulas.canUnlockZone(data, dunes) }, { false, "Need 1 more coin" })
		data.coins = dunes.cost
		t.equal({ Formulas.canUnlockZone(data, dunes) }, { true })

		data.zones.unlocked[dunes.id] = true
		t.equal({ Formulas.canUnlockZone(data, dunes) }, { false, "Already unlocked" })
		-- The level requirement is reported before the price.
		data.coins = 0
		t.equal({ Formulas.canUnlockZone(data, peaks) }, { false, "Reach level " .. peaks.levelReq })
		data.level = peaks.levelReq
		data.coins = 1e300
		t.equal({ Formulas.canUnlockZone(data, peaks) }, { true })
		data.coins = NAN
		t.equal((Formulas.canUnlockZone(data, peaks)), false)
	end)

	t.test("the spec example texts come out exactly", function()
		local dunes, peaks = Config.Zones.byId.dunes, Config.Zones.byId.peaks
		t.equal(dunes.name, "Sandy Dunes")
		local data = newData()
		t.equal(select(2, Formulas.canUnlockZone(data, peaks)), "Unlock Sandy Dunes first")
		data.zones.unlocked.dunes = true
		data.level = peaks.levelReq - 1
		t.equal(select(2, Formulas.canUnlockZone(data, peaks)), "Reach level " .. peaks.levelReq)
		data.level = peaks.levelReq
		data.coins = peaks.cost - 40000
		t.equal(select(2, Formulas.canUnlockZone(data, peaks)), "Need 40K more coins")
		t.equal(select(2, Formulas.canBuyHammer(data, Config.Hammers.byId.wood)), "Already owned")
	end)

	t.test("canBuyHammer checks ownership, the hammer's zone and the coins", function()
		local data = newData()
		local stone = Config.Hammers.byId.stone
		local zoneTwoHammer
		for _, hammer in Config.Hammers.list do
			if hammer.zoneOrder == 2 then
				zoneTwoHammer = hammer
				break
			end
		end

		t.equal({ Formulas.canBuyHammer(data, Config.Hammers.byId[Config.Hammers.starterId]) }, { false, "Already owned" })
		t.equal(
			{ Formulas.canBuyHammer(data, stone) },
			{ false, "Need " .. NumberFormat.abbreviate(stone.cost) .. " more coins" }
		)
		data.coins = stone.cost
		t.equal({ Formulas.canBuyHammer(data, stone) }, { true })
		data.hammers.owned.stone = true
		t.equal({ Formulas.canBuyHammer(data, stone) }, { false, "Already owned" })

		data.coins = 1e30
		t.equal({ Formulas.canBuyHammer(data, zoneTwoHammer) }, { false, "Unlock " .. Config.Zones.list[2].name .. " first" })
		data.zones.unlocked[Config.Zones.list[2].id] = true
		t.equal({ Formulas.canBuyHammer(data, zoneTwoHammer) }, { true })
	end)

	---------------------------------------------------------------------------------------------
	-- Crystals and boss

	t.test("nodeMaxHealth and nodeReward multiply the zone's small-crystal numbers", function()
		for _, zone in Config.Zones.list do
			for _, nodeType in Config.NodeTypes.list do
				t.equal(Formulas.nodeMaxHealth(zone, nodeType), zone.nodeHealth * nodeType.healthMult)
				local coins, xp = Formulas.nodeReward(zone, nodeType)
				t.equal(coins, zone.nodeCoins * nodeType.coinMult)
				t.equal(xp, zone.nodeXP * nodeType.xpMult)
			end
		end
		local small = Config.NodeTypes.byId.small
		t.equal(Formulas.nodeMaxHealth(Config.Zones.list[1], small), Config.Zones.list[1].nodeHealth)
	end)

	t.test("bossMaxHealth = max(minHealth, sum of damage * hitsPerPlayer)", function()
		local B = Config.Boss
		t.equal(Formulas.bossMaxHealth({}), B.minHealth)
		t.equal(Formulas.bossMaxHealth({ 0 }), B.minHealth)
		t.equal(Formulas.bossMaxHealth({ 100, 250 }), 350 * B.hitsPerPlayer)
		t.equal(Formulas.bossMaxHealth({ 100, NAN, -5, INF, "x" :: any }), 100 * B.hitsPerPlayer)
		t.truthy(isFinite(Formulas.bossMaxHealth({ 1e300, 1e300, 1e300 })))
	end)

	---------------------------------------------------------------------------------------------
	-- Pets

	t.test("petPower = def.power * tier multiplier, 0 for unknown pets", function()
		local def = Config.Pets.list[1]
		local function pet(petId, tier)
			return { id = "p1", petId = petId, tier = tier, equipped = false, locked = false, obtainedAt = 0 }
		end
		t.near(Formulas.petPower(pet(def.id, 1)), def.power, 1e-9)
		t.near(Formulas.petPower(pet(def.id, 2)), def.power * 2.5, 1e-9)
		t.near(Formulas.petPower(pet(def.id, 3)), def.power * 6, 1e-9)
		t.equal(Formulas.petPower(pet("not_a_pet", 1)), 0)
		t.equal(Formulas.petPower(pet(nil :: any, 1)), 0)
		-- Odd tiers are clamped into 1..maxTier instead of raising.
		t.near(Formulas.petPower(pet(def.id, 0)), def.power, 1e-9)
		t.near(Formulas.petPower(pet(def.id, 99)), def.power * 6, 1e-9)
		t.near(Formulas.petPower(pet(def.id, NAN)), def.power, 1e-9)
		t.near(Formulas.petPower(pet(def.id, "2" :: any)), def.power, 1e-9)
	end)

	t.test("comparePets, equippedPets and countPets are deterministic", function()
		local data = newData()
		local eggPets = Config.Eggs.list[1].pets
		local weak, strong = eggPets[1].petId, eggPets[#eggPets].petId
		local a = PetLogic.newInstance(data, weak, 1, 0) -- p1
		local b = PetLogic.newInstance(data, strong, 1, 0) -- p2
		local c = PetLogic.newInstance(data, weak, 1, 0) -- p3
		for _ = 4, 10 do
			PetLogic.newInstance(data, weak, 1, 0)
		end
		local j = data.pets.list.p10
		a.equipped, b.equipped, c.equipped, j.equipped = true, true, true, true
		data.pets.list.ghost =
			{ id = "ghost", petId = "removed_pet", tier = 1, equipped = true, locked = false, obtainedAt = 0 }

		t.truthy(Formulas.comparePets(b, a), "stronger first")
		t.falsy(Formulas.comparePets(a, b))
		t.truthy(Formulas.comparePets(a, c), "equal power: older uid first")
		t.truthy(Formulas.comparePets(c, j), "p3 before p10 (numeric, not alphabetical)")
		t.falsy(Formulas.comparePets(a, a))

		local ids = {}
		for _, pet in Formulas.equippedPets(data) do
			table.insert(ids, pet.id)
		end
		t.equal(ids, { "p2", "p1", "p3", "p10" }) -- the unknown pet is left out
		t.equal({ Formulas.countPets(data) }, { 11, 5 })
		t.equal({ Formulas.countPets(newData()) }, { 0, 0 })
	end)

	---------------------------------------------------------------------------------------------
	-- computeStats

	t.test("computeStats of a new player is the base stats", function()
		local stats = Formulas.computeStats(newData(), newSession())
		local wood = Config.Hammers.byId[Config.Hammers.starterId]
		t.equal(stats, {
			damage = wood.damage,
			coinMult = 1,
			xpMult = 1,
			damageMult = 1,
			luckMult = 1,
			swingCooldown = 0.5,
			range = 13,
			critChance = 0.05,
			critMult = 2,
			walkSpeed = 18,
			gemChanceBonus = 0,
			petSlots = 3,
			petStorage = 40,
			maxHatch = 1,
			petPower = 0,
		})
	end)

	t.test("computeStats applies every upgrade track with the spec's per-level effect", function()
		local data = newData()
		data.upgrades = {
			power = 7, -- +10 % damage
			swift = 10, -- -3 % swing cooldown
			fortune = 20, -- +5 % coins
			wisdom = 6, -- +5 % XP
			critChance = 12, -- +1 %
			critPower = 8, -- +0.1x
			reach = 6, -- +0.5 studs
			sprint = 9, -- +1 walk speed
			luck = 10, -- +3 % luck
			gemFinder = 14, -- +0.5 % gem chance
			petSlots = 2, -- +1 slot
			petStorage = 4, -- +10 storage
		}
		local stats = Formulas.computeStats(data, newSession())
		local wood = Config.Hammers.byId.wood
		t.near(stats.damageMult, 1.7, 1e-9)
		t.near(stats.damage, wood.damage * 1.7, 1e-9)
		t.near(stats.swingCooldown, 0.5 * 0.7, 1e-9)
		t.near(stats.coinMult, 2, 1e-9)
		t.near(stats.xpMult, 1.3, 1e-9)
		t.near(stats.critChance, 0.17, 1e-9)
		t.near(stats.critMult, 2.8, 1e-9)
		t.near(stats.range, 16, 1e-9)
		t.near(stats.walkSpeed, 27, 1e-9)
		t.near(stats.luckMult, 1.3, 1e-9)
		t.near(stats.gemChanceBonus, 0.07, 1e-9)
		t.equal(stats.petSlots, 5)
		t.equal(stats.petStorage, 80)
	end)

	t.test("computeStats matches hand-computed values for every pass and boost combination", function()
		local data = newData()
		unlockThrough(data, 2)
		data.rebirths = 2
		data.upgrades = { power = 3, fortune = 4, wisdom = 2, luck = 5, sprint = 3, petSlots = 1, petStorage = 2 }
		data.hammers.owned.iron = true
		data.hammers.equipped = "iron"
		local hammerDamage = Config.Hammers.byId.iron.damage

		-- Six equipped pets with different powers; only the strongest `petSlots` may count.
		local eggPets = Config.Eggs.list[1].pets
		local powers = {
			equip(data, eggPets[5].petId, 1),
			equip(data, eggPets[4].petId, 2),
			equip(data, eggPets[3].petId, 1),
			equip(data, eggPets[2].petId, 3),
			equip(data, eggPets[1].petId, 1),
			equip(data, eggPets[1].petId, 2),
		}
		table.sort(powers, function(a, b)
			return a > b
		end)
		local function topPower(count: number): number
			local sum = 0
			for index = 1, math.min(count, #powers) do
				sum += powers[index]
			end
			return sum
		end

		local session = newSession()
		session.friendCount = 2
		session.premium = true

		local combinations = 0
		for passMask = 0, 2 ^ #PASSES - 1 do
			local has = {}
			session.passes = {}
			for bit, key in PASSES do
				if bit32.band(passMask, bit32.lshift(1, bit - 1)) ~= 0 then
					has[key] = true
					session.passes[key] = true
				end
			end
			for boostMask = 0, 2 ^ #BOOSTS - 1 do
				local boost = {}
				data.boosts = {}
				for bit, id in BOOSTS do
					if bit32.band(boostMask, bit32.lshift(1, bit - 1)) ~= 0 then
						boost[id] = true
						data.boosts[id] = 60
					end
				end

				local slots = 3 + 1 + (if has.extraPets then 2 else 0)
				local petPower = topPower(slots)
				local expectedCoin = (1 + petPower)
					* (1 + 0.05 * 4)
					* (1 + 0.5 * 2)
					* (if has.doubleCoins then 2 else 1)
					* (if boost.coins then 2 else 1)
					* (if has.vip then 1.2 else 1)
					* 1.1 -- premium
					* (1 + 0.1 * 2) -- two friends
				local expectedDamageMult = (1 + 0.1 * 3)
					* (1 + 0.25 * 2)
					* (if has.doubleDamage then 2 else 1)
					* (if boost.damage then 2 else 1)
				local expectedXP = (1 + 0.05 * 2)
					* (1 + 0.25 * 2)
					* (if has.doubleXP then 2 else 1)
					* (if boost.xp then 2 else 1)
					* (if has.vip then 1.2 else 1)
				local expectedLuck = (1 + 0.03 * 5) * (if has.luckyEggs then 2 else 1) * (if boost.luck then 2 else 1)

				local stats = Formulas.computeStats(data, session)
				local label = "passes " .. passMask .. " boosts " .. boostMask
				t.near(stats.coinMult, expectedCoin, 1e-9 * expectedCoin, label .. " coinMult")
				t.near(stats.damageMult, expectedDamageMult, 1e-9, label .. " damageMult")
				t.near(stats.damage, hammerDamage * expectedDamageMult, 1e-9 * hammerDamage, label .. " damage")
				t.near(stats.xpMult, expectedXP, 1e-9, label .. " xpMult")
				t.near(stats.luckMult, expectedLuck, 1e-9, label .. " luckMult")
				t.near(stats.petPower, petPower, 1e-9, label .. " petPower")
				t.equal(stats.petSlots, slots, label .. " petSlots")
				t.equal(stats.petStorage, 40 + 20 + (if has.petStorage then 100 else 0), label .. " petStorage")
				t.equal(stats.maxHatch, if has.tripleHatch then 3 else 1, label .. " maxHatch")
				t.near(stats.walkSpeed, 18 + 3 + (if has.speed then 6 else 0), 1e-9, label .. " walkSpeed")
				t.near(stats.swingCooldown, 0.5, 1e-9, label .. " swingCooldown")
				combinations += 1
			end
		end
		t.equal(combinations, 1024 * 16)
	end)

	t.test("friend, premium and group bonuses", function()
		local data = newData()
		local session = newSession()
		session.friendCount = 3
		t.near(Formulas.computeStats(data, session).coinMult, 1.3, 1e-9)
		session.friendCount = 5
		t.near(Formulas.computeStats(data, session).coinMult, 1.5, 1e-9)
		session.friendCount = 40 -- capped at friendBoostMaxFriends
		t.near(Formulas.computeStats(data, session).coinMult, 1.5, 1e-9)
		session.friendCount = -2
		t.near(Formulas.computeStats(data, session).coinMult, 1, 1e-9)
		session.friendCount = NAN
		t.near(Formulas.computeStats(data, session).coinMult, 1, 1e-9)

		session.friendCount = 0
		session.premium = true
		t.near(Formulas.computeStats(data, session).coinMult, 1.1, 1e-9)
		session.inGroup = true
		t.near(Formulas.computeStats(data, session).coinMult, 1.1 * 1.05, 1e-9)
		session.premium = false
		t.near(Formulas.computeStats(data, session).coinMult, 1.05, 1e-9)
	end)

	t.test("a boost counts through data.boosts or through session.boostEnds", function()
		local data = newData()
		local session = newSession()
		t.falsy(Formulas.isBoostActive(data, session, "coins"))

		data.boosts.coins = 30
		t.truthy(Formulas.isBoostActive(data, session, "coins"))
		t.near(Formulas.computeStats(data, session).coinMult, 2, 1e-9)

		data.boosts.coins = 0
		t.falsy(Formulas.isBoostActive(data, session, "coins"))
		data.boosts.coins = -5
		t.falsy(Formulas.isBoostActive(data, session, "coins"))
		data.boosts.coins = NAN
		t.falsy(Formulas.isBoostActive(data, session, "coins"))
		data.boosts.coins = nil

		session.boostEnds.damage = 12345
		t.truthy(Formulas.isBoostActive(data, session, "damage"))
		local stats = Formulas.computeStats(data, session)
		t.near(stats.damageMult, 2, 1e-9)
		t.near(stats.coinMult, 1, 1e-9)

		-- Unknown boost ids never multiply anything.
		data.boosts.speedrun = 500
		session.boostEnds.speedrun = 1
		local unchanged = Formulas.computeStats(data, session)
		t.equal(unchanged, stats)
	end)

	t.test("statBreakdown lists nine labelled factors whose product is coinMult", function()
		local data = newData()
		data.rebirths = 3
		data.upgrades.fortune = 9
		data.boosts.coins = 10
		equip(data, Config.Eggs.list[1].pets[3].petId, 2)
		local session = newSession()
		session.passes = { vip = true, doubleCoins = true }
		session.premium = true
		session.inGroup = true
		session.friendCount = 4

		local breakdown = Formulas.statBreakdown(data, session)
		local labels, product = {}, 1
		for _, entry in breakdown do
			table.insert(labels, entry.label)
			t.truthy(isFinite(entry.mult) and entry.mult >= 1, entry.label)
			product *= entry.mult
		end
		t.equal(labels, {
			"Pets",
			"Fortune Upgrade",
			"Rebirths",
			"2x Coins Pass",
			"Coin Boost",
			"VIP",
			"Premium",
			"Friends Online",
			"Group Member",
		})
		t.near(product, Formulas.computeStats(data, session).coinMult, 1e-9)
		t.near(breakdown[2].mult, 1.45, 1e-9)
		t.near(breakdown[3].mult, 2.5, 1e-9)
		t.equal(breakdown[4].mult, 2)
		t.equal(breakdown[5].mult, 2)
		t.near(breakdown[6].mult, 1.2, 1e-9)
		t.near(breakdown[7].mult, 1.1, 1e-9)
		t.near(breakdown[8].mult, 1.4, 1e-9)
		t.near(breakdown[9].mult, 1.05, 1e-9)

		for _, entry in Formulas.statBreakdown(newData(), newSession()) do
			t.equal(entry.mult, 1, entry.label .. " is neutral for a new player")
		end
	end)

	t.test("computeStats is total: odd data never raises and never yields NaN", function()
		local data = newData()
		data.hammers.equipped = "banhammer" -- unknown: starter hammer is used
		data.rebirths = NAN
		data.level = -INF
		data.upgrades = {
			power = 9999, -- above the maximum: clamped to maxLevel (50)
			swift = INF,
			fortune = NAN,
			wisdom = -20,
			luck = "lots" :: any,
			sprint = 2.7, -- floored
			petSlots = 1e9,
			madeUp = 50,
		}
		data.boosts = { coins = NAN, xp = -1, luck = INF, damage = "yes" :: any }
		data.pets.list = {
			p1 = { id = "p1", petId = "not_a_pet", tier = 1, equipped = true, locked = false, obtainedAt = 0 },
			p2 = { id = "p2", petId = Config.Pets.list[1].id, tier = NAN, equipped = true, locked = false, obtainedAt = 0 },
			p3 = { id = "p3", petId = Config.Pets.list[1].id, tier = 3, equipped = "yes" :: any, locked = false, obtainedAt = 0 },
		}
		local session = newSession()
		session.friendCount = NAN
		session.serverLuck = NAN
		session.passes = { vip = "true" :: any, nonsense = true }
		session.premium = nil :: any

		local stats = Formulas.computeStats(data, session)
		for key, value in stats do
			t.truthy(isFinite(value), key .. " must be finite, got " .. tostring(value))
		end
		local wood = Config.Hammers.byId.wood
		t.near(stats.damageMult, 1 + 0.1 * 50, 1e-9)
		t.near(stats.damage, wood.damage * 6, 1e-9)
		t.near(stats.coinMult, 1 + Config.Pets.list[1].power, 1e-9) -- only p2 counts, as tier 1
		t.near(stats.xpMult, 1, 1e-9)
		t.near(stats.luckMult, 1, 1e-9)
		t.near(stats.swingCooldown, 0.5, 1e-9)
		t.near(stats.walkSpeed, 20, 1e-9)
		t.equal(stats.petSlots, 5) -- upgrade level clamped to its maximum of 2
		t.equal(stats.maxHatch, 1)

		-- Missing upgrade levels are 0.
		data.upgrades = {}
		t.near(Formulas.computeStats(data, session).damageMult, 1, 1e-9)
	end)

	t.test("the swing cooldown never drops below the minimum and the crit chance never exceeds 1", function()
		local data = newData()
		local swift = Config.Upgrades.byId.swift
		data.upgrades.swift = swift.maxLevel
		data.upgrades.critChance = Config.Upgrades.byId.critChance.maxLevel
		local stats = Formulas.computeStats(data, newSession())
		t.truthy(stats.swingCooldown >= G.minSwingCooldown)
		t.near(stats.swingCooldown, math.max(0.2, 0.5 * (1 - 0.03 * swift.maxLevel)), 1e-9)
		t.truthy(stats.critChance <= 1 and stats.critChance > 0.05)
	end)

	t.test("serverLuck can raise luck but never lowers it", function()
		local data = newData()
		local session = newSession()
		session.serverLuck = 3
		t.near(Formulas.computeStats(data, session).luckMult, 3, 1e-9)
		session.serverLuck = 0
		t.near(Formulas.computeStats(data, session).luckMult, 1, 1e-9)
	end)

	---------------------------------------------------------------------------------------------
	-- Time

	t.test("dayNumber = floor(unixTime / 86400)", function()
		t.equal(Formulas.dayNumber(0), 0)
		t.equal(Formulas.dayNumber(86399), 0)
		t.equal(Formulas.dayNumber(86400), 1)
		t.equal(Formulas.dayNumber(86400.5), 1)
		t.equal(Formulas.dayNumber(1767268800), 20454) -- 2026-01-01 12:00 UTC
		t.equal(Formulas.dayNumber(-5), 0)
		t.equal(Formulas.dayNumber(NAN), 0)
	end)
end
