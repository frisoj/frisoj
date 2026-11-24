-- Unit tests for Shared/Util/WeightedRandom.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local WeightedRandom = require(Shared:WaitForChild("Util"):WaitForChild("WeightedRandom"))

local NAN = 0 / 0

-- Deterministic stand-in for Roblox's Random (Park-Miller LCG); `calls` counts NextNumber draws.
local function newStubRandom(seed: number)
	local state = seed % 2147483647
	if state <= 0 then
		state += 2147483646
	end
	local rng = { calls = 0 }
	function rng:NextNumber(): number
		self.calls += 1
		state = (state * 48271) % 2147483647
		return (state - 1) / 2147483646
	end
	function rng:NextInteger(min: number, max: number): number
		return min + math.floor(self:NextNumber() * (max - min + 1))
	end
	return rng
end

-- Random whose NextNumber returns the given values in order (to hit exact boundaries).
local function scriptedRandom(values: { number })
	local rng = { calls = 0 }
	function rng:NextNumber(): number
		self.calls += 1
		local value = values[self.calls]
		assert(value ~= nil, "scriptedRandom ran out of values")
		return value
	end
	return rng
end

local function weightOf(entry): number
	return entry.weight
end

return function(t)
	t.test("empty input returns nil and draws nothing", function()
		local rng = newStubRandom(1)
		t.equal(WeightedRandom.pick({}, weightOf, rng), nil)
		t.equal(WeightedRandom.pickIndex({}, weightOf, rng), nil)
		t.equal(WeightedRandom.pickItem({}, rng), nil)
		t.equal(rng.calls, 0)
	end)

	t.test("total weight 0 returns nil and draws nothing", function()
		local rng = newStubRandom(1)
		local entries = { { id = "a", weight = 0 }, { id = "b", weight = 0 } }
		t.equal(WeightedRandom.pick(entries, weightOf, rng), nil)
		t.equal(WeightedRandom.pickIndex(entries, weightOf, rng), nil)
		t.equal(WeightedRandom.pickItem({ { item = "a", weight = 0 } }, rng), nil)
		t.equal(rng.calls, 0)
	end)

	t.test("invalid weights count as zero", function()
		local rng = newStubRandom(3)
		local entries = {
			{ id = "negative", weight = -5 },
			{ id = "nan", weight = NAN },
			{ id = "infinite", weight = math.huge },
			{ id = "text", weight = "10" },
			{ id = "missing" },
		}
		t.equal(WeightedRandom.pick(entries, weightOf, rng), nil)
		t.equal(rng.calls, 0)
		table.insert(entries, { id = "valid", weight = 0.001 })
		for _ = 1, 200 do
			local picked = WeightedRandom.pick(entries, weightOf, rng)
			t.equal(picked.id, "valid")
		end
	end)

	t.test("a single entry is always picked, with one draw per pick", function()
		local rng = newStubRandom(9)
		local entries = { { id = "only", weight = 3 } }
		for _ = 1, 50 do
			t.truthy(WeightedRandom.pick(entries, weightOf, rng) == entries[1])
		end
		t.equal(rng.calls, 50)
	end)

	t.test("boundaries: roll * total selects the half-open interval of each entry", function()
		local entries = { { id = "a", weight = 1 }, { id = "b", weight = 2 }, { id = "c", weight = 1 } }
		-- total 4 → a: [0, 1), b: [1, 3), c: [3, 4)
		local cases = {
			{ 0, "a" },
			{ 0.2499, "a" },
			{ 0.25, "b" },
			{ 0.5, "b" },
			{ 0.7499, "b" },
			{ 0.75, "c" },
			{ 0.9999, "c" },
		}
		for _, case in cases do
			local picked = WeightedRandom.pick(entries, weightOf, scriptedRandom({ case[1] }))
			t.equal(picked.id, case[2], `roll {case[1]}`)
		end
	end)

	t.test("zero-weight entries are skipped even on their boundary", function()
		local entries = {
			{ id = "zeroFirst", weight = 0 },
			{ id = "a", weight = 1 },
			{ id = "zeroMiddle", weight = 0 },
			{ id = "b", weight = 1 },
			{ id = "zeroLast", weight = 0 },
		}
		t.equal(WeightedRandom.pick(entries, weightOf, scriptedRandom({ 0 })).id, "a")
		t.equal(WeightedRandom.pick(entries, weightOf, scriptedRandom({ 0.5 })).id, "b")
		t.equal(WeightedRandom.pick(entries, weightOf, scriptedRandom({ 0.999999 })).id, "b")
		t.equal(WeightedRandom.pickIndex(entries, weightOf, scriptedRandom({ 0.5 })), 4)
	end)

	t.test("a roll that lands past the end falls back to the last positive entry", function()
		local entries = { { id = "a", weight = 1 }, { id = "b", weight = 1 }, { id = "zero", weight = 0 } }
		-- 1.0 is outside Random's [0, 1) range; it stands in for accumulated floating point error.
		t.equal(WeightedRandom.pick(entries, weightOf, scriptedRandom({ 1 })).id, "b")
	end)

	t.test("pickIndex and pick agree", function()
		local entries = { { id = "a", weight = 5 }, { id = "b", weight = 3 }, { id = "c", weight = 2 } }
		local first, second = newStubRandom(77), newStubRandom(77)
		for _ = 1, 300 do
			local index = WeightedRandom.pickIndex(entries, weightOf, first)
			local entry = WeightedRandom.pick(entries, weightOf, second)
			t.truthy(entries[index] == entry)
		end
	end)

	t.test("weightOf is called exactly once per entry", function()
		local entries = { { weight = 1 }, { weight = 2 }, { weight = 3 } }
		local calls = 0
		WeightedRandom.pick(entries, function(entry)
			calls += 1
			return entry.weight
		end, newStubRandom(5))
		t.equal(calls, 3)
	end)

	t.test("pickItem returns the item of { item, weight } entries", function()
		local rng = newStubRandom(11)
		local entries = {
			{ item = "common", weight = 90 },
			{ item = "rare", weight = 10 },
			{ item = "never", weight = 0 },
		}
		local counts = { common = 0, rare = 0, never = 0 }
		local rounds = 20000
		for _ = 1, rounds do
			local item = WeightedRandom.pickItem(entries, rng)
			counts[item] += 1
		end
		t.equal(counts.never, 0)
		t.near(counts.common / rounds, 0.9, 0.01)
		t.near(counts.rare / rounds, 0.1, 0.01)
		local falsy = WeightedRandom.pickItem({ { item = false, weight = 1 } }, rng)
		t.equal(falsy, false, "falsy items are returned as they are")
	end)

	t.test("distribution matches egg-style weights with a seeded generator", function()
		local entries = {
			{ id = "common", weight = 50 },
			{ id = "uncommon", weight = 30 },
			{ id = "rare", weight = 15 },
			{ id = "epic", weight = 4.5 },
			{ id = "legendary", weight = 0.5 },
		}
		local rng = newStubRandom(123456)
		local counts = {}
		local rounds = 200000
		for _ = 1, rounds do
			local id = WeightedRandom.pick(entries, weightOf, rng).id
			counts[id] = (counts[id] or 0) + 1
		end
		t.near(counts.common / rounds, 0.50, 0.005)
		t.near(counts.uncommon / rounds, 0.30, 0.005)
		t.near(counts.rare / rounds, 0.15, 0.004)
		t.near(counts.epic / rounds, 0.045, 0.002)
		t.near(counts.legendary / rounds, 0.005, 0.001)
		t.equal(rng.calls, rounds)
	end)

	t.test("the same seed reproduces the same sequence; weights need not sum to 100", function()
		local entries = { { id = "a", weight = 0.2 }, { id = "b", weight = 0.7 }, { id = "c", weight = 12 } }
		local function sequence(seed: number): string
			local rng = newStubRandom(seed)
			local picked = {}
			for index = 1, 60 do
				picked[index] = WeightedRandom.pick(entries, weightOf, rng).id
			end
			return table.concat(picked)
		end
		t.equal(sequence(5), sequence(5))
		t.truthy(sequence(5) ~= sequence(6))
	end)

	t.test("works with the environment's Random when there is one", function()
		local RandomClass = Random
		if RandomClass == nil then
			return
		end
		local entries = { { id = "a", weight = 1 }, { id = "b", weight = 3 } }
		local rng = RandomClass.new(2024)
		local counts = { a = 0, b = 0 }
		for _ = 1, 4000 do
			local id = WeightedRandom.pick(entries, weightOf, rng).id
			counts[id] += 1
		end
		t.near(counts.b / 4000, 0.75, 0.05)
	end)
end
