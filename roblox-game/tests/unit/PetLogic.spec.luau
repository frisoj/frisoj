-- Unit tests for Shared/Logic/PetLogic: egg odds with luck, rolling, instance creation, hatch and fuse rules,
-- team selection, ordering and the EquippedPets attribute format.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Logic = Shared:WaitForChild("Logic")
local PetLogic = require(Logic:WaitForChild("PetLogic"))
local Formulas = require(Logic:WaitForChild("Formulas"))
local DataSchema = require(Logic:WaitForChild("DataSchema"))
local NumberFormat = require(Shared:WaitForChild("Util"):WaitForChild("NumberFormat"))

local G = Config.Game
local NAN = 0 / 0
local INF = math.huge
local LUCK_STEPS = { 1, 1.03, 1.3, 1.6, 2, 3.2, 4, 6.4, 25, 1000 }

local MEADOW = Config.Eggs.list[1]
local COMMON = MEADOW.pets[1].petId
local UNCOMMON = MEADOW.pets[2].petId
local RARE = MEADOW.pets[3].petId
local EPIC = MEADOW.pets[4].petId
local LEGENDARY = MEADOW.pets[5].petId

-- Random stand-in returning the given numbers in order.
local function scriptedRandom(values: { number }): any
	local rng = { calls = 0 }
	function rng:NextNumber(): number
		self.calls += 1
		local value = values[self.calls]
		assert(value ~= nil, "scriptedRandom ran out of values")
		return value
	end
	return rng
end

local function newData()
	return DataSchema.default(0)
end

local function statsFor(data, passes: { [string]: boolean }?)
	local session = DataSchema.defaultSession()
	session.passes = passes or {}
	return Formulas.computeStats(data, session)
end

local function add(data, petId: string, tier: number?, flags: { equipped: boolean?, locked: boolean? }?)
	local pet = PetLogic.newInstance(data, petId, tier or 1, 0)
	if flags then
		pet.equipped = flags.equipped == true
		pet.locked = flags.locked == true
	end
	return pet
end

local function isLuckAffected(rarity: string): boolean
	return Config.Rarities.byId[rarity].luckAffected
end

return function(t)
	---------------------------------------------------------------------------------------------
	-- Odds

	t.test("odds without luck are exactly the egg weights, in egg order", function()
		for _, egg in Config.Eggs.list do
			local totalWeight = 0
			for _, entry in egg.pets do
				totalWeight += entry.weight
			end
			local odds = PetLogic.odds(egg, 1)
			t.equal(#odds, #egg.pets, egg.id)
			for index, entry in egg.pets do
				t.equal(odds[index].petId, entry.petId)
				t.equal(odds[index].rarity, Config.Pets.byId[entry.petId].rarity)
				t.near(odds[index].chance, entry.weight / totalWeight, 1e-12, egg.id .. " " .. entry.petId)
			end
		end
	end)

	t.test("odds add up to 1 for every egg and every luck value", function()
		for _, egg in Config.Eggs.list do
			for _, luck in LUCK_STEPS do
				local sum = 0
				for _, entry in PetLogic.odds(egg, luck) do
					t.truthy(entry.chance > 0 and entry.chance < 1, egg.id .. " chance in (0, 1)")
					sum += entry.chance
				end
				t.near(sum, 1, 1e-9, egg.id .. " luck " .. luck)
			end
		end
	end)

	t.test("luck multiplies the weight of Rare-and-better pets, then renormalises", function()
		-- Meadow Egg 50 / 30 / 15 / 4.5 / 0.5 with luck 2 -> 50 / 30 / 30 / 9 / 1 out of 120.
		local weights = {}
		for index, entry in MEADOW.pets do
			weights[index] = entry.weight
		end
		t.equal(weights, { 50, 30, 15, 4.5, 0.5 })
		local odds = PetLogic.odds(MEADOW, 2)
		t.near(odds[1].chance, 50 / 120, 1e-12)
		t.near(odds[2].chance, 30 / 120, 1e-12)
		t.near(odds[3].chance, 30 / 120, 1e-12)
		t.near(odds[4].chance, 9 / 120, 1e-12)
		t.near(odds[5].chance, 1 / 120, 1e-12)

		-- Generic check against the documented formula for every egg.
		for _, egg in Config.Eggs.list do
			local luck = 3.2
			local total = 0
			for _, entry in egg.pets do
				local affected = isLuckAffected(Config.Pets.byId[entry.petId].rarity)
				total += entry.weight * (if affected then luck else 1)
			end
			for index, entry in PetLogic.odds(egg, luck) do
				local source = egg.pets[index]
				local affected = isLuckAffected(entry.rarity)
				t.near(entry.chance, source.weight * (if affected then luck else 1) / total, 1e-12, egg.id)
			end
		end
	end)

	t.test("more luck strictly raises every Rare+ chance and lowers Common and Uncommon", function()
		for _, egg in Config.Eggs.list do
			local previous = PetLogic.odds(egg, LUCK_STEPS[1])
			for step = 2, #LUCK_STEPS do
				local current = PetLogic.odds(egg, LUCK_STEPS[step])
				local rarePlusBefore, rarePlusAfter = 0, 0
				for index, entry in current do
					local label = egg.id .. " " .. entry.petId .. " at luck " .. LUCK_STEPS[step]
					if isLuckAffected(entry.rarity) then
						t.truthy(entry.chance > previous[index].chance, label .. " must rise")
						rarePlusBefore += previous[index].chance
						rarePlusAfter += entry.chance
					else
						t.truthy(entry.chance < previous[index].chance, label .. " must fall")
					end
				end
				t.truthy(rarePlusAfter > rarePlusBefore, egg.id .. " total Rare+ chance must rise")
				previous = current
			end
		end
	end)

	t.test("luck below 1 or broken luck counts as 1", function()
		local base = PetLogic.odds(MEADOW, 1)
		for _, luck in { 0, 0.5, -3, NAN, -INF, "2" :: any, nil :: any } do
			t.equal(PetLogic.odds(MEADOW, luck), base, "luck " .. tostring(luck))
		end
		-- Infinite luck is not a number we can use either; a huge finite one is capped and stays finite.
		t.equal(PetLogic.odds(MEADOW, INF), base)
		local sum = 0
		for _, entry in PetLogic.odds(MEADOW, 1e300) do
			t.truthy(entry.chance == entry.chance and entry.chance >= 0, "finite chance")
			sum += entry.chance
		end
		t.near(sum, 1, 1e-9)
	end)

	t.test("eggs with broken entries: unknown pets and bad weights are left out", function()
		local egg = {
			id = "test_egg",
			name = "Test Egg",
			zoneId = "meadow",
			cost = 1,
			color = Color3.new(1, 1, 1),
			spotColor = Color3.new(0, 0, 0),
			pets = {
				{ petId = COMMON, weight = 30 },
				{ petId = "removed_pet", weight = 50 },
				{ petId = UNCOMMON, weight = 0 },
				{ petId = RARE, weight = NAN },
				{ petId = EPIC, weight = -5 },
				{ petId = LEGENDARY, weight = 10 },
			},
		}
		local odds = PetLogic.odds(egg, 1)
		t.equal(#odds, 2)
		t.equal({ odds[1].petId, odds[2].petId }, { COMMON, LEGENDARY })
		t.near(odds[1].chance, 0.75, 1e-12)
		t.near(odds[2].chance, 0.25, 1e-12)

		egg.pets = { { petId = "removed_pet", weight = 100 } }
		t.equal(PetLogic.odds(egg, 2), {})
		local rng = scriptedRandom({})
		t.equal(PetLogic.roll(egg, 2, rng), nil)
		t.equal(rng.calls, 0)
		egg.pets = {}
		t.equal(PetLogic.odds(egg, 1), {})
		t.equal(PetLogic.roll(egg, 1, Random.new(1)), nil)
	end)

	---------------------------------------------------------------------------------------------
	-- Rolling

	t.test("roll uses the odds table: boundaries map to the right pets with one draw each", function()
		local odds = PetLogic.odds(MEADOW, 2) -- 50 / 30 / 30 / 9 / 1 out of 120
		local edges = { 0 }
		for index, entry in odds do
			edges[index + 1] = edges[index] + entry.chance
		end
		for index, entry in odds do
			local low = scriptedRandom({ edges[index] + 1e-9 })
			t.equal(PetLogic.roll(MEADOW, 2, low), entry.petId, "just inside the lower edge of " .. entry.petId)
			t.equal(low.calls, 1)
			local high = scriptedRandom({ edges[index + 1] - 1e-9 })
			t.equal(PetLogic.roll(MEADOW, 2, high), entry.petId, "just inside the upper edge of " .. entry.petId)
		end
		t.equal(PetLogic.roll(MEADOW, 2, scriptedRandom({ 0 })), COMMON)
		t.equal(PetLogic.roll(MEADOW, 2, scriptedRandom({ 0.9999999999999999 })), LEGENDARY)
	end)

	t.test("roll is deterministic per seed and only returns pets of that egg", function()
		for _, egg in Config.Eggs.list do
			local inEgg = {}
			for _, entry in egg.pets do
				inEgg[entry.petId] = true
			end
			local first, second = Random.new(1234), Random.new(1234)
			for _ = 1, 200 do
				local petId = PetLogic.roll(egg, 1.5, first)
				t.truthy(petId ~= nil and inEgg[petId], egg.id .. " rolled " .. tostring(petId))
				t.equal(PetLogic.roll(egg, 1.5, second), petId)
			end
		end
	end)

	t.test("rolled frequencies match the displayed odds (with and without luck)", function()
		local rolls = 40000
		for _, luck in { 1, 4 } do
			local rng = Random.new(2026 + luck)
			local counts = {}
			for _ = 1, rolls do
				local petId = PetLogic.roll(MEADOW, luck, rng) :: string
				counts[petId] = (counts[petId] or 0) + 1
			end
			for _, entry in PetLogic.odds(MEADOW, luck) do
				local observed = (counts[entry.petId] or 0) / rolls
				-- Five standard deviations of a binomial proportion: fails by chance about once in a million.
				local tolerance = 5 * math.sqrt(entry.chance * (1 - entry.chance) / rolls)
				t.near(observed, entry.chance, tolerance, entry.petId .. " at luck " .. luck)
			end
		end
	end)

	---------------------------------------------------------------------------------------------
	-- Uids and instances

	t.test("uid and uidNumber convert both ways and reject malformed ids", function()
		t.equal(PetLogic.uid(1), "p1")
		t.equal(PetLogic.uid(1234567), "p1234567")
		t.equal(PetLogic.uidNumber("p1"), 1)
		t.equal(PetLogic.uidNumber("p1234567"), 1234567)
		for _, bad in
			{ "", "p", "1", "p0", "p01", "p-1", "p1.5", "P1", "pp1", "p1 ", " p1", "p1e3", "p99999999999999999999" }
		do
			t.equal(PetLogic.uidNumber(bad), nil, "'" .. bad .. "'")
		end
		t.equal(PetLogic.uidNumber(1), nil)
		t.equal(PetLogic.uidNumber(nil), nil)
		t.equal(PetLogic.uidNumber({}), nil)
	end)

	t.test("newInstance allocates uids from nextId, stores the pet and marks the index", function()
		local data = newData()
		local first, firstNew = PetLogic.newInstance(data, COMMON, 1, 1700000000)
		t.equal(
			first,
			{ id = "p1", petId = COMMON, tier = 1, equipped = false, locked = false, obtainedAt = 1700000000 }
		)
		t.equal(firstNew, true)
		t.truthy(data.pets.list.p1 == first, "the returned instance is the stored one")
		t.equal(data.pets.nextId, 2)
		t.equal(data.petIndex, { [COMMON] = true })

		local second, secondNew = PetLogic.newInstance(data, COMMON, 2, 1700000001)
		t.equal(second.id, "p2")
		t.equal(second.tier, 2)
		t.equal(secondNew, false)

		local third, thirdNew = PetLogic.newInstance(data, "royal_dragon", 3, 1700000002)
		t.equal(third.id, "p3")
		t.equal(thirdNew, true)
		t.equal(data.pets.nextId, 4)
		t.equal((Formulas.countPets(data)), 3)

		-- A deleted pet's uid is never reused.
		data.pets.list.p3 = nil
		t.equal((PetLogic.newInstance(data, COMMON, 1, 0)).id, "p4")
	end)

	t.test("newInstance repairs odd input instead of corrupting the inventory", function()
		local data = newData()
		t.equal((PetLogic.newInstance(data, COMMON, 99, NAN)).tier, Config.Pets.maxTier)
		t.equal((PetLogic.newInstance(data, COMMON, 0, -5)).tier, 1)
		t.equal((PetLogic.newInstance(data, COMMON, NAN, 0)).tier, 1)
		t.equal(data.pets.list.p1.obtainedAt, 0)

		-- A counter that fell behind (or broke) never overwrites an existing pet.
		data.pets.nextId = 1
		local pet = PetLogic.newInstance(data, COMMON, 1, 0)
		t.equal(pet.id, "p4")
		t.equal(data.pets.nextId, 5)
		data.pets.nextId = NAN
		t.equal((PetLogic.newInstance(data, COMMON, 1, 0)).id, "p5")
		t.equal((Formulas.countPets(data)), 5)

		local before = (Formulas.countPets(data))
		t.throws(function()
			PetLogic.newInstance(data, "not_a_pet", 1, 0)
		end)
		t.throws(function()
			PetLogic.newInstance(data, nil :: any, 1, 0)
		end)
		t.equal((Formulas.countPets(data)), before)
		t.equal(data.petIndex.not_a_pet, nil)
	end)

	---------------------------------------------------------------------------------------------
	-- Hatching

	t.test("canHatch covers the amount, the pass, the zone, the coins and the storage", function()
		local data = newData()
		local stats = statsFor(data)
		local triple = G.tripleHatchCount

		for _, count in { 0, 2, -1, 1.5, 4, NAN, INF, "1" :: any, nil :: any } do
			t.equal({ PetLogic.canHatch(data, stats, MEADOW, count) }, { false, "Invalid amount" }, tostring(count))
		end
		data.coins = 1e30
		t.equal(
			{ PetLogic.canHatch(data, stats, MEADOW, triple) },
			{ false, "Hatch x" .. triple .. " needs the Triple Hatch pass" }
		)
		data.coins = 0

		local dunesEgg = Config.Eggs.list[2]
		t.equal(
			{ PetLogic.canHatch(data, stats, dunesEgg, 1) },
			{ false, "Unlock " .. Config.Zones.byId[dunesEgg.zoneId].name .. " first" }
		)

		t.equal(
			{ PetLogic.canHatch(data, stats, MEADOW, 1) },
			{ false, "Need " .. NumberFormat.abbreviate(MEADOW.cost) .. " more coins" }
		)
		data.coins = MEADOW.cost - 1
		t.equal({ PetLogic.canHatch(data, stats, MEADOW, 1) }, { false, "Need 1 more coin" })
		data.coins = MEADOW.cost
		t.equal({ PetLogic.canHatch(data, stats, MEADOW, 1) }, { true })

		-- Hatch x3 costs three eggs and needs the pass.
		local tripleStats = statsFor(data, { tripleHatch = true })
		t.equal(tripleStats.maxHatch, triple)
		t.equal((PetLogic.canHatch(data, tripleStats, MEADOW, triple)), false)
		data.coins = MEADOW.cost * triple
		t.equal({ PetLogic.canHatch(data, tripleStats, MEADOW, triple) }, { true })

		data.zones.unlocked[dunesEgg.zoneId] = true
		data.coins = dunesEgg.cost
		t.equal({ PetLogic.canHatch(data, stats, dunesEgg, 1) }, { true })
	end)

	t.test("canHatch refuses when the hatched pets would not fit into the storage", function()
		local data = newData()
		data.coins = 1e30
		local stats = statsFor(data, { tripleHatch = true })
		for _ = 1, stats.petStorage - 2 do
			add(data, COMMON)
		end
		t.equal({ PetLogic.canHatch(data, stats, MEADOW, 1) }, { true })
		t.equal(
			{ PetLogic.canHatch(data, stats, MEADOW, 3) },
			{ false, "Pet storage full (" .. (stats.petStorage - 2) .. "/" .. stats.petStorage .. ")" }
		)
		add(data, COMMON)
		t.equal({ PetLogic.canHatch(data, stats, MEADOW, 1) }, { true }) -- exactly fills the last slot
		add(data, COMMON)
		t.equal(
			{ PetLogic.canHatch(data, stats, MEADOW, 1) },
			{ false, "Pet storage full (" .. stats.petStorage .. "/" .. stats.petStorage .. ")" }
		)
		-- More storage (upgrade or pass) makes room again.
		t.equal({ PetLogic.canHatch(data, statsFor(data, { petStorage = true }), MEADOW, 1) }, { true })
	end)

	---------------------------------------------------------------------------------------------
	-- Teams and ordering

	t.test("bestTeam picks the strongest pets, ties going to the older pet", function()
		local data = newData()
		add(data, COMMON) -- p1
		add(data, LEGENDARY) -- p2
		add(data, COMMON, 3) -- p3 rainbow common
		add(data, EPIC) -- p4
		add(data, COMMON) -- p5
		add(data, EPIC) -- p6 (same power as p4)
		add(data, LEGENDARY, 2, { locked = true }) -- p7: locked pets can be equipped
		data.pets.list.ghost =
			{ id = "ghost", petId = "removed_pet", tier = 3, equipped = false, locked = false, obtainedAt = 0 }

		local power = function(uid)
			return Formulas.petPower(data.pets.list[uid])
		end
		t.truthy(power("p7") > power("p2") and power("p2") > power("p3") and power("p3") > power("p4"))

		t.equal(PetLogic.bestTeam(data, 3), { "p7", "p2", "p3" })
		t.equal(PetLogic.bestTeam(data, 5), { "p7", "p2", "p3", "p4", "p6" })
		t.equal(PetLogic.bestTeam(data, 100), { "p7", "p2", "p3", "p4", "p6", "p1", "p5" }) -- never the unknown pet
		t.equal(PetLogic.bestTeam(data, 0), {})
		t.equal(PetLogic.bestTeam(data, -2), {})
		t.equal(PetLogic.bestTeam(data, NAN), {})
		t.equal(PetLogic.bestTeam(data, 2.9), { "p7", "p2" })
		t.equal(PetLogic.bestTeam(newData(), 3), {})

		-- The total power of the best team is the maximum over all teams of that size.
		local best = 0
		for _, uid in PetLogic.bestTeam(data, 3) do
			best += power(uid)
		end
		local all = { "p1", "p2", "p3", "p4", "p5", "p6", "p7" }
		for a = 1, #all do
			for b = a + 1, #all do
				for c = b + 1, #all do
					t.truthy(power(all[a]) + power(all[b]) + power(all[c]) <= best + 1e-9)
				end
			end
		end
	end)

	t.test("bestTeam does not depend on the order pets were inserted in", function()
		local a, b = newData(), newData()
		local kinds = { COMMON, EPIC, RARE, EPIC, LEGENDARY, COMMON, UNCOMMON, RARE }
		for index = 1, #kinds do
			local pet =
				{ id = "p" .. index, petId = kinds[index], tier = 1, equipped = false, locked = false, obtainedAt = 0 }
			a.pets.list[pet.id] = pet
		end
		for index = #kinds, 1, -1 do
			local pet =
				{ id = "p" .. index, petId = kinds[index], tier = 1, equipped = false, locked = false, obtainedAt = 0 }
			b.pets.list[pet.id] = pet
		end
		t.equal(PetLogic.bestTeam(a, 4), { "p5", "p2", "p4", "p3" })
		t.equal(PetLogic.bestTeam(b, 4), PetLogic.bestTeam(a, 4))
	end)

	t.test("sorted lists equipped pets first, then by power, then by age", function()
		local data = newData()
		add(data, COMMON, 1, { equipped = true }) -- p1
		add(data, LEGENDARY) -- p2
		add(data, EPIC, 1, { equipped = true }) -- p3
		add(data, COMMON) -- p4
		add(data, COMMON) -- p5
		add(data, EPIC) -- p6
		local ids = {}
		for _, pet in PetLogic.sorted(data) do
			table.insert(ids, pet.id)
		end
		t.equal(ids, { "p3", "p1", "p2", "p6", "p4", "p5" })
		t.equal(PetLogic.sorted(newData()), {})
	end)

	---------------------------------------------------------------------------------------------
	-- Fusing

	t.test("fuseCandidates: same kind and tier, never locked, unequipped first, oldest first", function()
		local data = newData()
		add(data, COMMON, 1, { equipped = true }) -- p1
		add(data, COMMON) -- p2
		add(data, COMMON, 1, { locked = true }) -- p3
		add(data, COMMON, 2) -- p4 other tier
		add(data, UNCOMMON) -- p5 other kind
		add(data, COMMON) -- p6
		add(data, COMMON, 1, { equipped = true }) -- p7
		add(data, COMMON) -- p8
		add(data, COMMON, 1, { equipped = true, locked = true }) -- p9
		for _ = 10, 11 do
			add(data, COMMON) -- p10, p11
		end

		t.equal(PetLogic.fuseCandidates(data, COMMON, 1), { "p2", "p6", "p8", "p10", "p11", "p1", "p7" })
		t.equal(PetLogic.fuseCandidates(data, COMMON, 2), { "p4" })
		t.equal(PetLogic.fuseCandidates(data, COMMON, 3), {})
		t.equal(PetLogic.fuseCandidates(data, "not_a_pet", 1), {})
		t.equal(PetLogic.fuseSelection(data, COMMON, 1), { "p2", "p6", "p8", "p10" })
		t.equal(#(PetLogic.fuseSelection(data, COMMON, 1) :: any), G.fuseCount)
	end)

	t.test("a fuse falls back to equipped pets only when the unequipped ones run out", function()
		local data = newData()
		add(data, RARE, 2, { equipped = true }) -- p1
		add(data, RARE, 2) -- p2
		add(data, RARE, 2, { equipped = true }) -- p3
		add(data, RARE, 2) -- p4
		add(data, RARE, 2, { locked = true }) -- p5
		t.equal({ PetLogic.canFuse(data, RARE, 2) }, { true })
		t.equal(PetLogic.fuseSelection(data, RARE, 2), { "p2", "p4", "p1", "p3" })
	end)

	t.test("canFuse explains why a fuse is not possible", function()
		local data = newData()
		local name = Config.Pets.byId[COMMON].name
		t.equal({ PetLogic.canFuse(data, COMMON, 1) }, { false, "Need " .. G.fuseCount .. " more unlocked " .. name })
		for _ = 1, G.fuseCount - 1 do
			add(data, COMMON)
		end
		add(data, COMMON, 1, { locked = true })
		t.equal({ PetLogic.canFuse(data, COMMON, 1) }, { false, "Need 1 more unlocked " .. name })
		t.equal(PetLogic.fuseSelection(data, COMMON, 1), nil)
		add(data, COMMON)
		t.equal({ PetLogic.canFuse(data, COMMON, 1) }, { true })

		-- The highest tier cannot be fused further, however many there are.
		for _ = 1, G.fuseCount do
			add(data, COMMON, Config.Pets.maxTier)
		end
		t.equal({ PetLogic.canFuse(data, COMMON, Config.Pets.maxTier) }, { false, "Already the highest tier" })
		t.equal(PetLogic.fuseSelection(data, COMMON, Config.Pets.maxTier), nil)

		for _, bad in
			{
				{ "not_a_pet", 1 },
				{ COMMON, 0 },
				{ COMMON, 1.5 },
				{ COMMON, 99 },
				{ COMMON, NAN },
				{ 5, 1 },
				{ COMMON, "1" },
			}
		do
			t.equal({ PetLogic.canFuse(data, bad[1] :: any, bad[2] :: any) }, { false, "Unknown pet" })
		end
	end)

	---------------------------------------------------------------------------------------------
	-- EquippedPets attribute

	t.test("serializeEquipped writes petId:tier pairs, strongest first", function()
		local data = newData()
		t.equal(PetLogic.serializeEquipped(data), "")
		add(data, COMMON, 1, { equipped = true })
		add(data, LEGENDARY, 2, { equipped = true })
		add(data, EPIC, 3) -- not equipped
		add(data, COMMON, 3, { equipped = true })
		data.pets.list.ghost =
			{ id = "ghost", petId = "removed_pet", tier = 1, equipped = true, locked = false, obtainedAt = 0 }
		local text = PetLogic.serializeEquipped(data)
		t.equal(text, LEGENDARY .. ":2;" .. COMMON .. ":3;" .. COMMON .. ":1")
		t.equal(PetLogic.parseEquipped(text), {
			{ petId = LEGENDARY, tier = 2 },
			{ petId = COMMON, tier = 3 },
			{ petId = COMMON, tier = 1 },
		})
	end)

	t.test("every pet id survives the attribute round trip", function()
		local data = newData()
		local expected = {}
		for index, def in Config.Pets.list do
			local tier = 1 + index % Config.Pets.maxTier
			add(data, def.id, tier, { equipped = true })
		end
		for _, pet in Formulas.equippedPets(data) do
			table.insert(expected, { petId = pet.petId, tier = pet.tier })
		end
		local parsed = PetLogic.parseEquipped(PetLogic.serializeEquipped(data))
		t.equal(#expected, #Config.Pets.list)
		-- parseEquipped caps the number of entries; within the cap the order and content are identical.
		t.truthy(#parsed >= 20 and #parsed <= #expected)
		for index, entry in parsed do
			t.equal(entry, expected[index])
		end
	end)

	t.test("parseEquipped is tolerant of garbage", function()
		t.equal(PetLogic.parseEquipped(""), {})
		t.equal(PetLogic.parseEquipped(nil), {})
		t.equal(PetLogic.parseEquipped(42), {})
		t.equal(PetLogic.parseEquipped({}), {})
		t.equal(PetLogic.parseEquipped(";;;"), {})
		t.equal(PetLogic.parseEquipped("not_a_pet:1;" .. COMMON), {})
		t.equal(
			PetLogic.parseEquipped(
				COMMON
					.. ":2;;junk;"
					.. RARE
					.. ":0;:3;"
					.. EPIC
					.. ":99;"
					.. COMMON
					.. ":x;"
					.. COMMON
					.. ":1:1; "
					.. RARE
					.. ":1"
			),
			{
				{ petId = COMMON, tier = 2 },
				{ petId = RARE, tier = 1 },
				{ petId = EPIC, tier = Config.Pets.maxTier },
			}
		)
		local long = string.rep(COMMON .. ":1;", 500)
		local parsed = PetLogic.parseEquipped(long)
		t.truthy(#parsed <= 64, "bounded output for an oversized attribute")
	end)
end
