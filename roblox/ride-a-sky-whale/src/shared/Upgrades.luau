--!strict
-- Upgrades die je met Parels koopt. Elke stap: waarde en prijs.

export type Step = { value: number, cost: number }

local Upgrades = {}

Upgrades.KINDS = { "Net", "Nest", "Glider" }

Upgrades.INFO = {
	Net = { title = "Bigger Net", unit = "studs catch range" },
	Nest = { title = "Bigger Nest", unit = "Driftling slots" },
	Glider = { title = "Faster Glider", unit = "glide speed" },
} :: { [string]: { title: string, unit: string } }

Upgrades.STEPS = {
	Net = {
		{ value = 12, cost = 0 },
		{ value = 16, cost = 150 },
		{ value = 20, cost = 600 },
		{ value = 25, cost = 2500 },
		{ value = 30, cost = 10000 },
		{ value = 36, cost = 40000 },
	},
	Nest = {
		{ value = 6, cost = 0 },
		{ value = 8, cost = 300 },
		{ value = 10, cost = 1500 },
		{ value = 12, cost = 6000 },
		{ value = 15, cost = 25000 },
		{ value = 18, cost = 100000 },
	},
	Glider = {
		{ value = 45, cost = 0 },
		{ value = 55, cost = 200 },
		{ value = 65, cost = 1000 },
		{ value = 75, cost = 5000 },
		{ value = 85, cost = 20000 },
	},
} :: { [string]: { Step } }

Upgrades.VIP_EXTRA_SLOTS = 2

function Upgrades.value(kind: string, level: number): number
	local steps = Upgrades.STEPS[kind]
	return steps[math.clamp(level, 1, #steps)].value
end

-- Prijs van de volgende stap, of nil als je al op het maximum zit.
function Upgrades.nextCost(kind: string, level: number): number?
	local steps = Upgrades.STEPS[kind]
	local nextStep = steps[level + 1]
	return if nextStep then nextStep.cost else nil
end

return Upgrades
