--!strict
--[[
	Config — all game content and balance, one child ModuleScript per section. Pure data (numbers, strings,
	Color3 / Enum values): no services, nothing that can yield or error, so it loads on the server, on the
	client and in headless tests.

	    local Config = require(Shared:WaitForChild("Config"))

	THE ONE CONVENTION — used by every section that holds definitions:
	    Section.list          ordered array of the definitions (display / progression order, 1-based, dense)
	    Section.byId[id]      the same definition tables, addressed by their string id
	`id` is def.id; for game passes and products it is def.key; for sounds the sound name; for codes the code.
	byId lookups with a key that came from a client can be nil - always check before use.

	Section by section (extra fields after the +):
	    Game             flat table of constants (Config.Game.autosaveInterval ...), see Game.luau
	    Zones            .list .byId   Types.ZoneDef         + .firstId (the hub zone, "meadow")
	    NodeTypes        .list .byId   Types.NodeTypeDef     + .big[nodeTypeId] (true for "big" crystals)
	    Hammers          .list .byId   Types.HammerDef       + .starterId ("wood": free, owned by default)
	    Pets             .list .byId   Types.PetDef          + .tiers[tier] (Types.PetTierDef), .maxTier,
	                                                           .exclusiveIds (pets that are never in eggs)
	    Eggs             .list .byId   Types.EggDef
	    Upgrades         .list .byId   Types.UpgradeDef
	    Boosts           .list .byId   Types.BoostDef        (ids "coins", "xp", "luck", "damage")
	    Quests           .list .byId   Types.QuestDef
	    Achievements     .list .byId   Types.AchievementDef  + .badges[achievementId] = { tier, badgeId }
	    Tutorial         .list .byId   Types.TutorialStep    + .reward (granted after the last step)
	    Rarities         .list .byId   Rarities.RarityDef    (byId is keyed by the Types.Rarity string)
	    Monetization     .Passes.list   / .Passes.byId[passKey]         Types.GamePassDef
	                     .Products.list / .Products.byId[productKey]    Types.ProductDef
	                     + .studioTestMode, .oneTimeFallbackGemsPerRobux, .vipPetKey, .vipPetId
	    Sounds           .byId[name]   Types.SoundDef        (lookup only) + .Music (asset ids, may be empty)
	    Codes            .byId[CODE]   Types.CodeDef         (lookup only, upper-case keys)
	    Boss             flat table of constants (Config.Boss.interval ...), see Boss.luau
	Two sections are sequences without ids and therefore plain arrays, exactly as the spec indexes them:
	    DailyRewards     Config.DailyRewards[day]        { Types.Reward }, 7 entries
	    PlaytimeRewards  Config.PlaytimeRewards[index]   { Types.PlaytimeRewardDef }, ordered by seconds

	Treat everything as read-only at runtime. Balance numbers are derived, not typed in: Zones.luau holds the
	per-zone growth factors, Hammers.luau / Eggs.luau price and scale themselves from the zone they belong to,
	Pets.luau derives power from egg order and rarity, and Game.luau holds the curve parameters used by
	Shared/Logic/Formulas.
]]

local Rarities = require(script:WaitForChild("Rarities"))

export type RarityDef = Rarities.RarityDef

local Config = {
	Game = require(script:WaitForChild("Game")),
	Zones = require(script:WaitForChild("Zones")),
	NodeTypes = require(script:WaitForChild("NodeTypes")),
	Hammers = require(script:WaitForChild("Hammers")),
	Pets = require(script:WaitForChild("Pets")),
	Eggs = require(script:WaitForChild("Eggs")),
	Upgrades = require(script:WaitForChild("Upgrades")),
	Boosts = require(script:WaitForChild("Boosts")),
	Monetization = require(script:WaitForChild("Monetization")),
	Quests = require(script:WaitForChild("Quests")),
	Achievements = require(script:WaitForChild("Achievements")),
	DailyRewards = require(script:WaitForChild("DailyRewards")),
	PlaytimeRewards = require(script:WaitForChild("PlaytimeRewards")),
	Codes = require(script:WaitForChild("Codes")),
	Tutorial = require(script:WaitForChild("Tutorial")),
	Sounds = require(script:WaitForChild("Sounds")),
	Rarities = Rarities,
	Boss = require(script:WaitForChild("Boss")),
}

return Config
