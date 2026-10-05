--!strict
-- Laden en opslaan van spelersvoortgang met DataStoreService.
--
-- Let op: in Studio werkt opslaan pas als je de game hebt gepubliceerd en
-- Game Settings > Security > "Enable Studio Access to API Services" aan staat.
-- Zonder die instelling speel je in Studio met een lege, niet-opgeslagen save.

local DataStoreService = game:GetService("DataStoreService")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

export type NestEntry = { s: string, m: string? } -- soort + mutatie
export type DexEntry = { n: number, m: { [string]: boolean } }
export type Data = {
	version: number,
	pearls: number,
	totalPearls: number,
	migrations: number,
	netLevel: number,
	nestLevel: number,
	gliderLevel: number,
	nest: { NestEntry },
	dex: { [string]: DexEntry },
	codes: { [string]: boolean },
	purchases: { string },
	lastSeen: number,
	tutorialDone: boolean,
}

local PlayerData = {}

local profiles: { [Player]: Data } = {}
local saveDisabled: { [Player]: boolean } = {}

local store: DataStore? = nil
do
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(Config.DATASTORE_NAME)
	end)
	if ok then
		store = result
	else
		warn("[PlayerData] DataStore niet beschikbaar:", result)
	end
end

local function defaults(): Data
	return {
		version = 1,
		pearls = 0,
		totalPearls = 0,
		migrations = 0,
		netLevel = 1,
		nestLevel = 1,
		gliderLevel = 1,
		nest = {},
		dex = {},
		codes = {},
		purchases = {},
		lastSeen = os.time(),
		tutorialDone = false,
	}
end

-- Vult ontbrekende velden aan, zodat oude saves blijven werken na een update.
local function reconcile(loaded: any): Data
	local data = defaults()
	if type(loaded) == "table" then
		for key, value in loaded do
			local current = (data :: any)[key]
			if current ~= nil and type(value) == type(current) then
				(data :: any)[key] = value
			end
		end
	end
	return data
end

local function keyFor(player: Player): string
	return "u_" .. player.UserId
end

-- Laadt de save. Geeft nil terug als laden echt mislukt (dan wordt de speler
-- gekickt, zodat een lege save nooit een goede save overschrijft).
function PlayerData.load(player: Player): Data?
	if store == nil then
		saveDisabled[player] = true
		profiles[player] = defaults()
		return profiles[player]
	end
	local dataStore = store :: DataStore
	local lastError: any = nil
	for attempt = 1, 3 do
		local ok, result = pcall(function()
			return dataStore:GetAsync(keyFor(player))
		end)
		if ok then
			local data = reconcile(result)
			profiles[player] = data
			return data
		end
		lastError = result
		if RunService:IsStudio() then
			break
		end
		task.wait(attempt)
	end
	if RunService:IsStudio() then
		warn("[PlayerData] Opslaan staat uit in Studio:", lastError)
		saveDisabled[player] = true
		profiles[player] = defaults()
		return profiles[player]
	end
	warn("[PlayerData] Laden mislukt voor", player.Name, lastError)
	return nil
end

function PlayerData.get(player: Player): Data?
	return profiles[player]
end

function PlayerData.save(player: Player): boolean
	local data = profiles[player]
	if data == nil or store == nil or saveDisabled[player] then
		return data ~= nil
	end
	local dataStore = store :: DataStore
	data.lastSeen = os.time()
	local ok, err = pcall(function()
		dataStore:UpdateAsync(keyFor(player), function()
			return data
		end)
	end)
	if not ok then
		warn("[PlayerData] Opslaan mislukt voor", player.Name, err)
	end
	return ok
end

function PlayerData.release(player: Player)
	PlayerData.save(player)
	profiles[player] = nil
	saveDisabled[player] = nil
end

function PlayerData.all(): { [Player]: Data }
	return profiles
end

return PlayerData
