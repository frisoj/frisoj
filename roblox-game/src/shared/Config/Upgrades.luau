--!strict
--[[
	Config.Upgrades — the 12 permanent upgrade tracks bought with gems (kept through rebirths).
	Cost of the next level: floor(baseCost * costGrowth ^ currentLevel) gems (Formulas.upgradeCost).
	`effectPerLevel` is what Formulas.computeStats multiplies by the owned level; `effectKind` tells the UI how
	to print it ("percent": 0.1 -> "+10%", "flat": 0.5 -> "+0.5").

	Shape: Upgrades.list (ordered by `order`), Upgrades.byId[upgradeId].
	Maxing every track costs about 43K gems in total - weeks of play.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type UpgradeDef = Types.UpgradeDef

local list: { UpgradeDef } = {
	{
		id = "power",
		order = 1,
		name = "Power",
		icon = "💪",
		description = "+10% hammer damage per level.",
		maxLevel = 50,
		baseCost = 10,
		costGrowth = 1.1,
		effectPerLevel = 0.1,
		effectKind = "percent",
	},
	{
		id = "swift",
		order = 2,
		name = "Swift Swing",
		icon = "⚡",
		description = "Swing 3% faster per level.",
		maxLevel = 15,
		baseCost = 20,
		costGrowth = 1.28,
		effectPerLevel = 0.03, -- swingCooldown = base * (1 - 0.03 * level), never below Game.minSwingCooldown
		effectKind = "percent",
	},
	{
		id = "fortune",
		order = 3,
		name = "Fortune",
		icon = "💰",
		description = "+5% coins from everything per level.",
		maxLevel = 50,
		baseCost = 10,
		costGrowth = 1.1,
		effectPerLevel = 0.05,
		effectKind = "percent",
	},
	{
		id = "wisdom",
		order = 4,
		name = "Wisdom",
		icon = "📘",
		description = "+5% XP per level.",
		maxLevel = 30,
		baseCost = 10,
		costGrowth = 1.12,
		effectPerLevel = 0.05,
		effectKind = "percent",
	},
	{
		id = "critChance",
		order = 5,
		name = "Sharp Eye",
		icon = "🎯",
		description = "+1% critical hit chance per level.",
		maxLevel = 25,
		baseCost = 10,
		costGrowth = 1.15,
		effectPerLevel = 0.01,
		effectKind = "percent",
	},
	{
		id = "critPower",
		order = 6,
		name = "Crushing Blow",
		icon = "💥",
		description = "Critical hits deal +0.1x more damage per level.",
		maxLevel = 20,
		baseCost = 12,
		costGrowth = 1.18,
		effectPerLevel = 0.1,
		effectKind = "flat",
	},
	{
		id = "reach",
		order = 7,
		name = "Long Reach",
		icon = "📏",
		description = "+0.5 studs of smashing range per level.",
		maxLevel = 10,
		baseCost = 10,
		costGrowth = 1.35,
		effectPerLevel = 0.5,
		effectKind = "flat",
	},
	{
		id = "sprint",
		order = 8,
		name = "Sprint",
		icon = "👟",
		description = "+1 walk speed per level.",
		maxLevel = 14,
		baseCost = 6,
		costGrowth = 1.25,
		effectPerLevel = 1,
		effectKind = "flat",
	},
	{
		id = "luck",
		order = 9,
		name = "Egg Luck",
		icon = "🍀",
		description = "+3% luck when hatching eggs per level.",
		maxLevel = 20,
		baseCost = 15,
		costGrowth = 1.2,
		effectPerLevel = 0.03,
		effectKind = "percent",
	},
	{
		id = "gemFinder",
		order = 10,
		name = "Gem Finder",
		icon = "💎",
		description = "+0.5% chance for gems from every crystal per level.",
		maxLevel = 20,
		baseCost = 15,
		costGrowth = 1.2,
		effectPerLevel = 0.005,
		effectKind = "percent",
	},
	{
		id = "petSlots",
		order = 11,
		name = "Pet Slots",
		icon = "🐾",
		description = "Equip +1 more pet per level.",
		maxLevel = 2,
		baseCost = 600,
		costGrowth = 4,
		effectPerLevel = 1,
		effectKind = "flat",
	},
	{
		id = "petStorage",
		order = 12,
		name = "Pet Storage",
		icon = "🎒",
		description = "+10 pet inventory space per level.",
		maxLevel = 6,
		baseCost = 30,
		costGrowth = 1.7,
		effectPerLevel = 10,
		effectKind = "flat",
	},
}

local byId: { [string]: UpgradeDef } = {}
for _, def in list do
	byId[def.id] = def
end

return {
	list = list,
	byId = byId,
}
