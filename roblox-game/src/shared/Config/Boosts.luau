--!strict
--[[
	Config.Boosts — the four timed boosts. Time stacks when another one of the same kind is granted and only
	counts down while the player is online (BoostService). `multiplier` applies to the matching stat in
	Formulas.computeStats while the boost is active.

	Shape: Boosts.list (display order), Boosts.byId[boostId]. Ids: "coins", "xp", "luck", "damage".
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type BoostDef = Types.BoostDef

local list: { BoostDef } = {
	{ id = "coins", name = "2x Coins", icon = "💰", multiplier = 2, color = Color3.fromHex("#FFD23F") },
	{ id = "xp", name = "2x XP", icon = "⭐", multiplier = 2, color = Color3.fromHex("#A6FF4D") },
	{ id = "luck", name = "2x Luck", icon = "🍀", multiplier = 2, color = Color3.fromHex("#5BE37D") },
	{ id = "damage", name = "2x Damage", icon = "💥", multiplier = 2, color = Color3.fromHex("#FF6B6B") },
}

local byId: { [string]: BoostDef } = {}
for _, def in list do
	byId[def.id] = def
end

return {
	list = list,
	byId = byId,
}
