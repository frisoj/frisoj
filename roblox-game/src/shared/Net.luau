--!strict
--[[
	Net — the single definition of every remote plus the helpers both sides use to talk through them (spec §5).
	Remotes live in ReplicatedStorage.Remotes; Net.setup() creates them on the server, clients wait for them.
	Every function errors immediately on an unknown or wrong-kind name, so typos never fail silently.

	Server: Net.setup(), Net.handle(name, handler, maxPerSecond?), Net.onServerEvent(name, handler, maxPerSecond?),
	        Net.fireClient(player, name, ...), Net.fireAllClients(name, ...), Net.fireAllExcept(player, name, ...)
	Client: Net.request(name, ...) -> (ok, payload), Net.onClientEvent(name, handler), Net.fireServer(name, ...)

	Guards (server): every incoming request/event passes a rate limit and a "profile loaded" check before the
	handler runs. Net cannot require server modules, so the server foundation injects them once at boot:
	    Net.setGuards({
	        rateLimit = function(player, key, maxPerSecond) return RateLimiter... end,   -- true = allowed
	        isReady = function(player) return DataService.getProfile(player) ~= nil end,  -- true = profile loaded
	    })
	Until injected: rateLimit allows everything, isReady reads the Player attribute "DataLoaded" (set by
	DataService), i.e. players are "not ready" until their data is loaded.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Net = {}

export type RequestHandler = (player: Player, ...any) -> ...any
export type ServerEventHandler = (player: Player, ...any) -> ...any
export type ClientEventHandler = (...any) -> ...any
export type Guards = {
	rateLimit: ((player: Player, key: string, maxPerSecond: number) -> boolean)?,
	isReady: ((player: Player) -> boolean)?,
}

---------------------------------------------------------------------------------------------------
-- Remote names

-- RemoteFunctions, client → server. Handlers return (ok: boolean, payload: any?); when ok is false the payload is
-- a short English message for a toast.
Net.Requests = table.freeze({
	"BuyHammer", -- (hammerId)
	"EquipHammer", -- (hammerId)
	"UnlockZone", -- (zoneId)
	"TeleportToZone", -- (zoneId)
	"BuyUpgrade", -- (upgradeId)
	"Rebirth", -- ()
	"HatchEgg", -- (eggId, count) → { results = { { petId, tier, id, isNew } } }
	"EquipPet", -- (petUid, equip: boolean)
	"EquipBestPets", -- ()
	"UnequipAllPets", -- ()
	"DeletePets", -- ({ petUid })
	"LockPet", -- (petUid, locked)
	"FusePets", -- (petId, tier)
	"ClaimQuest", -- (index)
	"ClaimAchievement", -- (achievementId)
	"ClaimDaily", -- ()
	"ClaimPlaytime", -- (index)
	"RedeemCode", -- (code)
	"SetSetting", -- (key, value)
	"ClaimGroupReward", -- ()
	"GetLeaderboard", -- (boardId) → { entries = { { rank, userId, name, value } } }
	"TeleportToBoss", -- ()
})

-- RemoteEvents, client → server.
Net.ClientEvents = table.freeze({
	"HitNode", -- (nodeId: number)
	"SetTarget", -- (nodeId: number?)
})

-- RemoteEvents, server → client.
Net.ServerEvents = table.freeze({
	"StateInit", -- (state: Types.ReplicatedState)
	"StateDelta", -- (changes: { Types.StateChange })
	"Notify", -- ({ kind = "success"|"error"|"info"|"reward", text = string })
	"HitResult", -- (nodeId, damage, isCrit, coins, xp, gems, broke) to the hitter
	"LevelUp", -- (newLevel, gems)
	"BossState", -- (payload: Types.BossStatePayload)
	"Announcement", -- (text, colorHex?)
	"RewardPopup", -- ({ title = string, lines = { string } })
	"PurchaseGranted", -- (kind, key)
})

-- UnreliableRemoteEvents, server → client (cosmetic, may be dropped).
Net.UnreliableServerEvents = table.freeze({
	"NodeFx", -- (nodeId, hitterUserId, damage, isCrit, broke)
})

type RemoteKind = "Request" | "ClientEvent" | "ServerEvent" | "UnreliableServerEvent"

local FOLDER_NAME = "Remotes"
-- Requests and client events allowed per player per remote per second unless the caller passes its own limit.
local DEFAULT_MAX_PER_SECOND = 8
-- How long a client waits for a remote to replicate before giving up with an error.
local CLIENT_WAIT_TIMEOUT = 60

local MESSAGE_ERROR = "Something went wrong"
local MESSAGE_RATE_LIMITED = "Slow down!"
local MESSAGE_LOADING = "Still loading"
local MESSAGE_UNHANDLED = "Not available"
local MESSAGE_NETWORK = "Network error"

local CLASS_BY_KIND: { [RemoteKind]: string } = {
	Request = "RemoteFunction",
	ClientEvent = "RemoteEvent",
	ServerEvent = "RemoteEvent",
	UnreliableServerEvent = "UnreliableRemoteEvent",
}

local LABEL_BY_KIND: { [RemoteKind]: string } = {
	Request = "a request (Net.Requests)",
	ClientEvent = "a client → server event (Net.ClientEvents)",
	ServerEvent = "a server → client event (Net.ServerEvents)",
	UnreliableServerEvent = "an unreliable server → client event (Net.UnreliableServerEvents)",
}

local kindByName: { [string]: RemoteKind } = {}

local function registerNames(names: { string }, kind: RemoteKind)
	for _, name in names do
		if kindByName[name] ~= nil then
			error(`Net: remote name "{name}" is defined twice`)
		end
		kindByName[name] = kind
	end
end

registerNames(Net.Requests, "Request")
registerNames(Net.ClientEvents, "ClientEvent")
registerNames(Net.ServerEvents, "ServerEvent")
registerNames(Net.UnreliableServerEvents, "UnreliableServerEvent")

-- Returns the kind of `name`, raising at the caller of the public Net function when the name is unknown or is not
-- one of the accepted kinds.
local function expectKind(caller: string, name: string, accepted: RemoteKind, alsoAccepted: RemoteKind?): RemoteKind
	local kind: RemoteKind? = if type(name) == "string" then kindByName[name] else nil
	if kind == nil then
		error(`Net.{caller}: unknown remote name "{tostring(name)}" (see the lists in Shared/Net)`, 3)
	end
	if kind ~= accepted and kind ~= alsoAccepted then
		error(`Net.{caller}: "{name}" is {LABEL_BY_KIND[kind]}, which Net.{caller} cannot use`, 3)
	end
	return kind
end

local function expectServer(caller: string)
	if not RunService:IsServer() then
		error(`Net.{caller} can only be called on the server`, 3)
	end
end

local function expectClient(caller: string)
	if not RunService:IsClient() then
		error(`Net.{caller} can only be called on the client`, 3)
	end
end

local function expectFunction(caller: string, value: any)
	if type(value) ~= "function" then
		error(`Net.{caller}: handler must be a function, got {typeof(value)}`, 3)
	end
end

local function traceback(message: any): string
	return debug.traceback(tostring(message), 2)
end

---------------------------------------------------------------------------------------------------
-- Server

local serverFolder: Folder? = nil
local serverRemotes: { [string]: Instance } = {}
local hasHandler: { [string]: boolean } = {}

local function defaultRateLimit(_player: Player, _key: string, _maxPerSecond: number): boolean
	return true
end

local function defaultIsReady(player: Player): boolean
	return player:GetAttribute("DataLoaded") == true
end

local rateLimitGuard: (player: Player, key: string, maxPerSecond: number) -> boolean = defaultRateLimit
local isReadyGuard: (player: Player) -> boolean = defaultIsReady

-- nil when the call may proceed, otherwise the message to answer with.
local function rejectionFor(player: Player, name: string, maxPerSecond: number): string?
	if not rateLimitGuard(player, name, maxPerSecond) then
		return MESSAGE_RATE_LIMITED
	end
	if not isReadyGuard(player) then
		return MESSAGE_LOADING
	end
	return nil
end

local function unhandledRequest(): (boolean, string)
	return false, MESSAGE_UNHANDLED
end

local function createRemotes(folder: Folder, names: { string }, kind: RemoteKind)
	local className = CLASS_BY_KIND[kind]
	for _, name in names do
		local remote = folder:FindFirstChild(name)
		if remote == nil or remote.ClassName ~= className then
			if remote then
				remote:Destroy()
			end
			local created = Instance.new(className)
			created.Name = name
			created.Parent = folder
			remote = created
		end
		local instance = remote :: Instance
		if kind == "Request" then
			-- Without a callback InvokeServer would hang the client forever; answer until Net.handle replaces it.
			(instance :: RemoteFunction).OnServerInvoke = unhandledRequest
		end
		serverRemotes[name] = instance
	end
end

-- Creates ReplicatedStorage.Remotes with every remote. Server only; Main calls it once before services Init
-- (calling it again is a no-op, and the other server functions call it themselves if Main has not yet).
function Net.setup()
	expectServer("setup")
	if serverFolder then
		return
	end
	local existing = ReplicatedStorage:FindFirstChild(FOLDER_NAME)
	local folder: Folder
	if existing and existing:IsA("Folder") then
		folder = existing :: Folder
	else
		folder = Instance.new("Folder")
		folder.Name = FOLDER_NAME
	end
	createRemotes(folder, Net.Requests, "Request")
	createRemotes(folder, Net.ClientEvents, "ClientEvent")
	createRemotes(folder, Net.ServerEvents, "ServerEvent")
	createRemotes(folder, Net.UnreliableServerEvents, "UnreliableServerEvent")
	-- Parent last so clients receive the folder already filled.
	folder.Parent = ReplicatedStorage
	serverFolder = folder
end

local function getServerRemote(name: string): Instance
	if not serverFolder then
		Net.setup()
	end
	return serverRemotes[name]
end

-- Injects the server-side checks (see the header). Fields that are omitted keep their current implementation.
function Net.setGuards(guards: Guards)
	expectServer("setGuards")
	if type(guards) ~= "table" then
		error("Net.setGuards: expected a table { rateLimit = fn?, isReady = fn? }", 2)
	end
	local rateLimit = guards.rateLimit
	if rateLimit ~= nil then
		expectFunction("setGuards", rateLimit)
		rateLimitGuard = rateLimit
	end
	local isReady = guards.isReady
	if isReady ~= nil then
		expectFunction("setGuards", isReady)
		isReadyGuard = isReady
	end
end

local function finishRequest(name: string, player: Player, success: boolean, ok: any, payload: any): (boolean, any)
	if not success then
		warn(`[Net] request "{name}" from {player.Name} failed: {tostring(ok)}`)
		return false, MESSAGE_ERROR
	end
	if type(ok) ~= "boolean" then
		warn(`[Net] handler of "{name}" must return (boolean, payload?), got {typeof(ok)}`)
		return false, MESSAGE_ERROR
	end
	if not ok and type(payload) ~= "string" then
		return false, MESSAGE_ERROR
	end
	return ok, payload
end

-- Registers the one handler of a request. The handler receives (player, ...client arguments) — the arguments are
-- untrusted — and returns (ok: boolean, payload: any?). It only runs for players with a loaded profile and within
-- the rate limit (default 8 calls per second per player per remote); a handler error is logged and answered with
-- (false, "Something went wrong").
function Net.handle(name: string, handler: RequestHandler, maxPerSecond: number?)
	expectServer("handle")
	expectKind("handle", name, "Request")
	expectFunction("handle", handler)
	if hasHandler[name] then
		error(`Net.handle: "{name}" already has a handler`, 2)
	end
	hasHandler[name] = true
	local limit = maxPerSecond or DEFAULT_MAX_PER_SECOND
	local remote = getServerRemote(name) :: RemoteFunction
	remote.OnServerInvoke = function(player: Player, ...: any): (boolean, any)
		local checked, rejection = pcall(rejectionFor, player, name, limit)
		if not checked then
			warn(`[Net] guard error on "{name}": {tostring(rejection)}`)
			return false, MESSAGE_ERROR
		end
		if rejection ~= nil then
			return false, rejection
		end
		return finishRequest(name, player, xpcall(handler, traceback, player, ...))
	end
end

-- Registers the one handler of a client → server event. Same guards as Net.handle, but calls that are rate
-- limited or come from a player without a loaded profile are dropped silently.
function Net.onServerEvent(name: string, handler: ServerEventHandler, maxPerSecond: number?): RBXScriptConnection
	expectServer("onServerEvent")
	expectKind("onServerEvent", name, "ClientEvent")
	expectFunction("onServerEvent", handler)
	if hasHandler[name] then
		error(`Net.onServerEvent: "{name}" already has a handler`, 2)
	end
	hasHandler[name] = true
	local limit = maxPerSecond or DEFAULT_MAX_PER_SECOND
	local remote = getServerRemote(name) :: RemoteEvent
	return remote.OnServerEvent:Connect(function(player: Player, ...: any)
		local checked, rejection = pcall(rejectionFor, player, name, limit)
		if not checked then
			warn(`[Net] guard error on "{name}": {tostring(rejection)}`)
			return
		end
		if rejection ~= nil then
			return
		end
		local success, message = xpcall(handler, traceback, player, ...)
		if not success then
			warn(`[Net] event "{name}" from {player.Name} failed: {tostring(message)}`)
		end
	end)
end

-- Sends a server → client event to one player (reliable or unreliable, depending on the list the name is in).
function Net.fireClient(player: Player, name: string, ...: any)
	expectServer("fireClient")
	local kind = expectKind("fireClient", name, "ServerEvent", "UnreliableServerEvent")
	local remote = getServerRemote(name)
	if kind == "UnreliableServerEvent" then
		local unreliable = remote :: UnreliableRemoteEvent
		unreliable:FireClient(player, ...)
	else
		local reliable = remote :: RemoteEvent
		reliable:FireClient(player, ...)
	end
end

-- Sends a server → client event to every connected player.
function Net.fireAllClients(name: string, ...: any)
	expectServer("fireAllClients")
	local kind = expectKind("fireAllClients", name, "ServerEvent", "UnreliableServerEvent")
	local remote = getServerRemote(name)
	if kind == "UnreliableServerEvent" then
		local unreliable = remote :: UnreliableRemoteEvent
		unreliable:FireAllClients(...)
	else
		local reliable = remote :: RemoteEvent
		reliable:FireAllClients(...)
	end
end

-- Sends a server → client event to every connected player except `except`.
function Net.fireAllExcept(except: Player?, name: string, ...: any)
	expectServer("fireAllExcept")
	local kind = expectKind("fireAllExcept", name, "ServerEvent", "UnreliableServerEvent")
	local remote = getServerRemote(name)
	if kind == "UnreliableServerEvent" then
		local unreliable = remote :: UnreliableRemoteEvent
		for _, player in Players:GetPlayers() do
			if player ~= except then
				unreliable:FireClient(player, ...)
			end
		end
	else
		local reliable = remote :: RemoteEvent
		for _, player in Players:GetPlayers() do
			if player ~= except then
				reliable:FireClient(player, ...)
			end
		end
	end
end

---------------------------------------------------------------------------------------------------
-- Client

local clientFolder: Instance? = nil
local clientRemotes: { [string]: Instance } = {}

-- Yields until the remote has replicated (first use of each name only; afterwards it is cached).
local function getClientRemote(name: string): Instance
	local cached = clientRemotes[name]
	if cached then
		return cached
	end
	local folder = clientFolder
	if folder == nil then
		local found = ReplicatedStorage:WaitForChild(FOLDER_NAME, CLIENT_WAIT_TIMEOUT)
		if found == nil then
			error(
				`Net: ReplicatedStorage.{FOLDER_NAME} did not appear within {CLIENT_WAIT_TIMEOUT}s `
					.. "(did the server run Net.setup()?)"
			)
		end
		clientFolder = found
		folder = found
	end
	local remote = (folder :: Instance):WaitForChild(name, CLIENT_WAIT_TIMEOUT)
	if remote == nil then
		error(`Net: remote "{name}" did not replicate within {CLIENT_WAIT_TIMEOUT}s`)
	end
	local instance = remote :: Instance
	clientRemotes[name] = instance
	return instance
end

local function finishInvoke(success: boolean, ok: any, payload: any): (boolean, any)
	if not success or type(ok) ~= "boolean" then
		return false, MESSAGE_NETWORK
	end
	if not ok and type(payload) ~= "string" then
		return false, MESSAGE_ERROR
	end
	return ok, payload
end

local function invoke(remote: RemoteFunction, ...: any): ...any
	return remote:InvokeServer(...)
end

-- Calls a request and yields for the answer: (true, payload?) or (false, message). Never throws for network
-- problems — those come back as (false, "Network error").
function Net.request(name: string, ...: any): (boolean, any)
	expectClient("request")
	expectKind("request", name, "Request")
	local remote = getClientRemote(name) :: RemoteFunction
	return finishInvoke(pcall(invoke, remote, ...))
end

-- Listens to a server → client event (reliable or unreliable). Reliable events fired before the first listener
-- connects are queued by the engine, so StateInit cannot be missed.
function Net.onClientEvent(name: string, handler: ClientEventHandler): RBXScriptConnection
	expectClient("onClientEvent")
	local kind = expectKind("onClientEvent", name, "ServerEvent", "UnreliableServerEvent")
	expectFunction("onClientEvent", handler)
	local remote = getClientRemote(name)
	if kind == "UnreliableServerEvent" then
		local unreliable = remote :: UnreliableRemoteEvent
		return unreliable.OnClientEvent:Connect(handler)
	end
	local reliable = remote :: RemoteEvent
	return reliable.OnClientEvent:Connect(handler)
end

-- Sends a client → server event (fire and forget).
function Net.fireServer(name: string, ...: any)
	expectClient("fireServer")
	expectKind("fireServer", name, "ClientEvent")
	local remote = getClientRemote(name) :: RemoteEvent
	remote:FireServer(...)
end

return Net
