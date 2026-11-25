--!strict
--[[
	Config.PlaytimeRewards — free gifts for time played per UTC day (the counter resets at midnight UTC).
	A plain array ordered by `seconds`; gift number i is claimable once data.playtime.seconds >= [i].seconds
	and is remembered in data.playtime.claimed[tostring(i)].
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type PlaytimeRewardDef = Types.PlaytimeRewardDef

local MINUTE = 60

local rewards: { PlaytimeRewardDef } = {
	{ seconds = 2 * MINUTE, reward = { coinsScaled = 50 } },
	{ seconds = 5 * MINUTE, reward = { gems = 4 } },
	{ seconds = 10 * MINUTE, reward = { coinsScaled = 150, xpScaled = 50 } },
	{ seconds = 20 * MINUTE, reward = { gems = 6, boost = { id = "coins", seconds = 5 * MINUTE } } },
	{ seconds = 30 * MINUTE, reward = { gems = 8, coinsScaled = 400 } },
	{ seconds = 45 * MINUTE, reward = { gems = 10, boost = { id = "luck", seconds = 10 * MINUTE } } },
	{ seconds = 60 * MINUTE, reward = { gems = 15, coinsScaled = 800 } },
	{
		seconds = 90 * MINUTE,
		reward = {
			gems = 25,
			boosts = { { id = "damage", seconds = 15 * MINUTE }, { id = "xp", seconds = 15 * MINUTE } },
		},
	},
}

return rewards
