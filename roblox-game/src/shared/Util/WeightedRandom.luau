--!strict
--[[
	WeightedRandom — pick one element with probability weight / totalWeight, using a caller-supplied Random so
	results are reproducible from a seed. Pure (runs under Lune tests; any object with NextNumber works there).

	Weights that are not finite positive numbers count as 0 (such entries are never picked). When nothing can be
	picked — empty input or total weight 0 — every function returns nil instead of guessing.
]]

local WeightedRandom = {}

export type WeightedItem<T> = { item: T, weight: number }

local function sanitizeWeight(weight: any): number
	if type(weight) ~= "number" or weight ~= weight or weight <= 0 or weight == math.huge then
		return 0
	end
	return weight
end

-- Core: index of the chosen weight, or nil when the total is 0. Consumes exactly one rng:NextNumber() per
-- successful pick and none when it returns nil.
local function pickFromWeights(weights: { number }, rng: Random): number?
	local total = 0
	for _, weight in weights do
		total += weight
	end
	if total <= 0 then
		return nil
	end
	local roll = rng:NextNumber() * total
	local lastPositive: number? = nil
	for index, weight in weights do
		if weight > 0 then
			if roll < weight then
				return index
			end
			roll -= weight
			lastPositive = index
		end
	end
	-- Only reachable through floating point rounding (roll ended a hair above the last boundary).
	return lastPositive
end

-- Index into `entries` chosen by weightOf(entry), or nil. weightOf is called once per entry.
function WeightedRandom.pickIndex<T>(entries: { T }, weightOf: (entry: T) -> number, rng: Random): number?
	local weights: { number } = table.create(#entries)
	for index, entry in ipairs(entries) do
		weights[index] = sanitizeWeight(weightOf(entry))
	end
	return pickFromWeights(weights, rng)
end

-- The chosen entry itself, or nil.
--     local nodeType = WeightedRandom.pick(nodeTypes, function(def) return def.weight end, rng)
function WeightedRandom.pick<T>(entries: { T }, weightOf: (entry: T) -> number, rng: Random): T?
	local index = WeightedRandom.pickIndex(entries, weightOf, rng)
	if index == nil then
		return nil
	end
	return entries[index]
end

-- Variant for arrays of { item = ..., weight = number }: returns the chosen item, or nil.
function WeightedRandom.pickItem<T>(entries: { WeightedItem<T> }, rng: Random): T?
	local weights: { number } = table.create(#entries)
	for index, entry in ipairs(entries) do
		weights[index] = sanitizeWeight(entry.weight)
	end
	local index = pickFromWeights(weights, rng)
	if index == nil then
		return nil
	end
	return entries[index].item
end

return WeightedRandom
