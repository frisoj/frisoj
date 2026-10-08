--!strict
-- Developer Products afhandelen. ProcessReceipt is idempotent: elk aankoop-ID wordt in de
-- save bewaard en pas na een gelukte save krijgt Roblox "PurchaseGranted". Zo krijgt
-- niemand iets dubbel of verliest iemand een aankoop als een server crasht.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local PolicyService = game:GetService("PolicyService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Format = require(Shared:WaitForChild("Format"))

local Server = script.Parent
local PlayerData = require(Server:WaitForChild("PlayerData"))
local Economy = require(Server:WaitForChild("Economy"))
local Labs = require(Server:WaitForChild("Labs"))
local Stream = require(Server:WaitForChild("Stream"))
local Weather = require(Server:WaitForChild("Weather"))
local Fuse = require(Server:WaitForChild("Fuse"))

local Monetization = {}

local MAX_RECEIPTS = 200

local handlers: { [string]: (Player) -> () } = {}

for name, pack in Config.GOO_PACKS do
	handlers[name] = function(player: Player)
		local amount = Economy.incomeWorth(player, pack.seconds, pack.min)
		Economy.give(player, amount)
		Economy.notify(player, "+" .. Format.number(amount) .. " Goo! Thank you!", "good")
	end
end

handlers.LuckyEgg = function(player: Player)
	Economy.openEgg(player, "LuckyEgg")
end
handlers.MegaEgg = function(player: Player)
	Economy.openEgg(player, "MegaEgg")
end
handlers.ServerLuck2 = function(player: Player)
	Stream.addLuck(2, Config.SERVER_LUCK_SECONDS, player)
end
handlers.ServerLuck5 = function(player: Player)
	Stream.addLuck(5, Config.SERVER_LUCK_SECONDS, player)
end
handlers.GoldRush = function(player: Player)
	Weather.request("Gold", player)
end
handlers.RainbowSurge = function(player: Player)
	Weather.request("Rainbow", player)
end
handlers.LabShield = function(player: Player)
	Labs.shield(player, Config.SHIELD_SECONDS)
	Economy.notify(player, "Your lab is shielded for 5 minutes!", "good")
end
handlers.SkipFusion = function(player: Player)
	Fuse.skip(player)
end

local function productName(id: number): string?
	for name, productId in Config.PRODUCTS do
		if productId == id and productId ~= 0 then
			return name
		end
	end
	return nil
end

local function processReceipt(receipt: { [string]: any }): Enum.ProductPurchaseDecision
	local player = Players:GetPlayerByUserId(receipt.PlayerId)
	local data = player and PlayerData.get(player)
	if not player or not data then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	local purchaseId = tostring(receipt.PurchaseId)
	if table.find(data.purchases, purchaseId) then
		return Enum.ProductPurchaseDecision.PurchaseGranted
	end
	local name = productName(receipt.ProductId)
	local handler = name and handlers[name]
	if not handler then
		warn("[Monetization] Onbekend product:", receipt.ProductId)
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	local ok, err = pcall(function(): any
		(handler :: (Player) -> ())(player)
		return nil
	end)
	if not ok then
		warn("[Monetization] Product mislukt:", name, err)
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	table.insert(data.purchases, purchaseId)
	while #data.purchases > MAX_RECEIPTS do
		table.remove(data.purchases, 1)
	end
	if not PlayerData.save(player) then
		-- Niet opgeslagen: Roblox probeert het later opnieuw; het ID staat al in de save in
		-- het geheugen, dus bij een nieuwe poging in deze server wordt het niet dubbel gegeven.
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	return Enum.ProductPurchaseDecision.PurchaseGranted
end

-- Mag deze speler willekeurige items (eieren) kopen? Volgens de PolicyService-regels.
function Monetization.checkPolicy(player: Player)
	task.spawn(function()
		local ok, policy = pcall(function()
			return PolicyService:GetPolicyInfoForPlayerAsync(player)
		end)
		local restricted = ok and type(policy) == "table" and policy.ArePaidRandomItemsRestricted == true
		player:SetAttribute("RandomItemsRestricted", restricted or not ok)
	end)
end

function Monetization.start()
	MarketplaceService.ProcessReceipt = processReceipt
end

return Monetization
