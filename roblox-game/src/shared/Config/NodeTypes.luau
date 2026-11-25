--!strict
--[[
	Config.NodeTypes — the four crystal sizes. A zone's nodeHealth / nodeCoins / nodeXP describe a "small"
	crystal; the multipliers here turn that into the bigger ones. Bigger crystals pay more coins per point of
	health (5/4, 20/14, 70/40), so they are worth the extra hits.

	Shape: NodeTypes.list (small to prismatic), NodeTypes.byId[nodeTypeId],
	NodeTypes.big[nodeTypeId] == true for the types that count toward the `bigCrystals` stat and "smashBig" quests.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type NodeTypeDef = Types.NodeTypeDef

local list: { NodeTypeDef } = {
	{
		id = "small",
		name = "Small Crystal",
		weight = 60,
		healthMult = 1,
		coinMult = 1,
		xpMult = 1,
		gemChance = 0.01,
		gemMin = 1,
		gemMax = 1,
		scale = 1,
		respawnTime = 5,
	},
	{
		id = "medium",
		name = "Medium Crystal",
		weight = 28,
		healthMult = 4,
		coinMult = 5,
		xpMult = 4,
		gemChance = 0.03,
		gemMin = 1,
		gemMax = 1,
		scale = 1.5,
		respawnTime = 7,
	},
	{
		id = "large",
		name = "Large Crystal",
		weight = 10,
		healthMult = 14,
		coinMult = 20,
		xpMult = 14,
		gemChance = 0.08,
		gemMin = 1,
		gemMax = 2,
		scale = 2.2,
		respawnTime = 10,
	},
	{
		id = "prismatic",
		name = "Prismatic Crystal",
		weight = 2,
		healthMult = 40,
		coinMult = 70,
		xpMult = 40,
		gemChance = 1,
		gemMin = 3,
		gemMax = 6,
		scale = 2.8,
		respawnTime = 20,
	},
}

local byId: { [string]: NodeTypeDef } = {}
for _, def in list do
	byId[def.id] = def
end

local big: { [string]: boolean } = { large = true, prismatic = true }

return {
	list = list,
	byId = byId,
	big = big,
}
