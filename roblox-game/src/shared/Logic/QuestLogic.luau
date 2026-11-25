--!strict
--[[
	QuestLogic — pure rules for the retention features: UTC day numbers, daily quest assignment and progress,
	the daily login streak, playtime gifts and achievement progress. The services own the saved state and the
	rewards; this module only answers "what should happen", so the same answers drive the server and the UI.

	Quest assignment is deterministic per (day, userId): the same player gets the same quests on every server.
	Goals are fixed when the quests are assigned ("coins" goals are scaled by Formulas.coinScale at that moment)
	and stored in the QuestState, so later zone unlocks do not move a quest that is in progress.
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
type QuestState = Types.QuestState
type QuestDef = Types.QuestDef
type AchievementDef = Types.AchievementDef

export type DailyStatus = {
	canClaim: boolean, -- a claim is possible on this UTC day
	streak: number, -- the streak that is alive right now (0 when a day was missed)
	streakIfClaimed: number, -- the streak after the next claim (today when canClaim, otherwise tomorrow)
	rewardIndex: number, -- index into Config.DailyRewards of that next claim
}

export type PlaytimeStatus = {
	reached: boolean, -- enough seconds played today
	claimed: boolean,
	canClaim: boolean, -- reached and not claimed
	remaining: number, -- whole seconds still to play (0 when reached or when the index does not exist)
}

export type AchievementProgress = {
	value: number, -- current value of the tracked stat
	claimedTiers: number,
	totalTiers: number,
	nextGoal: number?, -- goal of the next unclaimed tier; nil when every tier is claimed
	canClaim: boolean,
}

local Game = Config.Game
local clampNumber = TableUtil.clampNumber
local clampInteger = TableUtil.clampInteger

local SECONDS_PER_DAY = 86400
local SEED_MODULUS = 2147483647

local QuestLogic = {}

---------------------------------------------------------------------------------------------------
-- Days

-- UTC day number of a unix timestamp (same as Formulas.dayNumber).
function QuestLogic.dayNumber(unixTime: number): number
	return Formulas.dayNumber(unixTime)
end

-- Whole seconds until the next UTC day starts (1..86400): when quests, playtime gifts and the daily reward reset.
function QuestLogic.secondsUntilNextDay(unixTime: number): number
	local time = clampNumber(unixTime, 0, Formulas.MAX_COUNT, 0)
	return math.max(1, math.ceil((Formulas.dayNumber(time) + 1) * SECONDS_PER_DAY - time))
end

---------------------------------------------------------------------------------------------------
-- Daily quests

local function weightOf(def: QuestDef): number
	return def.weight
end

-- Quests that cannot be completed are never assigned: "upgrade" quests once every upgrade track is maxed.
local function isAvailable(def: QuestDef, data: PlayerData): boolean
	if def.kind == "upgrade" then
		for _, upgrade in Config.Upgrades.list do
			if Formulas.upgradeLevel(data, upgrade.id) < upgrade.maxLevel then
				return true
			end
		end
		return false
	end
	return true
end

local function goalFor(def: QuestDef, data: PlayerData): number
	local goal = def.goal
	if def.goalScaled then
		goal *= Formulas.coinScale(data)
	end
	return clampNumber(math.ceil(goal), 1, Formulas.MAX_CURRENCY, 1)
end

-- The quests of `userId` for UTC day `day`: Config.Game.questsPerDay distinct quests picked by weight, of
-- different kinds while enough kinds are available. Pure: returns fresh QuestStates and does not touch `data`
-- (the caller stores them with data.quests.day = day).
function QuestLogic.assign(day: number, userId: number, data: PlayerData): { QuestState }
	local daySeed = clampInteger(day, 0, Formulas.MAX_COUNT, 0) % SEED_MODULUS
	local userSeed = math.abs(clampInteger(userId, -Formulas.MAX_COUNT, Formulas.MAX_COUNT, 0)) % SEED_MODULUS
	local rng = Random.new((daySeed * 48271 + userSeed * 69621 + 12345) % SEED_MODULUS)

	local pool: { QuestDef } = {}
	for _, def in Config.Quests.list do
		if isAvailable(def, data) then
			table.insert(pool, def)
		end
	end

	local list: { QuestState } = {}
	local usedKinds: { [string]: boolean } = {}
	while #list < Game.questsPerDay and #pool > 0 do
		local candidates: { QuestDef } = {}
		for _, def in pool do
			if not usedKinds[def.kind] then
				table.insert(candidates, def)
			end
		end
		if #candidates == 0 then
			candidates = pool -- fewer kinds than slots: allow a second quest of a kind
		end
		local def = WeightedRandom.pick(candidates, weightOf, rng) or candidates[1]
		usedKinds[def.kind] = true
		local index = table.find(pool, def)
		if index ~= nil then
			table.remove(pool, index)
		end
		table.insert(list, { id = def.id, progress = 0, goal = goalFor(def, data), claimed = false })
	end
	return list
end

-- True when the stored quests belong to another day (or there are none): time to assign new ones.
function QuestLogic.needsReset(data: PlayerData, day: number): boolean
	return data.quests.day ~= day or #data.quests.list == 0
end

-- Adds `amount` to every unclaimed, unfinished quest of that kind (progress never exceeds the goal).
-- Returns the indices in data.quests.list that changed, so the caller can replicate exactly those.
function QuestLogic.addProgress(data: PlayerData, kind: string, amount: number): { number }
	local changed: { number } = {}
	local delta = clampNumber(amount, 0, Formulas.MAX_CURRENCY, 0)
	if delta <= 0 then
		return changed
	end
	for index, state in data.quests.list do
		local def = Config.Quests.byId[state.id]
		if def ~= nil and def.kind == kind and not state.claimed and state.progress < state.goal then
			state.progress = math.min(state.goal, state.progress + delta)
			table.insert(changed, index)
		end
	end
	return changed
end

-- A quest can be claimed once its goal is reached, exactly once.
function QuestLogic.canClaim(state: QuestState): boolean
	return state.claimed ~= true and state.progress >= state.goal
end

-- The quest sentence with its goal filled in: "Smash 100 crystals", "Earn 32K coins", "Play for 10m 00s".
function QuestLogic.questText(state: QuestState): string
	local def = Config.Quests.byId[state.id]
	if def == nil then
		return "Daily quest"
	end
	local goal = if def.kind == "playtime"
		then NumberFormat.duration(state.goal)
		else NumberFormat.abbreviate(state.goal)
	return (string.gsub(def.text, "%%s", function()
		return goal
	end))
end

---------------------------------------------------------------------------------------------------
-- Daily login reward

-- State of the 7-day streak on UTC day `day`. One claim per day; claiming on the day after the last claim
-- continues the streak, any gap restarts it at 1. reward = Config.DailyRewards[status.rewardIndex].
function QuestLogic.dailyStatus(data: PlayerData, day: number): DailyStatus
	local lastDay = clampInteger(data.daily.lastClaimDay, 0, Formulas.MAX_COUNT, 0)
	local stored = clampInteger(data.daily.streak, 0, Formulas.MAX_COUNT, 0)
	local cycle = math.max(1, #Config.DailyRewards)

	-- A last claim "today" blocks. So does "tomorrow": two servers can disagree about the date for a moment
	-- around midnight and that must not allow a second claim. Anything further ahead is broken data and is
	-- treated like a gap. A stored streak of 0 means the player has never claimed.
	local claimedToday = stored > 0 and (lastDay == day or lastDay == day + 1)
	local alive = claimedToday or lastDay == day - 1
	local streak = if alive then stored else 0
	local streakIfClaimed = streak + 1
	return {
		canClaim = not claimedToday,
		streak = streak,
		streakIfClaimed = streakIfClaimed,
		rewardIndex = (streakIfClaimed - 1) % cycle + 1,
	}
end

---------------------------------------------------------------------------------------------------
-- Playtime gifts

-- State of gift number `index` (Config.PlaytimeRewards[index]) for the seconds played today.
function QuestLogic.playtimeStatus(data: PlayerData, index: number): PlaytimeStatus
	local def = if type(index) == "number" then Config.PlaytimeRewards[index] else nil
	if def == nil then
		return { reached = false, claimed = false, canClaim = false, remaining = 0 }
	end
	local seconds = clampNumber(data.playtime.seconds, 0, Formulas.MAX_COUNT, 0)
	local reached = seconds >= def.seconds
	local claimed = data.playtime.claimed[tostring(index)] == true
	return {
		reached = reached,
		claimed = claimed,
		canClaim = reached and not claimed,
		remaining = if reached then 0 else math.ceil(def.seconds - seconds),
	}
end

---------------------------------------------------------------------------------------------------
-- Achievements

-- Current value of the stat an achievement tracks ("level" and "rebirths" are top-level fields).
function QuestLogic.achievementValue(data: PlayerData, def: AchievementDef): number
	local value: any
	if def.stat == "level" then
		value = data.level
	elseif def.stat == "rebirths" then
		value = data.rebirths
	else
		value = data.stats[def.stat]
	end
	return clampNumber(value, 0, Formulas.MAX_CURRENCY, 0)
end

-- Progress of one achievement. Tiers are claimed one at a time, in order: canClaim says whether the next
-- unclaimed tier (def.tiers[claimedTiers + 1]) has been reached.
function QuestLogic.achievementProgress(data: PlayerData, def: AchievementDef): AchievementProgress
	local value = QuestLogic.achievementValue(data, def)
	local claimedTiers = clampInteger(data.achievements[def.id], 0, #def.tiers, 0)
	local nextTier = def.tiers[claimedTiers + 1]
	return {
		value = value,
		claimedTiers = claimedTiers,
		totalTiers = #def.tiers,
		nextGoal = if nextTier ~= nil then nextTier.goal else nil,
		canClaim = nextTier ~= nil and value >= nextTier.goal,
	}
end

-- The achievement sentence for one goal: "Smash 5K crystals", "Play for 2h 00m" (playSeconds goals are seconds).
function QuestLogic.achievementText(def: AchievementDef, goal: number): string
	local text = if def.stat == "playSeconds" then NumberFormat.duration(goal) else NumberFormat.abbreviate(goal)
	return (string.gsub(def.text, "%%s", function()
		return text
	end))
end

return QuestLogic
