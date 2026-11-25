--!strict
--[[
	Config.Achievements — long-term tiered goals. Progress is read straight from `data.stats[stat]` (or from
	`data.level` / `data.rebirths` when stat is "level" / "rebirths"); `data.achievements[id]` counts the claimed
	tiers, and ClaimAchievement always claims the next unclaimed tier once its goal is reached.

	Shape: Achievements.list (display order), Achievements.byId[achievementId],
	Achievements.badges[achievementId] = { tier, badgeId } (optional Roblox badges, see the bottom of the file).

	`text` has exactly one %s that receives the formatted goal of the tier. The "playSeconds" goals are in
	SECONDS: print them with NumberFormat.duration. Tier goals are strictly increasing.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type AchievementDef = Types.AchievementDef
type AchievementTier = Types.AchievementTier
type Reward = Types.Reward

local MINUTE = 60
local HOUR = 60 * MINUTE

local function tier(goal: number, reward: Reward): AchievementTier
	return { goal = goal, reward = reward }
end

local list: { AchievementDef } = {
	{
		id = "crystals",
		name = "Crystal Crusher",
		icon = "🔨",
		text = "Smash %s crystals",
		stat = "crystalsSmashed",
		tiers = {
			tier(100, { gems = 5 }),
			tier(1000, { gems = 15 }),
			tier(5000, { gems = 30 }),
			tier(25000, { gems = 60 }),
			tier(100000, { gems = 125 }),
			tier(500000, { gems = 250 }),
			tier(2000000, { gems = 500, boost = { id = "damage", seconds = HOUR } }),
		},
	},
	{
		id = "bigCrystals",
		name = "Giant Slayer",
		icon = "🔷",
		text = "Smash %s large or prismatic crystals",
		stat = "bigCrystals",
		tiers = {
			tier(10, { gems = 5 }),
			tier(100, { gems = 15 }),
			tier(500, { gems = 30 }),
			tier(2500, { gems = 60 }),
			tier(10000, { gems = 125 }),
			tier(50000, { gems = 300 }),
		},
	},
	{
		id = "coins",
		name = "Coin Collector",
		icon = "🪙",
		text = "Earn %s coins in total",
		stat = "totalCoins",
		tiers = {
			tier(1e4, { gems = 5 }),
			tier(1e6, { gems = 15 }),
			tier(1e8, { gems = 30 }),
			tier(1e10, { gems = 60 }),
			tier(1e12, { gems = 125 }),
			tier(1e14, { gems = 250 }),
			tier(1e16, { gems = 500, boost = { id = "coins", seconds = HOUR } }),
		},
	},
	{
		id = "eggs",
		name = "Egg Hunter",
		icon = "🥚",
		text = "Hatch %s eggs",
		stat = "eggsHatched",
		tiers = {
			tier(5, { gems = 5 }),
			tier(25, { gems = 15 }),
			tier(100, { gems = 30 }),
			tier(500, { gems = 75 }),
			tier(2000, { gems = 150 }),
			tier(10000, { gems = 400, boost = { id = "luck", seconds = HOUR } }),
		},
	},
	{
		id = "petIndex",
		name = "Pet Scholar",
		icon = "📖",
		text = "Discover %s different pets",
		stat = "petsDiscovered",
		tiers = {
			tier(5, { gems = 10 }),
			tier(12, { gems = 25 }),
			tier(20, { gems = 60 }),
			tier(30, { gems = 150 }),
			tier(40, { gems = 400 }),
		},
	},
	{
		id = "level",
		name = "Rising Star",
		icon = "⭐",
		text = "Reach level %s",
		stat = "level",
		tiers = {
			tier(5, { gems = 5 }),
			tier(10, { gems = 10 }),
			tier(20, { gems = 20 }),
			tier(35, { gems = 40 }),
			tier(50, { gems = 80 }),
			tier(75, { gems = 150 }),
			tier(100, { gems = 300, boost = { id = "xp", seconds = HOUR } }),
		},
	},
	{
		id = "rebirths",
		name = "Reborn Hero",
		icon = "♻️",
		text = "Reach rebirth %s",
		stat = "rebirths",
		tiers = {
			tier(1, { gems = 40 }),
			tier(3, { gems = 80 }),
			tier(5, { gems = 125 }),
			tier(10, { gems = 250 }),
			tier(25, { gems = 500 }),
			tier(50, { gems = 1000 }),
		},
	},
	{
		id = "playtime",
		name = "Dedicated Smasher",
		icon = "⏰",
		text = "Play for %s in total",
		stat = "playSeconds",
		tiers = {
			tier(30 * MINUTE, { gems = 5 }),
			tier(2 * HOUR, { gems = 15 }),
			tier(5 * HOUR, { gems = 30 }),
			tier(10 * HOUR, { gems = 60 }),
			tier(25 * HOUR, { gems = 125 }),
			tier(50 * HOUR, { gems = 250 }),
			tier(100 * HOUR, { gems = 500 }),
		},
	},
	{
		id = "bosses",
		name = "Titan Breaker",
		icon = "👑",
		text = "Crystal Titan wins: %s",
		stat = "bossesDefeated",
		tiers = {
			tier(1, { gems = 5 }),
			tier(5, { gems = 15 }),
			tier(25, { gems = 40 }),
			tier(100, { gems = 100 }),
			tier(250, { gems = 200 }),
			tier(500, { gems = 400 }),
		},
	},
	{
		id = "upgrades",
		name = "Master Tinkerer",
		icon = "⬆️",
		text = "Buy %s upgrade levels",
		stat = "upgradesBought",
		tiers = {
			tier(5, { gems = 5 }),
			tier(20, { gems = 15 }),
			tier(50, { gems = 40 }),
			tier(100, { gems = 100 }),
			tier(175, { gems = 200 }),
			tier(250, { gems = 400 }),
		},
	},
	{
		id = "quests",
		name = "Quest Champion",
		icon = "📜",
		text = "Claim %s daily quests",
		stat = "questsClaimed",
		tiers = {
			tier(3, { gems = 5 }),
			tier(10, { gems = 15 }),
			tier(30, { gems = 40 }),
			tier(100, { gems = 100 }),
			tier(250, { gems = 250 }),
		},
	},
}

local byId: { [string]: AchievementDef } = {}
for _, def in list do
	byId[def.id] = def
end

-- Optional Roblox badges: when the given tier of an achievement is claimed, AchievementService awards the badge.
-- A badgeId of 0 means "no badge" (the default); the owner creates badges on the Creator Dashboard and pastes
-- their ids here.
export type BadgeDef = { tier: number, badgeId: number }

local badges: { [string]: BadgeDef } = {
	crystals = { tier = 3, badgeId = 0 }, -- 5,000 crystals
	bigCrystals = { tier = 3, badgeId = 0 }, -- 500 big crystals
	coins = { tier = 3, badgeId = 0 }, -- 100M coins earned
	eggs = { tier = 3, badgeId = 0 }, -- 100 eggs
	petIndex = { tier = 3, badgeId = 0 }, -- 20 different pets
	level = { tier = 5, badgeId = 0 }, -- level 50
	rebirths = { tier = 1, badgeId = 0 }, -- first rebirth
	playtime = { tier = 2, badgeId = 0 }, -- 2 hours played
	bosses = { tier = 1, badgeId = 0 }, -- first Crystal Titan
	upgrades = { tier = 3, badgeId = 0 }, -- 50 upgrade levels
	quests = { tier = 3, badgeId = 0 }, -- 30 daily quests
}

return {
	list = list,
	byId = byId,
	badges = badges,
}
