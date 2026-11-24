-- Unit tests for Shared/Util/TableUtil.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local TableUtil = require(Shared:WaitForChild("Util"):WaitForChild("TableUtil"))

local NAN = 0 / 0

-- Deterministic stand-in for Roblox's Random (Park-Miller LCG): the test environment may not provide Random,
-- and the utilities only need NextNumber/NextInteger.
local function newStubRandom(seed: number)
	local state = seed % 2147483647
	if state <= 0 then
		state += 2147483646
	end
	local rng = {}
	function rng:NextNumber(min: number?, max: number?): number
		state = (state * 48271) % 2147483647
		local unit = (state - 1) / 2147483646
		if min ~= nil and max ~= nil then
			return min + unit * (max - min)
		end
		return unit
	end
	function rng:NextInteger(min: number, max: number): number
		return min + math.floor(self:NextNumber() * (max - min + 1))
	end
	return rng
end

return function(t)
	t.test("deepCopy copies nested tables without sharing them", function()
		local original = { coins = 5, pets = { list = { a = { tier = 1 } }, order = { "a", "b" } } }
		local copy = TableUtil.deepCopy(original)
		t.equal(copy, original)
		t.truthy(copy ~= original)
		t.truthy(copy.pets ~= original.pets)
		t.truthy(copy.pets.list.a ~= original.pets.list.a)
		copy.pets.list.a.tier = 3
		table.insert(copy.pets.order, "c")
		t.equal(original.pets.list.a.tier, 1)
		t.equal(#original.pets.order, 2)
	end)

	t.test("deepCopy passes non-tables through and keeps shared/cyclic structure", function()
		t.equal(TableUtil.deepCopy(5), 5)
		t.equal(TableUtil.deepCopy("x"), "x")
		t.equal(TableUtil.deepCopy(nil), nil)
		t.equal(TableUtil.deepCopy(false), false)
		local shared = { value = 1 }
		local source = { first = shared, second = shared }
		source.self = source
		local copy = TableUtil.deepCopy(source)
		t.truthy(copy.first == copy.second, "a shared reference stays shared in the copy")
		t.truthy(copy.first ~= shared)
		t.truthy(copy.self == copy, "a cycle points at the copy, not at the original")
	end)

	t.test("deepEqual", function()
		t.truthy(TableUtil.deepEqual(1, 1))
		t.truthy(TableUtil.deepEqual("a", "a"))
		t.truthy(TableUtil.deepEqual(nil, nil))
		t.truthy(TableUtil.deepEqual({}, {}))
		t.truthy(TableUtil.deepEqual({ a = 1, b = { c = { 1, 2, 3 } } }, { a = 1, b = { c = { 1, 2, 3 } } }))
		t.falsy(TableUtil.deepEqual(1, 2))
		t.falsy(TableUtil.deepEqual(1, "1"))
		t.falsy(TableUtil.deepEqual({}, nil))
		t.falsy(TableUtil.deepEqual(nil, {}))
		t.falsy(TableUtil.deepEqual({ a = 1 }, { a = 2 }))
		t.falsy(TableUtil.deepEqual({ a = 1 }, { a = 1, b = 2 }), "extra key on the right")
		t.falsy(TableUtil.deepEqual({ a = 1, b = 2 }, { a = 1 }), "extra key on the left")
		t.falsy(TableUtil.deepEqual({ 1, 2, 3 }, { 1, 3, 2 }), "array order matters")
		t.falsy(TableUtil.deepEqual({ a = { b = 1 } }, { a = { b = { 1 } } }))
		t.falsy(TableUtil.deepEqual(NAN, NAN), "NaN equals nothing")
		t.truthy(TableUtil.deepEqual({ a = false }, { a = false }))
		t.falsy(TableUtil.deepEqual({ a = false }, {}))
	end)

	t.test("getPath", function()
		local data = { coins = 7, pets = { list = { p1 = { tier = 2 } } }, quests = { list = { { id = "q" } } } }
		t.equal(TableUtil.getPath(data, { "coins" }), 7)
		t.equal(TableUtil.getPath(data, { "pets", "list", "p1", "tier" }), 2)
		t.truthy(TableUtil.getPath(data, { "pets", "list" }) == data.pets.list)
		t.truthy(TableUtil.getPath(data, {}) == data, "empty path returns the root")
		t.equal(TableUtil.getPath(data, { "missing" }), nil)
		t.equal(TableUtil.getPath(data, { "missing", "deeper", "still" }), nil)
		t.equal(TableUtil.getPath(data, { "coins", "x" }), nil, "walking through a number yields nil, not an error")
		t.equal(TableUtil.getPath(data, { "quests", "list", 1, "id" }), "q", "numbers address array slots")
		t.equal(TableUtil.getPath(data, { "quests", "list", "1", "id" }), nil, 'the string "1" is not the index 1')
		t.equal(TableUtil.getPath(nil, { "a" }), nil)
		t.equal(TableUtil.getPath(5, {}), 5)
	end)

	t.test("setPath writes, creates intermediate tables and replaces blocking values", function()
		local data = { coins = 1, hammers = { owned = { wood = true } } }
		TableUtil.setPath(data, { "coins" }, 50)
		TableUtil.setPath(data, { "hammers", "owned", "stone" }, true)
		TableUtil.setPath(data, { "session", "stats", "damage" }, 12)
		t.equal(data, {
			coins = 50,
			hammers = { owned = { wood = true, stone = true } },
			session = { stats = { damage = 12 } },
		})
		TableUtil.setPath(data, { "coins", "nested" }, 1)
		t.equal(data.coins, { nested = 1 }, "a number in the way is replaced by a table")
		local value = { 1, 2 }
		TableUtil.setPath(data, { "list" }, value)
		t.truthy(data.list == value, "tables are stored by reference, not copied")
		TableUtil.setPath(data, { "list", 2 }, "two")
		t.equal(data.list, { 1, "two" })
	end)

	t.test("setPath with nil deletes without creating tables", function()
		local data = { codes = { RELEASE = true, SMASH100 = true } }
		TableUtil.setPath(data, { "codes", "RELEASE" }, nil)
		t.equal(data, { codes = { SMASH100 = true } })
		TableUtil.setPath(data, { "boosts", "coins" }, nil)
		t.equal(data.boosts, nil, "deleting below a missing table must not create it")
		TableUtil.setPath(data, { "codes" }, nil)
		t.equal(data, {})
	end)

	t.test("setPath rejects an empty path and a non-table root", function()
		t.throws(function()
			TableUtil.setPath({}, {}, 1)
		end)
		t.throws(function()
			TableUtil.setPath(nil, { "a" }, 1)
		end)
		t.throws(function()
			TableUtil.setPath(5, { "a" }, 1)
		end)
	end)

	t.test("getPath reads back what setPath wrote", function()
		local data = {}
		local paths = { { "a" }, { "b", "c" }, { "b", "d", "e" }, { "f", "g", "h", "i" } }
		for index, path in paths do
			TableUtil.setPath(data, path, index * 10)
		end
		for index, path in paths do
			t.equal(TableUtil.getPath(data, path), index * 10)
		end
	end)

	t.test("count, isEmpty", function()
		t.equal(TableUtil.count({}), 0)
		t.equal(TableUtil.count({ 1, 2, 3 }), 3)
		t.equal(TableUtil.count({ a = 1, b = 2 }), 2)
		t.equal(TableUtil.count({ 1, 2, a = 1, b = false }), 4)
		t.truthy(TableUtil.isEmpty({}))
		t.falsy(TableUtil.isEmpty({ 1 }))
		t.falsy(TableUtil.isEmpty({ a = false }))
	end)

	t.test("keys, values, sortedKeys", function()
		local dict = { banana = 2, apple = 1, cherry = 3 }
		local keys = TableUtil.keys(dict)
		table.sort(keys)
		t.equal(keys, { "apple", "banana", "cherry" })
		local values = TableUtil.values(dict)
		table.sort(values)
		t.equal(values, { 1, 2, 3 })
		t.equal(TableUtil.sortedKeys(dict), { "apple", "banana", "cherry" })
		t.equal(TableUtil.sortedKeys({ [3] = "c", [1] = "a", [2] = "b" }), { 1, 2, 3 })
		t.equal(TableUtil.sortedKeys({ [10] = true, b = true, [2] = true, a = true }), { 2, 10, "a", "b" })
		t.equal(TableUtil.keys({}), {})
		t.equal(TableUtil.values({}), {})
		t.equal(TableUtil.sortedKeys({}), {})
	end)

	t.test("map and filter build new dense arrays", function()
		local source = { 1, 2, 3, 4 }
		t.equal(
			TableUtil.map(source, function(value, index)
				return value * 10 + index
			end),
			{ 11, 22, 33, 44 }
		)
		t.equal(
			TableUtil.map(source, function(value)
				return if value % 2 == 0 then value else nil
			end),
			{ 2, 4 },
			"nil results are skipped"
		)
		t.equal(
			TableUtil.filter(source, function(value)
				return value > 2
			end),
			{ 3, 4 }
		)
		t.equal(
			TableUtil.filter(source, function(_, index)
				return index == 1
			end),
			{ 1 }
		)
		t.equal(source, { 1, 2, 3, 4 }, "the input is not modified")
		t.equal(
			TableUtil.map({}, function(value)
				return value
			end),
			{}
		)
	end)

	t.test("shuffle returns a permutation in a new array and leaves the input alone", function()
		local source = {}
		for index = 1, 20 do
			source[index] = index
		end
		local shuffled = TableUtil.shuffle(source, newStubRandom(42))
		t.truthy(shuffled ~= source)
		for index = 1, 20 do
			t.equal(source[index], index)
		end
		t.equal(#shuffled, 20)
		local sorted = table.clone(shuffled)
		table.sort(sorted)
		t.equal(sorted, source)
		t.falsy(TableUtil.deepEqual(shuffled, source), "20 elements staying in place would be astronomically unlikely")
	end)

	t.test("shuffle is deterministic per seed and handles tiny arrays", function()
		local source = { "a", "b", "c", "d", "e", "f", "g", "h" }
		local first = TableUtil.shuffle(source, newStubRandom(7))
		local again = TableUtil.shuffle(source, newStubRandom(7))
		local other = TableUtil.shuffle(source, newStubRandom(8))
		t.equal(first, again)
		t.falsy(TableUtil.deepEqual(first, other))
		t.equal(TableUtil.shuffle({}, newStubRandom(1)), {})
		t.equal(TableUtil.shuffle({ "only" }, newStubRandom(1)), { "only" })
	end)

	t.test("shuffle produces every permutation about equally often", function()
		local rng = newStubRandom(2024)
		local counts = {}
		local rounds = 12000
		for _ = 1, rounds do
			local key = table.concat(TableUtil.shuffle({ "a", "b", "c" }, rng))
			counts[key] = (counts[key] or 0) + 1
		end
		t.equal(TableUtil.count(counts), 6)
		for key, amount in counts do
			t.near(amount / rounds, 1 / 6, 0.02, `permutation {key}`)
		end
	end)

	t.test("shuffle works with the environment's Random when there is one", function()
		local RandomClass = Random
		if RandomClass == nil then
			return
		end
		local shuffled = TableUtil.shuffle({ 1, 2, 3, 4, 5 }, RandomClass.new(5))
		table.sort(shuffled)
		t.equal(shuffled, { 1, 2, 3, 4, 5 })
	end)

	t.test("clampNumber", function()
		t.equal(TableUtil.clampNumber(5, 0, 10, 1), 5)
		t.equal(TableUtil.clampNumber(-5, 0, 10, 1), 0)
		t.equal(TableUtil.clampNumber(50, 0, 10, 1), 10)
		t.equal(TableUtil.clampNumber(2.5, 0, 10, 1), 2.5)
		t.equal(TableUtil.clampNumber(0, 0, 10, 1), 0)
		t.equal(TableUtil.clampNumber(NAN, 0, 10, 1), 1)
		t.equal(TableUtil.clampNumber(math.huge, 0, 10, 1), 1)
		t.equal(TableUtil.clampNumber(-math.huge, 0, 10, 1), 1)
		t.equal(TableUtil.clampNumber(nil, 0, 10, 1), 1)
		t.equal(TableUtil.clampNumber("7", 0, 10, 1), 1)
		t.equal(TableUtil.clampNumber({}, 0, 10, 1), 1)
		t.equal(TableUtil.clampNumber(true, 0, 10, 1), 1)
		t.equal(TableUtil.clampNumber(5, 10, 0, 3), 3, "an empty range yields the default instead of an error")
		t.equal(TableUtil.clampNumber(1e300, 0, math.huge, 1), 1e300)
	end)

	t.test("clampInteger", function()
		t.equal(TableUtil.clampInteger(5.9, 0, 10, 1), 5)
		t.equal(TableUtil.clampInteger(-0.5, -3, 10, 1), -1)
		t.equal(TableUtil.clampInteger(99.5, 0, 10, 1), 10)
		t.equal(TableUtil.clampInteger(-99, 0, 10, 1), 0)
		t.equal(TableUtil.clampInteger(NAN, 0, 10, 1), 1)
		t.equal(TableUtil.clampInteger(math.huge, 0, 10, 1), 1)
		t.equal(TableUtil.clampInteger("3", 0, 10, 1), 1)
		t.equal(TableUtil.clampInteger(nil, 0, 10, 1), 1)
		t.equal(TableUtil.clampInteger(1, 1, 0, 0), 0, "index into an empty list")
	end)
end
