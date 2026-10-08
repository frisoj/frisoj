--!strict
-- Laden en opslaan van spelersvoortgang met DataStoreService, met een sessie-slot:
-- maar één server tegelijk mag een save schrijven. Zo krijgt een speler die snel van
-- server wisselt nooit oude voortgang terug, en kan niemand slijmpjes dupliceren.
--
-- In Studio werkt opslaan pas na publiceren en met Game Settings > Security >
-- "Enable Studio Access to API Services". Zonder die instelling speel je met een lege save.

local DataStoreService = game:GetService("DataStoreService")
local RunService = game:GetService("RunService")
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

export type Slime = { s: string, m: string?, f: number }
export type DexEntry = { f: number, m: { [string]: boolean } }
export type Fusion = { s: string, m: string?, f: number, readyAt: number }
export type Lock = { id: string, t: number }
export type Data = {
	version: number,
	goo: number,
	totalGoo: number,
	tank: number,
	rebirths: number,
	steals: number,
	timesStolen: number,
	lab: { [string]: Slime }, -- platformnummer (als tekst) -> slijmpje
	storage: { Slime }, -- wacht op een vrij platform
	fusing: Fusion?,
	dex: { [string]: DexEntry },
	codes: { [string]: boolean },
	purchases: { string },
	skipTokens: number,
	lastSeen: number,
	dailyDay: number,
	dailyStreak: number,
	giftDay: number,
	giftSeconds: number,
	giftsClaimed: number,
	tutorial: number,
	lock: Lock?,
}

local PlayerData = {}

local SESSION_ID = if game.JobId ~= "" then game.JobId else "studio-" .. HttpService:GenerateGUID(false)
local LOCK_STALE_SECONDS = 300
local LOCK_WAIT_ATTEMPTS = 6

local profiles: { [Player]: Data } = {}
local saveDisabled: { [Player]: boolean } = {}
local awaySeconds: { [Player]: number } = {}

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

function PlayerData.defaults(): Data
	return {
		version = 1,
		goo = 50,
		totalGoo = 0,
		tank = 0,
		rebirths = 0,
		steals = 0,
		timesStolen = 0,
		lab = {},
		storage = {},
		fusing = nil,
		dex = {},
		codes = {},
		purchases = {},
		skipTokens = 0,
		lastSeen = os.time(),
		dailyDay = 0,
		dailyStreak = 0,
		giftDay = 0,
		giftSeconds = 0,
		giftsClaimed = 0,
		tutorial = 0,
	}
end

-- Vult ontbrekende velden aan, zodat oude saves blijven werken na een update.
-- `fusing` en `lock` zijn optioneel en worden apart overgenomen.
function PlayerData.reconcile(loaded: any): Data
	local data = PlayerData.defaults()
	if type(loaded) == "table" then
		for key, value in loaded do
			local current = (data :: any)[key]
			if current ~= nil and type(value) == type(current) then
				(data :: any)[key] = value
			end
		end
		if type(loaded.fusing) == "table" then
			data.fusing = loaded.fusing
		end
	end
	return data
end

local function keyFor(player: Player): string
	return "u_" .. player.UserId
end

local function lockedByOther(current: any): boolean
	if type(current) ~= "table" or type(current.lock) ~= "table" then
		return false
	end
	local lock = current.lock
	return lock.id ~= SESSION_ID and os.time() - (tonumber(lock.t) or 0) < LOCK_STALE_SECONDS
end

local function useDefaults(player: Player): Data
	saveDisabled[player] = true
	local data = PlayerData.defaults()
	profiles[player] = data
	awaySeconds[player] = 0
	return data
end

-- Laadt de save en neemt het sessie-slot. Geeft nil als laden echt mislukt; dan wordt de
-- speler gekickt, zodat een lege save nooit een goede save overschrijft.
function PlayerData.load(player: Player): Data?
	if store == nil then
		return useDefaults(player)
	end
	local dataStore = store :: DataStore
	local lastError: any = nil
	local attempt = 0
	while attempt < LOCK_WAIT_ATTEMPTS + 3 do
		attempt += 1
		local waitForLock = attempt <= LOCK_WAIT_ATTEMPTS
		local loaded: Data? = nil
		local blocked = false
		local ok, err = pcall(function()
			dataStore:UpdateAsync(keyFor(player), function(current: any)
				if waitForLock and lockedByOther(current) then
					blocked = true
					return nil
				end
				blocked = false
				local data = PlayerData.reconcile(current)
				data.lock = { id = SESSION_ID, t = os.time() }
				loaded = data
				return data
			end)
		end)
		if ok and loaded then
			local data = loaded :: Data
			profiles[player] = data
			awaySeconds[player] = if data.totalGoo > 0 then math.max(0, os.time() - data.lastSeen) else 0
			return data
		end
		if ok and blocked then
			task.wait(3)
		else
			lastError = err
			if RunService:IsStudio() then
				break
			end
			task.wait(attempt)
		end
		if player.Parent == nil then
			return nil
		end
	end
	if RunService:IsStudio() then
		warn("[PlayerData] Opslaan staat uit in Studio:", lastError)
		return useDefaults(player)
	end
	warn("[PlayerData] Laden mislukt voor", player.Name, lastError)
	return nil
end

function PlayerData.get(player: Player): Data?
	return profiles[player]
end

function PlayerData.awaySeconds(player: Player): number
	return awaySeconds[player] or 0
end

-- Slaat op. Met `release` = true wordt ook het sessie-slot vrijgegeven.
function PlayerData.save(player: Player, release: boolean?): boolean
	local data = profiles[player]
	if data == nil or store == nil or saveDisabled[player] then
		return data ~= nil
	end
	local dataStore = store :: DataStore
	local stolen = false
	local ok, err = pcall(function()
		dataStore:UpdateAsync(keyFor(player), function(current: any)
			if type(current) == "table" and type(current.lock) == "table" and current.lock.id ~= SESSION_ID then
				stolen = true
				return nil
			end
			stolen = false
			data.lastSeen = os.time()
			data.lock = if release then nil else { id = SESSION_ID, t = os.time() }
			return data
		end)
	end)
	if not ok then
		warn("[PlayerData] Opslaan mislukt voor", player.Name, err)
		return false
	end
	if stolen then
		warn("[PlayerData] Save van", player.Name, "is door een andere server overgenomen; deze server schrijft niet meer.")
		saveDisabled[player] = true
		return false
	end
	return true
end

function PlayerData.release(player: Player)
	PlayerData.save(player, true)
	profiles[player] = nil
	saveDisabled[player] = nil
	awaySeconds[player] = nil
end

function PlayerData.all(): { [Player]: Data }
	return profiles
end

return PlayerData
