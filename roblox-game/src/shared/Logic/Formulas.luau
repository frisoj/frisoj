--!strict
--[[
	Formulas — all game math in one pure module (no services, no Instances), shared by the server, the client
	UI and the headless tests. Every balance number comes from Config; nothing here is tuned by hand.

	Conventions the rest of the game relies on:
	- data.xp is the XP collected toward the NEXT level (it restarts at 0 on every level-up), see applyXP.
	- A boost is active when data.boosts[id] > 0 (remaining seconds) or session.boostEnds[id] is set, see
	  isBoostActive. BoostService must clear both before it refreshes the stats of an expired boost.
	- Every function is total: odd input (NaN, negative numbers, unknown ids, levels above the maximum) is
	  clamped or ignored instead of raising, and no result is ever NaN.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))
local Config = require(Shared:WaitForChild("Config"))
local NumberFormat = require(Shared:WaitForChild("Util"):WaitForChild("NumberFormat"))
local TableUtil = require(Shared:WaitForChild("Util"):WaitForChild("TableUtil"))

type PlayerData = Types.PlayerData
type SessionState = Types.SessionState
type Stats = Types.Stats
type ZoneDef = Types.ZoneDef
type NodeTypeDef = Types.NodeTypeDef
type HammerDef = Types.HammerDef
type UpgradeDef = Types.UpgradeDef
type PetInstance = Types.PetInstance

-- One factor of the coin multiplier, for the Stats window (statBreakdown).
export type BreakdownEntry = { label: string, mult: number }

local Game = Config.Game
local clampNumber = TableUtil.clampNumber
local clampInteger = TableUtil.clampInteger

local Formulas = {}

-- Sanity bounds (not balance): they keep saved numbers finite and counters exact. DataSchema clamps to them.
Formulas.MAX_CURRENCY = 1e300 -- coins, gems, XP
Formulas.MAX_COUNT = 1e15 -- counters, timestamps and other whole numbers (exact in a double)
Formulas.MAX_REBIRTHS = 1e6

-- Costs are floor(a * b ^ n); the epsilon stops 2400 from becoming 2399 when the product lands a hair low.
local EPSILON = 1e-9

local MAX_CURRENCY = Formulas.MAX_CURRENCY
local MAX_COUNT = Formulas.MAX_COUNT

local function levelOf(data: PlayerData): number
	return clampInteger(data.level, 1, Game.levelCap, 1)
end

local function rebirthsOf(data: PlayerData): number
	return clampInteger(data.rebirths, 0, Formulas.MAX_REBIRTHS, 0)
end

-- "Need 40K more coins" (rounded up to a whole unit so it never reads "Need 0 more").
local function needMore(missing: number, singular: string): string
	local amount = math.max(1, math.ceil(missing))
	return "Need " .. NumberFormat.abbreviate(amount) .. " more " .. singular .. (if amount == 1 then "" else "s")
end

---------------------------------------------------------------------------------------------------
-- Levels

-- XP needed to go from `level` to `level + 1`.
function Formulas.xpForLevel(level: number): number
	local l = clampInteger(level, 1, Game.levelCap, 1)
	return math.max(1, math.floor(Game.xpBase * l ^ Game.xpExponent * Game.xpGrowth ^ (l - 1) + EPSILON))
end

-- Gems granted for reaching `newLevel`.
function Formulas.levelUpGems(newLevel: number): number
	local l = clampInteger(newLevel, 1, MAX_COUNT, 1)
	local gems = math.floor(Game.levelUpGemBase + Game.levelUpGemPerLevel * l + EPSILON)
	return math.clamp(gems, 0, Game.levelUpGemMax)
end

-- Adds `amount` XP to (level, xp) and returns newLevel, newXP, levelsGained, gemsEarned. XP stops counting at
-- Config.Game.levelCap (newXP is 0 there). Currency.addXP is expected to use this so the curve lives in one place.
function Formulas.applyXP(level: number, xp: number, amount: number): (number, number, number, number)
	local newLevel = clampInteger(level, 1, Game.levelCap, 1)
	local newXP = clampNumber(xp, 0, MAX_CURRENCY, 0) + clampNumber(amount, 0, MAX_CURRENCY, 0)
	local gained, gems = 0, 0
	while newLevel < Game.levelCap do
		local needed = Formulas.xpForLevel(newLevel)
		if newXP < needed then
			break
		end
		newXP -= needed
		newLevel += 1
		gained += 1
		gems += Formulas.levelUpGems(newLevel)
	end
	if newLevel >= Game.levelCap then
		newXP = 0
	end
	return newLevel, math.min(newXP, MAX_CURRENCY), gained, gems
end

-- (xpIntoLevel, xpNeeded) for the XP bar; xpIntoLevel never exceeds xpNeeded. At the level cap it is (1, 1):
-- a full bar (check data.level >= Config.Game.levelCap to print "MAX").
function Formulas.levelProgress(data: PlayerData): (number, number)
	local level = levelOf(data)
	if level >= Game.levelCap then
		return 1, 1
	end
	local needed = Formulas.xpForLevel(level)
	return clampNumber(data.xp, 0, needed, 0), needed
end

---------------------------------------------------------------------------------------------------
-- Upgrades and rebirth

-- Owned level of an upgrade track: a whole number in 0..maxLevel (0 for unknown ids and odd saved values).
function Formulas.upgradeLevel(data: PlayerData, upgradeId: string): number
	local def = Config.Upgrades.byId[upgradeId]
	if def == nil then
		return 0
	end
	return clampInteger(data.upgrades[upgradeId], 0, def.maxLevel, 0)
end

-- Gems for the next level when `currentLevel` is owned. Check currentLevel < def.maxLevel first (canBuyUpgrade).
function Formulas.upgradeCost(def: UpgradeDef, currentLevel: number): number
	local level = clampInteger(currentLevel, 0, math.max(0, def.maxLevel), 0)
	return math.max(1, math.floor(def.baseCost * def.costGrowth ^ level + EPSILON))
end

-- Whether the next level of `def` can be bought now; reason text when not ("Max level", "Need 12 more gems").
function Formulas.canBuyUpgrade(data: PlayerData, def: UpgradeDef): (boolean, string?)
	local level = Formulas.upgradeLevel(data, def.id)
	if level >= def.maxLevel then
		return false, "Max level"
	end
	local missing = Formulas.upgradeCost(def, level) - clampNumber(data.gems, 0, MAX_CURRENCY, 0)
	if missing > 0 then
		return false, needMore(missing, "gem")
	end
	return true, nil
end

-- Coins needed for the next rebirth when `rebirths` are done. Infinite (never affordable) once the curve
-- overflows, far beyond anything reachable.
function Formulas.rebirthCost(rebirths: number): number
	local r = clampInteger(rebirths, 0, Formulas.MAX_REBIRTHS, 0)
	return math.floor(Game.rebirthCostBase * Game.rebirthCostGrowth ^ r + EPSILON)
end

-- Gems granted by the rebirth that brings the total to `newRebirths`.
function Formulas.rebirthGems(newRebirths: number): number
	local n = clampInteger(newRebirths, 1, Formulas.MAX_REBIRTHS, 1)
	local gems = math.floor(Game.rebirthGemBase + Game.rebirthGemPerRebirth * (n - 1) + EPSILON)
	return math.clamp(gems, 0, Game.rebirthGemMax)
end

-- Whether the player can rebirth now; reason text when not.
function Formulas.canRebirth(data: PlayerData): (boolean, string?)
	local rebirths = rebirthsOf(data)
	if rebirths >= Formulas.MAX_REBIRTHS then
		return false, "Max rebirths reached"
	end
	local missing = Formulas.rebirthCost(rebirths) - clampNumber(data.coins, 0, MAX_CURRENCY, 0)
	if missing > 0 then
		return false, needMore(missing, "coin")
	end
	return true, nil
end

---------------------------------------------------------------------------------------------------
-- Zones

-- The zone with that `order` (1 = hub), or nil.
function Formulas.zoneByOrder(order: number): ZoneDef?
	for _, zone in Config.Zones.list do
		if zone.order == order then
			return zone
		end
	end
	return nil
end

local function firstZone(): ZoneDef
	local zone: ZoneDef? = Config.Zones.byId[Config.Zones.firstId]
	return zone or Config.Zones.list[1]
end

-- Highest-order unlocked zone (the hub zone when nothing is marked).
function Formulas.bestZone(data: PlayerData): ZoneDef
	local best = firstZone()
	for _, zone in Config.Zones.list do
		if data.zones.unlocked[zone.id] == true and zone.order > best.order then
			best = zone
		end
	end
	return best
end

-- The next zone to unlock (lowest order that is still locked), or nil when everything is unlocked.
function Formulas.nextZone(data: PlayerData): ZoneDef?
	local hub = firstZone()
	local nextZone: ZoneDef? = nil
	for _, zone in Config.Zones.list do
		if zone.id ~= hub.id and data.zones.unlocked[zone.id] ~= true then
			if nextZone == nil or zone.order < nextZone.order then
				nextZone = zone
			end
		end
	end
	return nextZone
end

-- Coins that "one small crystal of the player's best zone" is worth; scales coinsScaled rewards and quest goals.
function Formulas.coinScale(data: PlayerData): number
	return Formulas.bestZone(data).nodeCoins * (1 + Game.rebirthCoinBonus * rebirthsOf(data))
end

-- Same for XP (xpScaled rewards).
function Formulas.xpScale(data: PlayerData): number
	return Formulas.bestZone(data).nodeXP * (1 + Game.rebirthXPBonus * rebirthsOf(data))
end

-- Zones unlock strictly in order: previous zone, then level, then coins.
function Formulas.canUnlockZone(data: PlayerData, zone: ZoneDef): (boolean, string?)
	if zone.id == firstZone().id or data.zones.unlocked[zone.id] == true then
		return false, "Already unlocked"
	end
	local previous = Formulas.zoneByOrder(zone.order - 1)
	if previous ~= nil and previous.id ~= firstZone().id and data.zones.unlocked[previous.id] ~= true then
		return false, "Unlock " .. previous.name .. " first"
	end
	if levelOf(data) < zone.levelReq then
		return false, "Reach level " .. tostring(zone.levelReq)
	end
	local missing = zone.cost - clampNumber(data.coins, 0, MAX_CURRENCY, 0)
	if missing > 0 then
		return false, needMore(missing, "coin")
	end
	return true, nil
end

-- A hammer needs its zone unlocked and coins; owned hammers cannot be bought again.
function Formulas.canBuyHammer(data: PlayerData, hammer: HammerDef): (boolean, string?)
	if hammer.id == Config.Hammers.starterId or data.hammers.owned[hammer.id] == true then
		return false, "Already owned"
	end
	local zone = Formulas.zoneByOrder(hammer.zoneOrder)
	if zone ~= nil and zone.id ~= firstZone().id and data.zones.unlocked[zone.id] ~= true then
		return false, "Unlock " .. zone.name .. " first"
	end
	local missing = hammer.cost - clampNumber(data.coins, 0, MAX_CURRENCY, 0)
	if missing > 0 then
		return false, needMore(missing, "coin")
	end
	return true, nil
end

---------------------------------------------------------------------------------------------------
-- Crystals and the boss

function Formulas.nodeMaxHealth(zone: ZoneDef, nodeType: NodeTypeDef): number
	return math.max(1, zone.nodeHealth * nodeType.healthMult)
end

-- (coins, xp) for smashing the whole crystal, before the player's multipliers.
function Formulas.nodeReward(zone: ZoneDef, nodeType: NodeTypeDef): (number, number)
	return zone.nodeCoins * nodeType.coinMult, zone.nodeXP * nodeType.xpMult
end

-- Boss health for the given stats.damage values of the online players (one entry per player).
function Formulas.bossMaxHealth(damages: { number }): number
	local total = 0
	for _, damage in damages do
		total += clampNumber(damage, 0, MAX_CURRENCY, 0) * Config.Boss.hitsPerPlayer
	end
	return math.clamp(math.floor(total), Config.Boss.minHealth, MAX_CURRENCY)
end

---------------------------------------------------------------------------------------------------
-- Pets

-- def.power * tier multiplier; 0 for a pet that no longer exists in Config.
function Formulas.petPower(pet: PetInstance): number
	local def = Config.Pets.byId[pet.petId]
	if def == nil then
		return 0
	end
	local tierDef = Config.Pets.tiers[clampInteger(pet.tier, 1, Config.Pets.maxTier, 1)]
	local mult = if tierDef ~= nil then tierDef.powerMult else 1
	return clampNumber(def.power * mult, 0, MAX_CURRENCY, 0)
end

-- Numeric order for ids like "p9" < "p10": shorter first, then alphabetical.
local function uidLess(a: string, b: string): boolean
	if #a ~= #b then
		return #a < #b
	end
	return a < b
end

-- Sort order used everywhere pets are ranked: stronger first, ties broken by the older (smaller) uid, so the
-- result is deterministic. Usage: table.sort(pets, Formulas.comparePets)
function Formulas.comparePets(a: PetInstance, b: PetInstance): boolean
	local powerA, powerB = Formulas.petPower(a), Formulas.petPower(b)
	if powerA ~= powerB then
		return powerA > powerB
	end
	return uidLess(tostring(a.id), tostring(b.id))
end

-- Equipped pets that exist in Config, strongest first (deterministic order).
function Formulas.equippedPets(data: PlayerData): { PetInstance }
	local equipped: { PetInstance } = {}
	for _, pet in data.pets.list do
		if type(pet) == "table" and pet.equipped == true and Config.Pets.byId[pet.petId] ~= nil then
			table.insert(equipped, pet)
		end
	end
	table.sort(equipped, Formulas.comparePets)
	return equipped
end

-- (total pets in the inventory, pets flagged as equipped).
function Formulas.countPets(data: PlayerData): (number, number)
	local total, equipped = 0, 0
	for _, pet in data.pets.list do
		total += 1
		if type(pet) == "table" and pet.equipped == true then
			equipped += 1
		end
	end
	return total, equipped
end

---------------------------------------------------------------------------------------------------
-- Derived stats

-- Owned game pass (Robux-owned or granted): reads session.passes.
function Formulas.hasPass(session: SessionState, passKey: string): boolean
	return session.passes[passKey] == true
end

-- A boost counts while it has remaining seconds in the saved data or an end time in the session.
function Formulas.isBoostActive(data: PlayerData, session: SessionState, boostId: string): boolean
	if clampNumber(data.boosts[boostId], 0, MAX_CURRENCY, 0) > 0 then
		return true
	end
	return type(session.boostEnds[boostId]) == "number"
end

local function boostMult(data: PlayerData, session: SessionState, boostId: string): number
	local def = Config.Boosts.byId[boostId]
	if def == nil or not Formulas.isBoostActive(data, session, boostId) then
		return 1
	end
	return clampNumber(def.multiplier, 1, MAX_COUNT, 1)
end

-- effectPerLevel * owned level of an upgrade track (0 when the track does not exist).
local function upgradeEffect(data: PlayerData, upgradeId: string): number
	local def = Config.Upgrades.byId[upgradeId]
	if def == nil then
		return 0
	end
	return def.effectPerLevel * Formulas.upgradeLevel(data, upgradeId)
end

local function petSlotsOf(data: PlayerData, session: SessionState): number
	local passSlots = if Formulas.hasPass(session, "extraPets") then Game.extraPetsPassSlots else 0
	return math.max(0, math.floor(Game.basePetSlots + upgradeEffect(data, "petSlots") + passSlots + EPSILON))
end

-- Summed power of the strongest `slots` equipped pets (extra equipped pets beyond the limit never count).
local function equippedPower(data: PlayerData, slots: number): number
	local power = 0
	for index, pet in Formulas.equippedPets(data) do
		if index > slots then
			break
		end
		power += Formulas.petPower(pet)
	end
	return power
end

-- The factors of the coin multiplier in display order; their product is Stats.coinMult.
local function coinFactors(data: PlayerData, session: SessionState): { BreakdownEntry }
	local friends = clampInteger(session.friendCount, 0, Game.friendBoostMaxFriends, 0)
	return {
		{ label = "Pets", mult = 1 + equippedPower(data, petSlotsOf(data, session)) },
		{ label = "Fortune Upgrade", mult = 1 + upgradeEffect(data, "fortune") },
		{ label = "Rebirths", mult = 1 + Game.rebirthCoinBonus * rebirthsOf(data) },
		{ label = "2x Coins Pass", mult = if Formulas.hasPass(session, "doubleCoins") then Game.doubleCoinsMult else 1 },
		{ label = "Coin Boost", mult = boostMult(data, session, "coins") },
		{ label = "VIP", mult = if Formulas.hasPass(session, "vip") then 1 + Game.vipCoinBonus else 1 },
		{ label = "Premium", mult = if session.premium == true then 1 + Game.premiumCoinBonus else 1 },
		{ label = "Friends Online", mult = 1 + Game.friendBoostPerFriend * friends },
		{ label = "Group Member", mult = if session.inGroup == true then 1 + Game.groupCoinBonus else 1 },
	}
end

-- Coin multiplier split into its factors for the Stats window, always the same nine rows in the same order
-- (a factor that does not apply has mult 1). The product of all `mult` values equals computeStats().coinMult.
function Formulas.statBreakdown(data: PlayerData, session: SessionState): { BreakdownEntry }
	return coinFactors(data, session)
end

-- Everything derived from the saved data plus the session (passes, boosts, social bonuses). Does not read
-- session.stats. The equipped hammer falls back to the starter hammer when it is unknown.
function Formulas.computeStats(data: PlayerData, session: SessionState): Stats
	local hammer: HammerDef? = Config.Hammers.byId[data.hammers.equipped]
	if hammer == nil then
		hammer = Config.Hammers.byId[Config.Hammers.starterId]
	end
	local hammerDamage = if hammer ~= nil then clampNumber(hammer.damage, 0, MAX_CURRENCY, 0) else 0
	local rebirths = rebirthsOf(data)
	local hasPass = Formulas.hasPass
	local vip = hasPass(session, "vip")

	local petSlots = petSlotsOf(data, session)
	local coinMult = 1
	for _, factor in coinFactors(data, session) do
		coinMult *= factor.mult
	end

	local damageMult = (1 + upgradeEffect(data, "power"))
		* (1 + Game.rebirthDamageBonus * rebirths)
		* (if hasPass(session, "doubleDamage") then Game.doubleDamageMult else 1)
		* boostMult(data, session, "damage")

	local xpMult = (1 + upgradeEffect(data, "wisdom"))
		* (1 + Game.rebirthXPBonus * rebirths)
		* (if hasPass(session, "doubleXP") then Game.doubleXPMult else 1)
		* boostMult(data, session, "xp")
		* (if vip then 1 + Game.vipXPBonus else 1)

	-- session.serverLuck is reserved (always 1 today); it can only ever raise luck.
	local luckMult = (1 + upgradeEffect(data, "luck"))
		* (if hasPass(session, "luckyEggs") then Game.luckyEggsMult else 1)
		* boostMult(data, session, "luck")
		* clampNumber(session.serverLuck, 1, MAX_COUNT, 1)

	local swingCooldown =
		math.max(Game.minSwingCooldown, Game.baseSwingCooldown * (1 - upgradeEffect(data, "swift")))
	local storagePass = if hasPass(session, "petStorage") then Game.petStoragePassBonus else 0

	return {
		damage = hammerDamage * damageMult,
		coinMult = coinMult,
		xpMult = xpMult,
		damageMult = damageMult,
		luckMult = luckMult,
		swingCooldown = swingCooldown,
		range = Game.baseRange + upgradeEffect(data, "reach"),
		critChance = math.clamp(Game.baseCritChance + upgradeEffect(data, "critChance"), 0, 1),
		critMult = Game.baseCritMult + upgradeEffect(data, "critPower"),
		walkSpeed = Game.baseWalkSpeed
			+ upgradeEffect(data, "sprint")
			+ (if hasPass(session, "speed") then Game.speedPassBonus else 0),
		gemChanceBonus = upgradeEffect(data, "gemFinder"),
		petSlots = petSlots,
		petStorage = math.max(
			0,
			math.floor(Game.basePetStorage + upgradeEffect(data, "petStorage") + storagePass + EPSILON)
		),
		maxHatch = if hasPass(session, "tripleHatch") then Game.tripleHatchCount else 1,
		petPower = equippedPower(data, petSlots),
	}
end

---------------------------------------------------------------------------------------------------
-- Time

-- UTC day number of a unix timestamp: floor(t / 86400).
function Formulas.dayNumber(unixTime: number): number
	return math.floor(clampNumber(unixTime, 0, MAX_COUNT, 0) / 86400)
end

return Formulas
