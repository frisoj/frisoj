--!strict
--[[
	Config.Tutorial — the onboarding steps, in order. data.tutorial.step is the index (1-based) of the step the
	player is on; TutorialService advances it from GameEvents and grants `reward` after the last step.

	Shape: Tutorial.list (in order), Tutorial.byId[stepId], Tutorial.reward.

	goalKind: "smash" | "coins" | "buyHammer" | "hatch" | "unlockZone" | "upgrade"  (count `goalAmount` of them)
	hint:     "crystal" | "window:Hammers" | "egg" | "gate" | "window:Upgrades"      (what the arrow points at)
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type TutorialStep = Types.TutorialStep
type Reward = Types.Reward

local list: { TutorialStep } = {
	{
		id = "smash",
		text = "Tap a crystal to smash it! Break 3 crystals.",
		goalKind = "smash",
		goalAmount = 3,
		hint = "crystal",
	},
	{
		id = "hammer",
		text = "Open Hammers and buy a stronger hammer.",
		goalKind = "buyHammer",
		goalAmount = 1,
		hint = "window:Hammers",
	},
	{
		id = "egg",
		text = "Hatch a pet at the Meadow Egg. Pets multiply your coins!",
		goalKind = "hatch",
		goalAmount = 1,
		hint = "egg",
	},
	{
		id = "upgrade",
		text = "Level up to earn gems, then buy an upgrade.",
		goalKind = "upgrade",
		goalAmount = 1,
		hint = "window:Upgrades",
	},
	{
		id = "zone",
		text = "Reach level 5 and unlock Sandy Dunes at the gate!",
		goalKind = "unlockZone",
		goalAmount = 1,
		hint = "gate",
	},
}

local byId: { [string]: TutorialStep } = {}
for _, step in list do
	byId[step.id] = step
end

-- Granted once when the last step is completed.
local reward: Reward = { gems = 30, boost = { id = "coins", seconds = 10 * 60 } }

return {
	list = list,
	byId = byId,
	reward = reward,
}
