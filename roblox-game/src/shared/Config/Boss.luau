--!strict
--[[
	Config.Boss — the Crystal Titan: a giant crystal that appears at the boss arena every few minutes and that
	everybody on the server smashes together.

	Health:   maxHealth = max(minHealth, sum over online players of stats.damage * hitsPerPlayer).
	Rewards:  a player's fair share is maxHealth / (players counted at spawn). Somebody who dealt exactly their
	          fair share gets `reward`; others get it scaled by damage / fairShare, capped at maxShareMult.
	          Players below minShare of their fair share get nothing. If the timer runs out, everything is
	          additionally multiplied by timeoutRewardScale * (damage dealt to the boss / maxHealth).
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

local reward: Types.Reward = { coinsScaled = 300, xpScaled = 120, gems = 5 }

local Boss = {
	name = "Crystal Titan", -- shown in announcements and on the boss bar
	icon = "👑",

	firstDelay = 180, -- seconds after server start before the first boss
	interval = 420, -- seconds from one boss spawn to the next
	duration = 120, -- seconds the boss stays before it escapes
	minPlayers = 1, -- online players needed for a boss to spawn

	hitsPerPlayer = 90, -- boss health per online player, in normal hits of that player (45 s of swinging)
	minHealth = 150, -- lower bound of the boss health

	reward = reward, -- for dealing exactly one fair share (scaled coins / XP use Formulas.coinScale / xpScale)
	minShare = 0.01, -- fraction of the fair share needed to get any reward
	maxShareMult = 2, -- reward scaling is capped at this many fair shares
	timeoutRewardScale = 0.5, -- extra reward factor when the boss was not defeated in time

	topCount = 5, -- entries in the damage ranking sent with BossState
	updateInterval = 0.5, -- seconds between BossState "update" broadcasts while a boss is alive

	scale = 9, -- size of the boss crystal relative to a small crystal
	range = 24, -- hit range (studs from the crystal centre) used instead of stats.range for the boss
	colors = { Color3.fromRGB(255, 90, 200), Color3.fromRGB(120, 230, 255), Color3.fromRGB(255, 220, 90) },
	announceColor = "#FF4D6D", -- colorHex of the spawn / defeat announcements
}

return Boss
