--!strict
--[[
	Config.Codes — promo codes. Each code can be redeemed once per player (data.codes[code]).

	Shape: Codes.byId[CODE]. Keys are UPPER CASE: CodeService trims and upper-cases what the player typed before
	looking it up. `expires` is an os.time() timestamp (UTC) after which the code stops working; nil = never.
	To add a code, add a line here and publish.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type CodeDef = Types.CodeDef

local MINUTE = 60

local byId: { [string]: CodeDef } = {
	RELEASE = { reward = { gems = 25, boost = { id = "coins", seconds = 15 * MINUTE } } },
	CRYSTALS = { reward = { coinsScaled = 250, gems = 10 } },
	SMASH100 = { reward = { gems = 20, boost = { id = "damage", seconds = 10 * MINUTE } } },
}

return {
	byId = byId,
}
