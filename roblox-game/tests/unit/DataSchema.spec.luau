-- Unit tests for Shared/Logic/DataSchema: defaults, reconcile (targeted cases plus seeded garbage fuzzing with
-- invariant and DataStore-safety checks), pet limits, the default session and the replicated view.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Logic = Shared:WaitForChild("Logic")
local DataSchema = require(Logic:WaitForChild("DataSchema"))
local Formulas = require(Logic:WaitForChild("Formulas"))
local PetLogic = require(Logic:WaitForChild("PetLogic"))
local QuestLogic = require(Logic:WaitForChild("QuestLogic"))
local TableUtil = require(Shared:WaitForChild("Util"):WaitForChild("TableUtil"))

local G = Config.Game
local NAN = 0 / 0
local INF = math.huge
local NOW = 1767268800 -- 2026-01-01 12:00 UTC
local TODAY = 20454

local MAX_EQUIPPED = G.basePetSlots + G.extraPetsPassSlots + Config.Upgrades.byId.petSlots.maxLevel

local function isFinite(value: any): boolean
	return type(value) == "number" and value == value and math.abs(value) ~= INF
end

local function isWhole(value: any): boolean
	return isFinite(value) and math.floor(value) == value
end

---------------------------------------------------------------------------------------------------
-- DataStore safety: only booleans / finite numbers / valid UTF-8 strings / tables; a table is either a dense
-- array or a dictionary with string keys. Returns a description of the first problem, or nil.

local function storageProblem(value: any, path: string): string?
	local kind = type(value)
	if kind == "boolean" then
		return nil
	elseif kind == "number" then
		return if isFinite(value) then nil else path .. " is not finite"
	elseif kind == "string" then
		return if utf8.len(value) then nil else path .. " is not valid UTF-8"
	elseif kind ~= "table" then
		return path .. " is a " .. typeof(value)
	end
	if getmetatable(value) ~= nil then
		return path .. " has a metatable"
	end
	local count, stringKeys = 0, 0
	for key, child in value do
		count += 1
		if type(key) == "string" then
			stringKeys += 1
			if not utf8.len(key) then
				return path .. " has a key that is not valid UTF-8"
			end
		elseif type(key) ~= "number" then
			return path .. " has a " .. type(key) .. " key"
		end
		local problem = storageProblem(child, path .. "." .. tostring(key))
		if problem then
			return problem
		end
	end
	if stringKeys > 0 and stringKeys ~= count then
		return path .. " mixes string and number keys"
	end
	if stringKeys == 0 and count ~= #value then
		return path .. " is a sparse array"
	end
	return nil
end

---------------------------------------------------------------------------------------------------
-- Schema invariants of reconciled data. Returns a description of the first violation, or nil.

local function check(condition: any, message: string)
	if not condition then
		error(message, 0)
	end
end

local function assertFlags(tbl: any, name: string, accept: ((key: string) -> boolean)?)
	check(type(tbl) == "table", name .. " must be a table")
	for key, value in tbl do
		check(type(key) == "string" and #key > 0, name .. " key must be a non-empty string")
		check(value == true, name .. "." .. key .. " must be true")
		check(accept == nil or accept(key), name .. "." .. key .. " is not allowed")
	end
end

local function schemaProblem(data: any): string?
	local ok, problem = pcall(function()
		local template = DataSchema.default(0)
		check(type(data) == "table", "data must be a table")
		for key, value in template do
			check(type(data[key]) == type(value), "field " .. key .. " has type " .. type(data[key]))
		end
		for key in data do
			check(template[key] ~= nil, "unexpected field " .. tostring(key))
		end

		check(data.version == DataSchema.VERSION, "version")
		for _, key in { "coins", "gems", "xp" } do
			check(isFinite(data[key]) and data[key] >= 0 and data[key] <= Formulas.MAX_CURRENCY, key .. " out of range")
		end
		check(isWhole(data.level) and data.level >= 1 and data.level <= G.levelCap, "level out of range")
		check(isWhole(data.rebirths) and data.rebirths >= 0, "rebirths out of range")
		for _, key in { "firstJoin", "lastJoin", "joins" } do
			check(isWhole(data[key]) and data[key] >= 0, key .. " out of range")
		end
		check(type(data.groupRewardClaimed) == "boolean", "groupRewardClaimed")

		for _, key in DataSchema.STAT_KEYS do
			check(data.stats[key] ~= nil, "stat " .. key .. " is missing")
		end
		for key, value in data.stats do
			check(type(key) == "string", "stat key")
			check(isFinite(value) and value >= 0, "stat " .. key .. " out of range")
		end

		-- Hammers
		assertFlags(data.hammers.owned, "hammers.owned", function(key)
			return Config.Hammers.byId[key] ~= nil
		end)
		check(data.hammers.owned[Config.Hammers.starterId] == true, "starter hammer must be owned")
		check(data.hammers.owned[data.hammers.equipped] == true, "equipped hammer must be owned")

		-- Zones: the hub plus a prefix of the zone order
		assertFlags(data.zones.unlocked, "zones.unlocked", function(key)
			return Config.Zones.byId[key] ~= nil
		end)
		check(data.zones.unlocked[Config.Zones.firstId] == true, "hub zone must be unlocked")
		local open = true
		for _, zone in Config.Zones.list do
			local unlocked = data.zones.unlocked[zone.id] == true
			check(open or not unlocked, "zone " .. zone.id .. " is unlocked behind a locked zone")
			open = unlocked
		end

		-- Pets
		check(isWhole(data.pets.nextId) and data.pets.nextId >= 1, "pets.nextId")
		local equipped, kinds = 0, {}
		for uid, pet in data.pets.list do
			check(type(pet) == "table", "pet must be a table")
			check(pet.id == uid, "pet.id must equal its key " .. tostring(uid))
			local number = PetLogic.uidNumber(uid)
			check(number ~= nil, "malformed pet uid " .. tostring(uid))
			check(number < data.pets.nextId, "pet uid " .. uid .. " is not below nextId")
			check(Config.Pets.byId[pet.petId] ~= nil, "unknown pet " .. tostring(pet.petId))
			check(isWhole(pet.tier) and pet.tier >= 1 and pet.tier <= Config.Pets.maxTier, "pet tier")
			check(type(pet.equipped) == "boolean" and type(pet.locked) == "boolean", "pet flags")
			check(isWhole(pet.obtainedAt) and pet.obtainedAt >= 0, "pet obtainedAt")
			check(TableUtil.count(pet) == 6, "pet has extra fields")
			equipped += if pet.equipped then 1 else 0
			kinds[pet.petId] = true
		end
		check(equipped <= MAX_EQUIPPED, "too many equipped pets: " .. equipped)
		assertFlags(data.petIndex, "petIndex", function(key)
			return Config.Pets.byId[key] ~= nil
		end)
		for petId in kinds do
			check(data.petIndex[petId] == true, "owned pet " .. petId .. " missing from petIndex")
		end
		check(data.stats.petsDiscovered >= TableUtil.count(data.petIndex), "petsDiscovered below the index size")

		-- Upgrades, boosts, achievements
		for id, level in data.upgrades do
			local def = Config.Upgrades.byId[id]
			check(def ~= nil, "unknown upgrade " .. tostring(id))
			check(isWhole(level) and level >= 0 and level <= def.maxLevel, "upgrade level " .. id)
		end
		for id, seconds in data.boosts do
			check(Config.Boosts.byId[id] ~= nil, "unknown boost " .. tostring(id))
			check(isFinite(seconds) and seconds > 0, "boost seconds " .. id)
		end
		for id, tiers in data.achievements do
			local def = Config.Achievements.byId[id]
			check(def ~= nil, "unknown achievement " .. tostring(id))
			check(isWhole(tiers) and tiers >= 0 and tiers <= #def.tiers, "achievement tiers " .. id)
		end

		-- Quests
		check(isWhole(data.quests.day) and data.quests.day >= 0, "quests.day")
		check(#data.quests.list <= G.questsPerDay, "too many quests")
		local seen = {}
		for _, quest in data.quests.list do
			check(Config.Quests.byId[quest.id] ~= nil, "unknown quest")
			check(not seen[quest.id], "duplicate quest " .. quest.id)
			seen[quest.id] = true
			check(isFinite(quest.goal) and quest.goal >= 1, "quest goal")
			check(isFinite(quest.progress) and quest.progress >= 0 and quest.progress <= quest.goal, "quest progress")
			check(type(quest.claimed) == "boolean", "quest claimed")
			check(TableUtil.count(quest) == 4, "quest has extra fields")
		end

		-- Daily, playtime, codes, purchases, passes
		check(isWhole(data.daily.lastClaimDay) and data.daily.lastClaimDay >= 0, "daily.lastClaimDay")
		check(isWhole(data.daily.streak) and data.daily.streak >= 0, "daily.streak")
		check(isWhole(data.playtime.day) and data.playtime.day >= 0, "playtime.day")
		check(isFinite(data.playtime.seconds) and data.playtime.seconds >= 0, "playtime.seconds")
		assertFlags(data.playtime.claimed, "playtime.claimed", function(key)
			local index = tonumber(key)
			return index ~= nil and tostring(index) == key and Config.PlaytimeRewards[index] ~= nil
		end)
		assertFlags(data.codes, "codes")
		assertFlags(data.purchases.oneTime, "purchases.oneTime")
		check(#data.purchases.history <= G.purchaseHistoryLimit, "purchase history too long")
		for _, id in data.purchases.history do
			check(type(id) == "string" and #id > 0, "purchase id")
		end
		assertFlags(data.grantedPasses, "grantedPasses", function(key)
			return Config.Monetization.Passes.byId[key] ~= nil
		end)

		-- Settings and tutorial
		local settings = data.settings
		check(isFinite(settings.music) and settings.music >= 0 and settings.music <= 1, "settings.music")
		check(isFinite(settings.sfx) and settings.sfx >= 0 and settings.sfx <= 1, "settings.sfx")
		for _, key in { "showOtherPets", "lowDetail", "autoSmash", "damageNumbers" } do
			check(type(settings[key]) == "boolean", "settings." .. key)
		end
		check(TableUtil.count(settings) == 6, "settings has extra fields")
		local steps = #Config.Tutorial.list
		check(
			isWhole(data.tutorial.step) and data.tutorial.step >= 1 and data.tutorial.step <= steps + 1,
			"tutorial.step"
		)
		check(type(data.tutorial.done) == "boolean", "tutorial.done")
		check(data.tutorial.step <= steps or data.tutorial.done, "tutorial past the last step must be done")
	end)
	return if ok then nil else tostring(problem)
end

-- True when the two values share a table anywhere (reconcile must not alias its input).
local function sharesTables(a: any, b: any): boolean
	local seen = {}
	local function collect(value: any)
		if type(value) == "table" and not seen[value] then
			seen[value] = true
			for key, child in next, value do -- next: hostile inputs may carry an __iter metamethod
				collect(key)
				collect(child)
			end
		end
	end
	collect(a)
	local function find(value: any): boolean
		if type(value) ~= "table" then
			return false
		end
		if seen[value] then
			return true
		end
		for _, child in next, value do
			if find(child) then
				return true
			end
		end
		return false
	end
	return find(b)
end

---------------------------------------------------------------------------------------------------
-- Valid data with every field in use.

local function richData()
	local data = DataSchema.default(1690000000)
	data.coins = 123456.5
	data.gems = 789
	data.xp = 42.25
	data.level = 17
	data.rebirths = 3
	data.stats.totalCoins = 9.9e12
	data.stats.crystalsSmashed = 5000
	data.stats.playSeconds = 7200.5
	data.stats.customCounter = 12 -- services may add their own counters

	data.hammers.owned.stone = true
	data.hammers.owned.iron = true
	data.hammers.owned.bronze = true
	data.hammers.equipped = "bronze"
	data.zones.unlocked.dunes = true
	data.zones.unlocked.peaks = true

	local eggPets = Config.Eggs.list[1].pets
	local first = PetLogic.newInstance(data, eggPets[1].petId, 1, 1700000001)
	local second = PetLogic.newInstance(data, eggPets[2].petId, 2, 1700000002)
	local third = PetLogic.newInstance(data, eggPets[5].petId, 3, 1700000003)
	PetLogic.newInstance(data, eggPets[1].petId, 1, 1700000004)
	PetLogic.newInstance(data, "royal_dragon", 1, 1700000005)
	first.equipped = true
	second.equipped = true
	third.equipped = true
	third.locked = true
	data.pets.list.p4 = nil -- a deleted pet leaves a gap in the uids
	data.pets.nextId = 9
	data.petIndex[Config.Eggs.list[2].pets[1].petId] = true -- discovered earlier, no longer owned
	data.stats.petsDiscovered = TableUtil.count(data.petIndex)

	data.upgrades = { power = 7, swift = 15, petSlots = 2, luck = 0 }
	data.boosts = { coins = 120.5, luck = 3600 }
	data.quests = { day = TODAY, list = QuestLogic.assign(TODAY, 7, data) }
	data.quests.list[1].progress = data.quests.list[1].goal
	data.quests.list[1].claimed = true
	data.quests.list[2].progress = 1
	data.achievements = { crystals = 2, level = 1 }
	data.daily = { lastClaimDay = TODAY - 1, streak = 4 }
	data.playtime = { day = TODAY, seconds = 1234, claimed = { ["1"] = true, ["2"] = true } }
	data.codes = { RELEASE = true, OLDCODE2019 = true }
	data.purchases = { history = { "purchase-a", "purchase-b" }, oneTime = { starterPack = true, vipPet = true } }
	data.grantedPasses = { vip = true }
	data.settings =
		{ music = 0.25, sfx = 1, showOtherPets = false, lowDetail = true, autoSmash = false, damageNumbers = false }
	data.tutorial = { step = #Config.Tutorial.list + 1, done = true }
	data.groupRewardClaimed = true
	data.lastJoin = 1699999999
	data.joins = 37
	return data
end

---------------------------------------------------------------------------------------------------
-- Garbage generators (seeded)

local JUNK_STRINGS = {
	"",
	"wood",
	"stone",
	"void",
	"banhammer",
	"meadow",
	"dunes",
	"peaks",
	"nexus",
	"atlantis",
	"clover_bunny",
	"royal_dragon",
	"not_a_pet",
	"p1",
	"p2",
	"p3",
	"p007",
	"p-1",
	"12",
	"1",
	"2",
	"99",
	"vip",
	"speed",
	"coins",
	"luck",
	"power",
	"petSlots",
	"smash_100",
	"hatch_3",
	"crystals",
	"true",
	"\255\254\253",
	"caf\195\169",
	string.rep("x", 300),
}

local SCHEMA_KEYS = {
	"version",
	"coins",
	"gems",
	"xp",
	"level",
	"rebirths",
	"stats",
	"hammers",
	"owned",
	"equipped",
	"zones",
	"unlocked",
	"pets",
	"list",
	"nextId",
	"petIndex",
	"upgrades",
	"boosts",
	"quests",
	"day",
	"achievements",
	"daily",
	"lastClaimDay",
	"streak",
	"playtime",
	"seconds",
	"claimed",
	"codes",
	"purchases",
	"history",
	"oneTime",
	"grantedPasses",
	"settings",
	"music",
	"sfx",
	"tutorial",
	"step",
	"done",
	"id",
	"petId",
	"tier",
	"locked",
	"obtainedAt",
	"progress",
	"goal",
	"totalCoins",
	"petsDiscovered",
}

local function newFuzzer(seed: number)
	local rng = Random.new(seed)
	local fuzz = {}

	local function pick(list)
		return list[rng:NextInteger(1, #list)]
	end

	function fuzz.scalar(): any
		local roll = rng:NextInteger(1, 18)
		if roll == 1 then
			return nil
		elseif roll == 2 then
			return true
		elseif roll == 3 then
			return false
		elseif roll == 4 then
			return 0
		elseif roll == 5 then
			return -rng:NextInteger(1, 1000000)
		elseif roll == 6 then
			return NAN
		elseif roll == 7 then
			return INF
		elseif roll == 8 then
			return -INF
		elseif roll == 9 then
			return rng:NextInteger(0, 12)
		elseif roll == 10 then
			return rng:NextNumber() * 1000
		elseif roll == 11 then
			return 1.7e308
		elseif roll == 12 then
			return 2 ^ 60 + 0.5
		elseif roll == 13 then
			return function() end
		elseif roll == 14 then
			return Vector3.new(1, 2, 3)
		elseif roll == 15 then
			return rng:NextInteger(1, 1e9) * 1e6
		else
			return pick(JUNK_STRINGS)
		end
	end

	function fuzz.key(): any
		local roll = rng:NextInteger(1, 10)
		if roll <= 5 then
			return pick(SCHEMA_KEYS)
		elseif roll <= 7 then
			return pick(JUNK_STRINGS)
		elseif roll == 8 then
			return rng:NextInteger(-2, 9)
		elseif roll == 9 then
			return rng:NextNumber() < 0.5
		else
			return rng:NextNumber() * 10
		end
	end

	function fuzz.value(depth: number): any
		if depth <= 0 or rng:NextNumber() < 0.45 then
			return fuzz.scalar()
		end
		local result = {}
		if rng:NextNumber() < 0.3 then
			for index = 1, rng:NextInteger(0, 8) do
				result[index] = fuzz.value(depth - 1) -- may leave holes: the scalar can be nil
			end
		end
		for _ = 1, rng:NextInteger(0, 7) do
			local key = fuzz.key()
			if key ~= nil and key == key then
				result[key] = fuzz.value(depth - 1)
			end
		end
		return result
	end

	-- A table shaped like saved data, with garbage in most places.
	function fuzz.shaped(): any
		local template = DataSchema.default(0)
		local result = {}
		for key, default in template do
			local roll = rng:NextNumber()
			if roll < 0.15 then
				result[key] = nil
			elseif roll < 0.3 then
				result[key] = default
			elseif type(default) == "table" then
				result[key] = fuzz.value(3)
			else
				result[key] = fuzz.scalar()
			end
		end
		for _ = 1, rng:NextInteger(0, 3) do
			local key = fuzz.key()
			if key ~= nil and key == key then
				result[key] = fuzz.value(2)
			end
		end
		return result
	end

	-- Valid data with `count` random corruptions somewhere inside.
	function fuzz.mutated(count: number): any
		local data = TableUtil.deepCopy(richData())
		for _ = 1, count do
			local slots = {}
			local function collect(tbl: any)
				table.insert(slots, tbl)
				for _, child in tbl do
					if type(child) == "table" then
						collect(child)
					end
				end
			end
			collect(data)
			local target = pick(slots)
			local keys = TableUtil.keys(target)
			local roll = rng:NextNumber()
			if roll < 0.6 and #keys > 0 then
				target[pick(keys)] = fuzz.value(2)
			else
				local key = fuzz.key()
				if key ~= nil and key == key then
					target[key] = fuzz.value(2)
				end
			end
		end
		return data
	end

	return fuzz
end

-- reconcile must survive `raw` and produce valid, storable, stable data.
local function assertReconciles(t, raw: any, label: string)
	local ok, result = pcall(DataSchema.reconcile, raw, NOW)
	if not ok then
		t.fail(label .. ": reconcile raised: " .. tostring(result))
	end
	local problem = schemaProblem(result) or storageProblem(result, "data")
	if problem then
		t.fail(label .. ": " .. problem)
	end
	t.falsy(sharesTables(raw, result), label .. ": the result aliases a table of the input")
	t.equal(DataSchema.reconcile(result, NOW), result, label .. ": reconcile must be idempotent")
	for key, value in Formulas.computeStats(result, DataSchema.defaultSession()) do
		t.truthy(isFinite(value), label .. ": stat " .. key .. " is not finite")
	end
	return result
end

return function(t)
	---------------------------------------------------------------------------------------------
	-- Defaults

	t.test("default data describes a fresh player", function()
		local data = DataSchema.default(NOW)
		t.equal(DataSchema.VERSION, G.dataVersion)
		t.equal(data.version, DataSchema.VERSION)
		t.equal({ data.coins, data.gems, data.xp, data.level, data.rebirths }, { 0, 0, 0, 1, 0 })
		t.equal(data.hammers, { owned = { [Config.Hammers.starterId] = true }, equipped = Config.Hammers.starterId })
		t.equal(data.zones, { unlocked = { [Config.Zones.firstId] = true } })
		t.equal(data.pets, { list = {}, nextId = 1 })
		t.equal(data.tutorial, { step = 1, done = false })
		t.equal(data.settings, {
			music = 0.5,
			sfx = 0.8,
			showOtherPets = true,
			lowDetail = false,
			autoSmash = true,
			damageNumbers = true,
		})
		t.equal({ data.firstJoin, data.lastJoin, data.joins }, { NOW, NOW, 0 })
		for _, key in DataSchema.STAT_KEYS do
			t.equal(data.stats[key], 0, key)
		end
		t.equal(#DataSchema.STAT_KEYS, 13)
		t.equal(schemaProblem(data), nil)
		t.equal(storageProblem(data, "data"), nil)
	end)

	t.test("every default call returns independent tables", function()
		local a, b = DataSchema.default(1), DataSchema.default(1)
		t.equal(a, b)
		t.falsy(sharesTables(a, b))
		a.settings.music = 0
		a.stats.totalCoins = 5
		a.hammers.owned.stone = true
		t.equal(DataSchema.default(1), b)
	end)

	t.test("default tolerates an odd timestamp", function()
		t.equal(DataSchema.default(NAN).firstJoin, 0)
		t.equal(DataSchema.default(-5).firstJoin, 0)
		t.equal(DataSchema.default(nil :: any).lastJoin, 0)
		t.equal(DataSchema.default(12.9).firstJoin, 12)
	end)

	---------------------------------------------------------------------------------------------
	-- Reconcile: whole-value cases

	t.test("reconcile of nothing or of a non-table is default data", function()
		local expected = DataSchema.default(NOW)
		local inputs: { any } = { 0, 42, "hello", true, false, NAN, function() end, Vector3.new(1, 2, 3), {} }
		t.equal(DataSchema.reconcile(nil, NOW), expected)
		for index, raw in inputs do
			t.equal(DataSchema.reconcile(raw, NOW), expected, "input " .. index)
		end
	end)

	t.test("valid data round-trips unchanged and is not aliased", function()
		local data = richData()
		t.equal(schemaProblem(data), nil)
		local copy = TableUtil.deepCopy(data)
		local result = DataSchema.reconcile(copy, NOW)
		t.equal(result, data)
		t.equal(copy, data, "reconcile must not modify its input")
		t.falsy(sharesTables(copy, result))
		t.equal(storageProblem(result, "data"), nil)

		local fresh = DataSchema.default(123456)
		t.equal(DataSchema.reconcile(TableUtil.deepCopy(fresh), NOW), fresh)
	end)

	t.test("missing fields are filled in without touching the ones that are there", function()
		local result = DataSchema.reconcile({ coins = 500, level = 9, settings = { music = 0.1 } }, NOW)
		local expected = DataSchema.default(NOW)
		expected.coins = 500
		expected.level = 9
		expected.settings.music = 0.1
		t.equal(result, expected)

		-- Every single top-level field can be missing on its own.
		local rich = richData()
		for key in rich do
			local partial = TableUtil.deepCopy(rich)
			partial[key] = nil
			assertReconciles(t, partial, "without " .. key)
		end
	end)

	t.test("unknown top-level fields are dropped and the version is current", function()
		local raw = TableUtil.deepCopy(richData()) :: any
		raw.hacked = true
		raw.inventory = { 1, 2, 3 }
		raw[1] = "array part"
		raw.version = 0
		local result = DataSchema.reconcile(raw, NOW)
		t.equal(result, richData())
	end)

	---------------------------------------------------------------------------------------------
	-- Reconcile: numbers

	t.test("numbers are clamped; NaN, infinity and wrong types fall back to the default", function()
		local result = DataSchema.reconcile({
			coins = -50,
			gems = NAN,
			xp = INF,
			level = 0,
			rebirths = -3,
			joins = 2.9,
			firstJoin = "yesterday",
			lastJoin = -INF,
		}, NOW)
		t.equal({ result.coins, result.gems, result.xp, result.level, result.rebirths }, { 0, 0, 0, 1, 0 })
		t.equal({ result.joins, result.firstJoin, result.lastJoin }, { 2, NOW, NOW })

		result = DataSchema.reconcile({ coins = 1e305, gems = 12.5, xp = 0.75, level = 5000, rebirths = 7.9 }, NOW)
		t.equal(result.coins, Formulas.MAX_CURRENCY)
		t.equal(result.gems, 12.5)
		t.equal(result.xp, 0.75)
		t.equal(result.level, G.levelCap)
		t.equal(result.rebirths, 7)

		result = DataSchema.reconcile({ coins = "999", level = true, rebirths = {}, gems = function() end }, NOW)
		t.equal({ result.coins, result.level, result.rebirths, result.gems }, { 0, 1, 0, 0 })
	end)

	t.test("stats keep valid counters (also custom ones) and repair the rest", function()
		local result = DataSchema.reconcile({
			stats = {
				totalCoins = 1e15,
				crystalsSmashed = -4,
				bigCrystals = NAN,
				eggsHatched = "12",
				customCounter = 3,
				badCounter = INF,
				[5] = 10,
				[true] = 1,
				["\255"] = 4,
				[string.rep("k", 200)] = 4,
				nested = { 1 },
			},
		}, NOW)
		local expected = DataSchema.default(NOW).stats
		expected.totalCoins = 1e15
		expected.customCounter = 3
		t.equal(result.stats, expected)
	end)

	---------------------------------------------------------------------------------------------
	-- Reconcile: hammers and zones

	t.test("unknown hammers are dropped and the starter hammer is always owned", function()
		local result = DataSchema.reconcile({
			hammers = {
				owned = { stone = true, banhammer = true, iron = false, gold = "yes", [3] = true },
				equipped = "stone",
			},
		}, NOW)
		t.equal(result.hammers, { owned = { wood = true, stone = true }, equipped = "stone" })
	end)

	t.test("an equipped hammer that is not owned is replaced by the best owned one", function()
		local result =
			DataSchema.reconcile({ hammers = { owned = { stone = true, iron = true }, equipped = "void" } }, NOW)
		t.equal(result.hammers.equipped, "iron")
		result =
			DataSchema.reconcile({ hammers = { owned = { iron = true, stone = true }, equipped = "banhammer" } }, NOW)
		t.equal(result.hammers.equipped, "iron")
		result = DataSchema.reconcile({ hammers = { owned = {}, equipped = 17 } }, NOW)
		t.equal(result.hammers, { owned = { wood = true }, equipped = "wood" })
		result = DataSchema.reconcile({ hammers = "all of them" }, NOW)
		t.equal(result.hammers, { owned = { wood = true }, equipped = "wood" })
		-- Owning a better hammer does not override a valid choice.
		result = DataSchema.reconcile({ hammers = { owned = { iron = true, stone = true }, equipped = "wood" } }, NOW)
		t.equal(result.hammers.equipped, "wood")
	end)

	t.test("zone unlocks become a prefix of the zone order", function()
		local function unlocked(raw)
			return DataSchema.reconcile({ zones = { unlocked = raw } }, NOW).zones.unlocked
		end
		t.equal(unlocked({ meadow = true, dunes = true, peaks = true }), { meadow = true, dunes = true, peaks = true })
		t.equal(unlocked({ dunes = true, grove = true, nexus = true }), { meadow = true, dunes = true })
		t.equal(unlocked({ peaks = true, atlantis = true }), { meadow = true })
		t.equal(unlocked({ meadow = false, dunes = "yes" }), { meadow = true })
		t.equal(unlocked(nil), { meadow = true })
		t.equal(unlocked(7), { meadow = true })

		local all = {}
		for _, zone in Config.Zones.list do
			all[zone.id] = true
		end
		t.equal(unlocked(TableUtil.deepCopy(all)), all)
	end)

	---------------------------------------------------------------------------------------------
	-- Reconcile: pets

	t.test("pets are kept well-formed: unknown kinds dropped, fields repaired, ids below nextId", function()
		local kind = Config.Pets.list[1].id
		local result = DataSchema.reconcile({
			pets = {
				nextId = 2,
				list = {
					p1 = { id = "p1", petId = kind, tier = 2, equipped = true, locked = true, obtainedAt = 50 },
					p7 = { id = "wrong", petId = kind, tier = 99, equipped = "yes", obtainedAt = NAN, extra = 1 },
					p3 = { id = "p3", petId = "not_a_pet", tier = 1 },
					p4 = "a pet",
					p5 = { tier = 1 },
				},
			},
		}, NOW)
		t.equal(result.pets, {
			nextId = 8,
			list = {
				p1 = { id = "p1", petId = kind, tier = 2, equipped = true, locked = true, obtainedAt = 50 },
				p7 = {
					id = "p7",
					petId = kind,
					tier = Config.Pets.maxTier,
					equipped = false,
					locked = false,
					obtainedAt = NOW,
				},
			},
		})
		t.equal(result.petIndex, { [kind] = true })
		t.equal(result.stats.petsDiscovered, 1)
	end)

	t.test("pets stored under malformed keys get fresh uids instead of being lost", function()
		local kind, other = Config.Pets.list[1].id, Config.Pets.list[2].id
		local raw = {
			pets = {
				nextId = "soon",
				list = {
					p2 = { petId = kind, tier = 1 },
					["7"] = { petId = other, tier = 1, obtainedAt = 5 },
					p007 = { petId = kind, tier = 3, obtainedAt = 6 },
					[4] = { petId = other, tier = 2, obtainedAt = 7 },
					pet = { petId = kind, tier = 2, obtainedAt = 8 },
				},
			},
		}
		local result = assertReconciles(t, raw, "malformed keys")
		t.equal(result.pets.nextId, 7)
		t.equal(result.pets.list.p2.petId, kind)
		local kinds = {}
		for uid, pet in result.pets.list do
			table.insert(kinds, pet.petId .. ":" .. pet.tier)
			t.equal(pet.id, uid)
		end
		table.sort(kinds)
		local expected = { kind .. ":1", kind .. ":2", kind .. ":3", other .. ":1", other .. ":2" }
		table.sort(expected)
		t.equal(kinds, expected)
		-- Deterministic: the same input always produces the same uids.
		t.equal(DataSchema.reconcile(raw, NOW), result)
	end)

	t.test("nextId always ends above every uid and is never lowered", function()
		local kind = Config.Pets.list[1].id
		local result = DataSchema.reconcile({ pets = { nextId = 500, list = { p3 = { petId = kind } } } }, NOW)
		t.equal(result.pets.nextId, 500)
		result = DataSchema.reconcile(
			{ pets = { nextId = -4, list = { p30 = { petId = kind }, p4 = { petId = kind } } } },
			NOW
		)
		t.equal(result.pets.nextId, 31)
		result = DataSchema.reconcile({ pets = { list = "none" } }, NOW)
		t.equal(result.pets, { list = {}, nextId = 1 })
	end)

	t.test("no more pets stay equipped than any player could equip; the weakest are unequipped", function()
		local eggPets = Config.Eggs.list[1].pets
		local list = {}
		for index = 1, 12 do
			local petId = if index <= 2 then eggPets[5].petId else eggPets[1].petId
			list["p" .. index] = { petId = petId, tier = 1, equipped = true }
		end
		local result = assertReconciles(t, { pets = { list = list, nextId = 13 } }, "too many equipped")
		local total, equipped = Formulas.countPets(result)
		t.equal(total, 12)
		t.equal(equipped, MAX_EQUIPPED)
		t.truthy(result.pets.list.p1.equipped and result.pets.list.p2.equipped, "the strongest stay equipped")
		t.truthy(result.pets.list.p3.equipped, "ties keep the oldest")
		t.falsy(result.pets.list.p12.equipped)
	end)

	t.test("an absurd number of pets is cut down to the strongest", function()
		local eggPets = Config.Eggs.list[1].pets
		local list = {}
		for index = 1, 1500 do
			local petId = if index > 1490 then eggPets[5].petId else eggPets[1].petId
			list["p" .. index] = { petId = petId, tier = 1 }
		end
		local result = assertReconciles(t, { pets = { list = list, nextId = 1501 } }, "huge inventory")
		t.equal((Formulas.countPets(result)), 1000)
		t.equal(result.pets.nextId, 1501)
		for index = 1491, 1500 do
			t.truthy(result.pets.list["p" .. index], "strong pet p" .. index .. " must survive")
		end
	end)

	t.test("the pet index keeps known discoveries and gains every owned kind", function()
		local kind, other = Config.Pets.list[1].id, Config.Pets.list[2].id
		local result = DataSchema.reconcile({
			petIndex = { [other] = true, not_a_pet = true, [Config.Pets.list[3].id] = false },
			pets = { list = { p1 = { petId = kind } } },
			stats = { petsDiscovered = 9 },
		}, NOW)
		t.equal(result.petIndex, { [kind] = true, [other] = true })
		t.equal(result.stats.petsDiscovered, 9) -- pets that left Config still count as discovered
	end)

	---------------------------------------------------------------------------------------------
	-- Reconcile: the rest

	t.test("upgrades, boosts and achievements only keep known ids with values in range", function()
		local result = DataSchema.reconcile({
			upgrades = { power = 12, swift = 99, fortune = -3, wisdom = 2.9, luck = NAN, madeUp = 5, [1] = 3 },
			boosts = { coins = 90.5, xp = 0, luck = -10, damage = NAN, turbo = 500 },
			achievements = { crystals = 2, level = 99, coins = -1, eggs = "3", madeUp = 1 },
		}, NOW)
		t.equal(result.upgrades, {
			power = 12,
			swift = Config.Upgrades.byId.swift.maxLevel,
			fortune = 0,
			wisdom = 2,
			luck = 0,
		})
		t.equal(result.boosts, { coins = 90.5 })
		t.equal(result.achievements, {
			crystals = 2,
			level = #Config.Achievements.byId.level.tiers,
			coins = 0,
			eggs = 0,
		})
	end)

	t.test("quests keep known, distinct, well-formed entries (at most questsPerDay)", function()
		local result = DataSchema.reconcile({
			quests = {
				day = TODAY + 0.5,
				list = {
					{ id = "smash_100", progress = 150, goal = 100, claimed = true },
					{ id = "made_up", progress = 1, goal = 5, claimed = false },
					{ id = "smash_100", progress = 1, goal = 100, claimed = false },
					"junk",
					{ id = "hatch_3", progress = -2, goal = NAN },
					{ id = "coins_small", progress = 10, goal = 32000, claimed = "no" },
					{ id = "boss_1", progress = 0, goal = 1, claimed = false },
				},
			},
		}, NOW)
		t.equal(result.quests, {
			day = TODAY,
			list = {
				{ id = "smash_100", progress = 100, goal = 100, claimed = true },
				{ id = "hatch_3", progress = 0, goal = Config.Quests.byId.hatch_3.goal, claimed = false },
				{ id = "coins_small", progress = 10, goal = 32000, claimed = false },
			},
		})

		t.equal(DataSchema.reconcile({ quests = { list = { [2] = { id = "smash_100" } } } }, NOW).quests.list, {})
		t.equal(DataSchema.reconcile({ quests = { day = -1, list = 5 } }, NOW).quests, { day = 0, list = {} })
	end)

	t.test("the purchase history keeps the last 100 valid ids in order", function()
		local history = {}
		for index = 1, 250 do
			history[index] = "purchase-" .. index
		end
		history[40] = 12345
		history[249] = ""
		local result = DataSchema.reconcile({
			purchases = {
				history = history,
				oneTime = { starterPack = true, royalDragon = false, [3] = true, oldProduct = true },
			},
		}, NOW)
		t.equal(#result.purchases.history, G.purchaseHistoryLimit)
		t.equal(result.purchases.history[G.purchaseHistoryLimit], "purchase-250")
		t.equal(result.purchases.history[G.purchaseHistoryLimit - 1], "purchase-248")
		t.equal(result.purchases.history[1], "purchase-150")
		-- One-time purchases are records of real money: unknown keys are kept.
		t.equal(result.purchases.oneTime, { starterPack = true, oldProduct = true })

		result = DataSchema.reconcile({ purchases = { history = { "a", "b", "c" } } }, NOW)
		t.equal(result.purchases, { history = { "a", "b", "c" }, oneTime = {} })
		result = DataSchema.reconcile({ purchases = { history = { a = "x", "first", nil, "third" } } }, NOW)
		t.equal(storageProblem(result, "data"), nil)
	end)

	t.test("codes, granted passes, playtime, daily, settings and tutorial are sanitised", function()
		local result = DataSchema.reconcile({
			codes = { RELEASE = true, RETIRED = true, CRYSTALS = false, [7] = true, ["\255\255"] = true },
			grantedPasses = { vip = true, madeUpPass = true, speed = "yes" },
			playtime = {
				day = TODAY,
				seconds = -30,
				claimed = { ["1"] = true, ["9"] = true, ["2"] = 1, [3] = true, x = true },
			},
			daily = { lastClaimDay = TODAY - 1.5, streak = -2 },
			settings = { music = 7, sfx = -1, showOtherPets = "no", lowDetail = true, autoSmash = 0, volume = 11 },
			tutorial = { step = 99, done = false },
			groupRewardClaimed = "true",
		}, NOW)
		t.equal(result.codes, { RELEASE = true, RETIRED = true })
		t.equal(result.grantedPasses, { vip = true })
		t.equal(result.playtime, { day = TODAY, seconds = 0, claimed = { ["1"] = true } })
		t.equal(result.daily, { lastClaimDay = TODAY - 2, streak = 0 })
		t.equal(result.settings, {
			music = 1,
			sfx = 0,
			showOtherPets = true,
			lowDetail = true,
			autoSmash = true,
			damageNumbers = true,
		})
		t.equal(result.tutorial, { step = #Config.Tutorial.list + 1, done = true })
		t.equal(result.groupRewardClaimed, false)

		result = DataSchema.reconcile({ tutorial = { step = 3, done = true } }, NOW)
		t.equal(result.tutorial, { step = 3, done = true })
		result = DataSchema.reconcile({ tutorial = { step = 0 } }, NOW)
		t.equal(result.tutorial, { step = 1, done = false })
	end)

	t.test("hostile tables (metatables, cycles) do not break reconcile", function()
		local cyclic: any = { coins = 5 }
		cyclic.stats = cyclic
		cyclic.pets = { list = cyclic, nextId = cyclic }
		assertReconciles(t, cyclic, "cyclic")

		local trapped = setmetatable({ coins = 10 }, {
			__index = function()
				error("__index must not be called")
			end,
			__iter = function()
				error("__iter must not be called")
			end,
		})
		local result = assertReconciles(
			t,
			{ coins = 1, stats = trapped, hammers = trapped, pets = { list = trapped } },
			"metatable"
		)
		t.equal(result.coins, 1)
		t.equal(assertReconciles(t, trapped, "metatable root").coins, 10)
	end)

	---------------------------------------------------------------------------------------------
	-- Reconcile: fuzzing

	t.test("fuzz: 300 random garbage values reconcile into valid, storable, stable data", function()
		local fuzz = newFuzzer(20260101)
		for index = 1, 300 do
			assertReconciles(t, fuzz.value(4), "garbage #" .. index)
		end
	end)

	t.test("fuzz: 300 save-shaped tables full of garbage reconcile into valid data", function()
		local fuzz = newFuzzer(424242)
		for index = 1, 300 do
			assertReconciles(t, fuzz.shaped(), "shaped #" .. index)
		end
	end)

	t.test("fuzz: 400 corrupted copies of valid data reconcile into valid data", function()
		local fuzz = newFuzzer(777)
		for index = 1, 400 do
			assertReconciles(t, fuzz.mutated(1 + index % 6), "mutated #" .. index)
		end
	end)

	t.test("fuzz: a single corruption never damages unrelated top-level fields", function()
		local fuzz = newFuzzer(99)
		local rich = richData()
		-- Fields that other fields legitimately influence (pets feed petIndex / the discovery counter).
		local coupled = { pets = { petIndex = true, stats = true }, petIndex = { stats = true } }
		for index = 1, 200 do
			local raw = TableUtil.deepCopy(rich)
			local keys = TableUtil.sortedKeys(raw)
			local key = keys[1 + index % #keys]
			raw[key] = fuzz.value(3)
			local result = assertReconciles(t, raw, "single #" .. index)
			for other, expected in rich do
				if other ~= key and not (coupled[key] and coupled[key][other]) then
					t.equal(result[other], expected, "corrupting " .. key .. " changed " .. other)
				end
			end
		end
	end)

	t.test("reconciled data survives a (mock) DataStore round trip unchanged", function()
		local store = game:GetService("DataStoreService"):GetDataStore("DataSchemaSpec")
		local fuzz = newFuzzer(31337)
		local samples = { DataSchema.default(NOW), richData() }
		for index = 1, 40 do
			table.insert(samples, DataSchema.reconcile(if index % 2 == 0 then fuzz.shaped() else fuzz.mutated(4), NOW))
		end
		for index, data in samples do
			local key = "sample_" .. index
			store:SetAsync(key, data) -- raises for anything Roblox could not store
			t.equal(store:GetAsync(key), data, "sample " .. index)
		end
		t.equal(t.env.errors, {})
	end)

	---------------------------------------------------------------------------------------------
	-- enforcePetLimits

	t.test("enforcePetLimits unequips the weakest pets beyond the limit", function()
		local data = DataSchema.default(0)
		local eggPets = Config.Eggs.list[1].pets
		local weakA = PetLogic.newInstance(data, eggPets[1].petId, 1, 0) -- p1
		local strong = PetLogic.newInstance(data, eggPets[5].petId, 1, 0) -- p2
		local weakB = PetLogic.newInstance(data, eggPets[1].petId, 1, 0) -- p3
		local golden = PetLogic.newInstance(data, eggPets[1].petId, 2, 0) -- p4
		local resting = PetLogic.newInstance(data, eggPets[4].petId, 3, 0) -- p5, not equipped
		for _, pet in { weakA, strong, weakB, golden } do
			pet.equipped = true
		end

		t.equal(DataSchema.enforcePetLimits(data, 4), {})
		t.equal(DataSchema.enforcePetLimits(data, 10), {})
		t.equal(DataSchema.enforcePetLimits(data, 3), { "p3" }) -- weakest; of two equal pets the newer one goes
		t.equal({ weakA.equipped, strong.equipped, weakB.equipped, golden.equipped }, { true, true, false, true })
		t.equal(DataSchema.enforcePetLimits(data, 1), { "p4", "p1" })
		t.equal({ weakA.equipped, strong.equipped, golden.equipped }, { false, true, false })
		t.equal(DataSchema.enforcePetLimits(data, 0), { "p2" })
		t.equal(resting.equipped, false)
		t.equal((select(2, Formulas.countPets(data))), 0)
	end)

	t.test("enforcePetLimits tolerates odd limits and unknown pets", function()
		local data = DataSchema.default(0)
		local pet = PetLogic.newInstance(data, Config.Pets.list[1].id, 1, 0)
		pet.equipped = true
		data.pets.list.p9 =
			{ id = "p9", petId = "removed_pet", tier = 1, equipped = true, locked = false, obtainedAt = 0 }
		t.equal(DataSchema.enforcePetLimits(data, 1), { "p9" }) -- the unknown pet has no power: it goes first
		t.equal(DataSchema.enforcePetLimits(data, NAN), { "p1" })
		pet.equipped = true
		t.equal(DataSchema.enforcePetLimits(data, -3), { "p1" })
		pet.equipped = true
		t.equal(DataSchema.enforcePetLimits(data, 2.9), {})
	end)

	---------------------------------------------------------------------------------------------
	-- Session and replication

	t.test("defaultSession has neutral values and stats computed for default data", function()
		local session = DataSchema.defaultSession()
		t.equal(session.passes, {})
		t.equal(session.boostEnds, {})
		t.equal({ session.friendCount, session.premium, session.inGroup, session.serverLuck }, { 0, false, false, 1 })
		t.equal(session.randomItemsRestricted, true) -- fail closed until PolicyService has answered
		t.equal(session.stats, Formulas.computeStats(DataSchema.default(0), session))
		t.equal(session.stats.damage, Config.Hammers.byId[Config.Hammers.starterId].damage)
		t.equal(session.stats.coinMult, 1)

		local other = DataSchema.defaultSession()
		t.falsy(sharesTables(session, other))
		session.passes.vip = true
		t.equal(other.passes, {})
	end)

	t.test("toReplicated is the data plus the session and leaves the data untouched", function()
		local data = richData()
		local before = TableUtil.deepCopy(data)
		local session = DataSchema.defaultSession()
		local state = DataSchema.toReplicated(data, session)

		t.equal(state.session, session)
		t.equal(state.session.stats.petSlots, 3)
		for key, value in data do
			t.truthy(state[key] == value, key .. " must be the same value")
		end
		local count = 0
		for _ in pairs(state) do
			count += 1
		end
		t.equal(count, TableUtil.count(data) + 1)
		t.equal(data, before)
		t.equal((data :: any).session, nil)
		t.truthy(state ~= data)
	end)
end
