--!strict
--[[
	RewardLogic — turns a Types.Reward bundle into concrete amounts for one player and into the text lines the
	UI shows. Pure: RewardService grants what `resolve` returns, popups and cards print what `describe` returns,
	so the player always receives exactly what was displayed.

	Scaled parts use the player's progress: coinsScaled * Formulas.coinScale(data), xpScaled * Formulas.xpScale(data).
	Amounts are rounded to whole numbers; boosts with unknown ids and pets that are not in Config are left out.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))
local Config = require(Shared:WaitForChild("Config"))
local Formulas = require(Shared:WaitForChild("Logic"):WaitForChild("Formulas"))
local NumberFormat = require(Shared:WaitForChild("Util"):WaitForChild("NumberFormat"))
local TableUtil = require(Shared:WaitForChild("Util"):WaitForChild("TableUtil"))

type PlayerData = Types.PlayerData
type Reward = Types.Reward
type BoostGrant = Types.BoostGrant
type PetGrant = Types.PetGrant

-- A reward with every amount worked out for one player.
export type Resolved = {
	coins: number, -- whole coins, to be granted without multipliers
	gems: number,
	xp: number,
	boosts: { BoostGrant }, -- one entry per boost id (durations of the same id are added up)
	pet: PetGrant?,
}

local clampNumber = TableUtil.clampNumber
local clampInteger = TableUtil.clampInteger

local RewardLogic = {}

local function amount(value: any): number
	return clampNumber(value, 0, Formulas.MAX_CURRENCY, 0)
end

local function whole(value: number): number
	return math.floor(clampNumber(value, 0, Formulas.MAX_CURRENCY, 0) + 0.5)
end

-- "30m", "1h", "1h 30m", "5m 30s", "45s": shorter than NumberFormat.duration, for reward lines.
local function shortDuration(seconds: number): string
	local total = math.floor(seconds)
	local hours, minutes, rest = total // 3600, total // 60 % 60, total % 60
	local parts: { string } = {}
	if hours > 0 then
		table.insert(parts, tostring(hours) .. "h")
	end
	if minutes > 0 then
		table.insert(parts, tostring(minutes) .. "m")
	end
	if rest > 0 or #parts == 0 then
		table.insert(parts, tostring(rest) .. "s")
	end
	return table.concat(parts, " ")
end

local function addBoost(boosts: { BoostGrant }, grant: any)
	if type(grant) ~= "table" or type(grant.id) ~= "string" or Config.Boosts.byId[grant.id] == nil then
		return
	end
	local seconds = math.floor(clampNumber(grant.seconds, 0, Formulas.MAX_COUNT, 0))
	if seconds <= 0 then
		return
	end
	for _, existing in boosts do
		if existing.id == grant.id then
			existing.seconds += seconds
			return
		end
	end
	table.insert(boosts, { id = grant.id, seconds = seconds })
end

-- The concrete amounts of `reward` for the player owning `data`.
function RewardLogic.resolve(reward: Reward, data: PlayerData): Resolved
	local boosts: { BoostGrant } = {}
	addBoost(boosts, reward.boost)
	if type(reward.boosts) == "table" then
		for _, grant in reward.boosts do
			addBoost(boosts, grant)
		end
	end

	local pet: PetGrant? = nil
	local rewardPet = reward.pet
	if type(rewardPet) == "table" and Config.Pets.byId[rewardPet.petId] ~= nil then
		pet = { petId = rewardPet.petId, tier = clampInteger(rewardPet.tier, 1, Config.Pets.maxTier, 1) }
	end

	return {
		coins = whole(amount(reward.coins) + amount(reward.coinsScaled) * Formulas.coinScale(data)),
		gems = whole(amount(reward.gems)),
		xp = whole(amount(reward.xp) + amount(reward.xpScaled) * Formulas.xpScale(data)),
		boosts = boosts,
		pet = pet,
	}
end

-- Short English lines for popups and cards, in a fixed order (coins, gems, XP, boosts, pet):
-- "💰 +12.5K Coins", "💎 +50 Gems", "⭐ +1.2K XP", "⚡ 2x Coins for 30m", "🐾 Golden Meadow Fox".
function RewardLogic.describe(reward: Reward, data: PlayerData): { string }
	local resolved = RewardLogic.resolve(reward, data)
	local lines: { string } = {}
	if resolved.coins > 0 then
		local unit = if resolved.coins == 1 then " Coin" else " Coins"
		table.insert(lines, "💰 +" .. NumberFormat.abbreviate(resolved.coins) .. unit)
	end
	if resolved.gems > 0 then
		local unit = if resolved.gems == 1 then " Gem" else " Gems"
		table.insert(lines, "💎 +" .. NumberFormat.abbreviate(resolved.gems) .. unit)
	end
	if resolved.xp > 0 then
		table.insert(lines, "⭐ +" .. NumberFormat.abbreviate(resolved.xp) .. " XP")
	end
	for _, grant in resolved.boosts do
		local def = Config.Boosts.byId[grant.id]
		table.insert(lines, "⚡ " .. def.name .. " for " .. shortDuration(grant.seconds))
	end
	local pet = resolved.pet
	if pet ~= nil then
		local def = Config.Pets.byId[pet.petId]
		local tierDef = Config.Pets.tiers[pet.tier]
		local prefix = if pet.tier > 1 and tierDef ~= nil then tierDef.name .. " " else ""
		table.insert(lines, "🐾 " .. prefix .. def.name)
	end
	return lines
end

-- True when the reward would grant nothing at all (for any player).
function RewardLogic.isEmpty(reward: Reward): boolean
	if type(reward) ~= "table" then
		return true
	end
	if whole(amount(reward.coins)) > 0 or whole(amount(reward.gems)) > 0 or whole(amount(reward.xp)) > 0 then
		return false
	end
	if amount(reward.coinsScaled) > 0 or amount(reward.xpScaled) > 0 then
		return false
	end
	local boosts: { BoostGrant } = {}
	addBoost(boosts, reward.boost)
	if type(reward.boosts) == "table" then
		for _, grant in reward.boosts do
			addBoost(boosts, grant)
		end
	end
	if #boosts > 0 then
		return false
	end
	local pet = reward.pet
	return not (type(pet) == "table" and Config.Pets.byId[pet.petId] ~= nil)
end

-- A copy of `reward` with coins, coinsScaled, gems, xp and xpScaled multiplied by `factor` (boosts and the pet
-- are kept as they are). For rewards paid by contribution, e.g. the boss: scale(Config.Boss.reward, share).
function RewardLogic.scale(reward: Reward, factor: number): Reward
	local f = clampNumber(factor, 0, Formulas.MAX_COUNT, 0)
	local scaled: Reward = table.clone(reward)
	if reward.coins ~= nil then
		scaled.coins = amount(reward.coins) * f
	end
	if reward.coinsScaled ~= nil then
		scaled.coinsScaled = amount(reward.coinsScaled) * f
	end
	if reward.gems ~= nil then
		scaled.gems = amount(reward.gems) * f
	end
	if reward.xp ~= nil then
		scaled.xp = amount(reward.xp) * f
	end
	if reward.xpScaled ~= nil then
		scaled.xpScaled = amount(reward.xpScaled) * f
	end
	return scaled
end

-- A copy of `reward` with only the gems multiplied (VIP daily rewards: Config.Game.vipDailyGemMult).
function RewardLogic.withGemMultiplier(reward: Reward, multiplier: number): Reward
	local copy: Reward = table.clone(reward)
	if reward.gems ~= nil then
		copy.gems = amount(reward.gems) * clampNumber(multiplier, 0, Formulas.MAX_COUNT, 1)
	end
	return copy
end

return RewardLogic
