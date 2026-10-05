--!strict
-- Developer Products (Feestmalen, Parelzak) en Game Passes.
-- De ID's staan in Shared/Config. Een ID van 0 wordt overgeslagen.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Format = require(Shared:WaitForChild("Format"))

local Server = script.Parent
local PlayerData = require(Server:WaitForChild("PlayerData"))
local Economy = require(Server:WaitForChild("Economy"))
local NestService = require(Server:WaitForChild("NestService"))

local Monetization = {}

local MAX_RECEIPTS = 50

local function startFeast(player: Player, kind: string)
	local feast = Config.FEASTS[kind]
	local now = Workspace:GetServerTimeNow()
	local endsAt = math.max(now, (tonumber(Workspace:GetAttribute("FeastEndsAt")) or 0)) + feast.minutes * 60
	local currentMult = if ((tonumber(Workspace:GetAttribute("FeastEndsAt")) or 0)) > now then ((tonumber(Workspace:GetAttribute("FeastMult")) or 1)) else 1
	Workspace:SetAttribute("FeastEndsAt", endsAt)
	Workspace:SetAttribute("FeastMult", math.max(currentMult, feast.mult))
	Workspace:SetAttribute("FeastBy", player.DisplayName)
	Economy.announce(string.format("%s gave the whale a %s! %dx Pearls for EVERYONE for %d minutes!",
		player.DisplayName, feast.label, feast.mult, feast.minutes), "feast")
end

-- Product-ID -> wat de speler krijgt.
local handlers: { [number]: (Player, PlayerData.Data) -> () } = {}

if Config.PRODUCTS.GoldenFeast ~= 0 then
	handlers[Config.PRODUCTS.GoldenFeast] = function(player)
		startFeast(player, "GoldenFeast")
	end
end
if Config.PRODUCTS.MegaFeast ~= 0 then
	handlers[Config.PRODUCTS.MegaFeast] = function(player)
		startFeast(player, "MegaFeast")
	end
end
if Config.PRODUCTS.PearlPack ~= 0 then
	handlers[Config.PRODUCTS.PearlPack] = function(player, data)
		local amount = math.max(Config.PEARL_PACK_MIN,
			Economy.baseRate(data) * Economy.permanentMultiplier(player, data) * Config.PEARL_PACK_MINUTES)
		Economy.grantPearls(player, amount)
		Economy.notify(player, string.format("+%s Pearls! Thanks for your support.", Format.number(amount)), "good")
	end
end

local function processReceipt(receipt: { [string]: any }): Enum.ProductPurchaseDecision
	local player = Players:GetPlayerByUserId(receipt.PlayerId)
	if player == nil then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	local data = PlayerData.get(player)
	if data == nil then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	local purchaseId = tostring(receipt.PurchaseId)
	if table.find(data.purchases, purchaseId) then
		return Enum.ProductPurchaseDecision.PurchaseGranted -- al eerder gegeven
	end
	local handler = handlers[receipt.ProductId]
	if handler == nil then
		warn("[Monetization] Onbekend product:", receipt.ProductId)
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	local ok, err = pcall(function(): any
		handler(player, data)
		return nil
	end)
	if not ok then
		warn("[Monetization] Fout bij product", receipt.ProductId, err)
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	table.insert(data.purchases, purchaseId)
	while #data.purchases > MAX_RECEIPTS do
		table.remove(data.purchases, 1)
	end
	-- Eerst opslaan, dan pas bevestigen. Lukt opslaan niet, dan probeert Roblox het later opnieuw.
	if not PlayerData.save(player) then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	return Enum.ProductPurchaseDecision.PurchaseGranted
end

local function owns(player: Player, passId: number): boolean
	if passId == 0 then
		return false
	end
	local ok, result = pcall(function()
		return MarketplaceService:UserOwnsGamePassAsync(player.UserId, passId)
	end)
	return ok and result == true
end

local function applyPass(player: Player, name: string)
	local passes = Economy.getPasses(player)
	if name == "DoublePearls" then
		passes.DoublePearls = true
	elseif name == "VIPCaptain" then
		passes.VIPCaptain = true
	elseif name == "Weatherman" then
		passes.Weatherman = true
	end
	Economy.refresh(player)
	Economy.sync(player)
	if name == "VIPCaptain" then
		NestService.render(player)
	end
end

function Monetization.loadPasses(player: Player)
	for name, id in Config.PASSES do
		if owns(player, id) then
			applyPass(player, name)
		end
	end
end

function Monetization.start()
	MarketplaceService.ProcessReceipt = processReceipt
	MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player: Player, passId: number, purchased: boolean)
		if not purchased then
			return
		end
		for name, id in Config.PASSES do
			if id == passId and id ~= 0 then
				applyPass(player, name)
				Economy.notify(player, "Thanks! Your pass is active.", "good")
			end
		end
	end)
end

return Monetization
