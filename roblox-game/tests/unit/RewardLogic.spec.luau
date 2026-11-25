-- Unit tests for Shared/Logic/RewardLogic: resolving reward bundles for a player, the text lines shown in the
-- UI, emptiness checks and scaling. Also runs every reward defined in Config through resolve/describe.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Logic = Shared:WaitForChild("Logic")
local RewardLogic = require(Logic:WaitForChild("RewardLogic"))
local Formulas = require(Logic:WaitForChild("Formulas"))
local DataSchema = require(Logic:WaitForChild("DataSchema"))
local NumberFormat = require(Shared:WaitForChild("Util"):WaitForChild("NumberFormat"))
local TableUtil = require(Shared:WaitForChild("Util"):WaitForChild("TableUtil"))

local NAN = 0 / 0
local INF = math.huge

local function newData()
	return DataSchema.default(0)
end

-- A player in zone 3 with two rebirths: coinScale and xpScale are well above the starter values.
local function advancedData()
	local data = newData()
	for _, zone in Config.Zones.list do
		if zone.order <= 3 then
			data.zones.unlocked[zone.id] = true
		end
	end
	data.rebirths = 2
	return data
end

local function isWholeFinite(value: any): boolean
	return type(value) == "number" and value == value and math.abs(value) ~= INF and math.floor(value) == value
end

-- Every reward that exists in Config, with a label for failure messages.
local function configRewards(): { { label: string, reward: any } }
	local rewards = {}
	local function push(label: string, reward: any)
		table.insert(rewards, { label = label, reward = reward })
	end
	for index, reward in Config.DailyRewards do
		push("daily " .. index, reward)
	end
	for index, def in Config.PlaytimeRewards do
		push("playtime " .. index, def.reward)
	end
	for code, def in Config.Codes.byId do
		push("code " .. code, def.reward)
	end
	for _, def in Config.Quests.list do
		push("quest " .. def.id, def.reward)
	end
	for _, def in Config.Achievements.list do
		for index, tier in def.tiers do
			push("achievement " .. def.id .. " tier " .. index, tier.reward)
		end
	end
	for _, def in Config.Monetization.Products.list do
		push("product " .. def.key, def.reward)
	end
	push("tutorial", Config.Tutorial.reward)
	push("boss", Config.Boss.reward)
	return rewards
end

return function(t)
	---------------------------------------------------------------------------------------------
	-- resolve

	t.test("resolve of an empty reward is all zeros", function()
		t.equal(RewardLogic.resolve({}, newData()), { coins = 0, gems = 0, xp = 0, boosts = {} })
	end)

	t.test("resolve adds flat and scaled amounts using the player's scales", function()
		local starter, advanced = newData(), advancedData()
		local reward = { coins = 25, coinsScaled = 150, gems = 12, xp = 7, xpScaled = 40 }

		t.equal(RewardLogic.resolve(reward, starter), {
			coins = 25 + 150 * Formulas.coinScale(starter),
			gems = 12,
			xp = 7 + 40 * Formulas.xpScale(starter),
			boosts = {},
		})
		local resolved = RewardLogic.resolve(reward, advanced)
		t.equal(resolved.coins, math.floor(25 + 150 * Formulas.coinScale(advanced) + 0.5))
		t.equal(resolved.xp, math.floor(7 + 40 * Formulas.xpScale(advanced) + 0.5))
		t.equal(resolved.gems, 12)
		t.truthy(resolved.coins > RewardLogic.resolve(reward, starter).coins)

		-- The scale is "one small crystal of the best zone", times the rebirth bonus (+50 % coins, +25 % XP each).
		local peaks = Config.Zones.list[3]
		t.equal(RewardLogic.resolve({ coinsScaled = 1 }, advanced).coins, math.floor(peaks.nodeCoins * 2 + 0.5))
		t.equal(RewardLogic.resolve({ xpScaled = 1 }, advanced).xp, math.floor(peaks.nodeXP * 1.5 + 0.5))
	end)

	t.test("resolve returns whole numbers (rounded to nearest) and survives broken amounts", function()
		local data = newData()
		local resolved = RewardLogic.resolve({ coins = 10.4, gems = 2.5, xp = 0.49 }, data)
		t.equal({ resolved.coins, resolved.gems, resolved.xp }, { 10, 3, 0 })

		resolved =
			RewardLogic.resolve({ coins = NAN, coinsScaled = -5, gems = INF, xp = "9" :: any, xpScaled = -INF }, data)
		t.equal(resolved, { coins = 0, gems = 0, xp = 0, boosts = {} })

		resolved = RewardLogic.resolve({ coins = 1e308, coinsScaled = 1e308, gems = 1e308 }, advancedData())
		for _, key in { "coins", "gems", "xp" } do
			t.truthy(resolved[key] == resolved[key] and resolved[key] < INF, key .. " stays finite")
		end
	end)

	t.test("resolve merges boost and boosts, adding up durations per boost id", function()
		local data = newData()
		local resolved = RewardLogic.resolve({
			boost = { id = "coins", seconds = 300 },
			boosts = {
				{ id = "xp", seconds = 600 },
				{ id = "coins", seconds = 900 },
				{ id = "damage", seconds = 60.9 },
			},
		}, data)
		t.equal(resolved.boosts, {
			{ id = "coins", seconds = 1200 },
			{ id = "xp", seconds = 600 },
			{ id = "damage", seconds = 60 },
		})
		t.equal(
			RewardLogic.resolve({ boost = { id = "luck", seconds = 30 } }, data).boosts,
			{ { id = "luck", seconds = 30 } }
		)
	end)

	t.test("resolve drops boosts and pets that cannot be granted", function()
		local data = newData()
		local resolved = RewardLogic.resolve({
			boost = { id = "turbo", seconds = 300 },
			boosts = {
				{ id = "coins", seconds = 0 },
				{ id = "xp", seconds = -60 },
				{ id = "luck", seconds = NAN },
				{ id = 5, seconds = 60 },
				"junk",
				{ id = "damage", seconds = 45 },
			} :: any,
			pet = { petId = "not_a_pet", tier = 1 },
		}, data)
		t.equal(resolved, { coins = 0, gems = 0, xp = 0, boosts = { { id = "damage", seconds = 45 } } })
		t.equal(RewardLogic.resolve({ boost = "coins" :: any, boosts = 5 :: any, pet = "fox" :: any }, data).boosts, {})
	end)

	t.test("resolve copies the pet grant and clamps its tier", function()
		local data = newData()
		local reward = { pet = { petId = "royal_dragon", tier = 1 } }
		local resolved = RewardLogic.resolve(reward, data)
		t.equal(resolved.pet, { petId = "royal_dragon", tier = 1 })
		t.truthy(resolved.pet ~= reward.pet, "a copy, not the Config table")
		t.equal(RewardLogic.resolve({ pet = { petId = "starter_fox", tier = 99 } }, data).pet, {
			petId = "starter_fox",
			tier = Config.Pets.maxTier,
		})
		t.equal(
			RewardLogic.resolve({ pet = { petId = "starter_fox", tier = NAN } }, data).pet,
			{ petId = "starter_fox", tier = 1 }
		)
	end)

	t.test("resolve never modifies the reward (Config tables are shared)", function()
		local data = advancedData()
		for _, entry in configRewards() do
			local before = TableUtil.deepCopy(entry.reward)
			local resolved = RewardLogic.resolve(entry.reward, data)
			RewardLogic.describe(entry.reward, data)
			RewardLogic.isEmpty(entry.reward)
			-- Mutating the result must not reach the Config table either.
			for _, boost in resolved.boosts do
				boost.seconds = 0
			end
			if resolved.pet then
				resolved.pet.tier = 3
			end
			t.equal(entry.reward, before, entry.label)
		end
	end)

	---------------------------------------------------------------------------------------------
	-- describe

	t.test("describe prints the spec's example lines", function()
		local data = newData()
		t.equal(RewardLogic.describe({ coins = 12500 }, data), { "💰 +12.5K Coins" })
		t.equal(RewardLogic.describe({ gems = 50 }, data), { "💎 +50 Gems" })
		t.equal(RewardLogic.describe({ boost = { id = "coins", seconds = 1800 } }, data), { "⚡ 2x Coins for 30m" })
		local fox = Config.Pets.byId.meadow_fox
		t.equal(fox.name, "Meadow Fox")
		t.equal(RewardLogic.describe({ pet = { petId = "meadow_fox", tier = 1 } }, data), { "🐾 Meadow Fox" })
	end)

	t.test("describe lists coins, gems, XP, boosts and the pet in that order", function()
		local data = newData()
		local lines = RewardLogic.describe({
			pet = { petId = "meadow_fox", tier = 2 },
			boosts = { { id = "luck", seconds = 5400 }, { id = "xp", seconds = 90 } },
			boost = { id = "damage", seconds = 3600 },
			xpScaled = 100,
			gems = 1,
			coinsScaled = 250,
		}, data)
		t.equal(lines, {
			"💰 +" .. NumberFormat.abbreviate(250 * Formulas.coinScale(data)) .. " Coins",
			"💎 +1 Gem",
			"⭐ +" .. NumberFormat.abbreviate(100 * Formulas.xpScale(data)) .. " XP",
			"⚡ 2x Damage for 1h",
			"⚡ 2x Luck for 1h 30m",
			"⚡ 2x XP for 1m 30s",
			"🐾 Golden Meadow Fox",
		})
		t.equal(RewardLogic.describe({ pet = { petId = "meadow_fox", tier = 3 } }, data), { "🐾 Rainbow Meadow Fox" })
		t.equal(RewardLogic.describe({ coins = 1 }, data), { "💰 +1 Coin" })
		t.equal(RewardLogic.describe({ boost = { id = "coins", seconds = 45 } }, data), { "⚡ 2x Coins for 45s" })
		t.equal(RewardLogic.describe({ boost = { id = "coins", seconds = 7200 } }, data), { "⚡ 2x Coins for 2h" })
		t.equal(RewardLogic.describe({}, data), {})
		t.equal(RewardLogic.describe({ coins = 0, gems = -3, boost = { id = "turbo", seconds = 60 } }, data), {})
	end)

	t.test("describe shows exactly what resolve grants, for the player it is shown to", function()
		local reward = { coinsScaled = 400 }
		local starter, advanced = newData(), advancedData()
		t.equal(
			RewardLogic.describe(reward, starter),
			{ "💰 +" .. NumberFormat.abbreviate(RewardLogic.resolve(reward, starter).coins) .. " Coins" }
		)
		t.equal(
			RewardLogic.describe(reward, advanced),
			{ "💰 +" .. NumberFormat.abbreviate(RewardLogic.resolve(reward, advanced).coins) .. " Coins" }
		)
		t.truthy(RewardLogic.describe(reward, starter)[1] ~= RewardLogic.describe(reward, advanced)[1])
	end)

	---------------------------------------------------------------------------------------------
	-- isEmpty

	t.test("isEmpty is true only when nothing at all would be granted", function()
		t.truthy(RewardLogic.isEmpty({}))
		t.truthy(RewardLogic.isEmpty({ coins = 0, gems = 0, xp = 0, coinsScaled = 0, xpScaled = 0, boosts = {} }))
		t.truthy(RewardLogic.isEmpty({ coins = -5, gems = NAN, xp = INF }))
		t.truthy(RewardLogic.isEmpty({ boost = { id = "turbo", seconds = 60 } }))
		t.truthy(RewardLogic.isEmpty({ boost = { id = "coins", seconds = 0 } }))
		t.truthy(RewardLogic.isEmpty({ pet = { petId = "not_a_pet", tier = 1 } }))
		t.truthy(RewardLogic.isEmpty(nil :: any))
		t.truthy(RewardLogic.isEmpty("gems" :: any))

		t.falsy(RewardLogic.isEmpty({ coins = 1 }))
		t.falsy(RewardLogic.isEmpty({ coinsScaled = 0.5 }))
		t.falsy(RewardLogic.isEmpty({ gems = 1 }))
		t.falsy(RewardLogic.isEmpty({ xp = 3 }))
		t.falsy(RewardLogic.isEmpty({ xpScaled = 10 }))
		t.falsy(RewardLogic.isEmpty({ boost = { id = "coins", seconds = 60 } }))
		t.falsy(RewardLogic.isEmpty({ boosts = { { id = "luck", seconds = 60 } } }))
		t.falsy(RewardLogic.isEmpty({ pet = { petId = "starter_fox", tier = 1 } }))
	end)

	---------------------------------------------------------------------------------------------
	-- scale / withGemMultiplier

	t.test("scale multiplies the currency parts and keeps boosts and pets", function()
		local reward = {
			coins = 10,
			coinsScaled = 300,
			gems = 5,
			xp = 4,
			xpScaled = 120,
			boost = { id = "coins", seconds = 60 },
			pet = { petId = "starter_fox", tier = 1 },
		}
		local before = TableUtil.deepCopy(reward)
		local half = RewardLogic.scale(reward, 0.5)
		t.equal(half, {
			coins = 5,
			coinsScaled = 150,
			gems = 2.5,
			xp = 2,
			xpScaled = 60,
			boost = { id = "coins", seconds = 60 },
			pet = { petId = "starter_fox", tier = 1 },
		})
		t.equal(reward, before, "the original is untouched")
		t.truthy(half ~= reward)

		t.equal(RewardLogic.scale({ gems = 5 }, 2), { gems = 10 })
		t.equal(RewardLogic.scale({ gems = 5 }, 0), { gems = 0 })
		t.equal(RewardLogic.scale({ gems = 5 }, -3), { gems = 0 })
		t.equal(RewardLogic.scale({ gems = 5 }, NAN), { gems = 0 })
		t.equal(RewardLogic.scale({}, 2), {})
	end)

	t.test("scaling the boss reward by contribution gives proportional, whole amounts", function()
		local data = advancedData()
		local full = RewardLogic.resolve(Config.Boss.reward, data)
		local double = RewardLogic.resolve(RewardLogic.scale(Config.Boss.reward, 2), data)
		local tenth = RewardLogic.resolve(RewardLogic.scale(Config.Boss.reward, 0.1), data)
		t.equal(double.coins, full.coins * 2)
		t.equal(double.gems, full.gems * 2)
		t.near(tenth.coins, full.coins / 10, 1)
		t.truthy(isWholeFinite(tenth.coins) and isWholeFinite(tenth.gems) and isWholeFinite(tenth.xp))
		t.truthy(RewardLogic.isEmpty(RewardLogic.scale(Config.Boss.reward, 0)))
	end)

	t.test("withGemMultiplier only changes the gems", function()
		local reward = { gems = 15, coinsScaled = 100, boost = { id = "luck", seconds = 900 } }
		local doubled = RewardLogic.withGemMultiplier(reward, Config.Game.vipDailyGemMult)
		t.equal(doubled, { gems = 30, coinsScaled = 100, boost = { id = "luck", seconds = 900 } })
		t.equal(reward.gems, 15)
		t.equal(RewardLogic.withGemMultiplier({ coinsScaled = 100 }, 2), { coinsScaled = 100 })
		t.equal(RewardLogic.withGemMultiplier({ gems = 10 }, NAN), { gems = 10 })
		-- VIP doubles the gems of every daily reward that has gems.
		local data = newData()
		for day, daily in Config.DailyRewards do
			local normal = RewardLogic.resolve(daily, data)
			local vip = RewardLogic.resolve(RewardLogic.withGemMultiplier(daily, Config.Game.vipDailyGemMult), data)
			t.equal(vip.gems, normal.gems * Config.Game.vipDailyGemMult, "day " .. day)
			t.equal(vip.coins, normal.coins, "day " .. day)
			t.equal(vip.boosts, normal.boosts, "day " .. day)
		end
	end)

	---------------------------------------------------------------------------------------------
	-- Every reward in Config

	t.test("every reward defined in Config resolves to something real and describes itself", function()
		local rewards = configRewards()
		t.truthy(#rewards > 80, "found " .. #rewards .. " rewards")
		for _, data in { newData(), advancedData() } do
			for _, entry in rewards do
				local label = entry.label
				t.falsy(RewardLogic.isEmpty(entry.reward), label .. " is empty")
				local resolved = RewardLogic.resolve(entry.reward, data)
				t.truthy(isWholeFinite(resolved.coins) and resolved.coins >= 0, label .. " coins")
				t.truthy(isWholeFinite(resolved.gems) and resolved.gems >= 0, label .. " gems")
				t.truthy(isWholeFinite(resolved.xp) and resolved.xp >= 0, label .. " xp")
				local parts = 0
				for _, boost in resolved.boosts do
					t.truthy(Config.Boosts.byId[boost.id], label .. " boost id")
					t.truthy(isWholeFinite(boost.seconds) and boost.seconds > 0, label .. " boost seconds")
					parts += 1
				end
				if resolved.pet then
					t.truthy(Config.Pets.byId[resolved.pet.petId], label .. " pet")
					parts += 1
				end
				parts += (if resolved.coins > 0 then 1 else 0) + (if resolved.gems > 0 then 1 else 0)
				parts += if resolved.xp > 0 then 1 else 0
				t.truthy(parts >= 1, label .. " grants nothing")

				-- Nothing in the reward was silently dropped, and every part gets exactly one line.
				local declared = {}
				if entry.reward.boost then
					declared[entry.reward.boost.id] = true
				end
				for _, boost in entry.reward.boosts or {} do
					declared[boost.id] = true
				end
				t.equal(#resolved.boosts, TableUtil.count(declared), label .. " lost a boost")
				t.equal(resolved.pet ~= nil, entry.reward.pet ~= nil, label .. " lost its pet")
				local lines = RewardLogic.describe(entry.reward, data)
				t.equal(#lines, parts, label .. " lines")
				for _, line in lines do
					t.truthy(utf8.len(line) and #line > 4, label .. " line '" .. line .. "'")
				end
			end
		end
	end)
end
