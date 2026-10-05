--!strict
-- Parels verdienen, upgrades, Migratie, codes, voeren en de Sky-dex.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Driftlings = require(Shared:WaitForChild("Driftlings"))
local Biomes = require(Shared:WaitForChild("Biomes"))
local Upgrades = require(Shared:WaitForChild("Upgrades"))
local Format = require(Shared:WaitForChild("Format"))

local Server = script.Parent
local PlayerData = require(Server:WaitForChild("PlayerData"))
local NestService = require(Server:WaitForChild("NestService"))
local Remotes = require(Server:WaitForChild("Remotes"))

local Economy = {}

type Passes = { DoublePearls: boolean, VIPCaptain: boolean, Weatherman: boolean }

local passes: { [Player]: Passes } = {}
local friendBonus: { [Player]: number } = {}
local lastFeed: { [Player]: number } = {}
local lastAction: { [Player]: number } = {}
local friendCache: { [string]: boolean } = {}

local function now(): number
	return Workspace:GetServerTimeNow()
end

function Economy.notify(player: Player, text: string, kind: string?)
	Remotes.Notify:FireClient(player, { text = text, kind = kind or "info" })
end

function Economy.announce(text: string, kind: string?)
	Remotes.Announce:FireAllClients({ text = text, kind = kind or "info" })
end

function Economy.getPasses(player: Player): Passes
	local p = passes[player]
	if p == nil then
		p = { DoublePearls = false, VIPCaptain = false, Weatherman = false }
		passes[player] = p
	end
	return p :: Passes
end

function Economy.feastMultiplier(): number
	if ((tonumber(Workspace:GetAttribute("FeastEndsAt")) or 0)) > now() then
		return (tonumber(Workspace:GetAttribute("FeastMult")) or 1)
	end
	return 1
end

function Economy.songActive(): boolean
	return ((tonumber(Workspace:GetAttribute("SongEndsAt")) or 0)) > now()
end

function Economy.nestCapacity(player: Player, data: PlayerData.Data): number
	local cap = Upgrades.value("Nest", data.nestLevel)
	if Economy.getPasses(player).VIPCaptain then
		cap += Upgrades.VIP_EXTRA_SLOTS
	end
	return cap
end

local function entryRate(entry: PlayerData.NestEntry): number
	local species = Driftlings.SPECIES[entry.s]
	if species == nil then
		return 0
	end
	return species.rate * Biomes.mutationMult(entry.m)
end

-- Parels per minuut zonder boosts.
function Economy.baseRate(data: PlayerData.Data): number
	local total = 0
	for _, entry in data.nest do
		total += entryRate(entry)
	end
	return total
end

-- Permanente vermenigvuldiger (Migraties + 2x-pass).
function Economy.permanentMultiplier(player: Player, data: PlayerData.Data): number
	local mult = 1 + data.migrations * Config.MIGRATION_BONUS
	if Economy.getPasses(player).DoublePearls then
		mult *= 2
	end
	return mult
end

function Economy.totalMultiplier(player: Player, data: PlayerData.Data): number
	return Economy.permanentMultiplier(player, data) * Economy.feastMultiplier() * (1 + (friendBonus[player] or 0))
end

function Economy.migrationCost(data: PlayerData.Data): number
	return Config.MIGRATION_BASE_COST * (data.migrations + 1)
end

-- Stuurt nest, Sky-dex en levels naar de client.
function Economy.sync(player: Player)
	local data = PlayerData.get(player)
	if data == nil then
		return
	end
	Remotes.Sync:FireClient(player, {
		nest = data.nest,
		dex = data.dex,
		levels = { Net = data.netLevel, Nest = data.nestLevel, Glider = data.gliderLevel },
		nestCap = Economy.nestCapacity(player, data),
		migrations = data.migrations,
		migrationCost = Economy.migrationCost(data),
		tutorialDone = data.tutorialDone,
	})
end

-- Zet alle afgeleide waarden als attributen op de speler.
function Economy.refresh(player: Player)
	local data = PlayerData.get(player)
	if data == nil then
		return
	end
	local p = Economy.getPasses(player)
	player:SetAttribute("NetRange", Upgrades.value("Net", data.netLevel))
	player:SetAttribute("GliderSpeed", Upgrades.value("Glider", data.gliderLevel))
	player:SetAttribute("NestCap", Economy.nestCapacity(player, data))
	player:SetAttribute("Migrations", data.migrations)
	player:SetAttribute("VIP", p.VIPCaptain)
	player:SetAttribute("Weatherman", p.Weatherman)
	player:SetAttribute("DoublePearls", p.DoublePearls)
	player:SetAttribute("FriendBonus", friendBonus[player] or 0)
	player:SetAttribute("Pearls", math.floor(data.pearls))
	player:SetAttribute("Rate", Economy.baseRate(data) * Economy.totalMultiplier(player, data))

	local stats = player:FindFirstChild("leaderstats")
	if stats then
		local pearls = stats:FindFirstChild("Pearls") :: NumberValue?
		local migrations = stats:FindFirstChild("Migrations") :: IntValue?
		if pearls then
			pearls.Value = math.floor(data.pearls)
		end
		if migrations then
			migrations.Value = data.migrations
		end
	end
end

function Economy.grantPearls(player: Player, amount: number)
	local data = PlayerData.get(player)
	if data == nil then
		return
	end
	data.pearls += amount
	data.totalPearls += amount
	Economy.refresh(player)
end

-- Voegt een gevangen Driftling toe. Is het nest vol, dan blijven de beste
-- Driftlings zitten en wordt de zwakste verkocht.
function Economy.addDriftling(player: Player, speciesId: string, mutation: string?)
	local data = PlayerData.get(player)
	local species = Driftlings.SPECIES[speciesId]
	if data == nil or species == nil then
		return
	end

	local dexEntry = data.dex[speciesId]
	if dexEntry == nil then
		dexEntry = { n = 0, m = {} }
		data.dex[speciesId] = dexEntry
	end
	local entry = dexEntry :: PlayerData.DexEntry
	local firstOfKind = entry.n == 0
	entry.n += 1
	entry.m[mutation or "Normal"] = true

	local newEntry: PlayerData.NestEntry = { s = speciesId, m = mutation }
	table.insert(data.nest, newEntry)
	table.sort(data.nest, function(a, b)
		return entryRate(a) > entryRate(b)
	end)

	local label = (if mutation then mutation .. " " else "") .. species.name
	local rate = entryRate(newEntry)
	-- Nooit kleiner maken dan het nest al was (bijv. als de VIP-check even mislukte).
	local cap = math.max(Economy.nestCapacity(player, data), #data.nest - 1)
	local soldText = ""
	while #data.nest > cap do
		local sold = table.remove(data.nest) :: PlayerData.NestEntry
		local value = entryRate(sold) * Config.SELL_MINUTES * Economy.permanentMultiplier(player, data)
		data.pearls += value
		data.totalPearls += value
		local soldSpecies = Driftlings.SPECIES[sold.s]
		local soldName = (if sold.m then sold.m .. " " else "") .. (if soldSpecies then soldSpecies.name else sold.s)
		soldText = string.format(" Nest full: sold %s for %s Pearls.", soldName, Format.number(value))
	end

	if not data.tutorialDone then
		data.tutorialDone = true
	end

	local kind = "catch"
	if species.rarity == "Legendary" or species.rarity == "Mythic" or mutation == "Void" then
		kind = "rare"
	end
	local newTag = if firstOfKind then " NEW!" else ""
	Economy.notify(player, string.format("Caught %s! +%s/min.%s%s", label, Format.number(rate), newTag, soldText), kind)

	if species.rarity == "Mythic" or mutation == "Void" then
		Economy.announce(string.format("%s caught a %s!", player.DisplayName, label), "rare")
	end

	NestService.render(player)
	Economy.refresh(player)
	Economy.sync(player)
end

local function rateLimited(player: Player): boolean
	local t = os.clock()
	if t - (lastAction[player] or 0) < 0.25 then
		return true
	end
	lastAction[player] = t
	return false
end

function Economy.upgrade(player: Player, kind: string)
	local data = PlayerData.get(player)
	if data == nil or Upgrades.STEPS[kind] == nil then
		return
	end
	local field = if kind == "Net" then "netLevel" elseif kind == "Nest" then "nestLevel" else "gliderLevel"
	local level = (data :: any)[field] :: number
	local cost = Upgrades.nextCost(kind, level)
	if cost == nil then
		Economy.notify(player, Upgrades.INFO[kind].title .. " is already maxed out.", "bad")
		return
	end
	if data.pearls < cost then
		Economy.notify(player, "You need " .. Format.number(cost - data.pearls) .. " more Pearls.", "bad")
		return
	end
	data.pearls -= cost;
	(data :: any)[field] = level + 1
	Economy.notify(player, Upgrades.INFO[kind].title .. " upgraded!", "good")
	Economy.refresh(player)
	Economy.sync(player)
end

function Economy.migrate(player: Player)
	local data = PlayerData.get(player)
	if data == nil then
		return
	end
	local cost = Economy.migrationCost(data)
	if data.pearls < cost then
		Economy.notify(player, "Migration needs " .. Format.number(cost) .. " Pearls.", "bad")
		return
	end
	data.pearls = 0
	data.netLevel = 1
	data.nestLevel = 1
	data.gliderLevel = 1
	data.nest = {}
	data.migrations += 1
	Economy.announce(string.format("%s completed Migration #%d! Their whale calf grew.", player.DisplayName, data.migrations), "good")
	Economy.notify(player, string.format("Permanent bonus: +%d%% Pearls.", math.floor(data.migrations * Config.MIGRATION_BONUS * 100)), "good")
	NestService.render(player)
	Economy.refresh(player)
	Economy.sync(player)
end

function Economy.redeem(player: Player, raw: string)
	local data = PlayerData.get(player)
	if data == nil then
		return
	end
	local code = string.upper((raw:gsub("%s", "")))
	local reward = Config.CODES[code]
	if reward == nil then
		Economy.notify(player, "That code doesn't exist.", "bad")
		return
	end
	if data.codes[code] then
		Economy.notify(player, "You already used this code.", "bad")
		return
	end
	data.codes[code] = true
	Economy.grantPearls(player, reward.pearls)
	Economy.notify(player, string.format("Code redeemed: +%s Pearls!", Format.number(reward.pearls)), "good")
end

function Economy.feed(player: Player)
	local data = PlayerData.get(player)
	if data == nil then
		return
	end
	local t = os.clock()
	local wait = Config.FEED_COOLDOWN - (t - (lastFeed[player] or -math.huge))
	if wait > 0 then
		Economy.notify(player, string.format("The whale is still chewing. Try again in %ds.", math.ceil(wait)), "bad")
		return
	end
	local cost = math.max(Config.FEED_MIN_COST, math.floor(data.pearls * Config.FEED_COST_FRACTION))
	if data.pearls < cost then
		Economy.notify(player, "Feeding costs " .. Format.number(cost) .. " Pearls.", "bad")
		return
	end
	lastFeed[player] = t
	data.pearls -= cost
	local count = ((tonumber(Workspace:GetAttribute("FeedCount")) or 0)) + 1
	if count >= Config.FEED_GOAL then
		Workspace:SetAttribute("FeedCount", 0)
		Workspace:SetAttribute("SongEndsAt", math.max(now(), (tonumber(Workspace:GetAttribute("SongEndsAt")) or 0)) + Config.SONG_SECONDS)
		Economy.announce(player.DisplayName .. " filled the trough! The whale sings: double Driftlings for 5 minutes!", "good")
	else
		Workspace:SetAttribute("FeedCount", count)
		Economy.notify(player, string.format("You fed the whale (%d/%d).", count, Config.FEED_GOAL), "good")
	end
	Economy.refresh(player)
end

-- Elke seconde: Parels bijschrijven voor iedereen.
function Economy.tick(dt: number)
	for player, data in PlayerData.all() do
		local perMinute = Economy.baseRate(data) * Economy.totalMultiplier(player, data)
		local gained = perMinute / 60 * dt
		data.pearls += gained
		data.totalPearls += gained
		Economy.refresh(player)
		NestService.updateSign(player, perMinute)
	end
end

local function areFriends(a: Player, b: Player): boolean
	local key = if a.UserId < b.UserId then a.UserId .. ":" .. b.UserId else b.UserId .. ":" .. a.UserId
	local cached = friendCache[key]
	if cached ~= nil then
		return cached
	end
	local ok, result = pcall(function()
		return a:IsFriendsWithAsync(b.UserId)
	end)
	if not ok then
		return false -- niet onthouden, zodat het de volgende keer opnieuw geprobeerd wordt
	end
	local value = result == true
	friendCache[key] = value
	return value
end

function Economy.recomputeFriends()
	local list = Players:GetPlayers()
	for _, player in list do
		local count = 0
		for _, other in list do
			if other ~= player and other.Parent and areFriends(player, other) then
				count += 1
			end
		end
		-- areFriends kan wachten: check of de speler er nog is voordat we iets bewaren.
		if player.Parent and PlayerData.get(player) then
			friendBonus[player] = math.min(Config.FRIEND_BONUS_MAX, count * Config.FRIEND_BONUS)
			Economy.refresh(player)
		end
	end
end

function Economy.onJoin(player: Player)
	local data = PlayerData.get(player)
	if data == nil then
		return
	end

	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	local pearls = Instance.new("NumberValue")
	pearls.Name = "Pearls"
	pearls.Parent = stats
	local migrations = Instance.new("IntValue")
	migrations.Name = "Migrations"
	migrations.Parent = stats
	stats.Parent = player

	-- Offline verdiensten
	local away = math.min(PlayerData.awaySeconds(player), Config.OFFLINE_CAP_SECONDS)
	local offline = Economy.baseRate(data) * Economy.permanentMultiplier(player, data) * Config.OFFLINE_RATE * away / 60
	if offline >= 1 and away > 60 then
		data.pearls += offline
		data.totalPearls += offline
		task.delay(4, function()
			if player.Parent then
				Economy.notify(player, string.format("Your nest earned %s Pearls while you were away!", Format.number(offline)), "good")
			end
		end)
	end

	Economy.refresh(player)
	Economy.sync(player)
end

function Economy.onLeave(player: Player)
	passes[player] = nil
	friendBonus[player] = nil
	lastFeed[player] = nil
	lastAction[player] = nil
	local id = tostring(player.UserId)
	for key in friendCache do
		local a, b = string.match(key, "^(%d+):(%d+)$")
		if a == id or b == id then
			friendCache[key] = nil
		end
	end
end

function Economy.handleAction(player: Player, action: unknown, arg: unknown)
	if rateLimited(player) then
		return
	end
	if action == "upgrade" and type(arg) == "string" then
		Economy.upgrade(player, arg)
	elseif action == "migrate" then
		Economy.migrate(player)
	elseif action == "code" and type(arg) == "string" and #arg <= 30 then
		Economy.redeem(player, arg)
	end
end

return Economy
