--!strict
--[[
	PetLogic — pure pet rules shared by PetService, the egg/pets UI and the tests: egg odds and rolling, pet
	instance creation, hatch and fuse checks, team selection, UI ordering and the EquippedPets attribute format.

	LUCK FORMULA (the egg panel shows exactly these numbers and the server rolls with the same table):
	    weight(pet) = egg weight * luckMult   for rarities with Config.Rarities luckAffected (Rare and better)
	    weight(pet) = egg weight              for Common and Uncommon
	    chance(pet) = weight(pet) / sum of all weights
	So luck only moves probability from Common/Uncommon to Rare-and-better pets; luckMult below 1 counts as 1.

	Pet uids are "p" .. n with n taken from data.pets.nextId ("p1", "p2", ...); a uid is never reused.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))
local Config = require(Shared:WaitForChild("Config"))
local Formulas = require(Shared:WaitForChild("Logic"):WaitForChild("Formulas"))
local NumberFormat = require(Shared:WaitForChild("Util"):WaitForChild("NumberFormat"))
local TableUtil = require(Shared:WaitForChild("Util"):WaitForChild("TableUtil"))
local WeightedRandom = require(Shared:WaitForChild("Util"):WaitForChild("WeightedRandom"))

type PlayerData = Types.PlayerData
type Stats = Types.Stats
type EggDef = Types.EggDef
type PetInstance = Types.PetInstance

-- One row of an egg's odds table; `chance` is 0..1 and the rows of a table add up to 1.
export type OddsEntry = { petId: string, chance: number, rarity: Types.Rarity }

local Game = Config.Game
local clampNumber = TableUtil.clampNumber
local clampInteger = TableUtil.clampInteger

local UID_PREFIX = "p"
local MAX_LUCK = 1e6 -- sanity bound so odds stay finite
local MAX_PARSED_PETS = 32 -- parseEquipped never returns more entries than this

local PetLogic = {}

---------------------------------------------------------------------------------------------------
-- Uids

-- The uid for counter value n: "p" .. n.
function PetLogic.uid(n: number): string
	return UID_PREFIX .. string.format("%d", n)
end

-- The counter value inside a well-formed uid ("p12" -> 12), or nil for anything else ("12", "p012", "px").
function PetLogic.uidNumber(uid: any): number?
	if type(uid) ~= "string" then
		return nil
	end
	local digits = string.match(uid, "^" .. UID_PREFIX .. "(%d+)$")
	local n = if digits ~= nil then tonumber(digits) else nil
	if n == nil or n < 1 or n > Formulas.MAX_COUNT or PetLogic.uid(n) ~= uid then
		return nil
	end
	return n
end

---------------------------------------------------------------------------------------------------
-- Eggs

-- The exact hatch chances of `egg` for a player with `luckMult` (Stats.luckMult), in egg order. Pets that no
-- longer exist in Config are left out; the chances always add up to 1 (empty table for a broken egg).
function PetLogic.odds(egg: EggDef, luckMult: number): { OddsEntry }
	local luck = clampNumber(luckMult, 1, MAX_LUCK, 1)
	local entries: { OddsEntry } = {}
	local total = 0
	for _, entry in egg.pets do
		local def = Config.Pets.byId[entry.petId]
		local weight = clampNumber(entry.weight, 0, Formulas.MAX_COUNT, 0)
		if def ~= nil and weight > 0 then
			local rarity = Config.Rarities.byId[def.rarity]
			if rarity ~= nil and rarity.luckAffected then
				weight *= luck
			end
			table.insert(entries, { petId = def.id, chance = weight, rarity = def.rarity })
			total += weight
		end
	end
	for _, entry in entries do
		entry.chance /= total
	end
	return entries
end

local function chanceOf(entry: OddsEntry): number
	return entry.chance
end

-- Rolls one pet from `egg` with the odds() table (one rng:NextNumber() per roll). Returns the petId, or nil
-- only when the egg has no valid pets.
function PetLogic.roll(egg: EggDef, luckMult: number, rng: Random): string?
	local entry = WeightedRandom.pick(PetLogic.odds(egg, luckMult), chanceOf, rng)
	return if entry ~= nil then entry.petId else nil
end

-- Whether `count` eggs can be hatched now; reason text when not. The caller still checks the distance to the
-- egg stand. `stats` is the player's cached Stats (maxHatch, petStorage).
function PetLogic.canHatch(data: PlayerData, stats: Stats, egg: EggDef, count: number): (boolean, string?)
	if type(count) ~= "number" or (count ~= 1 and count ~= Game.tripleHatchCount) then
		return false, "Invalid amount"
	end
	if count > stats.maxHatch then
		return false, "Hatch x" .. tostring(count) .. " needs the Triple Hatch pass"
	end
	local zone = Config.Zones.byId[egg.zoneId]
	if zone ~= nil and zone.id ~= Config.Zones.firstId and data.zones.unlocked[zone.id] ~= true then
		return false, "Unlock " .. zone.name .. " first"
	end
	local missing = egg.cost * count - clampNumber(data.coins, 0, Formulas.MAX_CURRENCY, 0)
	if missing > 0 then
		local amount = math.max(1, math.ceil(missing))
		return false, "Need " .. NumberFormat.abbreviate(amount) .. " more coin" .. (if amount == 1 then "" else "s")
	end
	local total = Formulas.countPets(data)
	if total + count > stats.petStorage then
		return false, "Pet storage full (" .. tostring(total) .. "/" .. tostring(stats.petStorage) .. ")"
	end
	return true, nil
end

---------------------------------------------------------------------------------------------------
-- Instances

-- Creates a pet, stores it in data.pets.list under a fresh uid (advancing data.pets.nextId) and marks it in
-- data.petIndex. Returns the instance and whether this pet kind is new to the player's index.
-- Errors for a petId that is not in Config (validate client input before calling); the tier is clamped.
function PetLogic.newInstance(data: PlayerData, petId: string, tier: number, now: number): (PetInstance, boolean)
	if type(petId) ~= "string" or Config.Pets.byId[petId] == nil then
		error("PetLogic.newInstance: unknown pet id " .. tostring(petId), 2)
	end
	local pets = data.pets
	local nextId = clampInteger(pets.nextId, 1, Formulas.MAX_COUNT, 1)
	while pets.list[PetLogic.uid(nextId)] ~= nil do
		nextId += 1
	end
	local pet: PetInstance = {
		id = PetLogic.uid(nextId),
		petId = petId,
		tier = clampInteger(tier, 1, Config.Pets.maxTier, 1),
		equipped = false,
		locked = false,
		obtainedAt = clampInteger(now, 0, Formulas.MAX_COUNT, 0),
	}
	pets.list[pet.id] = pet
	pets.nextId = nextId + 1
	local isNew = data.petIndex[petId] ~= true
	data.petIndex[petId] = true
	return pet, isNew
end

---------------------------------------------------------------------------------------------------
-- Teams and ordering

-- Uids of the `slots` strongest pets (strongest first; ties go to the older pet). Use it for "Equip Best".
function PetLogic.bestTeam(data: PlayerData, slots: number): { string }
	local limit = clampInteger(slots, 0, Formulas.MAX_COUNT, 0)
	local pets: { PetInstance } = {}
	for _, pet in data.pets.list do
		if Config.Pets.byId[pet.petId] ~= nil then
			table.insert(pets, pet)
		end
	end
	table.sort(pets, Formulas.comparePets)
	local team: { string } = {}
	for index, pet in pets do
		if index > limit then
			break
		end
		table.insert(team, pet.id)
	end
	return team
end

-- Every pet for the inventory grid: equipped first, then by power (strongest first), ties by age.
function PetLogic.sorted(data: PlayerData): { PetInstance }
	local pets: { PetInstance } = {}
	for _, pet in data.pets.list do
		table.insert(pets, pet)
	end
	table.sort(pets, function(a: PetInstance, b: PetInstance): boolean
		local equippedA, equippedB = a.equipped == true, b.equipped == true
		if equippedA ~= equippedB then
			return equippedA
		end
		return Formulas.comparePets(a, b)
	end)
	return pets
end

---------------------------------------------------------------------------------------------------
-- Fusing

-- Uids that a fuse of (petId, tier) may consume, in the order they are consumed: never locked pets,
-- unequipped ones first, older ones first. A fuse takes the first Config.Game.fuseCount of them.
function PetLogic.fuseCandidates(data: PlayerData, petId: string, tier: number): { string }
	local pets: { PetInstance } = {}
	for _, pet in data.pets.list do
		if pet.petId == petId and pet.tier == tier and pet.locked ~= true then
			table.insert(pets, pet)
		end
	end
	table.sort(pets, function(a: PetInstance, b: PetInstance): boolean
		local equippedA, equippedB = a.equipped == true, b.equipped == true
		if equippedA ~= equippedB then
			return equippedB
		end
		-- Same kind and tier means the same power, so this is the uid order.
		return Formulas.comparePets(a, b)
	end)
	local uids: { string } = {}
	for _, pet in pets do
		table.insert(uids, pet.id)
	end
	return uids
end

-- Whether fuseCount pets of (petId, tier) can be fused into one of tier + 1; reason text when not.
function PetLogic.canFuse(data: PlayerData, petId: string, tier: number): (boolean, string?)
	local def = if type(petId) == "string" then Config.Pets.byId[petId] else nil
	if def == nil or type(tier) ~= "number" or Config.Pets.tiers[tier] == nil then
		return false, "Unknown pet"
	end
	if tier >= Config.Pets.maxTier then
		return false, "Already the highest tier"
	end
	local missing = Game.fuseCount - #PetLogic.fuseCandidates(data, petId, tier)
	if missing > 0 then
		return false, "Need " .. tostring(missing) .. " more unlocked " .. def.name
	end
	return true, nil
end

-- The exact uids one fuse of (petId, tier) consumes (Config.Game.fuseCount of them), or nil when canFuse fails.
function PetLogic.fuseSelection(data: PlayerData, petId: string, tier: number): { string }?
	if not PetLogic.canFuse(data, petId, tier) then
		return nil
	end
	local candidates = PetLogic.fuseCandidates(data, petId, tier)
	return table.move(candidates, 1, Game.fuseCount, 1, {})
end

---------------------------------------------------------------------------------------------------
-- EquippedPets attribute ("petId:tier;petId:tier", strongest first; "" when nothing is equipped)

function PetLogic.serializeEquipped(data: PlayerData): string
	local parts: { string } = {}
	for _, pet in Formulas.equippedPets(data) do
		local tier = clampInteger(pet.tier, 1, Config.Pets.maxTier, 1)
		table.insert(parts, pet.petId .. ":" .. string.format("%d", tier))
	end
	return table.concat(parts, ";")
end

-- Parses the attribute of any player. Tolerant: malformed chunks and unknown pets are skipped, tiers clamped.
function PetLogic.parseEquipped(text: any): { Types.PetGrant }
	local result: { Types.PetGrant } = {}
	if type(text) ~= "string" then
		return result
	end
	for chunk in string.gmatch(text, "[^;]+") do
		local petId, tierText = string.match(chunk, "^([%w_]+):(%d+)$")
		if petId ~= nil and tierText ~= nil and Config.Pets.byId[petId] ~= nil then
			local tier = clampInteger(tonumber(tierText), 1, Config.Pets.maxTier, 1)
			table.insert(result, { petId = petId, tier = tier })
			if #result >= MAX_PARSED_PETS then
				break
			end
		end
	end
	return result
end

return PetLogic
