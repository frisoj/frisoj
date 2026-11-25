-- Integrity tests for Shared/Config: every section loads, ids are consistent, cross references resolve, the
-- spec's fixed keys/flags/values are present and the derived economy numbers are sane (finite, increasing).
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local SECTIONS = {
	"Game",
	"Zones",
	"NodeTypes",
	"Hammers",
	"Pets",
	"Eggs",
	"Upgrades",
	"Boosts",
	"Monetization",
	"Quests",
	"Achievements",
	"DailyRewards",
	"PlaytimeRewards",
	"Codes",
	"Tutorial",
	"Sounds",
	"Rarities",
	"Boss",
}

local ARCHETYPES =
	{ "blob", "cat", "dog", "bunny", "bear", "fox", "bird", "dragon", "golem", "ghost", "unicorn", "robot" }
local RARITY_ORDER = { "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic", "Exclusive" }
local RARITY_HEX = {
	Common = "B8C1CC",
	Uncommon = "5BE37D",
	Rare = "4DA8FF",
	Epic = "B36BFF",
	Legendary = "FFB627",
	Mythic = "FF4D6D",
}
local BOOST_IDS = { "coins", "xp", "luck", "damage" }
local STAT_KEYS = {
	"totalCoins",
	"crystalsSmashed",
	"bigCrystals",
	"eggsHatched",
	"playSeconds",
	"bossesDefeated",
	"bossDamage",
	"upgradesBought",
	"petsDiscovered",
	"robuxSpent",
	"questsClaimed",
	"fuses",
	"hammersBought",
	"level",
	"rebirths",
}
local QUEST_KINDS = { "smash", "smashBig", "coins", "hatch", "playtime", "boss", "upgrade" }
local TUTORIAL_GOALS = { "smash", "coins", "buyHammer", "hatch", "unlockZone", "upgrade" }
local TUTORIAL_HINTS = { "crystal", "window:Hammers", "egg", "gate", "window:Upgrades" }
local ZONE_DECOR = { "meadow", "desert", "snow", "mushroom", "lava", "cavern", "sky", "void" }
local ZONE_NAMES = {
	"Sunny Meadow",
	"Sandy Dunes",
	"Frost Peaks",
	"Mushroom Grove",
	"Lava Forge",
	"Crystal Caverns",
	"Sky Sanctuary",
	"Void Nexus",
}
local ZONE_ICONS = { "🌼", "🏜️", "❄️", "🍄", "🌋", "💎", "☁️", "🌌" }
local SOUND_NAMES = {
	"Click",
	"Hover",
	"Open",
	"Close",
	"Hit",
	"Crit",
	"Break",
	"Coin",
	"Gem",
	"LevelUp",
	"Purchase",
	"Error",
	"Hatch",
	"Reveal",
	"RareReveal",
	"Rebirth",
	"Unlock",
	"Reward",
	"BossSpawn",
	"BossDefeat",
	"Equip",
	"Swing",
}
local BUILT_IN_SOUNDS = {
	"electronicpingshort.wav",
	"button.wav",
	"clickfast.wav",
	"hit.wav",
	"switch.wav",
	"swordslash.wav",
	"swordlunge.wav",
	"unsheath.wav",
	"victory.wav",
	"bass.wav",
	"collide.wav",
	"splat.wav",
	"pageturn.wav",
	"snap.mp3",
	"impact_water.mp3",
	"action_jump.mp3",
}

-- Spec §3.2: id -> { maxLevel, effectPerLevel, effectKind }
local UPGRADES = {
	power = { 50, 0.1, "percent" },
	swift = { 15, 0.03, "percent" },
	fortune = { 50, 0.05, "percent" },
	wisdom = { 30, 0.05, "percent" },
	critChance = { 25, 0.01, "percent" },
	critPower = { 20, 0.1, "flat" },
	reach = { 10, 0.5, "flat" },
	sprint = { 14, 1, "flat" },
	luck = { 20, 0.03, "percent" },
	gemFinder = { 20, 0.005, "percent" },
	petSlots = { 2, 1, "flat" },
	petStorage = { 6, 10, "flat" },
}
local UPGRADE_ORDER = {
	"power",
	"swift",
	"fortune",
	"wisdom",
	"critChance",
	"critPower",
	"reach",
	"sprint",
	"luck",
	"gemFinder",
	"petSlots",
	"petStorage",
}

-- Spec §9: key -> { price, randomItemRelated }
local PASSES = {
	vip = { 399, false },
	doubleCoins = { 299, false },
	doubleXP = { 199, false },
	doubleDamage = { 349, false },
	autoSmash = { 249, false },
	luckyEggs = { 299, true },
	tripleHatch = { 199, true },
	extraPets = { 349, false },
	petStorage = { 149, false },
	speed = { 99, false },
}
-- Spec §9: key -> { price, category, oneTime, grantsCurrency, randomItemRelated, bestValue }
local PRODUCTS = {
	coinsSmall = { 49, "coins", false, true, false, false },
	coinsMedium = { 149, "coins", false, true, false, false },
	coinsLarge = { 399, "coins", false, true, false, false },
	coinsMega = { 999, "coins", false, true, false, true },
	gemsSmall = { 79, "gems", false, true, false, false },
	gemsMedium = { 349, "gems", false, true, false, false },
	gemsLarge = { 799, "gems", false, true, false, false },
	gemsMega = { 1999, "gems", false, true, false, true },
	boostCoins = { 49, "boosts", false, false, false, false },
	boostXP = { 39, "boosts", false, false, false, false },
	boostDamage = { 49, "boosts", false, false, false, false },
	boostLuck = { 59, "boosts", false, false, true, false },
	boostAll = { 149, "boosts", false, false, true, false },
	starterPack = { 99, "special", true, true, false, false },
	royalDragon = { 499, "special", true, false, false, false },
}

local function contains(list, value): boolean
	return table.find(list, value) ~= nil
end

local function countKeys(map): number
	local n = 0
	for _ in map do
		n += 1
	end
	return n
end

local function isFinite(value): boolean
	return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function isPositive(value): boolean
	return isFinite(value) and value > 0
end

local function isWhole(value): boolean
	return isFinite(value) and math.floor(value) == value
end

local function countPlaceholders(text: string): number
	local _, n = string.gsub(text, "%%s", "")
	return n
end

local function hexOf(color: Color3): string
	return string.format(
		"%02X%02X%02X",
		math.floor(color.R * 255 + 0.5),
		math.floor(color.G * 255 + 0.5),
		math.floor(color.B * 255 + 0.5)
	)
end

return function(t)
	-- `section` must expose list + byId holding exactly the same definitions, keyed by def[keyField].
	local function checkIndexed(label: string, section, keyField: string)
		t.truthy(type(section.list) == "table", label .. ".list missing")
		t.truthy(type(section.byId) == "table", label .. ".byId missing")
		t.truthy(#section.list > 0, label .. ".list is empty")
		local seen = {}
		for index, def in section.list do
			local id = def[keyField]
			t.truthy(type(id) == "string" and id ~= "", `{label}.list[{index}] has no {keyField}`)
			t.falsy(seen[id], `{label}: duplicate {keyField} "{id}"`)
			seen[id] = true
			t.truthy(section.byId[id] == def, `{label}.byId["{id}"] is not the list entry`)
		end
		t.equal(countKeys(section.byId), #section.list, label .. ": byId and list differ in size")
		for key, def in section.byId do
			t.equal(def[keyField], key, `{label}.byId key "{key}" differs from its {keyField}`)
		end
	end

	local function checkOrderField(label: string, list)
		for index, def in list do
			t.equal(def.order, index, `{label}.list[{index}].order`)
		end
	end

	-- Every amount positive and finite, boosts and pets must exist, and the reward must grant something.
	local function checkReward(label: string, reward)
		t.truthy(type(reward) == "table", label .. ": reward missing")
		local grants = 0
		for key, value in reward do
			if key == "coins" or key == "coinsScaled" or key == "gems" or key == "xp" or key == "xpScaled" then
				t.truthy(isPositive(value), `{label}: {key} must be positive and finite`)
				if key == "gems" or key == "coins" or key == "xp" then
					t.truthy(isWhole(value), `{label}: {key} must be a whole number`)
				end
				grants += 1
			elseif key == "boost" or key == "boosts" then
				local grantsList = if key == "boost" then { value } else value
				t.truthy(#grantsList > 0, `{label}: empty boosts list`)
				local seenBoost = {}
				for _, grant in grantsList do
					t.truthy(Config.Boosts.byId[grant.id] ~= nil, `{label}: unknown boost id "{tostring(grant.id)}"`)
					t.truthy(isPositive(grant.seconds) and isWhole(grant.seconds), `{label}: boost seconds`)
					t.falsy(seenBoost[grant.id], `{label}: boost "{grant.id}" listed twice`)
					seenBoost[grant.id] = true
					grants += 1
				end
			elseif key == "pet" then
				t.truthy(Config.Pets.byId[value.petId] ~= nil, `{label}: unknown pet id "{tostring(value.petId)}"`)
				t.truthy(Config.Pets.tiers[value.tier] ~= nil, `{label}: unknown pet tier {tostring(value.tier)}`)
				grants += 1
			else
				t.fail(`{label}: unknown reward field "{tostring(key)}"`)
			end
		end
		t.truthy(grants > 0, label .. ": reward grants nothing")
	end

	t.test("exposes exactly the sections of the spec", function()
		for _, name in SECTIONS do
			t.truthy(type(Config[name]) == "table", "missing section " .. name)
		end
		t.equal(countKeys(Config), #SECTIONS)
	end)

	t.test("contains no NaN or infinite number anywhere", function()
		local visited = {}
		local function walk(value, path: string)
			if type(value) == "number" then
				t.truthy(isFinite(value), path .. " is not finite")
			elseif type(value) == "table" and not visited[value] then
				visited[value] = true
				for key, child in value do
					walk(child, path .. "." .. tostring(key))
				end
			end
		end
		walk(Config, "Config")
	end)

	t.test("list + byId convention holds for every section", function()
		checkIndexed("Zones", Config.Zones, "id")
		checkIndexed("NodeTypes", Config.NodeTypes, "id")
		checkIndexed("Hammers", Config.Hammers, "id")
		checkIndexed("Pets", Config.Pets, "id")
		checkIndexed("Eggs", Config.Eggs, "id")
		checkIndexed("Upgrades", Config.Upgrades, "id")
		checkIndexed("Boosts", Config.Boosts, "id")
		checkIndexed("Quests", Config.Quests, "id")
		checkIndexed("Achievements", Config.Achievements, "id")
		checkIndexed("Tutorial", Config.Tutorial, "id")
		checkIndexed("Rarities", Config.Rarities, "id")
		checkIndexed("Monetization.Passes", Config.Monetization.Passes, "key")
		checkIndexed("Monetization.Products", Config.Monetization.Products, "key")
		checkOrderField("Zones", Config.Zones.list)
		checkOrderField("Hammers", Config.Hammers.list)
		checkOrderField("Upgrades", Config.Upgrades.list)
		checkOrderField("Rarities", Config.Rarities.list)
		checkOrderField("Monetization.Passes", Config.Monetization.Passes.list)
		checkOrderField("Monetization.Products", Config.Monetization.Products.list)
	end)

	t.test("Game holds the constants named in the spec", function()
		local Game = Config.Game
		t.equal(Game.name, "Crystal Smashers")
		t.equal(Game.dataStoreName, "CrystalSmashers_PlayerData_v1")
		t.equal(Game.autosaveInterval, 120)
		t.truthy(Game.sessionLockTimeout > Game.autosaveInterval, "a live session must refresh its lock in time")
		t.equal(Game.baseWalkSpeed, 18)
		t.equal(Game.baseSwingCooldown, 0.5)
		t.equal(Game.minSwingCooldown, 0.2)
		t.equal(Game.baseRange, 13)
		t.equal(Game.baseCritChance, 0.05)
		t.equal(Game.baseCritMult, 2)
		t.equal(Game.breakBonus, 0.2)
		t.equal(Game.levelCap, 999)
		t.equal(Game.basePetSlots, 3)
		t.equal(Game.basePetStorage, 40)
		t.equal(Game.fuseCount, 4)
		t.equal(Game.friendBoostPerFriend, 0.1)
		t.equal(Game.friendBoostMaxFriends, 5)
		t.equal(Game.premiumCoinBonus, 0.1)
		t.equal(Game.groupId, 0)
		t.equal(Game.groupCoinBonus, 0.05)
		t.equal(Game.groupRewardGems, 100)
		t.equal(Game.rebirthCoinBonus, 0.5)
		t.equal(Game.rebirthDamageBonus, 0.25)
		t.equal(Game.rebirthXPBonus, 0.25)
		t.equal(Game.vipCoinBonus, 0.2)
		t.equal(Game.vipXPBonus, 0.2)
		t.equal(Game.vipDailyGemMult, 2)
		t.equal(Game.doubleCoinsMult, 2)
		t.equal(Game.doubleXPMult, 2)
		t.equal(Game.doubleDamageMult, 2)
		t.equal(Game.luckyEggsMult, 2)
		t.equal(Game.extraPetsPassSlots, 2)
		t.equal(Game.petStoragePassBonus, 100)
		t.equal(Game.speedPassBonus, 6)
		t.equal(Game.tripleHatchCount, 3)
		t.equal(Game.eggInteractDistance, 30)
		t.equal(Game.hitRangeTolerance, 6)
		t.equal(Game.hitCooldownTolerance, 0.85)
		t.equal(Game.teleportCooldown, 2)
		t.equal(Game.questsPerDay, 3)
		t.equal(Game.codeMaxLength, 24)
		t.equal(Game.codeRateLimit, 1)
		t.equal(Game.zoneSpacing, 280)
		t.equal(Game.islandRadius, 95)
		t.equal(Game.groundY, 0)
		t.equal(Game.voidY, -60)
		for _, key in
			{
				"xpBase",
				"xpExponent",
				"xpGrowth",
				"levelUpGemBase",
				"levelUpGemMax",
				"rebirthCostBase",
				"rebirthGemBase",
				"rebirthGemMax",
				"leaderboardWriteInterval",
				"leaderboardReadInterval",
				"leaderboardSize",
				"loadRetryAttempts",
				"loadRetryDelay",
			}
		do
			t.truthy(isPositive(Game[key]), "Game." .. key .. " must be positive")
		end
		t.truthy(Game.xpGrowth >= 1, "the XP curve must not shrink")
		t.truthy(Game.rebirthCostGrowth > 1, "rebirths must get more expensive")
		t.truthy(Game.levelUpGemPerLevel >= 0 and Game.rebirthGemPerRebirth >= 0)
		-- A whole island (plus bridge) must fit between two zone centres.
		t.truthy(Game.zoneSpacing > 2 * Game.islandRadius)
	end)

	t.test("zones: eight themed islands in order with strictly growing numbers", function()
		local zones = Config.Zones.list
		t.equal(#zones, 8)
		t.equal(Config.Zones.firstId, zones[1].id)
		local previous
		for order, zone in zones do
			local label = "zone " .. zone.id
			t.equal(zone.order, order, label .. " order")
			t.equal(zone.name, ZONE_NAMES[order], label .. " name")
			t.equal(zone.icon, ZONE_ICONS[order], label .. " icon")
			t.truthy(#zone.description > 0, label .. " description")
			t.truthy(isWhole(zone.levelReq) and zone.levelReq >= 1, label .. " levelReq")
			t.truthy(isWhole(zone.nodeHealth) and zone.nodeHealth > 0, label .. " nodeHealth")
			t.truthy(isWhole(zone.nodeCoins) and zone.nodeCoins > 0, label .. " nodeCoins")
			t.truthy(isWhole(zone.nodeXP) and zone.nodeXP > 0, label .. " nodeXP")
			t.truthy(zone.nodeCount >= 26 and zone.nodeCount <= 32, label .. " nodeCount 26-32")
			t.truthy(isWhole(zone.cost), label .. " cost")

			local egg = zone.eggId and Config.Eggs.byId[zone.eggId]
			t.truthy(egg, label .. " eggId does not exist")
			t.equal(egg.zoneId, zone.id, label .. " egg belongs to another zone")

			local theme = zone.theme
			t.equal(theme.decor, ZONE_DECOR[order], label .. " decor")
			t.truthy(typeof(theme.groundMaterial) == "EnumItem", label .. " groundMaterial")
			t.truthy(theme.groundMaterial.EnumType == Enum.Material, label .. " groundMaterial enum type")
			for _, key in { "ground", "cliff", "accent", "accent2", "fogColor", "ambient", "outdoorAmbient" } do
				t.equal(typeof(theme[key]), "Color3", `{label} theme.{key}`)
			end
			t.truthy(#theme.crystalColors >= 3, label .. " needs 3+ crystal colours")
			for _, color in theme.crystalColors do
				t.equal(typeof(color), "Color3", label .. " crystal colour")
			end
			t.truthy(theme.fogDensity >= 0 and theme.fogDensity <= 1, label .. " fogDensity 0..1")
			t.truthy(theme.clockTime >= 0 and theme.clockTime < 24, label .. " clockTime")
			t.truthy(theme.brightness > 0, label .. " brightness")

			if previous then
				t.truthy(zone.cost > previous.cost, label .. " cost must increase")
				t.truthy(zone.levelReq > previous.levelReq, label .. " levelReq must increase")
				t.truthy(zone.nodeHealth > previous.nodeHealth, label .. " nodeHealth must increase")
				t.truthy(zone.nodeCoins > previous.nodeCoins, label .. " nodeCoins must increase")
				t.truthy(zone.nodeXP > previous.nodeXP, label .. " nodeXP must increase")
			else
				t.equal(zone.cost, 0, "the first zone is free")
				t.equal(zone.levelReq, 1, "the first zone needs level 1")
			end
			previous = zone
		end
		t.truthy(zones[8].levelReq < Config.Game.levelCap)
	end)

	t.test("node types match the spec table", function()
		local expected = {
			{ "small", 60, 1, 1, 1, 0.01, 1, 5 },
			{ "medium", 28, 4, 5, 4, 0.03, 1.5, 7 },
			{ "large", 10, 14, 20, 14, 0.08, 2.2, 10 },
			{ "prismatic", 2, 40, 70, 40, 1, 2.8, 20 },
		}
		t.equal(#Config.NodeTypes.list, #expected)
		for index, row in expected do
			local def = Config.NodeTypes.list[index]
			t.equal(def.id, row[1])
			t.equal(def.weight, row[2], def.id .. " weight")
			t.equal(def.healthMult, row[3], def.id .. " healthMult")
			t.equal(def.coinMult, row[4], def.id .. " coinMult")
			t.equal(def.xpMult, row[5], def.id .. " xpMult")
			t.equal(def.gemChance, row[6], def.id .. " gemChance")
			t.equal(def.scale, row[7], def.id .. " scale")
			t.equal(def.respawnTime, row[8], def.id .. " respawnTime")
			t.truthy(#def.name > 0)
			t.truthy(isWhole(def.gemMin) and def.gemMin >= 1 and def.gemMax >= def.gemMin, def.id .. " gem range")
		end
		t.equal(Config.NodeTypes.byId.prismatic.gemMin, 3)
		t.equal(Config.NodeTypes.byId.prismatic.gemMax, 6)
		t.equal(Config.NodeTypes.big, { large = true, prismatic = true })
	end)

	t.test("hammers: 20 in order, 2-3 per zone, growing damage and cost", function()
		local hammers = Config.Hammers.list
		t.equal(#hammers, 20)
		t.equal(Config.Hammers.starterId, hammers[1].id)
		t.equal(hammers[1].cost, 0, "the starter hammer is free")
		t.equal(hammers[1].zoneOrder, 1)

		local perZone = {}
		local names = {}
		for index, hammer in hammers do
			local label = "hammer " .. hammer.id
			t.truthy(Config.Zones.list[hammer.zoneOrder] ~= nil, label .. " zoneOrder")
			t.truthy(isWhole(hammer.damage) and hammer.damage > 0, label .. " damage")
			t.truthy(isWhole(hammer.cost) and hammer.cost >= 0, label .. " cost")
			t.falsy(names[hammer.name], label .. " duplicate name")
			names[hammer.name] = true
			perZone[hammer.zoneOrder] = (perZone[hammer.zoneOrder] or 0) + 1

			local visual = hammer.visual
			t.equal(typeof(visual.headColor), "Color3", label .. " headColor")
			t.equal(typeof(visual.handleColor), "Color3", label .. " handleColor")
			t.truthy(visual.material.EnumType == Enum.Material, label .. " material")
			t.truthy(contains({ "block", "cylinder", "spike", "crystal" }, visual.shape), label .. " shape")
			t.truthy(visual.scale > 0 and visual.scale <= 3, label .. " scale")
			t.equal(type(visual.glow), "boolean", label .. " glow")

			local previous = hammers[index - 1]
			if previous then
				t.truthy(hammer.zoneOrder >= previous.zoneOrder, label .. " zoneOrder must not decrease")
				t.truthy(hammer.cost > previous.cost, label .. " cost must increase")
				local step = hammer.damage / previous.damage
				t.truthy(step >= 1.8 and step <= 3.5, `{label} damage step {step} outside 1.8-3.5`)
				t.truthy(visual.scale >= previous.visual.scale, label .. " visuals should escalate")
			end

			-- A zone-appropriate hammer breaks a small crystal of its own zone in a handful of hits.
			local zone = Config.Zones.list[hammer.zoneOrder]
			local hits = zone.nodeHealth / hammer.damage
			t.truthy(hits >= 0.4 and hits <= 6, `{label} needs {hits} hits in its zone`)
		end
		for order in Config.Zones.list do
			local count = perZone[order] or 0
			t.truthy(count >= 2 and count <= 3, `zone {order} has {count} hammers (2-3 expected)`)
		end
	end)

	t.test("pets: valid definitions, tiers and exclusives", function()
		local pets = Config.Pets.list
		t.truthy(#pets >= 43, "43+ pets expected, got " .. #pets)
		local names = {}
		for _, pet in pets do
			local label = "pet " .. pet.id
			t.truthy(#pet.name > 0, label .. " name")
			t.falsy(names[pet.name], label .. " duplicate name " .. pet.name)
			names[pet.name] = true
			t.truthy(Config.Rarities.byId[pet.rarity] ~= nil, label .. " rarity")
			t.truthy(isPositive(pet.power), label .. " power")
			t.truthy(contains(ARCHETYPES, pet.visual.archetype), label .. " archetype " .. pet.visual.archetype)
			t.equal(typeof(pet.visual.primary), "Color3", label .. " primary")
			t.equal(typeof(pet.visual.secondary), "Color3", label .. " secondary")
			t.equal(type(pet.visual.flying), "boolean", label .. " flying")
			t.truthy(pet.visual.scale > 0.5 and pet.visual.scale <= 2, label .. " scale")
		end

		t.equal(Config.Pets.tiers, {
			{ tier = 1, name = "Normal", powerMult = 1 },
			{ tier = 2, name = "Golden", powerMult = 2.5 },
			{ tier = 3, name = "Rainbow", powerMult = 6 },
		})
		t.equal(Config.Pets.maxTier, 3)

		t.equal(Config.Pets.exclusiveIds, { "starter_fox", "vip_unicorn", "royal_dragon" })
		local exclusiveCount = 0
		for _, pet in pets do
			if pet.rarity == "Exclusive" then
				exclusiveCount += 1
				t.truthy(contains(Config.Pets.exclusiveIds, pet.id), pet.id .. " missing from exclusiveIds")
			end
		end
		t.equal(exclusiveCount, 3)
		t.equal(Config.Monetization.vipPetId, "vip_unicorn")
	end)

	t.test("eggs: one per zone, valid pets, weights sum to 100, rarer is stronger", function()
		local eggs = Config.Eggs.list
		t.equal(#eggs, #Config.Zones.list)
		local owner = {} -- petId -> eggId
		local previous
		for index, egg in eggs do
			local label = "egg " .. egg.id
			local zone = Config.Zones.byId[egg.zoneId]
			t.truthy(zone, label .. " zoneId does not exist")
			t.equal(zone.order, index, label .. " is not in zone order")
			t.equal(zone.eggId, egg.id, label .. " is not its zone's egg")
			t.truthy(#egg.name > 0, label .. " name")
			t.truthy(isWhole(egg.cost) and egg.cost > 0, label .. " cost")
			t.equal(typeof(egg.color), "Color3")
			t.equal(typeof(egg.spotColor), "Color3")
			t.equal(#egg.pets, if index <= 4 then 5 else 6, label .. " pet count")

			local total = 0
			local lastRarityOrder, lastPower, lastWeight = 0, 0, math.huge
			for _, entry in egg.pets do
				local pet = Config.Pets.byId[entry.petId]
				t.truthy(pet, `{label}: unknown pet "{tostring(entry.petId)}"`)
				t.falsy(owner[pet.id], `{pet.id} is in two eggs`)
				owner[pet.id] = egg.id
				t.truthy(pet.rarity ~= "Exclusive", `{label}: exclusive pet {pet.id} must not be in an egg`)
				t.truthy(isPositive(entry.weight), label .. " weight")
				total += entry.weight

				local rarityOrder = Config.Rarities.byId[pet.rarity].order
				t.truthy(rarityOrder > lastRarityOrder, `{label}: pets must go from common to rare`)
				t.truthy(pet.power > lastPower, `{label}: {pet.id} should be stronger than the rarity below`)
				t.truthy(entry.weight < lastWeight, `{label}: rarer pets must be less likely`)
				lastRarityOrder, lastPower, lastWeight = rarityOrder, pet.power, entry.weight
			end
			t.near(total, 100, 1e-6, label .. " weights must sum to 100")

			if previous then
				t.truthy(egg.cost > previous.cost, label .. " cost must increase")
				t.truthy(
					Config.Pets.byId[egg.pets[1].petId].power > Config.Pets.byId[previous.pets[1].petId].power,
					label .. " pets should beat the previous egg's"
				)
			end
			previous = egg
		end

		-- Every pet is either in exactly one egg or Exclusive.
		for _, pet in Config.Pets.list do
			if pet.rarity == "Exclusive" then
				t.falsy(owner[pet.id], pet.id .. " is exclusive but hatches from " .. tostring(owner[pet.id]))
			else
				t.truthy(owner[pet.id], pet.id .. " cannot be obtained from any egg")
			end
		end
	end)

	t.test("the Meadow Egg matches the previews", function()
		local egg = Config.Eggs.byId[Config.Zones.list[1].eggId]
		t.equal(egg.name, "Meadow Egg")
		local expected = {
			{ "Clover Bunny", "Common", 50 },
			{ "Daisy Pup", "Uncommon", 30 },
			{ "Honey Cat", "Rare", 15 },
			{ "Meadow Fox", "Epic", 4.5 },
			{ "Sun Dragon", "Legendary", 0.5 },
		}
		t.equal(#egg.pets, #expected)
		for index, row in expected do
			local pet = Config.Pets.byId[egg.pets[index].petId]
			t.equal(pet.name, row[1])
			t.equal(pet.rarity, row[2])
			t.equal(egg.pets[index].weight, row[3])
		end
		-- Later eggs add a Mythic at 0.05 %.
		local late = Config.Eggs.list[5]
		t.equal(late.pets[1].weight, 49.95)
		t.equal(late.pets[6].weight, 0.05)
		t.equal(Config.Pets.byId[late.pets[6].petId].rarity, "Mythic")
	end)

	t.test("upgrades match the spec list exactly", function()
		t.equal(#Config.Upgrades.list, 12)
		for index, id in UPGRADE_ORDER do
			local def = Config.Upgrades.list[index]
			local expected = UPGRADES[id]
			t.equal(def.id, id)
			t.equal(def.maxLevel, expected[1], id .. " maxLevel")
			t.equal(def.effectPerLevel, expected[2], id .. " effectPerLevel")
			t.equal(def.effectKind, expected[3], id .. " effectKind")
			t.truthy(#def.name > 0 and #def.icon > 0 and #def.description > 0, id .. " texts")
			t.falsy(string.find(def.description, "\n"), id .. " description must be one line")
			t.truthy(isWhole(def.baseCost) and def.baseCost >= 1, id .. " baseCost")
			t.truthy(def.costGrowth > 1, id .. " costGrowth")
			-- Costs stay finite and strictly increase level by level.
			local last = 0
			for level = 0, def.maxLevel - 1 do
				local cost = math.floor(def.baseCost * def.costGrowth ^ level)
				t.truthy(isFinite(cost) and cost > last, `{id} cost at level {level}`)
				last = cost
			end
		end
		-- The swing cooldown can never go negative, even at max level.
		local swift = Config.Upgrades.byId.swift
		t.truthy(swift.effectPerLevel * swift.maxLevel < 1)
	end)

	t.test("boosts are the four x2 boosts", function()
		t.equal(#Config.Boosts.list, #BOOST_IDS)
		for index, id in BOOST_IDS do
			local def = Config.Boosts.list[index]
			t.equal(def.id, id)
			t.equal(def.multiplier, 2)
			t.truthy(#def.name > 0 and #def.icon > 0)
			t.equal(typeof(def.color), "Color3")
		end
	end)

	t.test("game passes: keys, prices and policy flags match the spec", function()
		local passes = Config.Monetization.Passes
		t.equal(#passes.list, countKeys(PASSES))
		for key, expected in PASSES do
			local def = passes.byId[key]
			t.truthy(def, "missing pass " .. key)
			t.equal(def.price, expected[1], key .. " price")
			t.equal(def.randomItemRelated, expected[2], key .. " randomItemRelated")
			t.equal(def.id, 0, key .. " id must default to 0")
			t.truthy(#def.name > 0 and #def.icon > 0 and #def.description > 0, key .. " texts")
		end
		t.equal(Config.Monetization.studioTestMode, false)
	end)

	t.test("products: keys, prices, rewards and policy flags match the spec", function()
		local products = Config.Monetization.Products
		t.equal(#products.list, countKeys(PRODUCTS))
		for key, expected in PRODUCTS do
			local def = products.byId[key]
			t.truthy(def, "missing product " .. key)
			t.equal(def.price, expected[1], key .. " price")
			t.equal(def.category, expected[2], key .. " category")
			t.equal(def.oneTime, expected[3], key .. " oneTime")
			t.equal(def.grantsCurrency, expected[4], key .. " grantsCurrency")
			t.equal(def.randomItemRelated, expected[5], key .. " randomItemRelated")
			t.equal(def.bestValue == true, expected[6], key .. " bestValue")
			t.equal(def.id, 0, key .. " id must default to 0")
			t.truthy(#def.name > 0 and #def.icon > 0 and #def.description > 0, key .. " texts")
			checkReward("product " .. key, def.reward)
			-- The policy flag must cover what the reward really contains.
			local reward = def.reward
			local hasCurrency = reward.coins ~= nil or reward.coinsScaled ~= nil or reward.gems ~= nil
			t.equal(def.grantsCurrency, hasCurrency, key .. " grantsCurrency must reflect its reward")
			local hasLuck = false
			for _, grant in reward.boosts or { reward.boost } do
				hasLuck = hasLuck or grant.id == "luck"
			end
			t.equal(def.randomItemRelated, hasLuck, key .. " randomItemRelated must reflect its reward")
		end

		local byId = products.byId
		t.equal(byId.coinsSmall.reward, { coinsScaled = 400 })
		t.equal(byId.coinsMedium.reward, { coinsScaled = 1600 })
		t.equal(byId.coinsLarge.reward, { coinsScaled = 6000 })
		t.equal(byId.coinsMega.reward, { coinsScaled = 20000 })
		t.equal(byId.gemsSmall.reward, { gems = 100 })
		t.equal(byId.gemsMedium.reward, { gems = 550 })
		t.equal(byId.gemsLarge.reward, { gems = 1500 })
		t.equal(byId.gemsMega.reward, { gems = 5000 })
		t.equal(byId.boostCoins.reward, { boost = { id = "coins", seconds = 1800 } })
		t.equal(byId.boostXP.reward, { boost = { id = "xp", seconds = 1800 } })
		t.equal(byId.boostDamage.reward, { boost = { id = "damage", seconds = 1800 } })
		t.equal(byId.boostLuck.reward, { boost = { id = "luck", seconds = 1800 } })
		t.equal(#byId.boostAll.reward.boosts, 4)
		for _, grant in byId.boostAll.reward.boosts do
			t.equal(grant.seconds, 3600)
		end
		t.equal(byId.starterPack.reward, {
			pet = { petId = "starter_fox", tier = 1 },
			gems = 250,
			coinsScaled = 500,
			boost = { id = "coins", seconds = 1800 },
		})
		t.equal(byId.royalDragon.reward, { pet = { petId = "royal_dragon", tier = 1 } })
		-- Bigger packs must never be a worse deal than smaller ones.
		for _, family in { { "coins", "coinsScaled" }, { "gems", "gems" } } do
			local lastRate = 0
			for _, size in { "Small", "Medium", "Large", "Mega" } do
				local def = byId[family[1] .. size]
				local rate = def.reward[family[2]] / def.price
				t.truthy(rate >= lastRate, def.key .. " is a worse deal than the smaller pack")
				lastRate = rate
			end
		end
	end)

	t.test("quests: valid kinds, texts, goals and rewards", function()
		local quests = Config.Quests.list
		t.truthy(#quests >= 12 and #quests <= 16, "about 14 quests expected, got " .. #quests)
		t.truthy(#quests >= Config.Game.questsPerDay)
		local kinds = {}
		for _, quest in quests do
			local label = "quest " .. quest.id
			t.truthy(contains(QUEST_KINDS, quest.kind), label .. " kind")
			kinds[quest.kind] = true
			t.equal(countPlaceholders(quest.text), 1, label .. " text needs exactly one %s")
			t.truthy(isWhole(quest.goal) and quest.goal > 0, label .. " goal")
			t.equal(quest.goalScaled, quest.kind == "coins", label .. " goalScaled is for coin quests only")
			t.truthy(isPositive(quest.weight), label .. " weight")
			checkReward(label, quest.reward)
		end
		for _, kind in QUEST_KINDS do
			t.truthy(kinds[kind], "no quest of kind " .. kind)
		end
	end)

	t.test("achievements: known stats, increasing tiers, valid rewards", function()
		local achievements = Config.Achievements.list
		t.truthy(#achievements >= 9 and #achievements <= 12, "about 10 achievements expected")
		local stats = {}
		for _, achievement in achievements do
			local label = "achievement " .. achievement.id
			t.truthy(contains(STAT_KEYS, achievement.stat), `{label}: unknown stat "{achievement.stat}"`)
			t.falsy(stats[achievement.stat], label .. " reuses stat " .. achievement.stat)
			stats[achievement.stat] = true
			t.truthy(#achievement.name > 0 and #achievement.icon > 0, label .. " texts")
			t.equal(countPlaceholders(achievement.text), 1, label .. " text needs exactly one %s")
			t.truthy(#achievement.tiers >= 5 and #achievement.tiers <= 7, label .. " needs 5-7 tiers")
			local lastGoal = 0
			for index, tier in achievement.tiers do
				t.truthy(isWhole(tier.goal) and tier.goal > lastGoal, `{label} tier {index} goal must increase`)
				lastGoal = tier.goal
				checkReward(`{label} tier {index}`, tier.reward)
			end
		end
		for _, stat in
			{
				"crystalsSmashed",
				"bigCrystals",
				"totalCoins",
				"eggsHatched",
				"petsDiscovered",
				"level",
				"rebirths",
				"playSeconds",
				"bossesDefeated",
				"upgradesBought",
			}
		do
			t.truthy(stats[stat], "no achievement for " .. stat)
		end
		-- Reachable: level goals below the cap, pet index goals within the number of pets, upgrade goals within
		-- the total number of upgrade levels.
		local byStat = {}
		for _, achievement in achievements do
			byStat[achievement.stat] = achievement
		end
		local function lastGoalOf(stat: string): number
			local tiers = byStat[stat].tiers
			return tiers[#tiers].goal
		end
		t.truthy(lastGoalOf("level") <= Config.Game.levelCap)
		t.truthy(lastGoalOf("petsDiscovered") <= #Config.Pets.list - #Config.Pets.exclusiveIds)
		local totalUpgradeLevels = 0
		for _, def in Config.Upgrades.list do
			totalUpgradeLevels += def.maxLevel
		end
		t.truthy(lastGoalOf("upgradesBought") <= totalUpgradeLevels)

		-- Optional badges: one entry per achievement, pointing at an existing tier, ids default to 0.
		for id, badge in Config.Achievements.badges do
			local achievement = Config.Achievements.byId[id]
			t.truthy(achievement, "badge for unknown achievement " .. tostring(id))
			t.truthy(achievement.tiers[badge.tier] ~= nil, "badge tier out of range for " .. id)
			t.equal(badge.badgeId, 0, "badge ids must default to 0 (" .. id .. ")")
		end
		t.equal(countKeys(Config.Achievements.badges), #achievements)
	end)

	t.test("daily rewards: 7 days, day 7 is the best", function()
		local rewards = Config.DailyRewards
		t.equal(#rewards, 7)
		for day, reward in rewards do
			checkReward("daily " .. day, reward)
		end
		-- Value a reward roughly (gems count most) to make sure day 7 beats every other day.
		local function score(reward): number
			local boostSeconds = 0
			for _, grant in reward.boosts or { reward.boost } do
				boostSeconds += grant.seconds
			end
			return (reward.gems or 0) * 10 + (reward.coinsScaled or 0) + (reward.xpScaled or 0) + boostSeconds / 60
		end
		for day = 1, 6 do
			t.truthy(score(rewards[7]) > score(rewards[day]), `day 7 must beat day {day}`)
		end
	end)

	t.test("playtime rewards: gifts at 2, 5, 10, 20, 30, 45, 60 and 90 minutes", function()
		local minutes = { 2, 5, 10, 20, 30, 45, 60, 90 }
		t.equal(#Config.PlaytimeRewards, #minutes)
		for index, def in Config.PlaytimeRewards do
			t.equal(def.seconds, minutes[index] * 60, "gift " .. index)
			checkReward("playtime gift " .. index, def.reward)
		end
	end)

	t.test("codes: upper-case keys within the length limit and valid rewards", function()
		local codes = Config.Codes.byId
		t.truthy(countKeys(codes) >= 3)
		for _, code in { "RELEASE", "CRYSTALS", "SMASH100" } do
			t.truthy(codes[code], "missing code " .. code)
		end
		for code, def in codes do
			t.truthy(
				type(code) == "string" and #code > 0 and #code <= Config.Game.codeMaxLength,
				"code length " .. code
			)
			t.equal(string.upper(code), code, "code keys must be upper case")
			t.falsy(string.find(code, "%s"), "code keys must not contain spaces")
			checkReward("code " .. code, def.reward)
			t.truthy(def.expires == nil or isPositive(def.expires), "code expiry " .. code)
		end
	end)

	t.test("tutorial: five steps with allowed goal kinds and hints", function()
		local steps = Config.Tutorial.list
		t.equal(#steps, 5)
		for index, step in steps do
			local label = "tutorial step " .. index
			t.truthy(#step.text > 0, label .. " text")
			t.truthy(contains(TUTORIAL_GOALS, step.goalKind), label .. " goalKind " .. step.goalKind)
			t.truthy(contains(TUTORIAL_HINTS, step.hint), label .. " hint " .. step.hint)
			t.truthy(isWhole(step.goalAmount) and step.goalAmount >= 1, label .. " goalAmount")
		end
		checkReward("tutorial", Config.Tutorial.reward)
		t.truthy((Config.Tutorial.reward.gems or 0) > 0, "the tutorial ends with a gem reward")
		-- The upgrade step must be doable early: the cheapest upgrade costs no more than the gems of the first
		-- few level-ups.
		local cheapest = math.huge
		for _, def in Config.Upgrades.list do
			cheapest = math.min(cheapest, def.baseCost)
		end
		local Game = Config.Game
		local earlyGems = 0
		for level = 2, 4 do
			earlyGems += math.min(Game.levelUpGemMax, math.floor(Game.levelUpGemBase + Game.levelUpGemPerLevel * level))
		end
		t.truthy(cheapest <= earlyGems, "the first upgrade must be affordable by level 4")
	end)

	t.test("sounds: every required name exists and uses a built-in sound", function()
		for _, name in SOUND_NAMES do
			local def = Config.Sounds.byId[name]
			t.truthy(def, "missing sound " .. name)
			t.truthy(type(def.id) == "string", name .. " id")
			if def.id ~= "" then
				local file = string.match(def.id, "^rbxasset://sounds/(.+)$")
				t.truthy(file and contains(BUILT_IN_SOUNDS, file), `{name}: "{def.id}" is not a built-in sound`)
			end
			t.truthy(def.volume > 0 and def.volume <= 1, name .. " volume")
			t.truthy(def.pitch == nil or (def.pitch > 0 and def.pitch <= 3), name .. " pitch")
		end
		t.equal(Config.Sounds.Music, {})
	end)

	t.test("rarities: order and style-guide colours", function()
		t.equal(#Config.Rarities.list, #RARITY_ORDER)
		for index, id in RARITY_ORDER do
			local def = Config.Rarities.list[index]
			t.equal(def.id, id)
			t.equal(def.name, id)
			t.equal(typeof(def.color), "Color3")
			if RARITY_HEX[id] then
				t.equal(hexOf(def.color), RARITY_HEX[id], id .. " colour")
			end
			t.equal(def.rainbow, id == "Exclusive", id .. " rainbow")
			t.equal(def.luckAffected, contains({ "Rare", "Epic", "Legendary", "Mythic" }, id), id .. " luckAffected")
			t.equal(def.announce, id == "Legendary" or id == "Mythic", id .. " announce")
		end
	end)

	t.test("boss: sane timings and a valid reward", function()
		local Boss = Config.Boss
		for _, key in { "firstDelay", "interval", "duration", "hitsPerPlayer", "minHealth", "updateInterval", "range" } do
			t.truthy(isPositive(Boss[key]), "Boss." .. key)
		end
		t.truthy(Boss.duration < Boss.interval, "a boss must be gone before the next one spawns")
		t.truthy(Boss.minShare > 0 and Boss.minShare < 1)
		t.truthy(Boss.maxShareMult >= 1)
		t.truthy(Boss.timeoutRewardScale >= 0 and Boss.timeoutRewardScale <= 1)
		-- One player swinging at the base rate must be able to deal their fair share within the duration.
		t.truthy(Boss.hitsPerPlayer * Config.Game.baseSwingCooldown < Boss.duration)
		checkReward("boss", Boss.reward)
		t.truthy(#Boss.colors >= 1)
	end)

	t.test("economy: prices fit the progression", function()
		local zones = Config.Zones.list
		for index, hammer in Config.Hammers.list do
			-- A hammer never costs more than unlocking the zone after its own (it would be skipped).
			local nextZone = zones[hammer.zoneOrder + 1]
			if nextZone and index > 1 then
				t.truthy(hammer.cost < nextZone.cost, `{hammer.id} costs more than unlocking {nextZone.id}`)
			end
		end
		for index, egg in Config.Eggs.list do
			local nextZone = zones[index + 1]
			if nextZone then
				t.truthy(egg.cost * 5 <= nextZone.cost, `{egg.id} is too expensive next to unlocking {nextZone.id}`)
			end
		end
		-- The first purchases come quickly: the second hammer costs at most 60 small crystals.
		t.truthy(Config.Hammers.list[2].cost <= 60 * zones[1].nodeCoins)
		-- The first rebirth is priced inside the mid game (between unlocking zone 4 and zone 6).
		t.truthy(Config.Game.rebirthCostBase > zones[4].cost and Config.Game.rebirthCostBase < zones[6].cost)
	end)
end
