--[[
	Players service and Player objects.

	Tests create players with env.mocks.addPlayer({ userId, name, ... }); it builds the Player (PlayerGui,
	PlayerScripts, Backpack, StarterGear), fires PlayerAdded and - when Players.CharacterAutoLoads - spawns a
	character (CharacterAdded). env.mocks.removePlayer / player:Kick fire PlayerRemoving and remove the player.
	The client side has one local player: env.mocks.setLocalPlayer(player) (or addPlayer{ isLocal = true },
	or env.mocks.bootClient(player) which also runs the client scripts).

	Friends, groups and names are configurable: env.mocks.setFriends, setGroupRank, config.userNames.
]]
return function(H)
	local sched = H.sched
	local config = H.config
	local env = H.env
	local roblox = H.roblox
	local Enum = roblox.Enum
	local Vector3, CFrame, Ray = roblox.Vector3, roblox.CFrame, roblox.Ray
	local Instances = H.instances
	local mocks = H.mocks

	-- hooks(player?) called whenever the local player changes (Remotes delivers what that player was sent so far)
	H.localPlayerHooks = {}

	config.userNames = {} -- [userId] = name for Players:GetNameFromUserIdAsync (false = unknown user -> error)
	config.rigType = "R15" -- default avatar rig for spawned characters ("R15" or "R6")
	mocks.kicks = {} -- { { player = Player, userId = number, message = string? } } in kick order

	local friends: { [string]: boolean } = {} -- "low:high" user id pairs
	local groups: { [number]: { [number]: { rank: number, role: string } } } = {} -- [userId][groupId]
	local nextUserId = 1000

	local playersService: any = nil
	local function players(): any
		if not playersService then
			playersService = Instances.getService("Players", true)
		end
		return playersService
	end

	local function userIdOf(target: any): number
		if type(target) == "number" then
			return target
		elseif H.isInstance(target) and target:IsA("Player") then
			return target.UserId
		end
		error("expected a Player or a user id", 3)
	end

	local function friendKey(a: number, b: number): string
		return math.min(a, b) .. ":" .. math.max(a, b)
	end

	--------------------------------------------------------------------------------------------------------------
	-- Players service
	--------------------------------------------------------------------------------------------------------------
	local Players = H.class("Players")
	Players.defaults.MaxPlayers = 12
	Players.defaults.PreferredPlayers = 12
	Players.defaults.BubbleChat = false
	Players.defaults.ClassicChat = true

	Players.props.LocalPlayer = {
		get = function(self)
			if H.sideOf(self) == "client" then
				return H.localPlayer
			end
			return nil
		end,
	}

	function Players.methods.GetPlayers(self: any): { any }
		local list = {}
		for _, child in self:GetChildren() do
			if child.ClassName == "Player" then
				table.insert(list, child)
			end
		end
		return list
	end

	function Players.methods.GetPlayerByUserId(self: any, userId: number): any
		for _, player in Players.methods.GetPlayers(self) do
			if player.UserId == userId then
				return player
			end
		end
		return nil
	end

	function Players.methods.GetPlayerFromCharacter(self: any, character: any): any
		if character == nil then
			return nil
		end
		for _, player in Players.methods.GetPlayers(self) do
			if player.Character == character then
				return player
			end
		end
		return nil
	end

	function Players.methods.GetNameFromUserIdAsync(self: any, userId: number): string
		if type(userId) ~= "number" then
			error(`GetNameFromUserIdAsync: number expected, got {H.typeof(userId)}`, 2)
		end
		H.yield()
		local configured = config.userNames[userId]
		if configured == false or userId <= 0 then
			error("Players:GetNameFromUserIdAsync() failed: Unknown user", 2)
		elseif configured then
			return configured
		end
		local player = Players.methods.GetPlayerByUserId(self, userId)
		return if player then player.Name else "User" .. userId
	end

	function Players.methods.GetUserIdFromNameAsync(self: any, name: string): number
		H.yield()
		for _, player in Players.methods.GetPlayers(self) do
			if player.Name == name then
				return player.UserId
			end
		end
		for userId, configured in config.userNames do
			if configured == name then
				return userId
			end
		end
		error("Players:GetUserIdFromNameAsync() failed: Unknown user", 2)
	end

	function Players.methods.GetUserThumbnailAsync(_self: any, userId: number, thumbnailType: any, thumbnailSize: any): (string, boolean)
		if type(userId) ~= "number" or typeof(thumbnailType) ~= "EnumItem" or typeof(thumbnailSize) ~= "EnumItem" then
			error("GetUserThumbnailAsync expects (userId: number, Enum.ThumbnailType, Enum.ThumbnailSize)", 2)
		end
		H.yield()
		return `rbxthumb://type={thumbnailType.Name}&id={userId}&w=150&h=150`, true
	end

	local function humanoidDescription(_self: any, _userId: number): any
		H.yield()
		return H.create("HumanoidDescription")
	end
	Players.methods.GetHumanoidDescriptionFromUserId = humanoidDescription
	Players.methods.GetHumanoidDescriptionFromUserIdAsync = humanoidDescription

	--------------------------------------------------------------------------------------------------------------
	-- Player
	--------------------------------------------------------------------------------------------------------------
	local Player = H.class("Player")
	Player.defaults.AccountAge = 365
	Player.defaults.FollowUserId = 0
	Player.defaults.LocaleId = "en-us"
	Player.defaults.HasVerifiedBadge = false
	Player.defaults.HasRobloxSubscription = false
	Player.defaults.Neutral = true
	Player.defaults.AutoJumpEnabled = true
	Player.defaults.CanLoadCharacterAppearance = true
	Player.defaults.DevEnableMouseLock = true
	Player.defaults.CameraMaxZoomDistance = 128
	Player.defaults.CameraMinZoomDistance = 0.5
	Player.defaults.HealthDisplayDistance = 100
	Player.defaults.NameDisplayDistance = 100
	Player.defaults.GameplayPaused = false
	Player.defaults.PartyId = ""

	local function spawnCFrame(): any
		for _, descendant in H.workspace:GetDescendants() do
			if descendant:IsA("SpawnLocation") and descendant.Enabled then
				return descendant.CFrame * CFrame.new(0, descendant.Size.Y / 2 + 3, 0)
			end
		end
		return CFrame.new(0, 5, 0)
	end

	local function removeCharacter(player: any)
		local old = player.Character
		if old then
			H.fire(player, "CharacterRemoving", old)
			sched.flush()
			H.rawset(player, "Character", nil)
			old:Destroy()
		end
	end

	local function loadCharacter(player: any)
		if player.Parent == nil then
			return
		end
		removeCharacter(player)
		local state = H.state(player)
		local character = H.buildCharacter(player, state.rigType or config.rigType, spawnCFrame())
		local starterCharacterScripts = H.game:GetService("StarterPlayer"):FindFirstChild("StarterCharacterScripts")
		if starterCharacterScripts then
			for _, child in starterCharacterScripts:GetChildren() do
				local copy = child:Clone()
				if copy then
					copy.Parent = character
				end
			end
		end
		H.rawset(player, "Character", character)
		character.Parent = H.workspace
		H.fire(player, "CharacterAdded", character)
		H.fire(player, "CharacterAppearanceLoaded", character)
	end

	local function loadCharacterMethod(self: any)
		if not self:IsA("Player") then
			error("Expected ':' not '.' calling member function LoadCharacter", 2)
		end
		H.yield()
		loadCharacter(self)
	end
	Player.methods.LoadCharacter = loadCharacterMethod
	Player.methods.LoadCharacterAsync = loadCharacterMethod

	table.insert(H.humanoidDiedHooks, function(humanoid: any)
		local character = humanoid.Parent
		local service = players()
		local player = character and service:GetPlayerFromCharacter(character)
		if player and service.CharacterAutoLoads then
			sched.delay(service.RespawnTime, function()
				if player.Parent ~= nil and player.Character == character then
					loadCharacter(player)
				end
			end)
		end
	end)

	local function removePlayer(player: any)
		local state = H.state(player)
		if state.removed then
			return
		end
		state.removed = true
		H.fire(players(), "PlayerRemoving", player)
		sched.flush()
		removeCharacter(player)
		if H.localPlayer == player then
			H.localPlayer = nil
		end
		player.Parent = nil
		sched.flush()
		player:Destroy()
	end

	function Player.methods.Kick(self: any, message: string?)
		if message ~= nil and type(message) ~= "string" then
			error(`Kick: string expected, got {H.typeof(message)}`, 2)
		end
		if H.state(self).removed or H.state(self).kicked then
			return
		end
		H.state(self).kicked = true
		table.insert(mocks.kicks, { player = self, userId = self.UserId, message = message })
		-- the player leaves on the next resumption, like a real disconnect
		sched.deferCall(function()
			removePlayer(self)
		end, table.pack())
	end

	function Player.methods.GetMouse(self: any): any
		local state = H.state(self)
		if not state.mouse then
			state.mouse = H.create("PlayerMouse")
		end
		return state.mouse
	end

	local function isFriendsWith(self: any, userId: number): boolean
		if type(userId) ~= "number" then
			error(`IsFriendsWithAsync: number expected, got {H.typeof(userId)}`, 2)
		end
		H.yield()
		return friends[friendKey(self.UserId, userId)] == true
	end
	Player.methods.IsFriendsWithAsync = isFriendsWith
	Player.methods.IsFriendsWith = isFriendsWith

	local function membership(self: any, groupId: number): any
		if type(groupId) ~= "number" then
			error(`group id must be a number, got {H.typeof(groupId)}`, 3)
		end
		H.yield()
		local perUser = groups[self.UserId]
		return perUser and perUser[groupId]
	end
	local function isInGroup(self: any, groupId: number): boolean
		return membership(self, groupId) ~= nil
	end
	local function rankInGroup(self: any, groupId: number): number
		local entry = membership(self, groupId)
		return if entry then entry.rank else 0
	end
	local function roleInGroup(self: any, groupId: number): string
		local entry = membership(self, groupId)
		return if entry then entry.role else "Guest"
	end
	Player.methods.IsInGroupAsync = isInGroup
	Player.methods.IsInGroup = isInGroup
	Player.methods.GetRankInGroupAsync = rankInGroup
	Player.methods.GetRankInGroup = rankInGroup
	Player.methods.GetRoleInGroupAsync = roleInGroup
	Player.methods.GetRoleInGroup = roleInGroup

	local function friendsOnline(_self: any, _maxFriends: number?): { any }
		H.yield()
		return {}
	end
	Player.methods.GetFriendsOnlineAsync = friendsOnline
	Player.methods.GetFriendsOnline = friendsOnline

	function Player.methods.HasAppearanceLoaded(self: any): boolean
		return self.Character ~= nil
	end
	function Player.methods.GetJoinData(_self: any): any
		return { SourcePlaceId = nil, SourceGameId = nil, Members = {}, TeleportData = nil, LaunchData = "" }
	end
	function Player.methods.GetNetworkPing(_self: any): number
		return 0.05
	end
	function Player.methods.IsVerified(_self: any): boolean
		return false
	end
	function Player.methods.DistanceFromCharacter(self: any, point: any): number
		local character = self.Character
		local head = character and character:FindFirstChild("Head")
		return if head then (head.Position - point).Magnitude else 0
	end
	Player.methods.RequestStreamAroundAsync = function(_self: any, _position: any, _timeout: number?)
		H.yield()
	end
	Player.methods.Move = function() end
	Player.methods.ClearCharacterAppearance = function() end

	-- PlayerMouse: values are whatever the test last set with env.mocks.setMouse
	local mouseState = { X = 0, Y = 0, Target = nil :: any, Hit = CFrame.identity }
	local Mouse = H.class("Mouse")
	local function mouseProp(name: string, read: () -> any)
		Mouse.props[name] = { get = read }
	end
	mouseProp("X", function()
		return mouseState.X
	end)
	mouseProp("Y", function()
		return mouseState.Y
	end)
	mouseProp("Target", function()
		return mouseState.Target
	end)
	mouseProp("Hit", function()
		return mouseState.Hit
	end)
	mouseProp("Origin", function()
		local camera = H.workspace.CurrentCamera
		return if camera then camera.CFrame else CFrame.identity
	end)
	mouseProp("UnitRay", function()
		local camera = H.workspace.CurrentCamera
		if camera then
			return camera:ViewportPointToRay(mouseState.X, mouseState.Y)
		end
		return Ray.new(Vector3.zero, Vector3.new(0, 0, -1))
	end)
	mouseProp("ViewSizeX", function()
		return config.viewportSize.X
	end)
	mouseProp("ViewSizeY", function()
		return config.viewportSize.Y
	end)
	H.mouseState = mouseState

	--------------------------------------------------------------------------------------------------------------
	-- test API
	--------------------------------------------------------------------------------------------------------------

	local function setLocalPlayer(player: any?)
		H.localPlayer = player
		H.notify(players(), "LocalPlayer")
		for _, hook in H.localPlayerHooks do
			hook(player)
		end
	end

	-- setLocalPlayer(player): the client side's Players.LocalPlayer. Events the server already sent to this
	-- player are delivered to the client side now.
	function mocks.setLocalPlayer(player: any?)
		if player ~= nil and not (H.isInstance(player) and player:IsA("Player")) then
			error("env.mocks.setLocalPlayer: expected a Player or nil", 2)
		end
		setLocalPlayer(player)
		sched.flush()
	end

	--[[ addPlayer(options?) -> Player.  options (all optional):
		userId, name, displayName, membership (Enum.MembershipType), accountAge, locale,
		isLocal = true    make this player the client side's LocalPlayer before PlayerAdded fires
		character = false do not spawn a character even if Players.CharacterAutoLoads
		rigType = "R6"    avatar rig for this player's characters
	]]
	function mocks.addPlayer(options: { [string]: any }?): any
		local opts = options or {}
		local service = players()
		local userId = opts.userId
		if userId == nil then
			nextUserId += 1
			userId = nextUserId
		end
		if service:GetPlayerByUserId(userId) then
			error(`env.mocks.addPlayer: a player with userId {userId} is already in the server`, 2)
		end
		local name = opts.name or ("Player" .. userId)
		local player = H.create("Player")
		player.Name = name
		H.rawset(player, "UserId", userId)
		H.rawset(player, "DisplayName", opts.displayName or name)
		H.rawset(player, "MembershipType", opts.membership or Enum.MembershipType.None)
		if opts.accountAge then
			H.rawset(player, "AccountAge", opts.accountAge)
		end
		if opts.locale then
			H.rawset(player, "LocaleId", opts.locale)
		end
		H.rawset(player, "CharacterAppearanceId", userId)
		H.state(player).rigType = opts.rigType

		local game = H.game
		local playerGui = H.create("PlayerGui", { Parent = player })
		for _, child in game:GetService("StarterGui"):GetChildren() do
			local copy = child:Clone()
			if copy then
				copy.Parent = playerGui
			end
		end
		local playerScripts = H.create("PlayerScripts", { Parent = player })
		local starterPlayerScripts = game:GetService("StarterPlayer"):FindFirstChild("StarterPlayerScripts")
		if starterPlayerScripts then
			for _, child in starterPlayerScripts:GetChildren() do
				local copy = child:Clone()
				if copy then
					copy.Parent = playerScripts
				end
			end
		end
		local backpack = H.create("Backpack", { Parent = player })
		H.create("StarterGear", { Parent = player })
		for _, child in game:GetService("StarterPack"):GetChildren() do
			local copy = child:Clone()
			if copy then
				copy.Parent = backpack
			end
		end

		player.Parent = service
		if opts.isLocal then
			setLocalPlayer(player)
		end
		H.fire(service, "PlayerAdded", player)
		for _, hook in H.playerAddedHooks do
			hook(player)
		end
		if service.CharacterAutoLoads and opts.character ~= false then
			sched.deferCall(function()
				if player.Parent ~= nil and player.Character == nil then
					loadCharacter(player)
				end
			end, table.pack())
		end
		sched.flush()
		return player
	end

	-- hooks(player) called by addPlayer right after PlayerAdded fired (used by Marketplace to redeliver receipts)
	H.playerAddedHooks = {}

	-- removePlayer(player): the player leaves: PlayerRemoving fires, then the character and the Player are removed
	function mocks.removePlayer(player: any)
		if not (H.isInstance(player) and player:IsA("Player")) then
			error("env.mocks.removePlayer: expected a Player", 2)
		end
		removePlayer(player)
		sched.flush()
	end

	-- spawnCharacter(player) -> Model: (re)spawns the character like player:LoadCharacter()
	function mocks.spawnCharacter(player: any): any
		loadCharacter(player)
		sched.flush()
		return player.Character
	end

	-- setFriends(a, b, areFriends = true): a and b are Players or user ids
	function mocks.setFriends(a: any, b: any, areFriends: boolean?)
		friends[friendKey(userIdOf(a), userIdOf(b))] = areFriends ~= false or nil
	end

	-- setGroupRank(playerOrUserId, groupId, rank, roleName?): rank 0 / nil removes the membership
	function mocks.setGroupRank(target: any, groupId: number, rank: number?, role: string?)
		local userId = userIdOf(target)
		groups[userId] = groups[userId] or {}
		if rank and rank > 0 then
			groups[userId][groupId] = { rank = rank, role = role or "Member" }
		else
			groups[userId][groupId] = nil
		end
	end

	-- setMembership(player, Enum.MembershipType.X): changes MembershipType and fires PlayerMembershipChanged
	function mocks.setMembership(player: any, membershipType: any)
		H.rawset(player, "MembershipType", membershipType)
		H.fire(players(), "PlayerMembershipChanged", player)
		sched.flush()
	end

	-- setMouse({ X=, Y=, Target=, Hit= }): values returned by player:GetMouse()
	function mocks.setMouse(fields: { [string]: any })
		for key, value in fields do
			mouseState[key] = value
		end
	end

	-- bootClient(player) -> { thread }: makes `player` the LocalPlayer and runs the client scripts in the order
	-- Roblox does: ReplicatedFirst, then the copies of StarterPlayerScripts in PlayerScripts, then PlayerGui.
	function mocks.bootClient(player: any): { thread }
		if not (H.isInstance(player) and player:IsA("Player")) then
			error("env.mocks.bootClient: expected a Player", 2)
		end
		if H.localPlayer ~= player then
			setLocalPlayer(player)
		end
		local threads = {}
		local roots = { H.game:GetService("ReplicatedFirst"), player:FindFirstChildOfClass("PlayerScripts"), player:FindFirstChildOfClass("PlayerGui") }
		for position = 1, 3 do
			local root = roots[position]
			if root then
				for _, descendant in root:GetDescendants() do
					if descendant.ClassName == "LocalScript" and env.scripts[descendant] and descendant.Enabled then
						table.insert(threads, H.runScript(descendant, "client"))
					end
				end
			end
		end
		sched.flush()
		return threads
	end

	table.insert(H.bootHooks, function()
		-- every place has these two containers under StarterPlayer
		local starterPlayer = Instances.getService("StarterPlayer", true)
		for _, className in { "StarterPlayerScripts", "StarterCharacterScripts" } do
			if not starterPlayer:FindFirstChildOfClass(className) then
				H.create(className, { Parent = starterPlayer })
			end
		end
	end)

	-- scripts copied by Clone keep their source (StarterPlayerScripts -> PlayerScripts, StarterGui -> PlayerGui ...)
	H.onClone(function(original: any, clone: any)
		local info = env.scripts[original]
		if info then
			env.scripts[clone] = info
		end
	end)

	return nil
end
