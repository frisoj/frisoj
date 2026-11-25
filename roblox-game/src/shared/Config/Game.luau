--!strict
--[[
	Config.Game — every global tunable that is not a list of definitions: identity, saving, base stats, the
	level/XP curve, rebirth numbers, pet limits, social and game-pass bonuses, validation tolerances, timers and
	the world layout. Plain numbers and strings only, so it loads anywhere (server, client, tests).

	The comment next to each constant is the contract for how Shared/Logic/Formulas (and the services) use it.
]]

local Game = {
	---------------------------------------------------------------------------------------------
	-- Identity and saving
	name = "Crystal Smashers", -- shown on the loading screen and in announcements
	dataStoreName = "CrystalSmashers_PlayerData_v1", -- DataStore holding one key ("u_" .. userId) per player
	dataVersion = 1, -- value of PlayerData.version for freshly created data
	autosaveInterval = 120, -- seconds between autosaves of one profile (staggered per player)
	sessionLockTimeout = 300, -- a foreign session lock older than this many seconds is treated as dead (> 2 autosaves)
	loadRetryAttempts = 6, -- how often loading is retried while another server still holds the lock
	loadRetryDelay = 5, -- seconds between those retries
	saveRetryAttempts = 3, -- attempts per DataStore write before a save is reported as failed
	profileWaitTimeout = 20, -- default timeout (seconds) of DataService.waitForProfile
	purchaseHistoryLimit = 100, -- how many PurchaseIds are remembered in data.purchases.history
	marketplaceRetryAttempts = 3, -- attempts per game-pass ownership check when a player joins

	---------------------------------------------------------------------------------------------
	-- Base player stats (before upgrades, passes and boosts)
	baseWalkSpeed = 18, -- Humanoid.WalkSpeed with no sprint upgrade and no speed pass
	baseSwingCooldown = 0.5, -- seconds between swings with no swift upgrade
	minSwingCooldown = 0.2, -- the swing cooldown can never drop below this
	baseRange = 13, -- studs from HumanoidRootPart to a crystal at which swings connect
	baseCritChance = 0.05, -- chance (0..1) that a hit is critical
	baseCritMult = 2, -- damage multiplier of a critical hit
	breakBonus = 0.2, -- extra fraction of the whole node reward paid to whoever lands the last hit

	---------------------------------------------------------------------------------------------
	-- Levels: xpForLevel(level) = floor(xpBase * level ^ xpExponent * xpGrowth ^ (level - 1))
	levelCap = 999, -- highest reachable level; XP stops counting there
	xpBase = 50, -- XP needed to go from level 1 to level 2
	xpExponent = 2, -- polynomial part of the curve (dominates the first levels)
	xpGrowth = 1.085, -- exponential part of the curve (dominates later levels)
	-- Level-up gems: levelUpGems(newLevel) = min(levelUpGemMax, floor(levelUpGemBase + levelUpGemPerLevel * newLevel))
	levelUpGemBase = 3, -- gems for every level-up
	levelUpGemPerLevel = 0.1, -- extra gems per level reached (one more gem every 10 levels)
	levelUpGemMax = 40, -- cap on the gems of a single level-up

	---------------------------------------------------------------------------------------------
	-- Rebirth
	rebirthCoinBonus = 0.5, -- coin multiplier is (1 + rebirthCoinBonus * rebirths); also scales coinScale
	rebirthDamageBonus = 0.25, -- damage multiplier is (1 + rebirthDamageBonus * rebirths)
	rebirthXPBonus = 0.25, -- XP multiplier is (1 + rebirthXPBonus * rebirths); also scales xpScale
	-- rebirthCost(rebirths) = floor(rebirthCostBase * rebirthCostGrowth ^ rebirths) coins
	rebirthCostBase = 15000000, -- coins for the first rebirth (about 40 % of the zone-5 unlock cost)
	rebirthCostGrowth = 2.5, -- cost multiplier per rebirth already done
	-- rebirthGems(newRebirths) = min(rebirthGemMax, rebirthGemBase + rebirthGemPerRebirth * (newRebirths - 1))
	rebirthGemBase = 60, -- gems granted by the first rebirth
	rebirthGemPerRebirth = 15, -- extra gems for every later rebirth
	rebirthGemMax = 600, -- cap on the gems of a single rebirth

	---------------------------------------------------------------------------------------------
	-- Pets
	basePetSlots = 3, -- equipped pets with no upgrade and no pass
	basePetStorage = 40, -- inventory size with no upgrade and no pass
	fuseCount = 4, -- pets of the same kind and tier consumed by one fuse (gives one pet of tier + 1)
	tripleHatchCount = 3, -- eggs opened by "Hatch x3" (needs the tripleHatch pass); Stats.maxHatch is 1 or this
	eggInteractDistance = 30, -- max studs between the player and an egg stand when hatching

	---------------------------------------------------------------------------------------------
	-- Social bonuses (all multiply coins)
	friendBoostPerFriend = 0.10, -- coin bonus per friend playing in the same server
	friendBoostMaxFriends = 5, -- friends counted at most (so at most +50 %)
	premiumCoinBonus = 0.10, -- coin bonus for Roblox Premium members
	groupId = 0, -- Roblox group id; 0 disables every group feature
	groupCoinBonus = 0.05, -- coin bonus for members of that group
	groupRewardGems = 100, -- one-time gems from ClaimGroupReward

	---------------------------------------------------------------------------------------------
	-- Game pass effects (prices and texts live in Config.Monetization)
	vipCoinBonus = 0.2, -- VIP: coins multiplied by (1 + vipCoinBonus)
	vipXPBonus = 0.2, -- VIP: XP multiplied by (1 + vipXPBonus)
	vipDailyGemMult = 2, -- VIP: gems of a daily reward are multiplied by this
	doubleCoinsMult = 2, -- doubleCoins pass: coin multiplier
	doubleXPMult = 2, -- doubleXP pass: XP multiplier
	doubleDamageMult = 2, -- doubleDamage pass: damage multiplier
	luckyEggsMult = 2, -- luckyEggs pass: luck multiplier
	extraPetsPassSlots = 2, -- extraPets pass: additional equipped pets
	petStoragePassBonus = 100, -- petStorage pass: additional inventory space
	speedPassBonus = 6, -- speed pass: additional walk speed

	---------------------------------------------------------------------------------------------
	-- Combat validation and client assistance
	hitRangeTolerance = 6, -- the server accepts hits up to stats.range + this many studs (latency slack)
	hitCooldownTolerance = 0.85, -- the server accepts hits spaced at least stats.swingCooldown * this
	hitRateLimit = 12, -- hard cap on HitNode events per second per player (rate limiter)
	autoSmashRangeMult = 2, -- Auto Smash looks for crystals within stats.range * this
	targetGraceSeconds = 3, -- how long an out-of-range target is kept so the player can step closer

	---------------------------------------------------------------------------------------------
	-- Zones and teleporting
	teleportCooldown = 2, -- seconds between two teleports of the same player
	zoneTrackInterval = 0.5, -- seconds between server checks of which island each player stands on

	---------------------------------------------------------------------------------------------
	-- Retention
	questsPerDay = 3, -- daily quests assigned per UTC day
	playtimeTickInterval = 10, -- seconds between PlaytimeTick events
	codeMaxLength = 24, -- longest promo code accepted by RedeemCode
	codeRateLimit = 1, -- RedeemCode requests accepted per second per player
	boostTickInterval = 1, -- seconds between boost countdown steps

	---------------------------------------------------------------------------------------------
	-- Leaderboards and analytics
	leaderboardWriteInterval = 120, -- seconds between OrderedDataStore writes for one player
	leaderboardReadInterval = 90, -- seconds between refreshes of the global boards
	leaderboardSize = 50, -- entries read per board
	leaderboardRows = 10, -- rows drawn on the in-world boards
	leaderboardLogScale = 10000000, -- total coins are stored as floor(log10(coins + 1) * this) to fit an integer
	analyticsFlushInterval = 60, -- seconds between flushes of aggregated economy events per player

	---------------------------------------------------------------------------------------------
	-- World layout (studs). Islands sit in a row along +X; zone order n is centred at x = (n - 1) * zoneSpacing.
	worldSeed = 20260, -- seed of the deterministic world generator
	zoneSpacing = 280, -- distance between the centres of two neighbouring islands
	islandRadius = 95, -- radius of the walkable top of every island
	groundY = 0, -- height of the island top surface
	voidY = -60, -- characters below this height are put back at their zone spawn
	bridgeWidth = 16, -- width of the bridges between islands
	nodeMinSpacing = 9, -- minimum distance between two crystal positions
	bossArenaRadius = 40, -- radius of the boss arena platform next to the hub
}

return Game
