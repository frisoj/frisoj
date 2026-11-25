--[[
	MarketplaceService: game pass ownership, purchase prompts, developer product receipts, product info.

	Nothing is ever really bought: prompts are recorded in env.mocks.prompts and the test decides what happens:
		env.mocks.setGamePassOwned(player, passId)               ownership seen by UserOwnsGamePassAsync
		env.mocks.completeGamePassPurchase(player, passId, true) fires PromptGamePassPurchaseFinished
		env.mocks.buyProduct(player, productId)                  builds a receipt and calls ProcessReceipt
		env.mocks.deliverReceipt(receipt)                        delivers a receipt again (idempotency tests)
	Receipts answered with anything but PurchaseGranted stay in env.mocks.pendingReceipts and are delivered again
	when that user (re)joins, like Roblox does.
]]
return function(H)
	local sched = H.sched
	local config = H.config
	local mocks = H.mocks
	local Enum = H.roblox.Enum
	local Instances = H.instances

	-- [Enum.InfoType name][id] = info table returned by GetProductInfo (see env.mocks.setProductInfo)
	config.productInfo = { Asset = {}, Product = {}, GamePass = {}, Subscription = {}, Bundle = {} }
	config.receiptRedeliveryDelay = 2 -- virtual seconds after a join before pending receipts are delivered again

	mocks.prompts = {} -- { { kind = "gamePass"|"product"|"premium"|"asset"|"bundle"|"subscription", player = Player, id = number? } }
	mocks.pendingReceipts = {} -- [PurchaseId] = receiptInfo not yet answered with PurchaseGranted
	mocks.receipts = {} -- every receipt ever created, in order

	local gamePassOwners: { [number]: { [number]: boolean } } = {} -- [userId][passId]
	local assetOwners: { [number]: { [number]: boolean } } = {}
	local purchaseCounter = 0

	local service: any = nil
	local function marketplace(): any
		if not service then
			service = Instances.getService("MarketplaceService", true)
		end
		return service
	end

	local function userIdOf(target: any, level: number): number
		if type(target) == "number" then
			return target
		elseif H.isInstance(target) and target:IsA("Player") then
			return target.UserId
		end
		error("expected a Player or a user id", level + 1)
	end

	local function requirePlayer(player: any, method: string)
		if not (H.isInstance(player) and player:IsA("Player")) then
			error(`MarketplaceService:{method}: player must be a Player, got {H.typeof(player)}`, 3)
		end
	end

	local function requireId(id: any, method: string)
		if type(id) ~= "number" or id % 1 ~= 0 then
			error(`MarketplaceService:{method}: id must be an integer, got {tostring(id)}`, 3)
		end
	end

	local Marketplace = H.class("MarketplaceService")

	function Marketplace.methods.UserOwnsGamePassAsync(_self: any, userId: number, gamePassId: number): boolean
		if type(userId) ~= "number" then
			error(`MarketplaceService:UserOwnsGamePassAsync: userId must be a number, got {H.typeof(userId)}`, 2)
		end
		requireId(gamePassId, "UserOwnsGamePassAsync")
		H.yield()
		local owned = gamePassOwners[userId]
		return owned ~= nil and owned[gamePassId] == true
	end

	local function playerOwnsAsset(_self: any, player: any, assetId: number): boolean
		requirePlayer(player, "PlayerOwnsAssetAsync")
		requireId(assetId, "PlayerOwnsAssetAsync")
		H.yield()
		local owned = assetOwners[player.UserId]
		return owned ~= nil and owned[assetId] == true
	end
	Marketplace.methods.PlayerOwnsAssetAsync = playerOwnsAsset
	Marketplace.methods.PlayerOwnsAsset = playerOwnsAsset

	local function getProductInfo(_self: any, id: number, infoType: any?): any
		requireId(id, "GetProductInfo")
		local kind = if infoType == nil then "Asset" else infoType.Name
		H.yield()
		local info = config.productInfo[kind] and config.productInfo[kind][id]
		if not info then
			error(`MarketplaceService:GetProductInfo() failed because HTTP 400 (Bad Request) [no {kind} info configured for id {id}]`, 2)
		end
		local copy = table.clone(info)
		if copy.ProductId == nil and kind == "Product" then
			copy.ProductId = id
		end
		copy.Name = copy.Name or (kind .. " " .. id)
		copy.Description = copy.Description or ""
		copy.PriceInRobux = copy.PriceInRobux or 0
		copy.IsForSale = if copy.IsForSale == nil then true else copy.IsForSale
		copy.ProductType = copy.ProductType or (if kind == "Product" then "Developer Product" elseif kind == "GamePass" then "Game Pass" else kind)
		return copy
	end
	Marketplace.methods.GetProductInfo = getProductInfo
	Marketplace.methods.GetProductInfoAsync = getProductInfo

	local function prompt(kind: string, player: any, id: number?)
		table.insert(mocks.prompts, { kind = kind, player = player, id = id, time = sched.now() })
	end

	function Marketplace.methods.PromptGamePassPurchase(_self: any, player: any, gamePassId: number)
		requirePlayer(player, "PromptGamePassPurchase")
		requireId(gamePassId, "PromptGamePassPurchase")
		prompt("gamePass", player, gamePassId)
	end

	function Marketplace.methods.PromptProductPurchase(_self: any, player: any, productId: number, _equipIfPurchased: boolean?, _currencyType: any?)
		requirePlayer(player, "PromptProductPurchase")
		requireId(productId, "PromptProductPurchase")
		prompt("product", player, productId)
	end

	function Marketplace.methods.PromptPurchase(_self: any, player: any, assetId: number, _equipIfPurchased: boolean?, _currencyType: any?)
		requirePlayer(player, "PromptPurchase")
		requireId(assetId, "PromptPurchase")
		prompt("asset", player, assetId)
	end

	function Marketplace.methods.PromptPremiumPurchase(_self: any, player: any)
		requirePlayer(player, "PromptPremiumPurchase")
		prompt("premium", player, nil)
	end

	function Marketplace.methods.PromptBundlePurchase(_self: any, player: any, bundleId: number)
		requirePlayer(player, "PromptBundlePurchase")
		prompt("bundle", player, bundleId)
	end

	function Marketplace.methods.PromptSubscriptionPurchase(_self: any, player: any, subscriptionId: string)
		requirePlayer(player, "PromptSubscriptionPurchase")
		table.insert(mocks.prompts, { kind = "subscription", player = player, id = subscriptionId, time = sched.now() })
	end

	--------------------------------------------------------------------------------------------------------------
	-- receipts
	--------------------------------------------------------------------------------------------------------------

	-- Calls the game's ProcessReceipt callback and returns its decision (nil when no callback is assigned or it
	-- failed). Steps virtual frames while the callback yields.
	local function deliver(receipt: any): any
		local callback = H.callback(marketplace(), "ProcessReceipt")
		if not callback then
			H.warn(`MarketplaceService.ProcessReceipt is not assigned; receipt {receipt.PurchaseId} stays pending`)
			return nil
		end
		local ok, decision = sched.runToCompletion(60, callback, table.clone(receipt))
		if not ok then
			H.reportError(decision, "MarketplaceService.ProcessReceipt")
			return nil
		end
		if decision == Enum.ProductPurchaseDecision.PurchaseGranted then
			mocks.pendingReceipts[receipt.PurchaseId] = nil
		elseif decision ~= Enum.ProductPurchaseDecision.NotProcessedYet then
			H.warn(`MarketplaceService.ProcessReceipt returned {tostring(decision)}; expected an Enum.ProductPurchaseDecision (treated as NotProcessedYet)`)
		end
		return decision
	end

	table.insert(H.playerAddedHooks, function(player: any)
		for _, receipt in mocks.pendingReceipts do
			if receipt.PlayerId == player.UserId then
				sched.delay(config.receiptRedeliveryDelay, function()
					if mocks.pendingReceipts[receipt.PurchaseId] and player.Parent ~= nil then
						deliver(receipt)
					end
				end)
			end
		end
	end)

	--------------------------------------------------------------------------------------------------------------
	-- test API
	--------------------------------------------------------------------------------------------------------------

	-- setGamePassOwned(playerOrUserId, passId, owned = true)
	function mocks.setGamePassOwned(target: any, gamePassId: number, owned: boolean?)
		local userId = userIdOf(target, 2)
		gamePassOwners[userId] = gamePassOwners[userId] or {}
		gamePassOwners[userId][gamePassId] = owned ~= false or nil
	end

	-- setAssetOwned(playerOrUserId, assetId, owned = true)
	function mocks.setAssetOwned(target: any, assetId: number, owned: boolean?)
		local userId = userIdOf(target, 2)
		assetOwners[userId] = assetOwners[userId] or {}
		assetOwners[userId][assetId] = owned ~= false or nil
	end

	-- setProductInfo(id, info, infoType = Enum.InfoType.Product): what GetProductInfo(id, infoType) returns,
	-- e.g. setProductInfo(123, { Name = "100 Gems", PriceInRobux = 79 }). info = nil makes the call fail again.
	function mocks.setProductInfo(id: number, info: { [string]: any }?, infoType: any?)
		local kind = if infoType == nil then "Product" else infoType.Name
		config.productInfo[kind] = config.productInfo[kind] or {}
		config.productInfo[kind][id] = info
	end

	-- completeGamePassPurchase(player, passId, purchased): the player answered a game pass prompt.
	-- purchased = true also marks the pass as owned. Fires PromptGamePassPurchaseFinished(player, passId, purchased).
	function mocks.completeGamePassPurchase(player: any, gamePassId: number, purchased: boolean)
		requirePlayer(player, "completeGamePassPurchase")
		if purchased then
			mocks.setGamePassOwned(player, gamePassId, true)
		end
		H.fire(marketplace(), "PromptGamePassPurchaseFinished", player, gamePassId, purchased == true)
		sched.flush()
	end

	-- completePremiumPurchase(player, purchased): fires PromptPremiumPurchaseFinished; purchased = true also turns
	-- the player's MembershipType into Premium (PlayerMembershipChanged).
	function mocks.completePremiumPurchase(player: any, purchased: boolean)
		requirePlayer(player, "completePremiumPurchase")
		H.fire(marketplace(), "PromptPremiumPurchaseFinished")
		if purchased then
			mocks.setMembership(player, Enum.MembershipType.Premium)
		end
		sched.flush()
	end

	-- cancelProductPurchase(player, productId): the player closed a product prompt without buying
	function mocks.cancelProductPurchase(player: any, productId: number)
		requirePlayer(player, "cancelProductPurchase")
		H.fire(marketplace(), "PromptProductPurchaseFinished", player.UserId, productId, false)
		sched.flush()
	end

	-- buyProduct(playerOrUserId, productId, options?) -> decision, receipt
	-- The player paid for a developer product: creates a receipt ({ PurchaseId (unique), PlayerId, ProductId,
	-- PlaceIdWherePurchased, CurrencySpent, CurrencyType, ProductPurchaseChannel }) and calls the game's
	-- MarketplaceService.ProcessReceipt with it. Returns what the callback returned (nil if it is missing or
	-- raised) and the receipt. options.price overrides CurrencySpent (default: configured PriceInRobux or 0).
	function mocks.buyProduct(target: any, productId: number, options: { [string]: any }?): (any, any)
		local userId = userIdOf(target, 2)
		requireId(productId, "buyProduct")
		purchaseCounter += 1
		local info = config.productInfo.Product[productId]
		local receipt = {
			PurchaseId = string.format("harness-purchase-%04d", purchaseCounter),
			PlayerId = userId,
			ProductId = productId,
			PlaceIdWherePurchased = config.placeId,
			CurrencySpent = (options and options.price) or (info and info.PriceInRobux) or 0,
			CurrencyType = Enum.CurrencyType.Robux,
			ProductPurchaseChannel = Enum.ProductPurchaseChannel.InExperience,
		}
		table.insert(mocks.receipts, receipt)
		mocks.pendingReceipts[receipt.PurchaseId] = receipt
		H.fire(marketplace(), "PromptProductPurchaseFinished", userId, productId, true)
		sched.flush()
		local decision = deliver(receipt)
		sched.flush()
		return decision, receipt
	end

	-- deliverReceipt(receipt) -> decision: calls ProcessReceipt again with an existing receipt
	function mocks.deliverReceipt(receipt: any): any
		if type(receipt) ~= "table" or type(receipt.PurchaseId) ~= "string" then
			error("env.mocks.deliverReceipt: expected a receipt returned by env.mocks.buyProduct", 2)
		end
		local decision = deliver(receipt)
		sched.flush()
		return decision
	end

	return nil
end
