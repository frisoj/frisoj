--!strict
-- Wie welke Game Pass heeft. Bij het joinen wordt alles opgevraagd (met herhaalpogingen),
-- en een pass die tijdens het spelen gekocht wordt, werkt meteen.

local MarketplaceService = game:GetService("MarketplaceService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Signal = require(script.Parent:WaitForChild("Signal"))

local Passes = {}

local owned: { [Player]: { [string]: boolean } } = {}

-- Vuurt (speler, passnaam) als een speler een pass krijgt.
Passes.changed = Signal.new() :: Signal.Signal<Player, string>

local function nameForId(id: number): string?
	for name, passId in Config.PASSES do
		if passId == id and passId ~= 0 then
			return name
		end
	end
	return nil
end

function Passes.has(player: Player, name: string): boolean
	local set = owned[player]
	return set ~= nil and set[name] == true
end

local function grant(player: Player, name: string)
	local set = owned[player]
	if not set or set[name] then
		return
	end
	set[name] = true
	player:SetAttribute("Pass_" .. name, true)
	if name == "VIP" then
		player:SetAttribute("VIP", true)
	end
	Passes.changed:Fire(player, name)
end

function Passes.load(player: Player)
	owned[player] = {}
	for name, id in Config.PASSES do
		if id ~= 0 then
			task.spawn(function()
				for attempt = 1, 4 do
					local ok, has = pcall(function()
						return MarketplaceService:UserOwnsGamePassAsync(player.UserId, id)
					end)
					if ok then
						if has then
							grant(player, name)
						end
						return
					end
					task.wait(attempt * 2)
				end
				warn("[Passes] Kon pass niet controleren:", name, player.Name)
			end)
		end
	end
end

function Passes.unload(player: Player)
	owned[player] = nil
end

function Passes.start()
	MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player: Player, id: number, purchased: boolean)
		if purchased then
			local name = nameForId(id)
			if name then
				grant(player, name)
			end
		end
	end)
end

return Passes
