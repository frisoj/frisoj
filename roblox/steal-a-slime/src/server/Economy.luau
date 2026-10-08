--!strict
-- Alles rond Goo en slijmpjes in de save: inkomen, platforms, Slijmdex, rebirths,
-- dagelijkse beloning, speeltijd-cadeaus, codes en wat de client te zien krijgt.
-- De wereld (platforms in de labs) volgt via het signaal `labChanged`.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Slimes = require(Shared:WaitForChild("Slimes"))
local Rebirths = require(Shared:WaitForChild("Rebirths"))
local Events = require(Shared:WaitForChild("Events"))
local Format = require(Shared:WaitForChild("Format"))

local Server = script.Parent
local PlayerData = require(Server:WaitForChild("PlayerData"))
local Passes = require(Server:WaitForChild("Passes"))
local Remotes = require(Server:WaitForChild("Remotes"))
local Signal = require(Server:WaitForChild("Signal"))

type Data = PlayerData.Data
type Slime = PlayerData.Slime

local Economy = {}

-- (speler) als platforms in het lab veranderd zijn
Economy.labChanged = Signal.new() :: Signal.Signal<Player>
-- (speler) na een rebirth: het lab moet leeg en opnieuw opgebouwd
Economy.rebirthed = Signal.new() :: Signal.Signal<Player>

local inTransit: { [Player]: { [number]: boolean } } = {}
local incomeCache: { [Player]: number } = {}
local friendCount: { [Player]: number } = {}
local friendPairs: { [string]: boolean } = {}
local lastAction: { [Player]: number } = {}

local function now(): number
	return Workspace:GetServerTimeNow()
end

function Economy.notify(player: Player, text: string, kind: string?)
	Remotes.Notify:FireClient(player, text, kind or "info")
end

function Economy.announce(text: string, color: string?)
	Remotes.Announce:FireAllClients(text, color or "#FFFFFF")
end

------------------------------------------------------------------ platforms

function Economy.padCount(player: Player): number
	local data = PlayerData.get(player)
	local n = Config.BASE_PADS + math.min(if data then data.rebirths else 0, Rebirths.MAX)
	if Passes.has(player, "MegaLab") then
		n += Config.MEGA_LAB_PADS
	end
	if Passes.has(player, "VIP") then
		n += Config.VIP_PADS
	end
	return math.min(n, Config.MAX_PADS)
end

function Economy.freePad(player: Player): number?
	local data = PlayerData.get(player)
	if not data then
		return nil
	end
	for i = 1, Economy.padCount(player) do
		if data.lab[tostring(i)] == nil then
			return i
		end
	end
	return nil
end

function Economy.setInTransit(player: Player, pad: number, value: boolean)
	local set = inTransit[player]
	if not set then
		set = {}
		inTransit[player] = set
	end
	if value then
		set[pad] = true
	else
		set[pad] = nil
	end
end

function Economy.isInTransit(player: Player, pad: number): boolean
	local set = inTransit[player]
	return set ~= nil and set[pad] == true
end

-- Slijmdex bijwerken; geeft true als het een nieuwe soort of mutatie was.
function Economy.discover(player: Player, slime: Slime): boolean
	local data = PlayerData.get(player)
	if not data then
		return false
	end
	local entry = data.dex[slime.s]
	local isNew = false
	if not entry then
		entry = { f = slime.f, m = {} }
		data.dex[slime.s] = entry
		isNew = true
	end
	local e = entry :: { f: number, m: { [string]: boolean } }
	if slime.f > e.f then
		e.f = slime.f
	end
	if slime.m and not e.m[slime.m] then
		e.m[slime.m] = true
		isNew = true
	end
	return isNew
end

function Economy.dexBonus(data: Data): number
	local bonus = 0
	for _, entry in data.dex do
		bonus += Config.DEX_SPECIES_BONUS
		for _ in entry.m do
			bonus += Config.DEX_MUTATION_BONUS
		end
	end
	return bonus
end

-- Zet een slijmpje op het eerste vrije platform, of in de opslag als het lab vol is.
function Economy.addSlime(player: Player, slime: Slime): (string, number?)
	local data = PlayerData.get(player)
	if not data then
		return "none", nil
	end
	local clean: Slime = { s = slime.s, m = slime.m, f = slime.f }
	local isNew = Economy.discover(player, clean)
	if isNew then
		Economy.notify(player, "New in your Slimedex: " .. Slimes.displayName(clean) .. "!", "rare")
	end
	local pad = Economy.freePad(player)
	if pad then
		data.lab[tostring(pad)] = clean
		Economy.labChanged:Fire(player)
		return "pad", pad
	end
	table.insert(data.storage, clean)
	Economy.notify(player, "Your lab is full: " .. Slimes.displayName(clean) .. " waits in storage.", "info")
	return "storage", nil
end

function Economy.removeSlime(player: Player, pad: number): Slime?
	local data = PlayerData.get(player)
	if not data then
		return nil
	end
	local key = tostring(pad)
	local slime = data.lab[key]
	if slime then
		data.lab[key] = nil
		Economy.labChanged:Fire(player)
	end
	return slime
end

-- Slijmpjes uit de opslag naar vrije platforms.
function Economy.placeStorage(player: Player)
	local data = PlayerData.get(player)
	if not data or #data.storage == 0 then
		return
	end
	local moved = false
	while #data.storage > 0 do
		local pad = Economy.freePad(player)
		if not pad then
			break
		end
		data.lab[tostring(pad)] = table.remove(data.storage, 1) :: Slime
		moved = true
	end
	if moved then
		Economy.labChanged:Fire(player)
	end
end

------------------------------------------------------------------ inkomen

function Economy.multiplier(player: Player): number
	local data = PlayerData.get(player)
	if not data then
		return 1
	end
	local mult = (1 + Config.REBIRTH_BONUS * data.rebirths) * (1 + Economy.dexBonus(data))
	if Passes.has(player, "DoubleGoo") then
		mult *= 2
	end
	if Passes.has(player, "VIP") then
		mult *= 1 + Config.VIP_BONUS
	end
	mult *= 1 + math.min(Config.FRIEND_BONUS * (friendCount[player] or 0), Config.FRIEND_BONUS_MAX)
	return mult * Events.gooMultiplier(now())
end

function Economy.baseIncome(player: Player): number
	local data = PlayerData.get(player)
	if not data then
		return 0
	end
	local total = 0
	for key, slime in data.lab do
		local pad = tonumber(key)
		if pad and not Economy.isInTransit(player, pad) then
			total += Slimes.income(slime)
		end
	end
	return total
end

function Economy.incomePerSecond(player: Player): number
	return Economy.baseIncome(player) * Economy.multiplier(player)
end

function Economy.give(player: Player, amount: number)
	local data = PlayerData.get(player)
	if not data or amount <= 0 or amount ~= amount then
		return
	end
	data.goo += amount
	data.totalGoo += amount
end

function Economy.spend(player: Player, amount: number): boolean
	local data = PlayerData.get(player)
	if not data or amount < 0 or data.goo < amount then
		return false
	end
	data.goo -= amount
	return true
end

function Economy.collect(player: Player): number
	local data = PlayerData.get(player)
	if not data then
		return 0
	end
	if data.tutorial == 1 then
		data.tutorial = 2
	end
	if data.tank < 1 then
		return 0
	end
	local amount = math.floor(data.tank)
	data.goo += amount
	data.tank -= amount
	return amount
end

-- Goo ter waarde van zoveel seconden inkomen, met een minimum (pakketten, cadeaus).
function Economy.incomeWorth(player: Player, seconds: number, minimum: number): number
	return math.max(minimum, math.floor(Economy.incomePerSecond(player) * seconds))
end

------------------------------------------------------------------ eieren

function Economy.openEgg(player: Player, egg: string): Slime?
	if not Slimes.EGGS[egg] then
		return nil
	end
	local luck = if Passes.has(player, "LuckyCharm") then 2 else 1
	local species = Slimes.pick(Slimes.eggOdds(egg, luck), math.random())
	local slime: Slime = { s = species, m = nil, f = 0 }
	Economy.addSlime(player, slime)
	local info = Slimes.BY_ID[species]
	Remotes.Effect:FireClient(player, "egg", nil, { species = species, egg = egg })
	if Slimes.rarityOrder(info.rarity) >= Slimes.rarityOrder("Mythic") then
		Economy.announce(string.format("%s hatched a %s %s!", player.DisplayName, string.upper(info.rarity), info.name), "#FF6FB5")
	end
	return slime
end

------------------------------------------------------------------ acties van de speler

function Economy.sell(player: Player, pad: number)
	local data = PlayerData.get(player)
	if not data or Economy.isInTransit(player, pad) then
		return
	end
	local slime = data.lab[tostring(pad)]
	if not slime then
		return
	end
	local value = math.floor(Slimes.price(slime) * Config.SELL_FRACTION)
	Economy.removeSlime(player, pad)
	Economy.give(player, value)
	Economy.notify(player, string.format("Sold %s for %s Goo", Slimes.displayName(slime), Format.number(value)), "good")
	Economy.placeStorage(player)
end

function Economy.rebirth(player: Player)
	local data = PlayerData.get(player)
	if not data then
		return
	end
	local req = Rebirths.next(data.rebirths)
	if not req then
		Economy.notify(player, "You reached the highest rebirth!", "info")
		return
	end
	if data.goo < req.goo then
		Economy.notify(player, "You need " .. Format.number(req.goo) .. " Goo to rebirth.", "bad")
		return
	end
	local found = false
	for key, slime in data.lab do
		local pad = tonumber(key)
		if pad and not Economy.isInTransit(player, pad) and Rebirths.meets(slime, req) then
			found = true
			break
		end
	end
	if not found then
		Economy.notify(player, "You need " .. Rebirths.describe(req) .. " in your lab to rebirth.", "bad")
		return
	end
	data.rebirths += 1
	data.goo = 50
	data.tank = 0
	data.lab = {}
	data.storage = {}
	data.fusing = nil
	inTransit[player] = {}
	Economy.rebirthed:Fire(player)
	Economy.labChanged:Fire(player)
	Remotes.Effect:FireClient(player, "rebirth", nil, { rebirths = data.rebirths })
	Economy.announce(string.format("%s reached REBIRTH %d!", player.DisplayName, data.rebirths), "#7CFFB2")
end

function Economy.claimDaily(player: Player)
	local data = PlayerData.get(player)
	if not data then
		return
	end
	local today = Events.day(now())
	if data.dailyDay >= today then
		return
	end
	local streak = if data.dailyDay == today - 1 then data.dailyStreak % #Config.DAILY + 1 else 1
	data.dailyDay = today
	data.dailyStreak = streak
	local reward = Config.DAILY[streak]
	if reward.egg then
		Economy.openEgg(player, reward.egg)
		Economy.notify(player, string.format("Day %d reward: a free %s!", streak, Slimes.EGGS[reward.egg].name), "rare")
	else
		local amount = Economy.incomeWorth(player, reward.minutes * 60, reward.min)
		Economy.give(player, amount)
		Economy.notify(player, string.format("Day %d reward: +%s Goo", streak, Format.number(amount)), "good")
	end
end

local function resetGiftsIfNewDay(data: Data)
	local today = Events.day(now())
	if data.giftDay ~= today then
		data.giftDay = today
		data.giftSeconds = 0
		data.giftsClaimed = 0
	end
end

function Economy.claimGift(player: Player)
	local data = PlayerData.get(player)
	if not data then
		return
	end
	resetGiftsIfNewDay(data)
	local gift = Config.GIFTS[data.giftsClaimed + 1]
	if not gift or data.giftSeconds < gift.at * 60 then
		return
	end
	data.giftsClaimed += 1
	if gift.egg then
		Economy.openEgg(player, gift.egg)
		Economy.notify(player, "Gift: a free " .. Slimes.EGGS[gift.egg].name .. "!", "rare")
	else
		local amount = Economy.incomeWorth(player, gift.minutes * 60, gift.min)
		Economy.give(player, amount)
		Economy.notify(player, "Gift: +" .. Format.number(amount) .. " Goo", "good")
	end
end

function Economy.redeem(player: Player, code: unknown): (boolean, string)
	local data = PlayerData.get(player)
	if not data or typeof(code) ~= "string" then
		return false, "Try again in a moment."
	end
	local key = string.upper(((code :: string):gsub("%s", "")))
	local reward = Config.CODES[key]
	if not reward then
		return false, "That code does not exist."
	end
	if data.codes[key] then
		return false, "You already used this code."
	end
	data.codes[key] = true
	if reward.goo then
		Economy.give(player, reward.goo)
	end
	if reward.egg then
		Economy.openEgg(player, reward.egg)
	end
	local text = if reward.goo then "+" .. Format.number(reward.goo) .. " Goo!" else "A free " .. Slimes.EGGS[reward.egg :: string].name .. "!"
	return true, text
end

------------------------------------------------------------------ vrienden

local function pairKey(a: Player, b: Player): string
	local x, y = math.min(a.UserId, b.UserId), math.max(a.UserId, b.UserId)
	return x .. ":" .. y
end

local function recountFriends()
	for _, p in Players:GetPlayers() do
		local n = 0
		for _, q in Players:GetPlayers() do
			if p ~= q and friendPairs[pairKey(p, q)] then
				n += 1
			end
		end
		friendCount[p] = n
	end
end

local function checkFriends(player: Player)
	for _, other in Players:GetPlayers() do
		if other ~= player then
			local key = pairKey(player, other)
			if friendPairs[key] == nil then
				local ok, isFriend = pcall(function()
					return player:IsFriendsWithAsync(other.UserId)
				end)
				friendPairs[key] = ok and isFriend == true
			end
		end
	end
	recountFriends()
end

------------------------------------------------------------------ toestand naar de client

function Economy.state(player: Player): { [string]: any }
	local data = PlayerData.get(player)
	if not data then
		return {}
	end
	local fusing = data.fusing
	return {
		goo = data.goo,
		tank = data.tank,
		income = incomeCache[player] or 0,
		multiplier = Economy.multiplier(player),
		rebirths = data.rebirths,
		pads = Economy.padCount(player),
		used = (function()
			local n = 0
			for _ in data.lab do
				n += 1
			end
			return n
		end)(),
		storage = #data.storage,
		steals = data.steals,
		dex = data.dex,
		dexBonus = Economy.dexBonus(data),
		fusing = if fusing then { s = fusing.s, m = fusing.m, f = fusing.f, readyAt = fusing.readyAt } else nil,
		skipTokens = data.skipTokens,
		dailyReady = data.dailyDay < Events.day(now()),
		dailyStreak = data.dailyStreak,
		-- Welke dag je nu kunt claimen: een gemiste dag zet de reeks terug op 1.
		dailyNext = if data.dailyDay == Events.day(now()) - 1 then data.dailyStreak % #Config.DAILY + 1 else 1,
		giftSeconds = data.giftSeconds,
		giftsClaimed = data.giftsClaimed,
		tutorial = data.tutorial,
		lab = data.lab,
	}
end

function Economy.pushState(player: Player)
	Remotes.State:FireClient(player, Economy.state(player))
end

local function updateLeaderstats(player: Player, data: Data)
	local stats = player:FindFirstChild("leaderstats")
	if not stats then
		return
	end
	local goo = stats:FindFirstChild("Goo")
	if goo and goo:IsA("StringValue") then
		goo.Value = Format.number(data.goo)
	end
	local steals = stats:FindFirstChild("Steals")
	if steals and steals:IsA("IntValue") then
		steals.Value = data.steals
	end
end

------------------------------------------------------------------ join / leave

function Economy.onJoin(player: Player)
	local data = PlayerData.get(player)
	if not data then
		return
	end
	inTransit[player] = {}
	resetGiftsIfNewDay(data)

	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	local goo = Instance.new("StringValue")
	goo.Name = "Goo"
	goo.Parent = stats
	local steals = Instance.new("IntValue")
	steals.Name = "Steals"
	steals.Parent = stats
	stats.Parent = player
	updateLeaderstats(player, data)

	task.spawn(checkFriends, player)

	-- Offline verdiensten pas na het laden van de passes, zodat 2x Goo meetelt.
	local away = PlayerData.awaySeconds(player)
	if away > 60 then
		task.delay(6, function()
			if player.Parent == nil or not PlayerData.get(player) then
				return
			end
			local seconds = math.min(away, Config.OFFLINE_CAP_SECONDS)
			local amount = math.floor(Economy.baseIncome(player) * Economy.multiplier(player) * seconds * Config.OFFLINE_RATE)
			if amount > 0 then
				Economy.give(player, amount)
				Economy.notify(player, string.format("Your lab earned %s Goo while you were away!", Format.number(amount)), "good")
			end
		end)
	end
end

function Economy.onLeave(player: Player)
	inTransit[player] = nil
	incomeCache[player] = nil
	friendCount[player] = nil
	lastAction[player] = nil
	recountFriends()
end

------------------------------------------------------------------ start

local function handleAction(player: Player, action: unknown, arg: unknown)
	local t = os.clock()
	if (lastAction[player] or 0) > t - 0.2 then
		return
	end
	lastAction[player] = t
	if action == "sell" and typeof(arg) == "number" then
		Economy.sell(player, math.floor(arg))
	elseif action == "rebirth" then
		Economy.rebirth(player)
	elseif action == "daily" then
		Economy.claimDaily(player)
	elseif action == "gift" then
		Economy.claimGift(player)
	end
end

function Economy.start()
	Remotes.Action.OnServerEvent:Connect(function(player: Player, action: unknown, arg: unknown)
		if action == "fuse" or action == "collect" then
			return -- die horen bij Fuse en Labs
		end
		handleAction(player, action, arg)
	end)
	Remotes.Code.OnServerInvoke = function(player: Player, code: unknown)
		local t = os.clock()
		if (lastAction[player] or 0) > t - 1 then
			return false, "Slow down a little."
		end
		lastAction[player] = t
		return Economy.redeem(player, code)
	end

	Players.PlayerRemoving:Connect(function()
		task.defer(recountFriends)
	end)

	task.spawn(function()
		while true do
			task.wait(1)
			for player, data in PlayerData.all() do
				local ok, err = pcall(function()
					local income = Economy.incomePerSecond(player)
					incomeCache[player] = income
					if Passes.has(player, "AutoCollect") then
						data.goo += income
					else
						data.tank += income
					end
					data.totalGoo += income
					resetGiftsIfNewDay(data)
					data.giftSeconds += 1
					updateLeaderstats(player, data)
					player:SetAttribute("Income", income)
					Economy.pushState(player)
				end)
				if not ok then
					warn("[Economy]", err)
				end
			end
		end
	end)
end

return Economy
