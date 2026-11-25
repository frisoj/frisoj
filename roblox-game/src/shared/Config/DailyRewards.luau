--!strict
--[[
	Config.DailyRewards — the 7-day login streak. A plain array of 7 rewards, indexed by streak day:
	    reward = Config.DailyRewards[((streak - 1) % #Config.DailyRewards) + 1]
	Day 7 is the best one; after it the cycle starts again. VIP owners get the gems multiplied by
	Config.Game.vipDailyGemMult.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type Reward = Types.Reward

local MINUTE = 60

local rewards: { Reward } = {
	{ coinsScaled = 150 }, -- day 1
	{ gems = 15 }, -- day 2
	{ coinsScaled = 250, boost = { id = "coins", seconds = 10 * MINUTE } }, -- day 3
	{ gems = 25, xpScaled = 100 }, -- day 4
	{ gems = 15, boost = { id = "luck", seconds = 15 * MINUTE } }, -- day 5
	{ gems = 40, coinsScaled = 500 }, -- day 6
	{ -- day 7
		gems = 100,
		coinsScaled = 1200,
		boosts = {
			{ id = "coins", seconds = 30 * MINUTE },
			{ id = "xp", seconds = 30 * MINUTE },
			{ id = "damage", seconds = 30 * MINUTE },
		},
	},
}

return rewards
