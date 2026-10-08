--!strict
-- De Fuse Machine: 3 dezelfde slijmpjes (zelfde soort en niveau) worden er één van een
-- niveau hoger (Giant ×4, Titan ×16). De beste mutatie van de drie blijft.

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Slimes = require(Shared:WaitForChild("Slimes"))

local Server = script.Parent
local PlayerData = require(Server:WaitForChild("PlayerData"))
local Economy = require(Server:WaitForChild("Economy"))
local Remotes = require(Server:WaitForChild("Remotes"))

type Slime = PlayerData.Slime

local Fuse = {}

local function now(): number
	return Workspace:GetServerTimeNow()
end

local function complete(player: Player)
	local data = PlayerData.get(player)
	local fusing = data and data.fusing
	if not data or not fusing then
		return
	end
	data.fusing = nil
	local result: Slime = { s = fusing.s, m = fusing.m, f = fusing.f }
	Economy.addSlime(player, result)
	Economy.notify(player, "Fusion done: " .. Slimes.displayName(result) .. "!", "rare")
	Remotes.Effect:FireClient(player, "fused", nil, { species = result.s, mut = result.m, fuse = result.f })
end

function Fuse.start(player: Player, species: unknown, level: unknown)
	local data = PlayerData.get(player)
	if not data or typeof(species) ~= "string" or typeof(level) ~= "number" then
		return
	end
	local s = species :: string
	local f = math.floor(level :: number)
	if not Slimes.BY_ID[s] or f < 0 or f >= Slimes.MAX_FUSE then
		return
	end
	if data.fusing then
		Economy.notify(player, "The Fuse Machine is still busy.", "bad")
		return
	end
	-- Zoek 3 passende slijmpjes; de beste mutaties tellen mee voor het resultaat.
	local found: { number } = {}
	for key, slime in data.lab do
		local pad = tonumber(key)
		if pad and slime.s == s and slime.f == f and not Economy.isInTransit(player, pad) then
			table.insert(found, pad)
		end
	end
	if #found < 3 then
		Economy.notify(player, "You need 3 of the same slime to fuse.", "bad")
		return
	end
	table.sort(found, function(a, b)
		return Slimes.mutationMult(data.lab[tostring(a)].m) > Slimes.mutationMult(data.lab[tostring(b)].m)
	end)
	local best: string? = nil
	for i = 1, 3 do
		local slime = Economy.removeSlime(player, found[i])
		if slime then
			best = Slimes.bestMutation(best, slime.m)
		end
	end
	local nextLevel = f + 1
	data.fusing = { s = s, m = best, f = nextLevel, readyAt = now() + Config.FUSE_SECONDS[nextLevel] }
	Economy.placeStorage(player)
	if data.skipTokens > 0 then
		data.skipTokens -= 1
		complete(player)
		return
	end
	Economy.notify(player, "Fusing into " .. Slimes.displayName({ s = s, m = best, f = nextLevel }) .. "...", "info")
end

-- Skip Fusion: maakt de huidige fusie meteen af, of bewaart een tegoed voor de volgende.
function Fuse.skip(player: Player)
	local data = PlayerData.get(player)
	if not data then
		return
	end
	if data.fusing then
		complete(player)
	else
		data.skipTokens += 1
		Economy.notify(player, "Your next fusion will finish instantly!", "good")
	end
end

function Fuse.init()
	Remotes.Action.OnServerEvent:Connect(function(player: Player, action: unknown, species: unknown, level: unknown)
		if action == "fuse" then
			Fuse.start(player, species, level)
		end
	end)
	task.spawn(function()
		while true do
			task.wait(1)
			local t = now()
			for player, data in PlayerData.all() do
				local fusing = data.fusing
				if fusing and t >= fusing.readyAt then
					local ok, err = pcall(function(): any
						complete(player)
						return nil
					end)
					if not ok then
						warn("[Fuse]", err)
					end
				end
			end
		end
	end)
end

return Fuse
