--!strict
--[[
	DataSchema — the shape of saved player data: defaults for a new player, `reconcile` (turns ANYTHING a
	DataStore may hand back into valid PlayerData without throwing and without dropping valid progress), the
	default session state and the replicated view. Pure: no services, no Instances.

	What "valid" means (reconcile guarantees it, and reconciling valid data returns an equal copy):
	- every field of Types.PlayerData exists with the right type; unknown top-level fields are dropped;
	- numbers are finite and inside their range (currencies 0..Formulas.MAX_CURRENCY, level 1..levelCap, ...);
	- dictionaries have string keys only, arrays are dense: the result can always be saved to a DataStore;
	- hammers / pets / upgrades / boosts / quests / achievements / passes that are not in Config are dropped;
	- the starter hammer is owned, the equipped hammer is owned, the hub zone is unlocked and unlocked zones
	  form a prefix of the zone order (a zone behind a locked one is locked again);
	- pet uids are "p<n>" with n < pets.nextId, every owned pet kind is in petIndex, and no more pets are
	  equipped than any player could ever equip (DataService applies the real limit with enforcePetLimits).
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))
local Config = require(Shared:WaitForChild("Config"))
local Formulas = require(Shared:WaitForChild("Logic"):WaitForChild("Formulas"))
local PetLogic = require(Shared:WaitForChild("Logic"):WaitForChild("PetLogic"))
local TableUtil = require(Shared:WaitForChild("Util"):WaitForChild("TableUtil"))

type PlayerData = Types.PlayerData
type PlayerSettings = Types.PlayerSettings
type PetInstance = Types.PetInstance
type QuestState = Types.QuestState
type SessionState = Types.SessionState
type ReplicatedState = Types.ReplicatedState

local Game = Config.Game
local clampNumber = TableUtil.clampNumber
local clampInteger = TableUtil.clampInteger

local MAX_CURRENCY = Formulas.MAX_CURRENCY
local MAX_COUNT = Formulas.MAX_COUNT

-- Structural limits (not balance): they bound the size of a save whatever was stored before.
local MAX_PETS = 1000 -- far above any reachable pet storage
local MAX_KEY_LENGTH = 64 -- longest free-form dictionary key kept (stat names, codes, product keys)
local MAX_PURCHASE_ID_LENGTH = 128
local MAX_FREE_KEYS = 500 -- most free-form keys kept per dictionary
local MAX_BOOST_SECONDS = 10 * 365 * 86400

-- Lifetime counters every player has from the start (services may add more keys through Currency.addStat).
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
}

local DEFAULT_SETTINGS: PlayerSettings = {
	music = 0.5,
	sfx = 0.8,
	showOtherPets = true,
	lowDetail = false,
	autoSmash = true, -- only has an effect for owners of the Auto Smash pass
	damageNumbers = true,
}

local DataSchema = {}

DataSchema.VERSION = Game.dataVersion
DataSchema.STAT_KEYS = STAT_KEYS

---------------------------------------------------------------------------------------------------
-- Defaults

-- Data of a brand-new player: starter hammer owned and equipped, hub zone unlocked, tutorial at step 1.
-- `now` is os.time(); joins starts at 0 (DataService counts the session that is starting).
function DataSchema.default(now: number): PlayerData
	local time = clampInteger(now, 0, MAX_COUNT, 0)
	local stats: { [string]: number } = {}
	for _, key in STAT_KEYS do
		stats[key] = 0
	end
	return {
		version = DataSchema.VERSION,
		coins = 0,
		gems = 0,
		xp = 0,
		level = 1,
		rebirths = 0,
		stats = stats,
		hammers = { owned = { [Config.Hammers.starterId] = true }, equipped = Config.Hammers.starterId },
		zones = { unlocked = { [Config.Zones.firstId] = true } },
		pets = { list = {}, nextId = 1 },
		petIndex = {},
		upgrades = {},
		boosts = {},
		quests = { day = 0, list = {} },
		achievements = {},
		daily = { lastClaimDay = 0, streak = 0 },
		playtime = { day = 0, seconds = 0, claimed = {} },
		codes = {},
		purchases = { history = {}, oneTime = {} },
		grantedPasses = {},
		settings = table.clone(DEFAULT_SETTINGS),
		tutorial = { step = 1, done = false },
		groupRewardClaimed = false,
		firstJoin = time,
		lastJoin = time,
		joins = 0,
	}
end

---------------------------------------------------------------------------------------------------
-- Reconcile helpers (everything read from `raw` goes through these; raw values are never trusted)

-- raw[key] when raw is a table, else nil. rawget: saved data has no metatables, hostile test input might.
local function field(raw: any, key: any): any
	if type(raw) ~= "table" then
		return nil
	end
	return rawget(raw, key)
end

-- A string that is safe as a DataStore key or value: non-empty, bounded, valid UTF-8.
local function isSafeString(value: any, maxLength: number): boolean
	return type(value) == "string" and #value >= 1 and #value <= maxLength and utf8.len(value) ~= nil
end

-- Keys of `raw` that are strings, in sorted order (iteration order of a hash table is not deterministic).
local function sortedStringKeys(raw: any): { string }
	local keys: { string } = {}
	if type(raw) == "table" then
		for key in next, raw do
			if type(key) == "string" then
				table.insert(keys, key)
			end
		end
		table.sort(keys)
	end
	return keys
end

-- { [key] = true } for every key of `raw` whose value is exactly true and that `accept` allows.
local function flags(raw: any, accept: (key: string) -> boolean): { [string]: boolean }
	local result: { [string]: boolean } = {}
	local kept = 0
	for _, key in sortedStringKeys(raw) do
		if kept >= MAX_FREE_KEYS then
			break
		end
		if rawget(raw, key) == true and accept(key) then
			result[key] = true
			kept += 1
		end
	end
	return result
end

local function isFreeKey(key: string): boolean
	return isSafeString(key, MAX_KEY_LENGTH)
end

local function boolean(value: any, default: boolean): boolean
	if type(value) == "boolean" then
		return value
	end
	return default
end

local function reconcileStats(raw: any): { [string]: number }
	local stats: { [string]: number } = {}
	for _, key in STAT_KEYS do
		stats[key] = clampNumber(field(raw, key), 0, MAX_CURRENCY, 0)
	end
	local kept = 0
	for _, key in sortedStringKeys(raw) do
		if stats[key] == nil and kept < MAX_FREE_KEYS and isFreeKey(key) then
			local value = rawget(raw, key)
			if type(value) == "number" and value == value and math.abs(value) ~= math.huge then
				stats[key] = math.clamp(value, 0, MAX_CURRENCY)
				kept += 1
			end
		end
	end
	return stats
end

local function reconcileHammers(raw: any): { owned: { [string]: boolean }, equipped: string }
	local owned = flags(field(raw, "owned"), function(key: string): boolean
		return Config.Hammers.byId[key] ~= nil
	end)
	owned[Config.Hammers.starterId] = true

	local equipped = field(raw, "equipped")
	if type(equipped) ~= "string" or owned[equipped] ~= true then
		-- Not owned (or unknown): fall back to the best hammer the player does own.
		equipped = Config.Hammers.starterId
		local bestOrder = -math.huge
		for _, hammer in Config.Hammers.list do
			if owned[hammer.id] == true and hammer.order > bestOrder then
				equipped = hammer.id
				bestOrder = hammer.order
			end
		end
	end
	return { owned = owned, equipped = equipped }
end

-- Unlocked zones must be a prefix of the zone order: stop at the first zone that is not marked.
local function reconcileZones(raw: any): { unlocked: { [string]: boolean } }
	local rawUnlocked = field(raw, "unlocked")
	local unlocked: { [string]: boolean } = { [Config.Zones.firstId] = true }
	local zones = table.clone(Config.Zones.list)
	table.sort(zones, function(a, b)
		return a.order < b.order
	end)
	for _, zone in zones do
		if zone.id ~= Config.Zones.firstId then
			if field(rawUnlocked, zone.id) ~= true then
				break
			end
			unlocked[zone.id] = true
		end
	end
	return { unlocked = unlocked }
end

type PendingPet = { sortKey: string, pet: PetInstance }

local function reconcilePets(raw: any, now: number): { list: { [string]: PetInstance }, nextId: number }
	local kept: { PetInstance } = {} -- pets whose key already is a well-formed uid
	local pending: { PendingPet } = {} -- pets stored under any other key: they get a fresh uid below
	local highest = 0

	local rawList = field(raw, "list")
	if type(rawList) == "table" then
		for key, value in next, rawList do
			local petId = field(value, "petId")
			if type(petId) == "string" and Config.Pets.byId[petId] ~= nil then
				local pet: PetInstance = {
					id = "",
					petId = petId,
					tier = clampInteger(field(value, "tier"), 1, Config.Pets.maxTier, 1),
					equipped = field(value, "equipped") == true,
					locked = field(value, "locked") == true,
					obtainedAt = clampInteger(field(value, "obtainedAt"), 0, MAX_COUNT, now),
				}
				local number = PetLogic.uidNumber(key)
				if number ~= nil then
					pet.id = key
					highest = math.max(highest, number)
					table.insert(kept, pet)
				else
					local sortKey = string.format("%s|%s|%d|%d", tostring(key), petId, pet.tier, pet.obtainedAt)
					table.insert(pending, { sortKey = sortKey, pet = pet })
				end
			end
		end
	end

	local nextId = math.max(clampInteger(field(raw, "nextId"), 1, MAX_COUNT, 1), highest + 1)
	table.sort(pending, function(a: PendingPet, b: PendingPet): boolean
		return a.sortKey < b.sortKey
	end)
	for _, entry in pending do
		entry.pet.id = PetLogic.uid(nextId)
		nextId += 1
		table.insert(kept, entry.pet)
	end

	-- Bound the inventory: keep the strongest pets (a real inventory is nowhere near this size).
	table.sort(kept, Formulas.comparePets)
	local list: { [string]: PetInstance } = {}
	for index, pet in kept do
		if index > MAX_PETS then
			break
		end
		list[pet.id] = pet
	end
	return { list = list, nextId = nextId }
end

local function reconcileUpgrades(raw: any): { [string]: number }
	local upgrades: { [string]: number } = {}
	for _, def in Config.Upgrades.list do
		local value = field(raw, def.id)
		if value ~= nil then
			upgrades[def.id] = clampInteger(value, 0, def.maxLevel, 0)
		end
	end
	return upgrades
end

-- Remaining seconds per boost; expired or broken entries are simply absent.
local function reconcileBoosts(raw: any): { [string]: number }
	local boosts: { [string]: number } = {}
	for _, def in Config.Boosts.list do
		local seconds = clampNumber(field(raw, def.id), 0, MAX_BOOST_SECONDS, 0)
		if seconds > 0 then
			boosts[def.id] = seconds
		end
	end
	return boosts
end

local function reconcileQuests(raw: any): { day: number, list: { QuestState } }
	local list: { QuestState } = {}
	local seen: { [string]: boolean } = {}
	local rawList = field(raw, "list")
	if type(rawList) == "table" then
		for index = 1, math.min(rawlen(rawList), 50) do
			local entry = rawget(rawList, index)
			local id = field(entry, "id")
			local def = if type(id) == "string" then Config.Quests.byId[id] else nil
			if def ~= nil and not seen[id] and #list < Game.questsPerDay then
				seen[id] = true
				local goal = clampNumber(field(entry, "goal"), 1, MAX_CURRENCY, math.max(1, def.goal))
				table.insert(list, {
					id = id,
					goal = goal,
					progress = clampNumber(field(entry, "progress"), 0, goal, 0),
					claimed = field(entry, "claimed") == true,
				})
			end
		end
	end
	return { day = clampInteger(field(raw, "day"), 0, MAX_COUNT, 0), list = list }
end

local function reconcileAchievements(raw: any): { [string]: number }
	local achievements: { [string]: number } = {}
	for _, def in Config.Achievements.list do
		local value = field(raw, def.id)
		if value ~= nil then
			achievements[def.id] = clampInteger(value, 0, #def.tiers, 0)
		end
	end
	return achievements
end

local function reconcilePlaytime(raw: any): { day: number, seconds: number, claimed: { [string]: boolean } }
	local rawClaimed = field(raw, "claimed")
	local claimed: { [string]: boolean } = {}
	for index = 1, #Config.PlaytimeRewards do
		local key = tostring(index)
		if field(rawClaimed, key) == true then
			claimed[key] = true
		end
	end
	return {
		day = clampInteger(field(raw, "day"), 0, MAX_COUNT, 0),
		seconds = clampNumber(field(raw, "seconds"), 0, MAX_COUNT, 0),
		claimed = claimed,
	}
end

local function reconcilePurchases(raw: any): { history: { string }, oneTime: { [string]: boolean } }
	local ids: { string } = {}
	local rawHistory = field(raw, "history")
	if type(rawHistory) == "table" then
		for index = 1, rawlen(rawHistory) do
			local id = rawget(rawHistory, index)
			if isSafeString(id, MAX_PURCHASE_ID_LENGTH) then
				table.insert(ids, id :: string)
			end
		end
	end
	-- Keep the most recent ids (the array is appended to, so they are at the end).
	local limit = Game.purchaseHistoryLimit
	local history: { string } = table.move(ids, math.max(1, #ids - limit + 1), #ids, 1, {})
	return { history = history, oneTime = flags(field(raw, "oneTime"), isFreeKey) }
end

local function reconcileSettings(raw: any): PlayerSettings
	return {
		music = clampNumber(field(raw, "music"), 0, 1, DEFAULT_SETTINGS.music),
		sfx = clampNumber(field(raw, "sfx"), 0, 1, DEFAULT_SETTINGS.sfx),
		showOtherPets = boolean(field(raw, "showOtherPets"), DEFAULT_SETTINGS.showOtherPets),
		lowDetail = boolean(field(raw, "lowDetail"), DEFAULT_SETTINGS.lowDetail),
		autoSmash = boolean(field(raw, "autoSmash"), DEFAULT_SETTINGS.autoSmash),
		damageNumbers = boolean(field(raw, "damageNumbers"), DEFAULT_SETTINGS.damageNumbers),
	}
end

-- step is the 1-based index into Config.Tutorial.list; a step past the last one means the tutorial is done.
local function reconcileTutorial(raw: any): { step: number, done: boolean }
	local stepCount = #Config.Tutorial.list
	local step = clampInteger(field(raw, "step"), 1, stepCount + 1, 1)
	return { step = step, done = field(raw, "done") == true or step > stepCount }
end

-- Most pets any player could have equipped: every slot upgrade plus the Extra Pets pass.
local function maxPetSlots(): number
	local slots = Game.basePetSlots + Game.extraPetsPassSlots
	local upgrade = Config.Upgrades.byId["petSlots"]
	if upgrade ~= nil then
		slots += upgrade.effectPerLevel * upgrade.maxLevel
	end
	return math.max(0, math.floor(slots))
end

---------------------------------------------------------------------------------------------------
-- Public API

-- Unequips the weakest equipped pets until at most `petSlots` are equipped (Stats.petSlots). Call it after
-- loading and whenever the slot count can shrink. Returns the uids that were unequipped (usually empty).
function DataSchema.enforcePetLimits(data: PlayerData, petSlots: number): { string }
	local slots = clampInteger(petSlots, 0, MAX_COUNT, 0)
	local equipped: { PetInstance } = {}
	for _, pet in data.pets.list do
		if pet.equipped == true then
			table.insert(equipped, pet)
		end
	end
	table.sort(equipped, Formulas.comparePets)
	local unequipped: { string } = {}
	for index, pet in equipped do
		if index > slots then
			pet.equipped = false
			table.insert(unequipped, pet.id)
		end
	end
	return unequipped
end

-- Valid PlayerData from whatever was stored (nil, wrong types, partial, NaN, unknown ids ...). Never throws,
-- never returns a reference into `raw`. `now` is os.time(), used where a timestamp is missing.
function DataSchema.reconcile(raw: any, now: number): PlayerData
	local time = clampInteger(now, 0, MAX_COUNT, 0)
	local data = DataSchema.default(time)
	if type(raw) ~= "table" then
		return data
	end

	data.coins = clampNumber(field(raw, "coins"), 0, MAX_CURRENCY, 0)
	data.gems = clampNumber(field(raw, "gems"), 0, MAX_CURRENCY, 0)
	data.xp = clampNumber(field(raw, "xp"), 0, MAX_CURRENCY, 0)
	data.level = clampInteger(field(raw, "level"), 1, Game.levelCap, 1)
	data.rebirths = clampInteger(field(raw, "rebirths"), 0, Formulas.MAX_REBIRTHS, 0)
	data.stats = reconcileStats(field(raw, "stats"))
	data.hammers = reconcileHammers(field(raw, "hammers"))
	data.zones = reconcileZones(field(raw, "zones"))
	data.pets = reconcilePets(field(raw, "pets"), time)
	data.upgrades = reconcileUpgrades(field(raw, "upgrades"))
	data.boosts = reconcileBoosts(field(raw, "boosts"))
	data.quests = reconcileQuests(field(raw, "quests"))
	data.achievements = reconcileAchievements(field(raw, "achievements"))
	data.daily = {
		lastClaimDay = clampInteger(field(field(raw, "daily"), "lastClaimDay"), 0, MAX_COUNT, 0),
		streak = clampInteger(field(field(raw, "daily"), "streak"), 0, MAX_COUNT, 0),
	}
	data.playtime = reconcilePlaytime(field(raw, "playtime"))
	-- Redeemed codes are kept even when the code left Config, so re-adding it cannot be redeemed twice.
	data.codes = flags(field(raw, "codes"), isFreeKey)
	data.purchases = reconcilePurchases(field(raw, "purchases"))
	data.grantedPasses = flags(field(raw, "grantedPasses"), function(key: string): boolean
		return Config.Monetization.Passes.byId[key] ~= nil
	end)
	data.settings = reconcileSettings(field(raw, "settings"))
	data.tutorial = reconcileTutorial(field(raw, "tutorial"))
	data.groupRewardClaimed = field(raw, "groupRewardClaimed") == true
	data.firstJoin = clampInteger(field(raw, "firstJoin"), 0, MAX_COUNT, time)
	data.lastJoin = clampInteger(field(raw, "lastJoin"), 0, MAX_COUNT, time)
	data.joins = clampInteger(field(raw, "joins"), 0, MAX_COUNT, 0)

	-- The pet index: what was recorded, plus every pet kind that is actually owned.
	data.petIndex = flags(field(raw, "petIndex"), function(key: string): boolean
		return Config.Pets.byId[key] ~= nil
	end)
	for _, pet in data.pets.list do
		data.petIndex[pet.petId] = true
	end
	data.stats.petsDiscovered = math.max(data.stats.petsDiscovered, TableUtil.count(data.petIndex))

	DataSchema.enforcePetLimits(data, maxPetSlots())
	return data
end

-- Session state of a player who owns nothing extra, with stats computed for default data. Paid random items
-- start as restricted (fail closed) until MonetizationService has asked PolicyService and writes the answer.
function DataSchema.defaultSession(): SessionState
	local session: SessionState = {
		passes = {},
		boostEnds = {},
		stats = nil :: any, -- filled in right below; computeStats does not read it
		friendCount = 0,
		premium = false,
		inGroup = false,
		randomItemsRestricted = true,
		serverLuck = 1,
	}
	session.stats = Formulas.computeStats(DataSchema.default(0), session)
	return session
end

-- The table sent with StateInit: the saved data plus `session`. It is a shallow view (nested tables are the
-- live ones), meant to be passed straight to a remote; do not keep or mutate it.
function DataSchema.toReplicated(data: PlayerData, session: SessionState): ReplicatedState
	local state: any = table.clone(data)
	state.session = session
	return state
end

return DataSchema
