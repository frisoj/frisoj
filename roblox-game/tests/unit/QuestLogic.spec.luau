-- Unit tests for Shared/Logic/QuestLogic: day numbers, deterministic quest assignment, quest progress, the daily
-- streak (same day, next day, gaps, clock skew), playtime gifts and achievement progress.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Logic = Shared:WaitForChild("Logic")
local QuestLogic = require(Logic:WaitForChild("QuestLogic"))
local Formulas = require(Logic:WaitForChild("Formulas"))
local DataSchema = require(Logic:WaitForChild("DataSchema"))
local NumberFormat = require(Shared:WaitForChild("Util"):WaitForChild("NumberFormat"))
local TableUtil = require(Shared:WaitForChild("Util"):WaitForChild("TableUtil"))

local G = Config.Game
local NAN = 0 / 0
local INF = math.huge
local TODAY = 20454 -- 2026-01-01
local CYCLE = #Config.DailyRewards

local function newData()
	return DataSchema.default(0)
end

local function ids(list): { string }
	local result = {}
	for index, state in list do
		result[index] = state.id
	end
	return result
end

-- Data whose quests are exactly the given ids (goals taken from Config, unscaled).
local function withQuests(questIds: { string })
	local data = newData()
	data.quests.day = TODAY
	for _, id in questIds do
		table.insert(data.quests.list, { id = id, progress = 0, goal = Config.Quests.byId[id].goal, claimed = false })
	end
	return data
end

-- Claims the daily reward the way DailyRewardService does and returns the reward index that was paid.
local function claimDaily(data, day: number): number?
	local status = QuestLogic.dailyStatus(data, day)
	if not status.canClaim then
		return nil
	end
	data.daily.lastClaimDay = day
	data.daily.streak = status.streakIfClaimed
	return status.rewardIndex
end

return function(t)
	---------------------------------------------------------------------------------------------
	-- Days

	t.test("dayNumber and secondsUntilNextDay", function()
		t.equal(QuestLogic.dayNumber(0), 0)
		t.equal(QuestLogic.dayNumber(86400 * TODAY), TODAY)
		t.equal(QuestLogic.dayNumber(86400 * TODAY + 86399), TODAY)
		t.equal(QuestLogic.dayNumber(86400 * (TODAY + 1)), TODAY + 1)
		for _, time in { 0, 1, 86399, 86400, 1767268800, 1767268800.75 } do
			t.equal(QuestLogic.dayNumber(time), Formulas.dayNumber(time))
		end

		t.equal(QuestLogic.secondsUntilNextDay(0), 86400)
		t.equal(QuestLogic.secondsUntilNextDay(1), 86399)
		t.equal(QuestLogic.secondsUntilNextDay(86399), 1)
		t.equal(QuestLogic.secondsUntilNextDay(86399.5), 1)
		t.equal(QuestLogic.secondsUntilNextDay(86400), 86400)
		t.equal(QuestLogic.secondsUntilNextDay(1767268800), 43200) -- noon
		t.equal(QuestLogic.secondsUntilNextDay(NAN), 86400)
	end)

	---------------------------------------------------------------------------------------------
	-- Assignment

	t.test("assign returns questsPerDay distinct quests of different kinds with fresh state", function()
		local data = newData()
		for day = TODAY, TODAY + 60 do
			for _, userId in { 1, 2, 77, 123456789, 4000000001, -1 } do
				local list = QuestLogic.assign(day, userId, data)
				t.equal(#list, G.questsPerDay)
				local seenIds, seenKinds = {}, {}
				for _, state in list do
					local def = Config.Quests.byId[state.id]
					t.truthy(def, "unknown quest " .. tostring(state.id))
					t.falsy(seenIds[state.id], "duplicate quest " .. state.id)
					t.falsy(seenKinds[def.kind], "duplicate kind " .. def.kind)
					seenIds[state.id] = true
					seenKinds[def.kind] = true
					t.equal(state.progress, 0)
					t.equal(state.claimed, false)
					t.truthy(state.goal >= 1 and state.goal == math.floor(state.goal), "whole goal")
					t.equal(TableUtil.count(state), 4)
				end
			end
		end
	end)

	t.test("assign is deterministic per (day, userId) and does not touch the data", function()
		local data = newData()
		local before = TableUtil.deepCopy(data)
		for _, userId in { 1, 99, 55555 } do
			local first = QuestLogic.assign(TODAY, userId, data)
			local second = QuestLogic.assign(TODAY, userId, data)
			t.equal(first, second)
			t.truthy(first ~= second and first[1] ~= second[1], "fresh tables every call")
			-- Independent of anything else in the data (same zone, same rebirths).
			local other = newData()
			other.coins = 1e9
			other.stats.crystalsSmashed = 500
			t.equal(QuestLogic.assign(TODAY, userId, other), first)
		end
		t.equal(data, before)
	end)

	t.test("assignments vary between days and between players", function()
		local data = newData()
		local function signature(day, userId)
			return table.concat(ids(QuestLogic.assign(day, userId, data)), ",")
		end
		local byDay, byUser = {}, {}
		for offset = 0, 59 do
			byDay[signature(TODAY + offset, 12345)] = true
			byUser[signature(TODAY, 1000 + offset)] = true
		end
		t.truthy(TableUtil.count(byDay) >= 20, "one player gets varied quests over 60 days")
		t.truthy(TableUtil.count(byUser) >= 20, "60 players get varied quests on one day")
		-- Consecutive days are not all identical for anybody.
		for userId = 1, 30 do
			local same = 0
			for offset = 0, 9 do
				if signature(TODAY + offset, userId) == signature(TODAY + offset + 1, userId) then
					same += 1
				end
			end
			t.truthy(same <= 3, "user " .. userId .. " keeps getting the same quests")
		end
	end)

	t.test("every quest can come up and heavier quests come up more often", function()
		local data = newData()
		local counts = {}
		local samples = 3000
		for userId = 1, samples do
			for _, state in QuestLogic.assign(TODAY, userId, data) do
				counts[state.id] = (counts[state.id] or 0) + 1
			end
		end
		for _, def in Config.Quests.list do
			t.truthy((counts[def.id] or 0) > 0, def.id .. " never assigned in " .. samples .. " samples")
		end
		-- Within one kind the choice is purely by weight.
		local byKind = {}
		for _, def in Config.Quests.list do
			byKind[def.kind] = byKind[def.kind] or {}
			table.insert(byKind[def.kind], def)
		end
		for kind, defs in byKind do
			for _, a in defs do
				for _, b in defs do
					if a.weight >= b.weight * 1.5 then
						t.truthy(
							counts[a.id] > counts[b.id],
							string.format(
								"%s: %s (weight %d) should beat %s (weight %d)",
								kind,
								a.id,
								a.weight,
								b.id,
								b.weight
							)
						)
					end
				end
			end
		end
	end)

	t.test("scaled goals are fixed at assignment from the player's coin scale", function()
		local function coinQuestGoals(data)
			local goals = {}
			for userId = 1, 400 do
				for _, state in QuestLogic.assign(TODAY, userId, data) do
					local def = Config.Quests.byId[state.id]
					if def.goalScaled then
						goals[def.id] = state.goal
					else
						t.equal(state.goal, def.goal, def.id .. " is not scaled")
					end
				end
			end
			return goals
		end

		local starter = newData()
		local advanced = newData()
		for _, zone in Config.Zones.list do
			if zone.order <= 4 then
				advanced.zones.unlocked[zone.id] = true
			end
		end
		advanced.rebirths = 2

		local starterGoals, advancedGoals = coinQuestGoals(starter), coinQuestGoals(advanced)
		local checked = 0
		for _, def in Config.Quests.list do
			if def.goalScaled then
				t.equal(starterGoals[def.id], math.ceil(def.goal * Formulas.coinScale(starter)), def.id)
				t.equal(advancedGoals[def.id], math.ceil(def.goal * Formulas.coinScale(advanced)), def.id)
				t.truthy(advancedGoals[def.id] > starterGoals[def.id])
				checked += 1
			end
		end
		t.truthy(checked >= 1, "the pool has scaled quests")
	end)

	t.test("upgrade quests are not assigned once every upgrade is maxed", function()
		local maxed = newData()
		for _, def in Config.Upgrades.list do
			maxed.upgrades[def.id] = def.maxLevel
		end
		local almost = TableUtil.deepCopy(maxed)
		almost.upgrades.power -= 1

		local sawUpgradeQuest = false
		for userId = 1, 500 do
			local list = QuestLogic.assign(TODAY, userId, maxed)
			t.equal(#list, G.questsPerDay)
			for _, state in list do
				t.truthy(Config.Quests.byId[state.id].kind ~= "upgrade", "impossible quest " .. state.id)
			end
			for _, state in QuestLogic.assign(TODAY, userId, almost) do
				sawUpgradeQuest = sawUpgradeQuest or Config.Quests.byId[state.id].kind == "upgrade"
			end
		end
		t.truthy(sawUpgradeQuest, "one missing level keeps upgrade quests in the pool")
	end)

	t.test("assign tolerates odd days and user ids", function()
		local data = newData()
		for _, args in { { NAN, NAN }, { -5, -5 }, { INF, 1 }, { 1e300, 1e300 }, { 0, 0 }, { 1.5, 2.5 }, { "x", {} } } do
			local list = QuestLogic.assign(args[1] :: any, args[2] :: any, data)
			t.equal(#list, G.questsPerDay)
		end
	end)

	t.test("needsReset on a new day or when no quests are stored", function()
		local data = newData()
		t.truthy(QuestLogic.needsReset(data, TODAY))
		data.quests = { day = TODAY, list = QuestLogic.assign(TODAY, 1, data) }
		t.falsy(QuestLogic.needsReset(data, TODAY))
		t.truthy(QuestLogic.needsReset(data, TODAY + 1))
		t.truthy(QuestLogic.needsReset(data, TODAY - 1))
		data.quests.list = {}
		t.truthy(QuestLogic.needsReset(data, TODAY))
	end)

	---------------------------------------------------------------------------------------------
	-- Progress and claiming

	t.test("addProgress only moves unclaimed, unfinished quests of that kind and reports their indices", function()
		local data = withQuests({ "smash_100", "hatch_3", "smash_250" })
		t.equal(QuestLogic.addProgress(data, "smash", 30), { 1, 3 })
		t.equal(
			{ data.quests.list[1].progress, data.quests.list[2].progress, data.quests.list[3].progress },
			{ 30, 0, 30 }
		)
		t.equal(QuestLogic.addProgress(data, "hatch", 1), { 2 })
		t.equal(QuestLogic.addProgress(data, "boss", 1), {})
		t.equal(QuestLogic.addProgress(data, "nonsense", 1), {})

		-- Progress stops exactly at the goal.
		t.equal(QuestLogic.addProgress(data, "smash", 90), { 1, 3 })
		t.equal(data.quests.list[1].progress, 100)
		t.equal(data.quests.list[3].progress, 120)
		-- A finished quest no longer changes (so nothing needs to be replicated for it).
		t.equal(QuestLogic.addProgress(data, "smash", 1000), { 3 })
		t.equal(data.quests.list[1].progress, 100)
		t.equal(data.quests.list[3].progress, 250)
		t.equal(QuestLogic.addProgress(data, "smash", 5), {})

		t.equal(QuestLogic.addProgress(data, "hatch", 1e300), { 2 })
		t.equal(data.quests.list[2].progress, 3)
	end)

	t.test("addProgress ignores claimed quests, broken amounts and unknown quests", function()
		local data = withQuests({ "smash_100", "smash_250" })
		data.quests.list[1].claimed = true
		t.equal(QuestLogic.addProgress(data, "smash", 10), { 2 })
		t.equal(data.quests.list[1].progress, 0)

		for _, amount in { 0, -5, NAN, INF, -INF, "3" :: any, nil :: any } do
			t.equal(QuestLogic.addProgress(data, "smash", amount), {}, tostring(amount))
		end
		t.equal(data.quests.list[2].progress, 10)
		t.equal(QuestLogic.addProgress(data, "smash", 0.5), { 2 })
		t.equal(data.quests.list[2].progress, 10.5)

		table.insert(data.quests.list, { id = "removed_quest", progress = 0, goal = 5, claimed = false })
		t.equal(QuestLogic.addProgress(data, "smash", 1), { 2 })
		t.equal(data.quests.list[3].progress, 0)
		t.equal(QuestLogic.addProgress(newData(), "smash", 1), {})
	end)

	t.test("canClaim needs the goal reached and can only be true once", function()
		t.falsy(QuestLogic.canClaim({ id = "smash_100", progress = 99, goal = 100, claimed = false }))
		t.truthy(QuestLogic.canClaim({ id = "smash_100", progress = 100, goal = 100, claimed = false }))
		t.truthy(QuestLogic.canClaim({ id = "smash_100", progress = 150, goal = 100, claimed = false }))
		t.falsy(QuestLogic.canClaim({ id = "smash_100", progress = 100, goal = 100, claimed = true }))
		t.falsy(QuestLogic.canClaim({ id = "smash_100", progress = 0, goal = 100, claimed = false }))
	end)

	t.test("questText fills the goal into the sentence", function()
		t.equal(
			QuestLogic.questText({ id = "smash_100", progress = 0, goal = 100, claimed = false }),
			"Smash 100 crystals"
		)
		t.equal(
			QuestLogic.questText({ id = "coins_small", progress = 0, goal = 32000, claimed = false }),
			"Earn 32K coins"
		)
		t.equal(
			QuestLogic.questText({ id = "playtime_10", progress = 0, goal = 600, claimed = false }),
			"Play for " .. NumberFormat.duration(600)
		)
		t.equal(QuestLogic.questText({ id = "removed_quest", progress = 0, goal = 5, claimed = false }), "Daily quest")
		for _, def in Config.Quests.list do
			local text = QuestLogic.questText({ id = def.id, progress = 0, goal = def.goal, claimed = false })
			t.falsy(string.find(text, "%s", 1, true), def.id .. " still has a placeholder")
			t.truthy(#text > 5)
		end
	end)

	---------------------------------------------------------------------------------------------
	-- Daily streak

	t.test("daily: a new player can claim day 1", function()
		local data = newData()
		t.equal(
			QuestLogic.dailyStatus(data, TODAY),
			{ canClaim = true, streak = 0, streakIfClaimed = 1, rewardIndex = 1 }
		)
		-- Even on the very first day numbers, where lastClaimDay = 0 could look like "today" or "yesterday".
		t.equal(QuestLogic.dailyStatus(data, 0), { canClaim = true, streak = 0, streakIfClaimed = 1, rewardIndex = 1 })
		t.equal(QuestLogic.dailyStatus(data, 1), { canClaim = true, streak = 0, streakIfClaimed = 1, rewardIndex = 1 })
	end)

	t.test("daily: only one claim per day", function()
		local data = newData()
		t.equal(claimDaily(data, TODAY), 1)
		t.equal(data.daily, { lastClaimDay = TODAY, streak = 1 })
		local status = QuestLogic.dailyStatus(data, TODAY)
		t.equal(status, { canClaim = false, streak = 1, streakIfClaimed = 2, rewardIndex = 2 })
		t.equal(claimDaily(data, TODAY), nil)
		t.equal(claimDaily(data, TODAY), nil)
		t.equal(data.daily, { lastClaimDay = TODAY, streak = 1 })
	end)

	t.test("daily: claiming on consecutive days walks through the cycle and wraps around", function()
		local data = newData()
		for offset = 0, CYCLE * 3 - 1 do
			local day = TODAY + offset
			local status = QuestLogic.dailyStatus(data, day)
			t.equal(status.canClaim, true, "day " .. offset)
			t.equal(status.streak, offset)
			t.equal(status.streakIfClaimed, offset + 1)
			t.equal(status.rewardIndex, offset % CYCLE + 1)
			t.truthy(Config.DailyRewards[status.rewardIndex], "reward exists")
			t.equal(claimDaily(data, day), offset % CYCLE + 1)
			t.equal(claimDaily(data, day), nil)
		end
		t.equal(data.daily.streak, CYCLE * 3)
		-- Day 7 pays the last reward of the cycle, day 8 starts over.
		local probe = newData()
		probe.daily = { lastClaimDay = TODAY - 1, streak = CYCLE - 1 }
		t.equal(QuestLogic.dailyStatus(probe, TODAY).rewardIndex, CYCLE)
		probe.daily = { lastClaimDay = TODAY - 1, streak = CYCLE }
		t.equal(QuestLogic.dailyStatus(probe, TODAY).rewardIndex, 1)
	end)

	t.test("daily: a missed day restarts the streak at 1", function()
		local data = newData()
		data.daily = { lastClaimDay = TODAY - 2, streak = 5 }
		t.equal(
			QuestLogic.dailyStatus(data, TODAY),
			{ canClaim = true, streak = 0, streakIfClaimed = 1, rewardIndex = 1 }
		)
		t.equal(claimDaily(data, TODAY), 1)
		t.equal(data.daily, { lastClaimDay = TODAY, streak = 1 })

		data.daily = { lastClaimDay = TODAY - 400, streak = 300 }
		t.equal(QuestLogic.dailyStatus(data, TODAY).streakIfClaimed, 1)

		-- Exactly yesterday continues it.
		data.daily = { lastClaimDay = TODAY - 1, streak = 5 }
		t.equal(
			QuestLogic.dailyStatus(data, TODAY),
			{ canClaim = true, streak = 5, streakIfClaimed = 6, rewardIndex = 6 }
		)
	end)

	t.test("daily: a server whose clock is slightly behind cannot hand out a second claim", function()
		local data = newData()
		data.daily = { lastClaimDay = TODAY + 1, streak = 3 } -- claimed just after midnight on another server
		local status = QuestLogic.dailyStatus(data, TODAY)
		t.equal(status.canClaim, false)
		t.equal(status.streak, 3)
		-- The streak continues normally afterwards.
		t.equal(QuestLogic.dailyStatus(data, TODAY + 1).canClaim, false)
		t.equal(
			QuestLogic.dailyStatus(data, TODAY + 2),
			{ canClaim = true, streak = 3, streakIfClaimed = 4, rewardIndex = 4 }
		)
	end)

	t.test("daily: broken saved values never lock the reward away", function()
		local data = newData()
		data.daily = { lastClaimDay = TODAY + 500, streak = 9 } -- far in the future: treated as a gap
		t.equal(
			QuestLogic.dailyStatus(data, TODAY),
			{ canClaim = true, streak = 0, streakIfClaimed = 1, rewardIndex = 1 }
		)
		data.daily = { lastClaimDay = NAN, streak = NAN }
		t.equal(
			QuestLogic.dailyStatus(data, TODAY),
			{ canClaim = true, streak = 0, streakIfClaimed = 1, rewardIndex = 1 }
		)
		data.daily = { lastClaimDay = TODAY, streak = -4 }
		t.equal(QuestLogic.dailyStatus(data, TODAY).canClaim, true)
		data.daily = { lastClaimDay = TODAY - 1, streak = 1e18 }
		local status = QuestLogic.dailyStatus(data, TODAY)
		t.truthy(status.rewardIndex >= 1 and status.rewardIndex <= CYCLE)
	end)

	---------------------------------------------------------------------------------------------
	-- Playtime gifts

	t.test("playtimeStatus follows the seconds played today", function()
		local data = newData()
		for index, def in Config.PlaytimeRewards do
			data.playtime.seconds = 0
			t.equal(
				QuestLogic.playtimeStatus(data, index),
				{ reached = false, claimed = false, canClaim = false, remaining = def.seconds }
			)
			data.playtime.seconds = def.seconds - 0.5
			t.equal(
				QuestLogic.playtimeStatus(data, index),
				{ reached = false, claimed = false, canClaim = false, remaining = 1 }
			)
			data.playtime.seconds = def.seconds
			t.equal(
				QuestLogic.playtimeStatus(data, index),
				{ reached = true, claimed = false, canClaim = true, remaining = 0 }
			)
			data.playtime.claimed[tostring(index)] = true
			t.equal(
				QuestLogic.playtimeStatus(data, index),
				{ reached = true, claimed = true, canClaim = false, remaining = 0 }
			)
		end
		-- Gifts are independent: claiming one does not affect the next.
		data = newData()
		data.playtime.seconds = Config.PlaytimeRewards[2].seconds
		data.playtime.claimed["1"] = true
		t.equal(QuestLogic.playtimeStatus(data, 2).canClaim, true)
		t.equal(QuestLogic.playtimeStatus(data, 3).canClaim, false)
	end)

	t.test("playtimeStatus of an index that does not exist is never claimable", function()
		local data = newData()
		data.playtime.seconds = 1e9
		data.playtime.claimed["99"] = true
		local nothing = { reached = false, claimed = false, canClaim = false, remaining = 0 }
		for _, index in { 0, -1, #Config.PlaytimeRewards + 1, 99, 1.5, NAN, INF, "1" :: any, nil :: any } do
			t.equal(QuestLogic.playtimeStatus(data, index), nothing, tostring(index))
		end
		data.playtime.seconds = NAN
		t.equal(QuestLogic.playtimeStatus(data, 1).reached, false)
	end)

	---------------------------------------------------------------------------------------------
	-- Achievements

	t.test("achievementProgress reads stats, level and rebirths", function()
		local data = newData()
		local crystals = Config.Achievements.byId.crystals
		local first, second = crystals.tiers[1].goal, crystals.tiers[2].goal

		t.equal(QuestLogic.achievementProgress(data, crystals), {
			value = 0,
			claimedTiers = 0,
			totalTiers = #crystals.tiers,
			nextGoal = first,
			canClaim = false,
		})
		data.stats.crystalsSmashed = first - 1
		t.equal(QuestLogic.achievementProgress(data, crystals).canClaim, false)
		data.stats.crystalsSmashed = first
		t.equal(QuestLogic.achievementProgress(data, crystals).canClaim, true)

		-- Tiers are claimed one at a time, even when several are reached.
		data.stats.crystalsSmashed = second + 5
		data.achievements.crystals = 1
		t.equal(QuestLogic.achievementProgress(data, crystals), {
			value = second + 5,
			claimedTiers = 1,
			totalTiers = #crystals.tiers,
			nextGoal = second,
			canClaim = true,
		})
		data.achievements.crystals = 2
		t.equal(QuestLogic.achievementProgress(data, crystals).canClaim, false)
		t.equal(QuestLogic.achievementProgress(data, crystals).nextGoal, crystals.tiers[3].goal)

		data.level = 33
		data.rebirths = 4
		t.equal(QuestLogic.achievementValue(data, Config.Achievements.byId.level), 33)
		t.equal(QuestLogic.achievementValue(data, Config.Achievements.byId.rebirths), 4)
		t.equal(QuestLogic.achievementProgress(data, Config.Achievements.byId.level).value, 33)
	end)

	t.test("achievementProgress when every tier is claimed, and with odd saved values", function()
		local data = newData()
		local def = Config.Achievements.byId.bigCrystals
		data.stats.bigCrystals = 1e12
		data.achievements.bigCrystals = #def.tiers
		t.equal(QuestLogic.achievementProgress(data, def), {
			value = 1e12,
			claimedTiers = #def.tiers,
			totalTiers = #def.tiers,
			canClaim = false,
		})
		data.achievements.bigCrystals = 99 -- more than there are: clamped
		t.equal(QuestLogic.achievementProgress(data, def).claimedTiers, #def.tiers)
		t.equal(QuestLogic.achievementProgress(data, def).canClaim, false)
		data.achievements.bigCrystals = NAN
		t.equal(QuestLogic.achievementProgress(data, def).claimedTiers, 0)
		data.achievements.bigCrystals = -2
		t.equal(QuestLogic.achievementProgress(data, def).claimedTiers, 0)

		data.stats.bigCrystals = NAN
		t.equal(QuestLogic.achievementProgress(data, def).value, 0)
		data.stats.bigCrystals = nil
		t.equal(QuestLogic.achievementProgress(data, def).value, 0)
		t.equal(QuestLogic.achievementProgress(data, def).canClaim, false)
	end)

	t.test("every achievement in Config reports progress and prints its goals", function()
		local data = newData()
		for _, def in Config.Achievements.list do
			local progress = QuestLogic.achievementProgress(data, def)
			t.equal(progress.claimedTiers, 0, def.id)
			t.equal(progress.totalTiers, #def.tiers, def.id)
			t.equal(progress.nextGoal, def.tiers[1].goal, def.id)
			-- A new player has nothing to claim, except goals that level 1 already meets.
			t.equal(progress.canClaim, progress.value >= def.tiers[1].goal, def.id)
			for _, tier in def.tiers do
				local text = QuestLogic.achievementText(def, tier.goal)
				t.falsy(string.find(text, "%s", 1, true), def.id .. " still has a placeholder")
				t.truthy(#text > 5)
			end
		end
		t.equal(QuestLogic.achievementText(Config.Achievements.byId.crystals, 5000), "Smash 5K crystals")
		local playtime = Config.Achievements.byId.playtime
		t.equal(
			QuestLogic.achievementText(playtime, 7200),
			(string.gsub(playtime.text, "%%s", NumberFormat.duration(7200)))
		)
	end)
end
