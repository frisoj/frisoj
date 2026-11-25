--[[
	Smaller services: CollectionService, HttpService, PolicyService, BadgeService, SocialService,
	AnalyticsService, LocalizationService, TextChatService, ContentProvider, ReplicatedFirst, GroupService,
	MessagingService, PhysicsService, TeleportService.

	Everything that would talk to Roblox is configurable under env.mocks.config and/or recorded:
	env.mocks.analytics, badgesAwarded, invites, teleports, systemMessages.
]]
return function(H)
	local sched = H.sched
	local config = H.config
	local mocks = H.mocks
	local roblox = H.roblox
	local Enum = roblox.Enum
	local Instances = H.instances

	local function requirePlayer(player: any, method: string)
		if not (H.isInstance(player) and player:IsA("Player")) then
			error(`{method}: Player expected, got {H.typeof(player)}`, 3)
		end
	end

	--------------------------------------------------------------------------------------------------------------
	-- CollectionService
	--------------------------------------------------------------------------------------------------------------
	local CollectionService = H.class("CollectionService")

	local function requireInstance(instance: any, method: string)
		if not H.isInstance(instance) then
			error(`CollectionService:{method}: Instance expected, got {H.typeof(instance)}`, 3)
		end
	end
	local function requireTag(tag: any, method: string)
		if type(tag) ~= "string" or tag == "" then
			error(`CollectionService:{method}: tag must be a non-empty string, got {H.typeof(tag)}`, 3)
		end
	end

	function CollectionService.methods.AddTag(_self: any, instance: any, tag: string)
		requireInstance(instance, "AddTag")
		requireTag(tag, "AddTag")
		Instances.addTag(instance, tag)
	end
	function CollectionService.methods.RemoveTag(_self: any, instance: any, tag: string)
		requireInstance(instance, "RemoveTag")
		requireTag(tag, "RemoveTag")
		Instances.removeTag(instance, tag)
	end
	function CollectionService.methods.HasTag(_self: any, instance: any, tag: string): boolean
		requireInstance(instance, "HasTag")
		return instance:HasTag(tag)
	end
	function CollectionService.methods.GetTags(_self: any, instance: any): { string }
		requireInstance(instance, "GetTags")
		return instance:GetTags()
	end
	function CollectionService.methods.GetTagged(_self: any, tag: string): { any }
		requireTag(tag, "GetTagged")
		return Instances.getTagged(tag)
	end
	function CollectionService.methods.GetInstanceAddedSignal(_self: any, tag: string): any
		requireTag(tag, "GetInstanceAddedSignal")
		return Instances.tagSignal("added", tag)
	end
	function CollectionService.methods.GetInstanceRemovedSignal(_self: any, tag: string): any
		requireTag(tag, "GetInstanceRemovedSignal")
		return Instances.tagSignal("removed", tag)
	end
	function CollectionService.methods.GetAllTags(_self: any): { string }
		local all = {}
		for tag, entry in H.tags.index do
			if #entry.list > 0 then
				table.insert(all, tag)
			end
		end
		table.sort(all)
		return all
	end

	--------------------------------------------------------------------------------------------------------------
	-- HttpService
	--------------------------------------------------------------------------------------------------------------
	local HttpService = H.class("HttpService")
	local guidRandom = H.newRandom(config.randomSeed + 99)
	config.httpHandler = nil -- function(request) -> response table; nil = "Http requests are not enabled"

	function HttpService.methods.GenerateGUID(_self: any, wrapInCurlyBraces: boolean?): string
		local template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
		local guid = string.gsub(template, "[xy]", function(character: string)
			local value = if character == "x" then guidRandom:NextInteger(0, 15) else guidRandom:NextInteger(8, 11)
			return string.format("%X", value)
		end)
		return if wrapInCurlyBraces == false then guid else "{" .. guid .. "}"
	end

	local function encodeString(value: string): string
		local escaped = string.gsub(value, '[%c"\\]', function(character: string)
			if character == '"' then
				return '\\"'
			elseif character == "\\" then
				return "\\\\"
			elseif character == "\n" then
				return "\\n"
			elseif character == "\r" then
				return "\\r"
			elseif character == "\t" then
				return "\\t"
			end
			return string.format("\\u%04x", string.byte(character))
		end)
		return '"' .. escaped .. '"'
	end

	local function encodeJson(value: any, seen: { [any]: boolean }): string
		local kind = type(value)
		if kind == "nil" then
			return "null"
		elseif kind == "boolean" then
			return tostring(value)
		elseif kind == "number" then
			if value ~= value or value == math.huge or value == -math.huge then
				return "null"
			elseif value % 1 == 0 and math.abs(value) < 1e15 then
				return string.format("%d", value)
			end
			return string.format("%.17g", value)
		elseif kind == "string" then
			return encodeString(value)
		elseif kind == "table" then
			if seen[value] then
				error("JSONEncode: tables cannot be cyclic", 0)
			end
			seen[value] = true
			local parts = {}
			local length = #value
			local result
			if length > 0 or next(value) == nil then
				for position = 1, length do
					parts[position] = encodeJson(value[position], seen)
				end
				result = "[" .. table.concat(parts, ",") .. "]"
			else
				local keys = {}
				for key in value do
					if type(key) == "string" or type(key) == "number" then
						table.insert(keys, key)
					end
				end
				table.sort(keys, function(a, b)
					return tostring(a) < tostring(b)
				end)
				for _, key in keys do
					table.insert(parts, encodeString(tostring(key)) .. ":" .. encodeJson(value[key], seen))
				end
				result = "{" .. table.concat(parts, ",") .. "}"
			end
			seen[value] = nil
			return result
		end
		return "null" -- Instances, functions, datatypes ...
	end

	function HttpService.methods.JSONEncode(_self: any, value: any): string
		return encodeJson(value, {})
	end

	function HttpService.methods.JSONDecode(_self: any, json: string): any
		if type(json) ~= "string" then
			error(`JSONDecode: string expected, got {H.typeof(json)}`, 2)
		end
		local ok, value = pcall(H.serde.decode, "json", json)
		if not ok then
			error("Can't parse JSON", 2)
		end
		return value
	end

	function HttpService.methods.UrlEncode(_self: any, input: string): string
		local encoded = string.gsub(input, "[^%w%-_%.~]", function(character: string)
			return string.format("%%%02X", string.byte(character))
		end)
		return encoded
	end

	local function httpRequest(request: any): any
		H.yield()
		if not config.httpHandler then
			error("Http requests are not enabled. Enable via game settings", 3)
		end
		return config.httpHandler(request)
	end
	function HttpService.methods.RequestAsync(_self: any, request: any): any
		if type(request) ~= "table" or type(request.Url) ~= "string" then
			error("RequestAsync expects a table with a Url", 2)
		end
		return httpRequest(request)
	end
	function HttpService.methods.GetAsync(_self: any, url: string, _nocache: boolean?, headers: any?): string
		local response = httpRequest({ Url = url, Method = "GET", Headers = headers })
		return if type(response) == "table" then response.Body else response
	end
	function HttpService.methods.PostAsync(_self: any, url: string, data: string, _contentType: any?, _compress: boolean?, headers: any?): string
		local response = httpRequest({ Url = url, Method = "POST", Body = data, Headers = headers })
		return if type(response) == "table" then response.Body else response
	end

	--------------------------------------------------------------------------------------------------------------
	-- PolicyService
	--------------------------------------------------------------------------------------------------------------
	config.policy = { -- returned by GetPolicyInfoForPlayerAsync for every player without an override
		AreAdsAllowed = true,
		ArePaidRandomItemsRestricted = false,
		AllowedExternalLinkReferences = {},
		IsPaidItemTradingAllowed = true,
		IsSubjectToChinaPolicies = false,
		IsContentSharingAllowed = true,
		IsEligibleToPurchaseSubscription = true,
		IsEligibleToPurchaseCommerceProduct = true,
	}
	config.policyByUserId = {} -- [userId] = fields that override config.policy for that user
	config.policyError = nil -- string: make GetPolicyInfoForPlayerAsync fail with this message

	local PolicyService = H.class("PolicyService")
	function PolicyService.methods.GetPolicyInfoForPlayerAsync(_self: any, player: any): any
		requirePlayer(player, "PolicyService:GetPolicyInfoForPlayerAsync")
		H.yield()
		if config.policyError then
			error(config.policyError, 2)
		end
		local info = table.clone(config.policy)
		info.AllowedExternalLinkReferences = table.clone(info.AllowedExternalLinkReferences)
		local override = config.policyByUserId[player.UserId]
		if override then
			for key, value in override do
				info[key] = value
			end
		end
		return info
	end

	--------------------------------------------------------------------------------------------------------------
	-- BadgeService
	--------------------------------------------------------------------------------------------------------------
	mocks.badgesAwarded = {} -- { { userId = number, badgeId = number } } in award order
	config.badgeError = nil -- string: make BadgeService calls fail with this message
	local ownedBadges: { [number]: { [number]: boolean } } = {}

	local BadgeService = H.class("BadgeService")
	local function badgeArguments(userId: any, badgeId: any, method: string)
		if type(userId) ~= "number" or type(badgeId) ~= "number" then
			error(`BadgeService:{method} expects (userId: number, badgeId: number)`, 3)
		end
		H.yield()
		if config.badgeError then
			error(config.badgeError, 3)
		end
	end
	function BadgeService.methods.AwardBadge(_self: any, userId: number, badgeId: number): boolean
		badgeArguments(userId, badgeId, "AwardBadge")
		ownedBadges[userId] = ownedBadges[userId] or {}
		if ownedBadges[userId][badgeId] then
			return false
		end
		ownedBadges[userId][badgeId] = true
		table.insert(mocks.badgesAwarded, { userId = userId, badgeId = badgeId })
		return true
	end
	BadgeService.methods.AwardBadgeAsync = BadgeService.methods.AwardBadge
	function BadgeService.methods.UserHasBadgeAsync(_self: any, userId: number, badgeId: number): boolean
		badgeArguments(userId, badgeId, "UserHasBadgeAsync")
		return ownedBadges[userId] ~= nil and ownedBadges[userId][badgeId] == true
	end
	function BadgeService.methods.GetBadgeInfoAsync(_self: any, badgeId: number): any
		badgeArguments(0, badgeId, "GetBadgeInfoAsync")
		return { Name = "Badge " .. badgeId, Description = "", IconImageId = 0, IsEnabled = true }
	end
	-- setBadgeOwned(playerOrUserId, badgeId, owned = true)
	function mocks.setBadgeOwned(target: any, badgeId: number, owned: boolean?)
		local userId = if type(target) == "number" then target else target.UserId
		ownedBadges[userId] = ownedBadges[userId] or {}
		ownedBadges[userId][badgeId] = owned ~= false or nil
	end

	--------------------------------------------------------------------------------------------------------------
	-- SocialService
	--------------------------------------------------------------------------------------------------------------
	mocks.invites = {} -- { { player = Player, options = ExperienceInviteOptions? } } game invite prompts shown
	config.canSendGameInvite = true

	local SocialService = H.class("SocialService")
	function SocialService.methods.CanSendGameInviteAsync(_self: any, player: any, _recipientId: number?): boolean
		requirePlayer(player, "SocialService:CanSendGameInviteAsync")
		H.yield()
		return config.canSendGameInvite == true
	end
	function SocialService.methods.PromptGameInvite(_self: any, player: any, options: any?)
		requirePlayer(player, "SocialService:PromptGameInvite")
		table.insert(mocks.invites, { player = player, options = options })
	end
	-- closeGameInvite(player, recipientIds?): the player closed the invite prompt (GameInvitePromptClosed)
	function mocks.closeGameInvite(player: any, recipientIds: { number }?)
		H.fire(Instances.getService("SocialService", true), "GameInvitePromptClosed", player, recipientIds or {})
		sched.flush()
	end

	--------------------------------------------------------------------------------------------------------------
	-- AnalyticsService: every call is recorded, nothing can fail
	--------------------------------------------------------------------------------------------------------------
	mocks.analytics = {} -- { { method = "LogEconomyEvent", args = { n = count, ... } } } in call order
	local AnalyticsService = H.class("AnalyticsService")
	AnalyticsService.anyMethod = function(name: string)
		return function(_self: any, ...)
			table.insert(mocks.analytics, { method = name, args = table.pack(...) })
		end
	end

	--------------------------------------------------------------------------------------------------------------
	-- LocalizationService
	--------------------------------------------------------------------------------------------------------------
	local LocalizationService = H.class("LocalizationService")
	LocalizationService.defaults.RobloxLocaleId = "en-us"
	LocalizationService.defaults.SystemLocaleId = "en-us"
	H.class("Translator").defaults.LocaleId = "en-us"
	local Translator = H.class("Translator")
	function Translator.methods.Translate(_self: any, _context: any, text: string): string
		return text
	end
	function Translator.methods.FormatByKey(_self: any, key: string, _args: any?): string
		return key
	end
	local function translator(_self: any, _target: any): any
		H.yield()
		return H.create("Translator")
	end
	LocalizationService.methods.GetTranslatorForPlayerAsync = translator
	LocalizationService.methods.GetTranslatorForLocaleAsync = translator
	function LocalizationService.methods.GetCountryRegionForPlayerAsync(_self: any, player: any): string
		requirePlayer(player, "LocalizationService:GetCountryRegionForPlayerAsync")
		H.yield()
		return "US"
	end

	--------------------------------------------------------------------------------------------------------------
	-- TextChatService
	--------------------------------------------------------------------------------------------------------------
	mocks.systemMessages = {} -- { { channel = TextChannel, text = string } } from TextChannel:DisplaySystemMessage
	local TextChatService = H.class("TextChatService")
	TextChatService.defaults.ChatTranslationEnabled = false
	TextChatService.defaults.ChatVersion = Enum.ChatVersion.TextChatService
	H.class("TextSource").defaults.CanSend = true

	local TextChannel = H.class("TextChannel")
	function TextChannel.methods.DisplaySystemMessage(self: any, text: string, _metadata: string?)
		if type(text) ~= "string" then
			error(`DisplaySystemMessage: string expected, got {H.typeof(text)}`, 2)
		end
		table.insert(mocks.systemMessages, { channel = self, text = text })
	end
	function TextChannel.methods.SendAsync(self: any, text: string, _metadata: string?)
		H.yield()
		local player = H.localPlayer
		if player then
			mocks.chat(player, text, self)
		end
	end
	function TextChannel.methods.AddUserAsync(self: any, userId: number): (any, any)
		H.yield()
		local source = H.create("TextSource")
		H.rawset(source, "UserId", userId)
		source.Name = tostring(userId)
		source.Parent = self
		return source, nil
	end
	function TextChatService.methods.CanUserChatAsync(_self: any, _userId: number): boolean
		H.yield()
		return true
	end
	function TextChatService.methods.CanUsersChatAsync(_self: any, _from: number, _to: number): boolean
		H.yield()
		return true
	end

	table.insert(H.bootHooks, function()
		local service = Instances.getService("TextChatService", true)
		local channels = H.create("Folder")
		channels.Name = "TextChannels"
		channels.Parent = service
		for _, name in { "RBXGeneral", "RBXSystem" } do
			local channel = H.create("TextChannel")
			channel.Name = name
			channel.Parent = channels
		end
		-- the configuration objects every place has under TextChatService
		for _, className in { "ChatWindowConfiguration", "ChatInputBarConfiguration", "BubbleChatConfiguration", "ChannelTabsConfiguration" } do
			H.create(className, { Parent = service })
		end
	end)

	-- chat(player, text, channel?) -> TextChatMessageProperties?: `player` sends a chat message. Runs the client's
	-- TextChatService.OnIncomingMessage callback (when assigned) and returns what it returned; also fires
	-- TextChatService.MessageReceived and TextChannel.MessageReceived, and the legacy Player.Chatted event.
	function mocks.chat(player: any, text: string, channel: any?): any
		requirePlayer(player, "env.mocks.chat")
		local service = Instances.getService("TextChatService", true)
		local target = channel or service.TextChannels.RBXGeneral
		local source = target:FindFirstChild(tostring(player.UserId))
		if not source then
			source = H.create("TextSource")
			H.rawset(source, "UserId", player.UserId)
			source.Name = tostring(player.UserId)
			source.Parent = target
		end
		local message = H.create("TextChatMessage")
		H.rawset(message, "Text", text)
		H.rawset(message, "PrefixText", player.DisplayName .. ":")
		H.rawset(message, "TextSource", source)
		H.rawset(message, "TextChannel", target)
		H.rawset(message, "Status", Enum.TextChatMessageStatus.Success)
		H.rawset(message, "MessageId", H.game:GetService("HttpService"):GenerateGUID(false))
		local properties = nil
		local callback = H.callback(service, "OnIncomingMessage")
		if callback then
			local ok, result = sched.runToCompletion(5, callback, message)
			if not ok then
				H.reportError(result, "TextChatService.OnIncomingMessage")
			else
				properties = result
			end
		end
		H.fireExisting(service, "MessageReceived", message)
		H.fireExisting(target, "MessageReceived", message)
		H.fireExisting(player, "Chatted", text)
		sched.flush()
		return properties
	end

	--------------------------------------------------------------------------------------------------------------
	-- ContentProvider, ReplicatedFirst, GroupService
	--------------------------------------------------------------------------------------------------------------
	local ContentProvider = H.class("ContentProvider")
	ContentProvider.defaults.RequestQueueSize = 0
	ContentProvider.defaults.BaseUrl = "https://www.roblox.com/"
	function ContentProvider.methods.PreloadAsync(_self: any, assets: { any }, callback: ((string, any) -> ())?)
		if type(assets) ~= "table" then
			error(`PreloadAsync: table expected, got {H.typeof(assets)}`, 2)
		end
		H.yield()
		if callback then
			for _, asset in assets do
				callback(tostring(asset), Enum.AssetFetchStatus.Success)
			end
		end
	end

	mocks.defaultLoadingScreenRemoved = false
	local ReplicatedFirst = H.class("ReplicatedFirst")
	function ReplicatedFirst.methods.RemoveDefaultLoadingScreen(_self: any)
		mocks.defaultLoadingScreenRemoved = true
	end
	function ReplicatedFirst.methods.IsFinishedReplicating(_self: any): boolean
		return true
	end

	local GroupService = H.class("GroupService")
	function GroupService.methods.GetGroupInfoAsync(_self: any, groupId: number): any
		H.yield()
		return { Id = groupId, Name = "Group " .. groupId, Description = "", EmblemUrl = "", Owner = { Id = 1, Name = "Owner" }, Roles = {} }
	end
	function GroupService.methods.GetGroupsAsync(_self: any, _userId: number): { any }
		H.yield()
		return {}
	end

	--------------------------------------------------------------------------------------------------------------
	-- MessagingService (loops back inside this one server)
	--------------------------------------------------------------------------------------------------------------
	local MessagingService = H.class("MessagingService")
	local topics: { [string]: any } = {}
	local function topicSignal(topic: string): any
		if not topics[topic] then
			topics[topic] = H.Signal.new("MessagingService topic " .. topic)
		end
		return topics[topic]
	end
	function MessagingService.methods.PublishAsync(_self: any, topic: string, message: any)
		if type(topic) ~= "string" then
			error(`PublishAsync: topic must be a string, got {H.typeof(topic)}`, 2)
		end
		H.yield()
		topicSignal(topic):_fire({ Data = message, Sent = sched.unixTime() })
	end
	function MessagingService.methods.SubscribeAsync(_self: any, topic: string, callback: (any) -> ()): any
		if type(topic) ~= "string" or type(callback) ~= "function" then
			error("SubscribeAsync expects (topic: string, callback: function)", 2)
		end
		H.yield()
		return topicSignal(topic):Connect(callback)
	end

	--------------------------------------------------------------------------------------------------------------
	-- PhysicsService collision groups
	--------------------------------------------------------------------------------------------------------------
	local PhysicsService = H.class("PhysicsService")
	local collisionGroups: { [string]: boolean } = { Default = true }
	local notCollidable: { [string]: boolean } = {}
	local function pairKey(a: string, b: string): string
		return if a < b then a .. "\0" .. b else b .. "\0" .. a
	end
	function PhysicsService.methods.RegisterCollisionGroup(_self: any, name: string)
		if type(name) ~= "string" or name == "" then
			error("RegisterCollisionGroup: name must be a non-empty string", 2)
		end
		collisionGroups[name] = true
	end
	function PhysicsService.methods.UnregisterCollisionGroup(_self: any, name: string)
		collisionGroups[name] = nil
	end
	function PhysicsService.methods.IsCollisionGroupRegistered(_self: any, name: string): boolean
		return collisionGroups[name] == true
	end
	function PhysicsService.methods.GetRegisteredCollisionGroups(_self: any): { any }
		local list = {}
		for name in collisionGroups do
			table.insert(list, { name = name, mask = 0 })
		end
		return list
	end
	function PhysicsService.methods.CollisionGroupSetCollidable(_self: any, a: string, b: string, collidable: boolean)
		if not collisionGroups[a] or not collisionGroups[b] then
			error("CollisionGroupSetCollidable: both collision groups must be registered first", 2)
		end
		notCollidable[pairKey(a, b)] = if collidable then nil else true
	end
	function PhysicsService.methods.CollisionGroupsAreCollidable(_self: any, a: string, b: string): boolean
		return not notCollidable[pairKey(a, b)]
	end

	--------------------------------------------------------------------------------------------------------------
	-- TeleportService: recorded, nobody goes anywhere
	--------------------------------------------------------------------------------------------------------------
	mocks.teleports = {} -- { { method = string, args = { n = count, ... } } }
	local TeleportService = H.class("TeleportService")
	for _, method in { "Teleport", "TeleportAsync", "TeleportToPlaceInstance", "TeleportToPrivateServer", "TeleportPartyAsync" } do
		TeleportService.methods[method] = function(_self: any, ...)
			table.insert(mocks.teleports, { method = method, args = table.pack(...) })
			return nil
		end
	end
	TeleportService.methods.GetLocalPlayerTeleportData = function()
		return nil
	end
	TeleportService.methods.GetArrivingTeleportGui = function()
		return nil
	end
	TeleportService.methods.SetTeleportGui = function() end
	TeleportService.methods.SetTeleportSetting = function() end
	TeleportService.methods.GetTeleportSetting = function()
		return nil
	end

	return nil
end
