--!strict
--[[
	Config.Quests — the pool of daily quests. Every UTC day each player gets Config.Game.questsPerDay distinct
	quests picked by `weight` (QuestLogic.assign).

	Shape: Quests.list (display order), Quests.byId[questId].

	Goals: plain counts, except
	  kind "coins"    -> goalScaled = true: the stored goal is goal * Formulas.coinScale(data) at assignment time;
	  kind "playtime" -> goal is in SECONDS (progress comes from PlaytimeTick); print it with NumberFormat.duration.
	`text` has exactly one %s that receives the formatted goal.
	Rewards use coinsScaled / xpScaled so they stay meaningful in every zone.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type QuestDef = Types.QuestDef

local MINUTE = 60

local list: { QuestDef } = {
	-- Smash crystals
	{
		id = "smash_100",
		kind = "smash",
		text = "Smash %s crystals",
		goal = 100,
		goalScaled = false,
		reward = { coinsScaled = 80, gems = 5 },
		weight = 10,
	},
	{
		id = "smash_250",
		kind = "smash",
		text = "Smash %s crystals",
		goal = 250,
		goalScaled = false,
		reward = { coinsScaled = 200, gems = 8 },
		weight = 8,
	},
	{
		id = "smash_600",
		kind = "smash",
		text = "Smash %s crystals",
		goal = 600,
		goalScaled = false,
		reward = { coinsScaled = 500, gems = 15 },
		weight = 4,
	},
	-- Smash big crystals (large or prismatic)
	{
		id = "big_15",
		kind = "smashBig",
		text = "Smash %s large or prismatic crystals",
		goal = 15,
		goalScaled = false,
		reward = { xpScaled = 80, gems = 6 },
		weight = 8,
	},
	{
		id = "big_40",
		kind = "smashBig",
		text = "Smash %s large or prismatic crystals",
		goal = 40,
		goalScaled = false,
		reward = { coinsScaled = 250, gems = 12 },
		weight = 5,
	},
	-- Earn coins (goal scales with the player's best zone)
	{
		id = "coins_small",
		kind = "coins",
		text = "Earn %s coins",
		goal = 400,
		goalScaled = true,
		reward = { xpScaled = 60, gems = 6 },
		weight = 10,
	},
	{
		id = "coins_large",
		kind = "coins",
		text = "Earn %s coins",
		goal = 2000,
		goalScaled = true,
		reward = { gems = 14, boost = { id = "coins", seconds = 5 * MINUTE } },
		weight = 5,
	},
	-- Hatch eggs
	{
		id = "hatch_3",
		kind = "hatch",
		text = "Hatch %s eggs",
		goal = 3,
		goalScaled = false,
		reward = { coinsScaled = 80, gems = 5 },
		weight = 8,
	},
	{
		id = "hatch_10",
		kind = "hatch",
		text = "Hatch %s eggs",
		goal = 10,
		goalScaled = false,
		reward = { gems = 12, boost = { id = "luck", seconds = 5 * MINUTE } },
		weight = 5,
	},
	-- Play time (goal in seconds)
	{
		id = "playtime_10",
		kind = "playtime",
		text = "Play for %s",
		goal = 10 * MINUTE,
		goalScaled = false,
		reward = { coinsScaled = 100, gems = 5 },
		weight = 8,
	},
	{
		id = "playtime_30",
		kind = "playtime",
		text = "Play for %s",
		goal = 30 * MINUTE,
		goalScaled = false,
		reward = { gems = 12, boost = { id = "xp", seconds = 5 * MINUTE } },
		weight = 5,
	},
	-- Boss
	{
		id = "boss_1",
		kind = "boss",
		text = "Help smash %s Crystal Titan",
		goal = 1,
		goalScaled = false,
		reward = { coinsScaled = 200, gems = 8 },
		weight = 6,
	},
	-- Upgrades
	{
		id = "upgrade_1",
		kind = "upgrade",
		text = "Buy %s upgrade level",
		goal = 1,
		goalScaled = false,
		reward = { coinsScaled = 100, xpScaled = 60 },
		weight = 6,
	},
	{
		id = "upgrade_3",
		kind = "upgrade",
		text = "Buy %s upgrade levels",
		goal = 3,
		goalScaled = false,
		reward = { coinsScaled = 250, gems = 6 },
		weight = 4,
	},
}

local byId: { [string]: QuestDef } = {}
for _, def in list do
	byId[def.id] = def
end

return {
	list = list,
	byId = byId,
}
