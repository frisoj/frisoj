-- Headless smoke test of the client foundation (spec §8, §13.1, §14): ClientState, Sound, WindowManager (windows,
-- layers, scale, ShopStand prompts), every Kit builder, Notifications, FloatingText, ZoneTracker and ClientMain.
-- The spec runs on the server side of the harness and drives the client modules through env:requireAs("client").
-- Tests share one booted client and run in order.
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local SoundService = game:GetService("SoundService")
local UserInputService = game:GetService("UserInputService")

return function(t)
	local env = t.env
	local mocks = env.mocks

	local Shared = ReplicatedStorage:WaitForChild("Shared")
	local Client = ReplicatedStorage:WaitForChild("Client")
	local Config = require(Shared:WaitForChild("Config"))

	-- Everything the tests share (filled by the first test).
	local player
	local server
	local ClientState, Sound, WindowManager, Kit, Theme, Notifications, FloatingText, ZoneTracker, ClientEvents
	local earlyStand

	local function clientRequire(...: string)
		local instance = Client
		for _, name in { ... } do
			instance = instance:WaitForChild(name)
		end
		return env:requireAs("client", instance)
	end

	local function noErrors()
		t.equal(env.errors, {}, "errors were reported")
	end

	local function contains(text: string, part: string)
		if not string.find(text, part, 1, true) then
			t.fail(`expected "{text}" to contain "{part}"`)
		end
	end

	local function countWarnings(part: string): number
		local count = 0
		for _, warning in env.warnings do
			if string.find(tostring(warning), part, 1, true) then
				count += 1
			end
		end
		return count
	end

	local function soundsPlayed(soundId: string): number
		local count = 0
		for _, played in mocks.soundsPlayed do
			if played.soundId == soundId then
				count += 1
			end
		end
		return count
	end

	local function soundId(name: string): string
		return Config.Sounds.byId[name].id
	end

	local function makeState()
		return {
			version = 1,
			coins = 100,
			gems = 7,
			xp = 0,
			level = 1,
			rebirths = 0,
			stats = { totalCoins = 100, crystalsSmashed = 0 },
			hammers = { owned = { wood = true }, equipped = "wood" },
			zones = { unlocked = { meadow = true } },
			pets = { list = {}, nextId = 1 },
			petIndex = {},
			upgrades = {},
			boosts = { coins = 60 },
			quests = {
				day = 20454,
				list = {
					{ id = "smash50", progress = 3, goal = 50, claimed = false },
					{ id = "hatch3", progress = 0, goal = 3, claimed = false },
				},
			},
			achievements = {},
			daily = { lastClaimDay = 0, streak = 0 },
			playtime = { day = 20454, seconds = 0, claimed = {} },
			codes = {},
			purchases = { history = {}, oneTime = {} },
			grantedPasses = {},
			settings = { music = 0.5, sfx = 0.5, showOtherPets = true, lowDetail = false, autoSmash = false, damageNumbers = true },
			tutorial = { step = 1, done = false },
			groupRewardClaimed = false,
			firstJoin = 1,
			lastJoin = 1,
			joins = 1,
			session = {
				passes = {},
				boostEnds = {},
				stats = { damage = 5, coinMult = 1, xpMult = 1, damageMult = 1, luckMult = 1, swingCooldown = 0.5, range = 13 },
				friendCount = 0,
				premium = false,
				inGroup = false,
				randomItemsRestricted = false,
				serverLuck = 1,
			},
		}
	end

	local function newStand(windowId: string, label: string?): Part
		local stand = Instance.new("Part")
		stand.Name = "Stand_" .. windowId
		stand.Anchored = true
		stand:SetAttribute("Window", windowId)
		if label then
			stand:SetAttribute("Label", label)
		end
		stand.Parent = workspace
		CollectionService:AddTag(stand, "ShopStand")
		return stand
	end

	------------------------------------------------------------------------------------------------------------
	t.test("boot: remotes, local player, client core modules load without errors", function()
		-- The server side of the game, reduced to what the client foundation talks to.
		server = env:loadStringAs(
			"server",
			[[
			local ReplicatedStorage = game:GetService("ReplicatedStorage")
			local Net = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Net"))
			Net.setup()
			return {
				init = function(player, state)
					Net.fireClient(player, "StateInit", state)
				end,
				delta = function(player, changes)
					Net.fireClient(player, "StateDelta", changes)
				end,
				fire = function(player, name, ...)
					Net.fireClient(player, name, ...)
				end,
			}
		]],
			"ServerSnippet"
		)()

		player = mocks.addPlayer({ userId = 101, name = "Ada" })
		mocks.setLocalPlayer(player)
		-- A stand that exists before the client code loads must get its prompt too.
		earlyStand = newStand("TestA", "Browse")
		mocks.flush()

		ClientState = clientRequire("Core", "ClientState")
		Sound = clientRequire("Core", "Sound")
		Theme = clientRequire("UI", "Theme")
		Kit = clientRequire("UI", "Kit")
		WindowManager = clientRequire("Core", "WindowManager")
		Notifications = clientRequire("Core", "Notifications")
		FloatingText = clientRequire("Core", "FloatingText")
		ZoneTracker = clientRequire("Core", "ZoneTracker")
		ClientEvents = clientRequire("Core", "ClientEvents")
		mocks.flush()

		t.truthy(ClientEvents.MenuHighlight and ClientEvents.LocalSwing and ClientEvents.TargetChanged)
		t.truthy(ClientEvents.HatchOverlay)
		local gui = WindowManager.getScreenGui()
		t.equal(gui.Name, "HUD")
		t.equal(gui.ClassName, "ScreenGui")
		t.equal(gui.ResetOnSpawn, false)
		t.equal(gui.IgnoreGuiInset, true)
		t.equal(gui.ZIndexBehavior, Enum.ZIndexBehavior.Sibling)
		t.truthy(gui.Parent == player:FindFirstChildOfClass("PlayerGui"))
		for _, layer in
			{
				WindowManager.getHudLayer(),
				WindowManager.getWindowLayer(),
				WindowManager.getOverlayLayer(),
				WindowManager.getNotificationLayer(),
			}
		do
			t.equal(layer.ClassName, "Frame")
			t.truthy(layer.Parent == gui)
		end
		t.truthy(WindowManager.getHudLayer().ZIndex < WindowManager.getWindowLayer().ZIndex)
		t.truthy(WindowManager.getWindowLayer().ZIndex < WindowManager.getOverlayLayer().ZIndex)
		t.truthy(WindowManager.getOverlayLayer().ZIndex < WindowManager.getNotificationLayer().ZIndex)
		noErrors()
	end)

	------------------------------------------------------------------------------------------------------------
	t.test("ClientState: StateInit, ordered deltas, coalesced observers, waiters", function()
		t.equal(ClientState.isReady(), false)
		t.throws(function()
			ClientState.get()
		end)

		local woken = 0
		for _ = 1, 3 do
			task.spawn(function()
				ClientState.waitUntilReady()
				woken += 1
			end)
		end
		local coinCalls, lastCoins, lastState = 0, nil, nil
		local stopCoins = ClientState.observe("coins", function(value, state)
			coinCalls += 1
			lastCoins = value
			lastState = state
		end)
		t.equal(coinCalls, 0, "observers are not called before the state arrives")

		server.init(player, makeState())
		mocks.flush()
		t.equal(ClientState.isReady(), true)
		t.equal(woken, 3, "every waiter resumes")
		ClientState.waitUntilReady() -- returns immediately now
		local state = ClientState.get()
		t.equal(state.coins, 100)
		t.equal(state.session.stats.damage, 5)
		t.equal(coinCalls, 1)
		t.equal(lastCoins, 100)
		t.truthy(lastState == state)

		-- observe() on a ready state calls back immediately
		local gemCalls, lastGems = 0, nil
		ClientState.observe("gems", function(value)
			gemCalls += 1
			lastGems = value
		end)
		t.equal(gemCalls, 1)
		t.equal(lastGems, 7)

		-- several deltas in one frame: applied in order, one callback per top-level key
		local changedKeys = {}
		local changedConnection = ClientState.Changed:Connect(function(key)
			table.insert(changedKeys, key)
		end)
		local sessionCalls = 0
		ClientState.observe("session", function()
			sessionCalls += 1
		end)
		t.equal(sessionCalls, 1)
		server.delta(player, { { path = { "coins" }, value = 150 }, { path = { "coins" }, value = 175 } })
		server.delta(player, {
			{ path = { "coins" }, value = 200 },
			{ path = { "session", "passes", "vip" }, value = true },
			{ path = { "session", "stats", "damage" }, value = 12 },
			{ path = { "upgrades", "power" }, value = 3 }, -- "upgrades" was an empty table
			{ path = { "brandNew", "deep", "key" }, value = "created" }, -- intermediate tables are created
			{ path = { "boosts", "coins" } }, -- value nil deletes
			{ path = { "quests", "list", "1", "progress" }, value = 9 }, -- index sent as a string
			{ path = { "quests", "list", 2, "claimed" }, value = true }, -- index sent as a number
		})
		mocks.flush()
		t.equal(state.coins, 200, "the mirror is updated as soon as the delta arrives")
		t.equal(state.session.passes.vip, true)
		t.equal(state.session.stats.damage, 12)
		t.equal(state.upgrades.power, 3)
		t.equal(state.brandNew.deep.key, "created")
		t.equal(state.boosts.coins, nil)
		t.equal(state.quests.list[1].progress, 9)
		t.equal(state.quests.list[2].claimed, true)
		t.equal(#state.quests.list, 2)
		t.equal(coinCalls, 1, "observers wait for the frame")
		mocks.step()
		t.equal(coinCalls, 2, "three coin changes in one frame produce one callback")
		t.equal(lastCoins, 200)
		t.equal(sessionCalls, 2)
		table.sort(changedKeys)
		t.equal(changedKeys, { "boosts", "brandNew", "coins", "quests", "session", "upgrades" })
		changedConnection:Disconnect()
		mocks.step()
		t.equal(coinCalls, 2, "nothing fires without changes")

		-- a failing observer is reported and does not break the others
		local survivorCalls = 0
		ClientState.observe("level", function()
			error("observer exploded")
		end)
		ClientState.observe("level", function()
			survivorCalls += 1
		end)
		t.equal(survivorCalls, 1)
		server.delta(player, { { path = { "level" }, value = 2 } })
		mocks.flush()
		mocks.step()
		t.equal(survivorCalls, 2)
		t.truthy(countWarnings("observer exploded") >= 2)

		-- malformed deltas are ignored
		server.delta(player, { { path = {}, value = 1 }, { value = 2 }, "garbage", { path = { true }, value = 3 } })
		server.delta(player, "not a table")
		mocks.flush()
		mocks.step()

		-- disconnect
		stopCoins()
		stopCoins()
		server.delta(player, { { path = { "coins" }, value = 250 } })
		mocks.flush()
		mocks.step()
		t.equal(state.coins, 250)
		t.equal(coinCalls, 2, "a disconnected observer is not called")
		noErrors()
	end)

	------------------------------------------------------------------------------------------------------------
	t.test("Sound: plays Config sounds at the sfx volume, pools voices, ignores unknown names", function()
		table.clear(mocks.soundsPlayed)
		Sound.play("Click")
		t.equal(soundsPlayed(soundId("Click")), 1)
		local played = mocks.soundsPlayed[1].sound
		t.near(played.Volume, Config.Sounds.byId.Click.volume * 0.5, 1e-4, "volume follows settings.sfx")
		t.equal(played.Parent.Name, "SFX")
		t.truthy(played.Parent.Parent == SoundService)

		Sound.play("NoSuchSound")
		Sound.play("")
		Sound.play(nil)
		Sound.play("Click", 0 / 0)
		t.equal(#mocks.soundsPlayed, 1, "unknown names play nothing; an immediate repeat is rate limited")

		mocks.advance(0.1)
		Sound.play("Coin", 1.5)
		local coin = mocks.soundsPlayed[#mocks.soundsPlayed].sound
		t.near(coin.PlaybackSpeed, (Config.Sounds.byId.Coin.pitch or 1) * 1.5, 1e-4)

		for _ = 1, 12 do
			mocks.advance(0.05)
			Sound.play("Hit")
		end
		local voices = 0
		for _, child in SoundService:FindFirstChild("SFX"):GetChildren() do
			if child.Name == "Hit" then
				voices += 1
			end
		end
		t.truthy(voices >= 1 and voices <= 4, `expected a small pool of voices, got {voices}`)
		t.equal(soundsPlayed(soundId("Hit")), 12)

		-- muted
		server.delta(player, { { path = { "settings", "sfx" }, value = 0 } })
		mocks.flush()
		local before = #mocks.soundsPlayed
		mocks.advance(0.1)
		Sound.play("Click")
		t.equal(#mocks.soundsPlayed, before)
		t.equal(Sound.sfxVolume(), 0)
		t.near(Sound.musicVolume(), 0.5)
		server.delta(player, { { path = { "settings", "sfx" }, value = 1 } })
		mocks.flush()
		noErrors()
	end)

	------------------------------------------------------------------------------------------------------------
	local windowLog = {}
	local builds = { TestA = 0, TestB = 0 }

	local function backdrop()
		return WindowManager.getWindowLayer():FindFirstChild("Backdrop")
	end

	local function windowFrame(id: string)
		return WindowManager.getWindowLayer():FindFirstChild("Window_" .. id)
	end

	t.test("WindowManager: register, open with args, close (button, Escape, gamepad B, backdrop), switch", function()
		WindowManager.Opened:Connect(function(id)
			table.insert(windowLog, "opened:" .. id)
		end)
		WindowManager.Closed:Connect(function(id)
			table.insert(windowLog, "closed:" .. id)
		end)

		local handleA
		local openArgs = {}
		local closes = 0
		WindowManager.register({
			id = "TestB",
			title = "Second",
			icon = "🅱️",
			order = 2,
			showInMenu = false,
			size = Vector2.new(900, 600),
			build = function(content)
				builds.TestB += 1
				Kit.label({ text = "B", parent = content })
			end,
		})
		WindowManager.register({
			id = "TestA",
			title = "First",
			icon = "🅰️",
			order = 1,
			showInMenu = true,
			build = function(content, handle)
				builds.TestA += 1
				handleA = handle
				Kit.label({ text = "A", parent = content })
			end,
			onOpen = function(args)
				table.insert(openArgs, args or false)
			end,
			onClose = function()
				closes += 1
			end,
			badge = function()
				return 2
			end,
		})
		mocks.flush()
		local registered = WindowManager.getRegistered()
		t.equal(#registered, 2)
		t.equal(registered[1].id, "TestA")
		t.equal(registered[2].id, "TestB")
		t.equal(registered[1].badge(), 2)
		t.equal(builds.TestA, 0, "windows are built lazily")
		t.equal(WindowManager.isOpen(), false)

		-- duplicate registrations and bad definitions
		WindowManager.register({ id = "TestA", title = "Dup", icon = "", order = 9, showInMenu = false, build = function() end })
		t.equal(#WindowManager.getRegistered(), 2)
		t.throws(function()
			WindowManager.register({ id = "NoBuild", title = "x", icon = "", order = 1, showInMenu = false })
		end)

		table.clear(mocks.soundsPlayed)
		WindowManager.open("TestA", { tab = "gems" })
		mocks.flush()
		t.equal(builds.TestA, 1)
		t.equal(openArgs[1].tab, "gems")
		t.equal(WindowManager.isOpen(), true)
		t.equal(WindowManager.isOpen("TestA"), true)
		t.equal(WindowManager.isOpen("TestB"), false)
		t.equal(WindowManager.getOpenId(), "TestA")
		t.equal(windowLog, { "opened:TestA" })
		t.equal(soundsPlayed(soundId("Open")), 1)

		local frame = windowFrame("TestA")
		t.truthy(frame and frame.Visible)
		t.truthy(handleA.frame == frame)
		t.equal(handleA.id, "TestA")
		t.truthy(handleA.content:IsDescendantOf(frame))
		t.equal(frame.Size, UDim2.fromOffset(Theme.Size.Window.X, Theme.Size.Window.Y))
		t.equal(frame.Active, true, "the window sinks clicks so they do not reach the backdrop")
		local title = frame.TitleBar.Title
		contains(title.Text, "First")
		contains(title.Text, "🅰️")
		handleA.setTitle("Renamed")
		contains(title.Text, "Renamed")
		t.truthy(backdrop().Visible)
		mocks.advance(0.5)
		t.near(backdrop().BackgroundTransparency, Theme.BackdropTransparency, 1e-3)

		-- opening the open window again only calls onOpen
		WindowManager.open("TestA", { tab = "coins" })
		t.equal(builds.TestA, 1)
		t.equal(openArgs[2].tab, "coins")
		t.equal(windowLog, { "opened:TestA" })

		-- close with the red button
		mocks.click(frame.Close)
		t.equal(WindowManager.isOpen(), false)
		t.equal(closes, 1)
		t.equal(windowLog, { "opened:TestA", "closed:TestA" })
		t.equal(soundsPlayed(soundId("Close")), 1)
		mocks.advance(0.5)
		t.equal(frame.Visible, false)
		t.equal(backdrop().Visible, false)

		-- Escape, gamepad B, backdrop click and the handle all close; the window is not rebuilt
		WindowManager.open("TestA")
		mocks.input(Enum.KeyCode.Escape)
		t.equal(WindowManager.isOpen(), false)
		WindowManager.open("TestA")
		mocks.input(Enum.KeyCode.ButtonB)
		t.equal(WindowManager.isOpen(), false)
		WindowManager.open("TestA")
		mocks.input(Enum.KeyCode.E)
		t.equal(WindowManager.isOpen(), true, "other keys do nothing")
		mocks.click(backdrop())
		t.equal(WindowManager.isOpen(), false)
		WindowManager.open("TestA")
		handleA.close()
		t.equal(WindowManager.isOpen(), false)
		t.equal(builds.TestA, 1)
		t.equal(closes, 5)

		-- toggle
		WindowManager.toggle("TestA")
		t.equal(WindowManager.isOpen("TestA"), true)
		WindowManager.toggle("TestA")
		t.equal(WindowManager.isOpen(), false)

		-- one window at a time
		table.clear(windowLog)
		WindowManager.open("TestA")
		WindowManager.open("TestB")
		mocks.flush()
		t.equal(WindowManager.isOpen("TestB"), true)
		t.equal(WindowManager.isOpen("TestA"), false)
		t.equal(windowLog, { "opened:TestA", "closed:TestA", "opened:TestB" })
		t.equal(frame.Visible, false)
		t.truthy(windowFrame("TestB").Visible)
		t.equal(windowFrame("TestB").Size, UDim2.fromOffset(900, 600))
		t.truthy(backdrop().Visible)
		WindowManager.toggle("TestA")
		t.equal(WindowManager.isOpen("TestA"), true)
		WindowManager.close()
		WindowManager.close() -- closing twice is harmless
		mocks.advance(0.5)
		t.equal(windowFrame("TestB").Visible, false)

		-- unknown ids only warn
		WindowManager.open("Nope")
		t.equal(WindowManager.isOpen(), false)
		t.equal(countWarnings('unknown window "Nope"'), 1)
		noErrors()
	end)

	t.test("WindowManager: a window whose build throws shows an error toast and breaks nothing", function()
		local failed = {}
		WindowManager.Failed:Connect(function(id, title)
			table.insert(failed, id .. "/" .. title)
		end)
		local attempts = 0
		WindowManager.register({
			id = "Broken",
			title = "Broken Window",
			icon = "💥",
			order = 50,
			showInMenu = false,
			build = function()
				attempts += 1
				error("build exploded")
			end,
		})
		WindowManager.open("Broken")
		mocks.flush()
		t.equal(attempts, 1)
		t.equal(WindowManager.isOpen(), false)
		t.equal(failed, { "Broken/Broken Window" })
		t.equal(windowFrame("Broken"), nil, "the half-built window is removed")
		t.equal(backdrop().Visible, false)
		t.equal(countWarnings("build exploded"), 1)

		local toasts = WindowManager.getNotificationLayer().Toasts
		local found = false
		for _, toast in toasts:GetChildren() do
			if toast:IsA("Frame") and string.find(toast.Text.Text, "Could not open Broken Window", 1, true) then
				found = true
			end
		end
		t.truthy(found, "an error toast is shown")

		-- the manager still works, also when a broken window is requested while another one is open
		WindowManager.open("TestA")
		t.equal(WindowManager.isOpen("TestA"), true)
		WindowManager.open("Broken")
		t.equal(WindowManager.isOpen("TestA"), true, "the open window stays when the next one fails to build")
		WindowManager.close()

		-- onOpen / onClose errors are contained too
		WindowManager.register({
			id = "Grumpy",
			title = "Grumpy",
			icon = "😠",
			order = 51,
			showInMenu = false,
			build = function() end,
			onOpen = function()
				error("onOpen exploded")
			end,
			onClose = function()
				error("onClose exploded")
			end,
		})
		WindowManager.open("Grumpy")
		t.equal(WindowManager.isOpen("Grumpy"), true)
		WindowManager.close()
		t.equal(WindowManager.isOpen(), false)
		t.equal(countWarnings("onOpen exploded"), 1)
		t.equal(countWarnings("onClose exploded"), 1)
		mocks.advance(6)
		noErrors()
	end)

	t.test("WindowManager: UIScale follows the viewport; phones in landscape fit", function()
		local function layerScale(layer)
			return layer:FindFirstChildOfClass("UIScale").Scale
		end
		local function check(viewport: Vector2, expectedScale: number, compact: boolean)
			mocks.setViewportSize(viewport)
			mocks.flush()
			t.near(WindowManager.getScale(), expectedScale, 1e-3)
			t.equal(WindowManager.isCompact(), compact)
			for _, layer in { WindowManager.getHudLayer(), WindowManager.getOverlayLayer(), WindowManager.getNotificationLayer() } do
				t.near(layerScale(layer), expectedScale, 1e-3)
				-- the layer still covers the whole screen after scaling
				t.near(layer.Size.X.Scale * expectedScale, 1, 1e-3)
				t.near(layer.Size.Y.Scale * expectedScale, 1, 1e-3)
			end
			local design = WindowManager.getDesignSize()
			t.near(design.X * expectedScale, viewport.X, 0.5)
			t.near(design.Y * expectedScale, viewport.Y, 0.5)
			t.near(WindowManager.getTopInset() * expectedScale, 36, 0.5)
		end

		local scales = {}
		WindowManager.ScaleChanged:Connect(function(scale)
			table.insert(scales, scale)
		end)
		check(Vector2.new(1920, 1080), 1, false)
		check(Vector2.new(1280, 720), 2 / 3, false)
		check(Vector2.new(3840, 2160), 2, false)
		check(Vector2.new(1024, 768), 1024 / 1920, false) -- tablet: width is the limit
		check(Vector2.new(844, 390), 0.5, true) -- phone in landscape: clamped so touch targets stay usable
		t.truthy(Theme.Size.Touch * WindowManager.getScale() >= 44, "touch targets stay at least 44 px")
		mocks.flush()
		t.equal(#scales, 5)

		-- windows: design scale on big screens, nearly full-screen but always fitting on small ones
		local function windowBox(id: string): Vector2
			WindowManager.open(id)
			mocks.advance(0.5) -- let the pop tween finish
			local frame = windowFrame(id)
			local scale = frame:FindFirstChild("WindowScale").Scale
			return Vector2.new(frame.Size.X.Offset * scale, frame.Size.Y.Offset * scale)
		end
		for _, viewport in { Vector2.new(844, 390), Vector2.new(667, 375), Vector2.new(1024, 768), Vector2.new(1280, 720) } do
			mocks.setViewportSize(viewport)
			for _, id in { "TestA", "TestB" } do
				local box = windowBox(id)
				t.truthy(box.X <= viewport.X and box.Y <= viewport.Y, `window {id} must fit {viewport}`)
			end
		end
		mocks.setViewportSize(Vector2.new(844, 390))
		local phoneBox = windowBox("TestA")
		t.truthy(phoneBox.Y >= 390 * 0.85, "nearly full-screen on a phone")

		-- resizing while a window is open re-fits it immediately
		mocks.setViewportSize(Vector2.new(1920, 1080))
		mocks.flush()
		local pcScale = windowFrame("TestA"):FindFirstChild("WindowScale").Scale
		t.near(pcScale, 1, 1e-3)
		t.near(Theme.Size.Window.X * pcScale / 1920, 0.73, 0.02, "about 70% of the screen on PC")
		WindowManager.close()
		mocks.setViewportSize(Vector2.new(1280, 720))
		mocks.advance(0.5)
		noErrors()
	end)

	t.test("WindowManager: ShopStand parts get prompts that open their window", function()
		local function promptOf(stand)
			return stand:FindFirstChildOfClass("ProximityPrompt")
		end
		local early = promptOf(earlyStand)
		t.truthy(early, "a stand tagged before the client loaded has a prompt")
		t.equal(early.ActionText, "Browse")
		t.equal(early.ObjectText, "First", "the prompt shows the window title once it is registered")
		t.equal(early.KeyboardKeyCode, WindowManager.PromptKey)
		t.equal(early.GamepadKeyCode, WindowManager.PromptGamepadKey)
		t.truthy(early.KeyboardKeyCode ~= Enum.KeyCode.E, "E belongs to smashing")
		t.equal(early.HoldDuration, 0)

		mocks.triggerPrompt(early)
		t.equal(WindowManager.isOpen("TestA"), true)
		t.equal(early.Enabled, false, "stand prompts are off while a window is open")
		WindowManager.close()
		t.equal(early.Enabled, true)

		-- a stand added later, without a label
		local late = newStand("TestB")
		mocks.flush()
		local latePrompt = promptOf(late)
		t.truthy(latePrompt)
		t.equal(latePrompt.ActionText, "Open")
		t.equal(latePrompt.ObjectText, "Second")
		late:SetAttribute("Label", "Enter")
		late:SetAttribute("Window", "TestA")
		mocks.flush()
		t.equal(latePrompt.ActionText, "Enter")
		t.equal(latePrompt.ObjectText, "First")
		mocks.triggerPrompt(latePrompt)
		t.equal(WindowManager.isOpen("TestA"), true)
		WindowManager.close()

		-- a stand for a window that does not exist only warns when used
		local ghost = newStand("Ghost")
		mocks.flush()
		mocks.triggerPrompt(promptOf(ghost))
		t.equal(WindowManager.isOpen(), false)
		t.equal(countWarnings('unknown window "Ghost"'), 1)

		-- cleanup when the tag or the part goes away
		CollectionService:RemoveTag(late, "ShopStand")
		mocks.flush()
		t.equal(promptOf(late), nil)
		ghost:Destroy()
		mocks.flush()
		WindowManager.open("TestA")
		WindowManager.close()
		mocks.advance(0.5)
		noErrors()
	end)

	------------------------------------------------------------------------------------------------------------
	local ui = {}
	local clicks = {}

	local function count(name: string)
		clicks[name] = (clicks[name] or 0) + 1
	end

	local function demoModel(): Model
		local model = Instance.new("Model")
		local body = Instance.new("Part")
		body.Size = Vector3.new(2, 2, 3)
		body.CFrame = CFrame.new(0, 5, 0)
		body.Anchored = true
		body.Parent = model
		local head = Instance.new("Part")
		head.Size = Vector3.new(1, 1, 1)
		head.CFrame = CFrame.new(0, 6.5, -1)
		head.Anchored = true
		head.Parent = model
		model.PrimaryPart = body
		return model
	end

	-- A window that uses every Kit builder; the mock Instances validate every property that is set.
	local function buildDemo(content, handle)
		ui.handle = handle
		local pageSize = UDim2.new(1, 0, 1, -(Theme.Size.TabBar + Theme.Size.Gap))
		local pagePosition = UDim2.fromOffset(0, Theme.Size.TabBar + Theme.Size.Gap)

		-- pages + tabs
		ui.gridPage = Kit.scrollGrid({ columns = 4, cellHeight = 300, size = pageSize, position = pagePosition, parent = content })
		ui.listPage = Kit.scrollList({ gap = 10, size = pageSize, position = pagePosition, parent = content })
		ui.controlsPage = Kit.frame({ size = pageSize, position = pagePosition, name = "Controls", parent = content })
		ui.tabs = Kit.tabs({
			tabs = {
				{ id = "grid", text = "Cards", icon = "🃏", page = ui.gridPage },
				{ id = "list", text = "List", icon = "📜", page = ui.listPage },
				{ id = "controls", text = "Controls", page = ui.controlsPage },
			},
			onSelect = function(id)
				ui.selectedTab = id
			end,
			parent = content,
		})

		-- card grid
		ui.cards = {}
		for index, rarity in { "Common", "Rare", "Legendary", "Exclusive" } do
			local card = Kit.card({
				rarity = rarity,
				layoutOrder = index,
				parent = ui.gridPage,
				onClick = function()
					count("card" .. index)
				end,
			})
			ui.cards[index] = card
			Kit.icon({ icon = "👑", size = UDim2.fromOffset(80, 80), anchor = Vector2.new(0.5, 0), position = UDim2.fromScale(0.5, 0), parent = card.instance })
			Kit.label({ text = rarity, style = "heading", color = Kit.rarityColor(rarity), size = UDim2.new(1, 0, 0, 36), position = UDim2.fromOffset(0, 136), parent = card.instance })
			Kit.label({ text = "Double all coins, forever", color = Theme.Color.TextMuted, size = UDim2.new(1, 0, 0, 48), position = UDim2.fromOffset(0, 174), parent = card.instance })
			Kit.button({
				text = Kit.priceText("robux", 1999),
				style = "robux",
				size = UDim2.new(1, 0, 0, 56),
				anchor = Vector2.new(0, 1),
				position = UDim2.fromScale(0, 1),
				name = "Buy",
				parent = card.instance,
				onClick = function()
					count("buy" .. index)
				end,
			})
		end
		ui.ribbon = Kit.ribbon({ parent = ui.cards[4].instance })
		ui.flatRibbon = Kit.ribbon({ text = "NEW", flat = true, parent = ui.cards[1].instance })
		ui.viewport = Kit.viewport(demoModel(), { size = UDim2.new(1, 0, 0, 120), spin = true, parent = ui.cards[2].instance })
		ui.staticViewport = Kit.viewport(nil, { size = UDim2.fromOffset(64, 64), yaw = 90, pitch = 0, zoom = 1.5, parent = ui.cards[3].instance })
		ui.squareGrid = Kit.scrollGrid({ columns = 6, cellAspect = 1, gap = 8, size = UDim2.fromOffset(300, 100), visible = false, parent = content })
		ui.fixedGrid = Kit.scrollGrid({ cellSize = UDim2.fromOffset(140, 140), size = UDim2.fromOffset(300, 100), visible = false, parent = content })

		-- list page
		ui.empty = Kit.emptyState({
			icon = "🐾",
			text = "No pets yet",
			hint = "Hatch an egg to get your first pet!",
			actionText = "Find an egg",
			onAction = function()
				count("emptyAction")
			end,
			size = UDim2.new(1, 0, 0, 280),
			layoutOrder = 1,
			parent = ui.listPage,
		})
		Kit.divider({ layoutOrder = 2, parent = ui.listPage })
		ui.footer = Kit.panel({ inset = true, size = UDim2.new(1, 0, 0, 56), padding = 10, layoutOrder = 3, parent = ui.listPage })
		local footerRow = Kit.row({ gap = 12, alignX = "center", parent = ui.footer })
		Kit.label({ text = "Premium members get <b>+10% Coins</b>", rich = true, size = UDim2.fromOffset(420, 36), layoutOrder = 1, parent = footerRow })
		Kit.divider({ vertical = true, size = UDim2.new(0, 3, 0.6, 0), layoutOrder = 2, parent = footerRow })
		ui.coinTag = Kit.priceTag({ currency = "coins", amount = 1500, size = UDim2.fromOffset(160, 36), layoutOrder = 3, parent = footerRow })
		ui.gemTag = Kit.priceTag({ currency = "gems", amount = 340, size = UDim2.fromOffset(160, 36), layoutOrder = 4, parent = footerRow })
		ui.robuxTag = Kit.priceTag({ currency = "robux", amount = 1999, size = UDim2.fromOffset(160, 36), layoutOrder = 5, parent = footerRow })

		-- controls page
		local column = Kit.column({ gap = 12, alignX = "left", parent = ui.controlsPage })
		ui.raised = Kit.panel({ size = UDim2.new(1, 0, 0, 90), corner = Theme.Corner.Pill, stroke = Theme.Stroke.Medium, strokeColor = Theme.Color.Gems, gradient = Theme.Gradient.Card, layoutOrder = 1, parent = column })
		Kit.titleBar({ text = "🎁 Title", height = 60, textSize = 30, corner = Theme.Corner.Panel, parent = ui.raised })
		ui.button = Kit.button({
			text = "Buy",
			icon = "🛒",
			style = "success",
			layoutOrder = 2,
			parent = column,
			onClick = function()
				count("button")
			end,
		})
		ui.holdButton = Kit.button({
			text = "+1",
			style = "gold",
			holdRepeat = true,
			size = UDim2.fromOffset(Theme.Size.ButtonSmall.X, Theme.Size.ButtonSmall.Y),
			layoutOrder = 3,
			parent = column,
			onClick = function()
				count("hold")
			end,
		})
		for order, style in { "primary", "danger", "neutral", "tab" } do
			Kit.button({ text = style, style = style, sound = "", textSize = 20, corner = Theme.Corner.Pill, layoutOrder = 3, name = "Style" .. order, parent = column })
		end
		ui.toggle = Kit.toggle({
			value = false,
			layoutOrder = 4,
			parent = column,
			onChange = function(value)
				ui.toggled = value
				count("toggle")
			end,
		})
		ui.slider = Kit.slider({
			value = 0.5,
			size = UDim2.fromOffset(400, 48),
			layoutOrder = 5,
			parent = column,
			onChange = function(value)
				ui.slid = value
				count("slide")
			end,
			onRelease = function(value)
				ui.released = value
				count("release")
			end,
		})
		ui.stepSlider = Kit.slider({ min = 0, max = 10, step = 1, value = 3.4, gradient = Theme.Gradient.Gold, layoutOrder = 6, parent = column })
		ui.input = Kit.textInput({
			placeholder = "Enter code",
			upper = true,
			maxLength = 8,
			alignX = "center",
			size = UDim2.fromOffset(400, 60),
			layoutOrder = 7,
			parent = column,
			onChange = function(text)
				ui.typed = text
			end,
			onSubmit = function(text)
				ui.submitted = text
			end,
		})
		ui.bar = Kit.progressBar({ fraction = 0.4, text = "4 / 10", size = UDim2.fromOffset(400, 36), layoutOrder = 8, parent = column })
		ui.blueBar = Kit.progressBar({ gradient = Theme.Gradient.Blue, corner = Theme.Corner.Small, textSize = 16, layoutOrder = 9, parent = column })
		ui.badge = Kit.badge({ parent = ui.button.instance, count = 0 })

		-- building blocks
		ui.raw = Kit.create("TextButton", {
			Name = "Raw",
			Text = "Raw",
			Size = UDim2.fromOffset(120, 44),
			LayoutOrder = 10,
			Parent = column,
			Activated = function()
				count("raw")
			end,
		}, { Kit.create("UICorner", { CornerRadius = UDim.new(0, 8) }) })
		Kit.feedback(ui.raw)
		ui.rawInner = Kit.frame({ color = Theme.Color.Inset, transparency = 0.2, corner = Theme.Corner.Small, clips = true, size = UDim2.fromOffset(40, 40), anchor = Vector2.new(0.5, 0.5), position = UDim2.fromScale(0.5, 0.5), parent = ui.raw })
		ui.raw2 = Kit.create("TextButton", { Name = "Raw2", Text = "", Size = UDim2.fromOffset(60, 44), LayoutOrder = 11, Parent = column })
		Kit.feedback(ui.raw2, { target = ui.raw2, sound = "Equip", hoverScale = 1.1, pressScale = 0.9 })
		ui.decorated = Kit.frame({ size = UDim2.fromOffset(200, 60), color = Theme.Color.White, layoutOrder = 12, parent = column })
		Kit.corner(ui.decorated)
		Kit.corner(Kit.frame({ parent = ui.decorated }), Theme.Corner.Pill)
		ui.stroke = Kit.stroke(ui.decorated, Theme.Stroke.Medium)
		ui.rainbowGradient = Kit.gradient(ui.decorated, Theme.rarityGradient("Epic"), 0)
		Kit.padding(ui.decorated, 4, 8)
		Kit.gridLayout(ui.decorated, { cellSize = UDim2.fromOffset(20, 20), gap = 2, alignX = "center", alignY = "center", maxPerLine = 3 })
		local wrapped = Kit.frame({ size = UDim2.fromOffset(200, 60), layoutOrder = 13, parent = column })
		Kit.listLayout(wrapped, { horizontal = true, wraps = true, gap = 4, alignX = "right", alignY = "bottom" })
		Kit.listLayout(Kit.frame({ parent = wrapped }))
		ui.outlined = Kit.label({ text = "Outlined", style = "number", stroke = false, scaled = false, wrap = false, alignX = "left", alignY = "top", font = Enum.Font.GothamBold, textSize = 18, autoSize = Enum.AutomaticSize.X, layoutOrder = 14, parent = column })
		Kit.textStroke(ui.outlined, 2, Theme.Color.Coins)
		for _, style in { "title", "heading", "button", "number", "body", "small" } do
			Kit.label({ text = style, style = style, visible = false, zIndex = 2, parent = column })
		end
	end

	t.test("Kit: a window built with every builder; buttons, toggles, sliders, tabs and inputs respond", function()
		WindowManager.register({ id = "KitDemo", title = "Kit Demo", icon = "🧰", order = 3, showInMenu = true, build = buildDemo })
		WindowManager.open("KitDemo")
		mocks.advance(0.5)
		t.equal(WindowManager.isOpen("KitDemo"), true, "the demo window builds (a failure is reported as a warning)")
		t.equal(countWarnings("KitDemo"), 0)

		-- tabs + pages
		t.equal(ui.tabs:getSelected(), "grid")
		t.equal(ui.gridPage.Visible, true)
		t.equal(ui.listPage.Visible, false)
		t.equal(ui.controlsPage.Visible, false)
		mocks.click(ui.tabs:getButton("list").instance)
		t.equal(ui.tabs:getSelected(), "list")
		t.equal(ui.selectedTab, "list")
		t.equal(ui.gridPage.Visible, false)
		t.equal(ui.listPage.Visible, true)
		ui.tabs:select("controls")
		t.equal(ui.selectedTab, "controls")
		t.equal(ui.controlsPage.Visible, true)
		ui.tabs:select("nope")
		t.equal(ui.tabs:getSelected(), "controls")
		ui.tabs:setBadge("list", 4)
		local tabBadge = ui.tabs:getButton("list").instance:FindFirstChild("Badge")
		t.truthy(tabBadge and tabBadge.Visible)
		ui.tabs:setTabVisible("list", false)
		t.equal(ui.tabs:getButton("list").instance.Visible, false)
		ui.tabs:setTabVisible("list", true)
		t.equal(ui.tabs.instance.Size, UDim2.new(1, 0, 0, Theme.Size.TabBar))

		-- button
		local button = ui.button
		t.equal(button.instance.ClassName, "TextButton")
		contains(button.label.Text, "Buy")
		contains(button.label.Text, "🛒")
		t.equal(button.label.Font, Theme.Font.Button)
		t.equal(button.label.TextScaled, true)
		t.truthy(button.label:FindFirstChildOfClass("UITextSizeConstraint"))
		t.truthy(button.body:FindFirstChildOfClass("UIStroke").Thickness >= 3, "thick outline")
		t.equal(button.body:FindFirstChildOfClass("UIGradient").Color, Theme.buttonGradient("success"))
		table.clear(mocks.soundsPlayed)
		mocks.hover(button.instance)
		mocks.click(button.instance)
		mocks.hover(button.instance, false)
		t.equal(clicks.button, 1)
		t.equal(soundsPlayed(soundId("Click")), 1, "buttons play the click sound")
		button:setText("Sold")
		button:setIcon(nil)
		t.equal(button.label.Text, "Sold")
		button:setStyle("danger")
		t.equal(button.body:FindFirstChildOfClass("UIGradient").Color, Theme.buttonGradient("danger"))
		button:setEnabled(false)
		t.equal(button:isEnabled(), false)
		t.equal(button.body:FindFirstChildOfClass("UIGradient").Color, Theme.buttonGradient("neutral"))
		t.throws(function()
			mocks.click(button.instance)
		end, "a disabled button cannot be clicked")
		mocks.click(button.instance, { force = true })
		t.equal(clicks.button, 1, "and ignores a click that arrives anyway")
		button:setEnabled(true)
		t.equal(button.body:FindFirstChildOfClass("UIGradient").Color, Theme.buttonGradient("danger"))
		button:setOnClick(function()
			count("replaced")
		end)
		mocks.advance(0.2)
		mocks.click(button.instance)
		t.equal(clicks.replaced, 1)
		t.equal(clicks.button, 1)
		button:pulse(true)
		mocks.advance(0.5)
		t.truthy(button.body:FindFirstChild("KitScale").Scale ~= 1, "pulsing")
		button:pulse(false)
		mocks.advance(0.5)
		t.near(button.body:FindFirstChild("KitScale").Scale, 1, 1e-3)

		-- badge
		t.equal(ui.badge.instance.Visible, false)
		ui.badge:set(3)
		t.equal(ui.badge.instance.Visible, true)
		t.equal(ui.badge:get(), 3)
		t.equal(ui.badge.instance:FindFirstChildOfClass("TextLabel").Text, "3")
		ui.badge:set(250)
		t.equal(ui.badge.instance:FindFirstChildOfClass("TextLabel").Text, "99+")
		ui.badge:set(0)
		t.equal(ui.badge.instance.Visible, false)

		-- hold to repeat: a short click fires once, holding repeats until release
		mocks.click(ui.holdButton.instance)
		t.equal(clicks.hold, 1)
		local press = mocks.inputBegan(Enum.UserInputType.MouseButton1, { position = Vector2.new(50, 50) })
		mocks.fire(ui.holdButton.instance, "InputBegan", press)
		mocks.advance(0.2)
		t.equal(clicks.hold, 1, "nothing repeats before the hold delay")
		mocks.advance(1)
		local held = clicks.hold
		t.truthy(held >= 4, `holding repeats the click (got {held})`)
		mocks.inputEnded(Enum.UserInputType.MouseButton1)
		mocks.click(ui.holdButton.instance) -- the release that ends the hold is not one more click
		t.equal(clicks.hold, held)
		mocks.advance(1)
		t.equal(clicks.hold, held, "released: no more clicks")
		mocks.click(ui.holdButton.instance)
		t.equal(clicks.hold, held + 1)

		-- toggle
		t.equal(ui.toggle:get(), false)
		mocks.click(ui.toggle.instance)
		t.equal(ui.toggle:get(), true)
		t.equal(ui.toggled, true)
		ui.toggle:set(false)
		t.equal(ui.toggle:get(), false)
		t.equal(clicks.toggle, 1, "setting from code does not call onChange")
		ui.toggle:setEnabled(false)
		t.throws(function()
			mocks.click(ui.toggle.instance)
		end)
		ui.toggle:setEnabled(true)

		-- slider: drag with the mouse
		local slider = ui.slider
		t.near(slider:get(), 0.5)
		local track = slider.instance.Track
		local hit = slider.instance.Hit
		local function at(fraction: number): Vector2
			return Vector2.new(track.AbsolutePosition.X + track.AbsoluteSize.X * fraction, track.AbsolutePosition.Y)
		end
		t.truthy(track.AbsoluteSize.X > 100)
		local down = mocks.inputBegan(Enum.UserInputType.MouseButton1, { position = at(0.25) })
		mocks.fire(hit, "InputBegan", down)
		t.near(slider:get(), 0.25, 1e-3)
		t.near(ui.slid, 0.25, 1e-3)
		local move = mocks.inputBegan(Enum.UserInputType.MouseMovement, { position = at(0.8) })
		mocks.fire(UserInputService, "InputChanged", move, false)
		t.near(slider:get(), 0.8, 1e-3)
		mocks.fire(UserInputService, "InputChanged", mocks.inputBegan(Enum.UserInputType.MouseMovement, { position = at(3) }), false)
		t.near(slider:get(), 1, 1e-6, "clamped to the track")
		t.equal(clicks.release, nil)
		mocks.inputEnded(Enum.UserInputType.MouseButton1)
		t.near(ui.released, 1, 1e-6)
		t.equal(clicks.release, 1)
		mocks.fire(UserInputService, "InputChanged", move, false)
		t.near(slider:get(), 1, 1e-6, "no longer dragging")
		local slides = clicks.slide
		slider:set(0.3)
		t.near(slider:get(), 0.3)
		t.equal(clicks.slide, slides, "setting from code does not call onChange")
		t.near(slider.instance.Track.Knob.Position.X.Scale, 0.3, 1e-3)
		t.equal(ui.stepSlider:get(), 3, "values snap to the step")
		ui.stepSlider:set(99)
		t.equal(ui.stepSlider:get(), 10)
		ui.stepSlider:set(0 / 0)
		t.equal(ui.stepSlider:get(), 0)

		-- text input
		mocks.typeText(ui.input.box, "hello world!", true)
		t.equal(ui.input:get(), "HELLO WO", "upper-cased and cut to maxLength")
		t.equal(ui.typed, "HELLO WO")
		t.equal(ui.submitted, "HELLO WO")
		ui.submitted = nil
		mocks.typeText(ui.input.box, "abc", false)
		t.equal(ui.submitted, nil, "leaving the box without Enter does not submit")
		ui.input:set("line\nbreak")
		t.equal(ui.input:get(), "LINEBREA")
		ui.input:focus()
		t.truthy(ui.input.box:IsFocused())
		ui.input.box:ReleaseFocus(false)

		-- progress bar
		t.near(ui.bar:get(), 0.4)
		t.near(ui.bar.instance.Fill.Size.X.Scale, 0.4, 1e-3)
		t.equal(ui.bar.instance.Text.Text, "4 / 10")
		ui.bar:set(0.75, "Almost")
		mocks.advance(0.5)
		t.near(ui.bar.instance.Fill.Size.X.Scale, 0.75, 1e-3)
		t.equal(ui.bar.instance.Text.Text, "Almost")
		ui.bar:set(7)
		t.equal(ui.bar:get(), 1)
		ui.bar:set(0 / 0)
		t.equal(ui.bar:get(), 0)
		mocks.advance(0.5)
		t.equal(ui.bar.instance.Fill.Visible, false)
		t.equal(ui.bar.instance.Text.Text, "Almost", "the text stays when omitted")
		t.equal(ui.blueBar:get(), 0)
		ui.blueBar:setGradient(Theme.Gradient.XP)
		t.equal(ui.blueBar.instance.Fill:FindFirstChildOfClass("UIGradient").Color, Theme.Gradient.XP)

		-- raw buttons with Kit.feedback, Kit.create events and children
		mocks.hover(ui.raw)
		mocks.click(ui.raw)
		mocks.hover(ui.raw, false)
		t.equal(clicks.raw, 1)
		t.truthy(ui.raw:FindFirstChildOfClass("UICorner"))
		t.equal(ui.raw.AutoButtonColor, false)
		table.clear(mocks.soundsPlayed)
		mocks.advance(0.2)
		mocks.click(ui.raw2)
		t.equal(soundsPlayed(soundId("Equip")), 1)

		-- price tags and texts
		t.equal(ui.coinTag.instance.Text, "🪙 1.5K")
		t.equal(ui.gemTag.instance.Text, "💎 340")
		t.equal(ui.robuxTag.instance.Text, "R$ 1,999")
		t.equal(ui.coinTag.instance.TextColor3, Theme.Color.Coins)
		ui.coinTag:set(2500000)
		t.equal(ui.coinTag.instance.Text, "🪙 2.5M")
		ui.coinTag:setAffordable(false)
		t.equal(ui.coinTag.instance.TextColor3, Theme.Color.Error)
		ui.coinTag:setAffordable(true)
		t.equal(ui.coinTag.instance.TextColor3, Theme.Color.Coins)
		t.equal(Kit.priceText("gems", 30), "💎 30")
		t.truthy(Kit.measureText("Sunny Meadow", 28) > 0)

		-- cards: click, selection, highlight, rarity
		ui.tabs:select("grid")
		local card = ui.cards[1]
		mocks.hover(card.instance.Hit)
		t.equal(card.instance.Glow.Visible, true)
		mocks.click(card.instance.Hit)
		mocks.hover(card.instance.Hit, false)
		t.equal(card.instance.Glow.Visible, false)
		t.equal(clicks.card1, 1)
		mocks.click(card.instance.Buy)
		t.equal(clicks.buy1, 1)
		t.equal(clicks.card1, 1, "a button on a card does not click the card")
		t.equal(card.stroke.Color, Theme.rarityColor("Common"))
		card:setHighlight(Theme.Color.Success)
		t.equal(card.stroke.Color, Theme.Color.Success)
		card:setSelected(true)
		t.equal(card.stroke.Color, Theme.Color.Selected)
		card:setSelected(false)
		card:setHighlight(nil)
		card:setRarity("Epic")
		t.equal(card.stroke.Color, Theme.rarityColor("Epic"))
		card:setRarity(nil)
		t.equal(card.stroke.Color, Theme.Color.Outline)
		card:setOnClick(nil)
		t.equal(card.instance.Hit.Visible, false)
		t.truthy(ui.cards[4].stroke:FindFirstChild("RarityGradient"), "Exclusive gets the rainbow")
		ui.cards[4]:setRarity("Common")
		t.equal(ui.cards[4].stroke:FindFirstChild("RarityGradient"), nil)
		Kit.applyRarity(ui.stroke, "Exclusive")
		Kit.applyRarity(ui.stroke, "Mythic")
		t.equal(ui.stroke.Color, Theme.rarityColor("Mythic"))
		t.equal(Kit.rarityColor("Legendary"), Config.Rarities.byId.Legendary.color)
		t.equal(Kit.rarityColor("???"), Theme.rarityColor("Common"))
		t.equal(Kit.rarityGradient("Exclusive"), Theme.Gradient.Rainbow)
		t.equal(ui.ribbon.ClassName, "CanvasGroup")
		t.equal(ui.ribbon.Band:FindFirstChildOfClass("TextLabel").Text, "BEST VALUE")
		t.equal(ui.flatRibbon:FindFirstChildOfClass("TextLabel").Text, "NEW")

		-- grids and lists
		for _, scroll in { ui.gridPage, ui.listPage, ui.squareGrid, ui.fixedGrid } do
			t.equal(scroll.ClassName, "ScrollingFrame")
			t.equal(scroll.AutomaticCanvasSize, Enum.AutomaticSize.Y)
		end
		local grid = ui.gridPage:FindFirstChildOfClass("UIGridLayout")
		t.near(grid.CellSize.X.Scale, 0.25)
		t.equal(grid.CellSize.Y.Offset, 300)
		t.truthy(ui.listPage:FindFirstChildOfClass("UIListLayout"))
		t.truthy(ui.squareGrid:FindFirstChildOfClass("UIGridLayout"):FindFirstChildOfClass("UIAspectRatioConstraint"))
		t.equal(ui.fixedGrid:FindFirstChildOfClass("UIGridLayout").CellSize, UDim2.fromOffset(140, 140))

		-- empty state
		ui.tabs:select("list")
		mocks.click(ui.empty:FindFirstChild("Button"))
		t.equal(clicks.emptyAction, 1)

		-- viewport: owns the model, frames it, spins, cleans up
		local view = ui.viewport
		t.equal(view.instance.ClassName, "ViewportFrame")
		t.truthy(view.instance.CurrentCamera == view.camera)
		t.truthy(view:getModel().Parent == view.instance)
		local center = Vector3.new(0, 5.25, -0.25)
		t.truthy((view.camera.CFrame.Position - center).Magnitude > 3, "the camera stands back from the model")
		t.truthy(view.camera.CFrame.LookVector:Dot((center - view.camera.CFrame.Position).Unit) > 0.95, "and looks at it")
		ui.tabs:select("grid")
		local before = view.camera.CFrame
		mocks.advance(0.5)
		t.truthy(view.camera.CFrame ~= before, "a spinning preview orbits")
		view:setSpin(false)
		before = view.camera.CFrame
		mocks.advance(0.5)
		t.truthy(view.camera.CFrame == before)
		local oldModel = view:getModel()
		local newModel = demoModel()
		view:setModel(newModel)
		t.equal(oldModel.Parent, nil, "the replaced model is destroyed")
		t.truthy(newModel.Parent == view.instance)
		view:refit()
		view:setSpin(true)
		t.equal(ui.staticViewport:getModel(), nil)
		ui.staticViewport:setModel(demoModel())
		t.truthy(ui.staticViewport:getModel())
		view.instance:Destroy()
		mocks.advance(0.5)

		-- motion helpers
		local tween = Kit.tween(ui.decorated, 0.2, { BackgroundTransparency = 0.5 })
		t.equal(typeof(tween), "Instance")
		Kit.tween(ui.decorated, 0.2, { Size = UDim2.fromOffset(210, 60) }, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
		mocks.advance(0.5)
		t.near(ui.decorated.BackgroundTransparency, 0.5, 1e-3)
		Kit.pop(ui.decorated)
		Kit.pop(ui.decorated, 0.3, 0.4)
		t.truthy(ui.decorated:FindFirstChild("KitScale").Scale < 1)
		mocks.advance(1)
		t.near(ui.decorated:FindFirstChild("KitScale").Scale, 1, 1e-3)
		local stopPulse = Kit.pulse(ui.decorated, { amount = 0.2, period = 0.4 })
		local sawPulse = false
		for _ = 1, 30 do
			mocks.step(1 / 60)
			if ui.decorated:FindFirstChild("KitScale").Scale > 1.05 then
				sawPulse = true
			end
		end
		t.truthy(sawPulse)
		stopPulse()
		stopPulse()
		mocks.advance(0.5)
		t.near(ui.decorated:FindFirstChild("KitScale").Scale, 1, 1e-3)
		local stopRainbow = Kit.rainbow(ui.rainbowGradient)
		t.equal(ui.rainbowGradient.Color, Theme.Gradient.Rainbow)
		mocks.step(1 / 60, 10)
		t.truthy(ui.rainbowGradient.Rotation ~= 0)
		stopRainbow()
		stopRainbow()

		-- Kit.clear keeps layouts and decorations
		Kit.clear(ui.decorated)
		t.truthy(ui.decorated:FindFirstChildOfClass("UIGridLayout"))
		t.truthy(ui.decorated:FindFirstChildOfClass("UIStroke"))
		t.equal(ui.decorated:FindFirstChildWhichIsA("GuiObject"), nil)
		ui.holdButton:destroy()
		t.equal(ui.holdButton.instance.Parent, nil)

		mocks.advance(2)
		noErrors()
	end)

	t.test("Kit.confirm: yes / cancel / Escape, one dialog at a time, above the window", function()
		local overlay = WindowManager.getOverlayLayer()
		local function dialog()
			return overlay:FindFirstChild("ConfirmDialog")
		end
		local yes, no = 0, 0
		Kit.confirm("Delete pets?", "This removes 3 pets forever.", function()
			yes += 1
		end, { yesText = "Delete", danger = true, icon = "🗑️" })
		mocks.flush()
		local first = dialog()
		t.truthy(first)
		t.equal(first.Dialog.Yes.Body:FindFirstChildOfClass("UIGradient").Color, Theme.buttonGradient("danger"))
		t.equal(first.Dialog.Yes.Body:FindFirstChildOfClass("TextLabel").Text, "Delete")
		mocks.click(first.Dialog.Yes)
		t.equal(yes, 1)
		t.equal(dialog(), nil)

		Kit.confirm("Rebirth?", "You keep gems, pets and upgrades.", function()
			yes += 1
		end, {
			onNo = function()
				no += 1
			end,
		})
		mocks.click(dialog().Dialog.No)
		t.equal(no, 1)
		t.equal(yes, 1)
		t.equal(dialog(), nil)

		-- Escape cancels the dialog first and leaves the window open
		t.equal(WindowManager.isOpen("KitDemo"), true)
		Kit.confirm("Sure?", "Really?", function()
			yes += 1
		end, {
			onNo = function()
				no += 1
			end,
		})
		mocks.input(Enum.KeyCode.Escape)
		t.equal(no, 2)
		t.equal(dialog(), nil)
		t.equal(WindowManager.isOpen("KitDemo"), true)
		mocks.input(Enum.KeyCode.Escape)
		t.equal(WindowManager.isOpen("KitDemo"), false, "the next Escape closes the window")

		-- clicking the dim background cancels; a second dialog replaces the first; close() dismisses silently
		Kit.confirm("One", "1", function()
			yes += 1
		end)
		mocks.click(dialog().Dim)
		t.equal(dialog(), nil)
		Kit.confirm("Two", "2", function()
			yes += 1
		end)
		local close = Kit.confirm("Three", "3", function()
			yes += 1
		end)
		local count = 0
		for _, child in overlay:GetChildren() do
			if child.Name == "ConfirmDialog" then
				count += 1
			end
		end
		t.equal(count, 1)
		close()
		close()
		t.equal(dialog(), nil)
		t.equal(yes, 1)
		mocks.input(Enum.KeyCode.Escape) -- nothing left to dismiss
		mocks.advance(1)
		noErrors()
	end)

	------------------------------------------------------------------------------------------------------------
	t.test("Notifications: toasts stack, dedupe, expire; server Notify shows a toast", function()
		local holder = WindowManager.getNotificationLayer().Toasts
		local function toastTexts(): { string }
			local texts = {}
			for _, child in holder:GetChildren() do
				if child:IsA("Frame") then
					table.insert(texts, child.Text.Text)
				end
			end
			table.sort(texts)
			return texts
		end
		mocks.advance(10)
		t.equal(toastTexts(), {})

		table.clear(mocks.soundsPlayed)
		Notifications.toast("success", "Bought Stone Hammer!")
		t.equal(#toastTexts(), 1)
		contains(toastTexts()[1], "Bought Stone Hammer!")
		t.equal(soundsPlayed(soundId("Purchase")), 1)
		local toast = holder:FindFirstChild("Toast")
		t.equal(toast:FindFirstChildOfClass("UIStroke").Color, Theme.Color.Success, "colour by kind")

		mocks.advance(0.1)
		Notifications.toast("error", "Not enough coins")
		t.equal(soundsPlayed(soundId("Error")), 1)
		Notifications.toast("error", "Not enough coins")
		Notifications.toast("error", "Not enough coins")
		t.equal(#toastTexts(), 2, "a repeated message does not stack")
		Notifications.toast("info", "")
		Notifications.toast("info", nil)
		Notifications.toast("made-up-kind", "Still shown")
		t.equal(#toastTexts(), 3)

		for index = 1, 6 do
			Notifications.toast("reward", "Reward " .. index)
		end
		t.equal(#toastTexts(), 4, "at most four toasts are visible")

		mocks.advance(6)
		t.equal(toastTexts(), {}, "toasts dismiss themselves")

		server.fire(player, "Notify", { kind = "reward", text = "Quest complete!" })
		server.fire(player, "Notify", { kind = "bogus", text = "Fallback kind" })
		server.fire(player, "Notify", { kind = "info" })
		server.fire(player, "Notify", "garbage")
		mocks.flush()
		local texts = toastTexts()
		t.equal(#texts, 2)
		mocks.advance(6)
		noErrors()
	end)

	t.test("Notifications: reward popups queue; announcements and the level-up banner show and leave", function()
		local layer = WindowManager.getNotificationLayer()
		local function popups()
			local found = {}
			for _, child in layer:GetChildren() do
				if child.Name == "RewardPopup" then
					table.insert(found, child)
				end
			end
			return found
		end

		table.clear(mocks.soundsPlayed)
		Notifications.rewardPopup("Daily Reward", { "+250 Gems", "30 min 2x Coins" })
		Notifications.rewardPopup("Second", { "+1 Pet" }, "Nice!")
		server.fire(player, "RewardPopup", { title = "From Server", lines = { "+5 Gems", 42, "" } })
		mocks.flush()
		t.equal(#popups(), 1, "only one popup at a time")
		local popup = popups()[1]
		contains(popup.Card.TitleBar.Title.Text, "Daily Reward")
		t.equal(popup.Card.Lines.Line1:FindFirstChildOfClass("TextLabel").Text, "+250 Gems")
		t.equal(popup.Card.Lines.Line2:FindFirstChildOfClass("TextLabel").Text, "30 min 2x Coins")
		t.equal(popup.Card.Confirm.Body:FindFirstChildOfClass("TextLabel").Text, "Awesome!")
		t.equal(soundsPlayed(soundId("Reward")), 1)

		mocks.click(popup.Card.Confirm)
		mocks.flush()
		t.equal(#popups(), 1)
		popup = popups()[1]
		contains(popup.Card.TitleBar.Title.Text, "Second")
		t.equal(popup.Card.Confirm.Body:FindFirstChildOfClass("TextLabel").Text, "Nice!")
		mocks.input(Enum.KeyCode.ButtonB) -- gamepad B confirms the popup
		mocks.flush()
		popup = popups()[1]
		contains(popup.Card.TitleBar.Title.Text, "From Server")
		t.equal(popup.Card.Lines.Line1:FindFirstChildOfClass("TextLabel").Text, "+5 Gems")
		t.equal(popup.Card.Lines:FindFirstChild("Line2"), nil, "non-text lines are dropped")
		mocks.click(popup.Dim)
		mocks.flush()
		t.equal(#popups(), 0)

		-- many lines are capped; no lines is fine; popups wait while an egg hatches
		local many = {}
		for index = 1, 12 do
			many[index] = "Line " .. index
		end
		ClientEvents.HatchOverlay:Fire(true)
		mocks.flush()
		Notifications.rewardPopup("Big", many)
		Notifications.rewardPopup("Empty", {})
		t.equal(#popups(), 0, "held back during the hatch overlay")
		ClientEvents.HatchOverlay:Fire(false)
		mocks.flush()
		popup = popups()[1]
		t.truthy(popup)
		contains(popup.Card.Lines.Line9:FindFirstChildOfClass("TextLabel").Text, "4 more")
		t.equal(popup.Card.Lines:FindFirstChild("Line10"), nil)
		mocks.click(popup.Card.Confirm)
		mocks.flush()
		contains(popups()[1].Card.TitleBar.Title.Text, "Empty")
		mocks.click(popups()[1].Card.Confirm)
		mocks.flush()
		t.equal(#popups(), 0)

		-- announcements: one at a time, in order
		local function banners()
			local found = {}
			for _, child in layer:GetChildren() do
				if child.Name == "Announcement" then
					table.insert(found, child)
				end
			end
			return found
		end
		Notifications.announce("The Crystal Titan has appeared!", Color3.fromRGB(255, 0, 0))
		server.fire(player, "Announcement", "MintyFox hatched a Legendary Sun Dragon!", "#FFB627")
		server.fire(player, "Announcement", "Bad colour", "not-a-colour")
		server.fire(player, "Announcement", 12345)
		mocks.flush()
		t.equal(#banners(), 1)
		local banner = banners()[1]
		contains(banner:FindFirstChildOfClass("TextLabel").Text, "Crystal Titan")
		t.equal(banner:FindFirstChildOfClass("TextLabel").TextColor3, Color3.fromRGB(255, 0, 0))
		mocks.advance(Theme.Time.Announce + 1)
		t.equal(#banners(), 1)
		banner = banners()[1]
		contains(banner:FindFirstChildOfClass("TextLabel").Text, "MintyFox")
		t.equal(banner:FindFirstChildOfClass("TextLabel").TextColor3, Color3.fromHex("#FFB627"))
		mocks.advance(Theme.Time.Announce + 1)
		contains(banners()[1]:FindFirstChildOfClass("TextLabel").Text, "Bad colour")
		mocks.advance(Theme.Time.Announce + 1)
		t.equal(#banners(), 0)

		-- level up: banner + sound; a second level-up updates the same banner
		table.clear(mocks.soundsPlayed)
		server.fire(player, "LevelUp", 7, 3)
		mocks.flush()
		local levelBanner = layer:FindFirstChild("LevelUp")
		t.truthy(levelBanner)
		contains(levelBanner.Level.Text, "Level 7")
		contains(levelBanner.Level.Text, "+3")
		t.equal(soundsPlayed(soundId("LevelUp")), 1)
		mocks.advance(1)
		server.fire(player, "LevelUp", 8, 4)
		server.fire(player, "LevelUp", "garbage")
		mocks.flush()
		t.truthy(layer:FindFirstChild("LevelUp") == levelBanner)
		contains(levelBanner.Level.Text, "Level 8")
		contains(levelBanner.Level.Text, "+7")
		mocks.advance(2)
		t.truthy(layer:FindFirstChild("LevelUp"), "the timer restarted with the second level-up")
		mocks.advance(3)
		t.equal(layer:FindFirstChild("LevelUp"), nil)
		noErrors()
	end)

	------------------------------------------------------------------------------------------------------------
	t.test("FloatingText: pooled, capped, rises and fades", function()
		local function attachments(): number
			local total = 0
			for _, child in workspace.Terrain:GetChildren() do
				if child.Name == "FloatingText" then
					total += 1
				end
			end
			return total
		end

		FloatingText.show(Vector3.new(0, 5, 0), "-48", Color3.new(1, 1, 1))
		t.equal(FloatingText.activeCount(), 1)
		t.equal(attachments(), 1)
		local attachment = workspace.Terrain:FindFirstChild("FloatingText")
		local billboard = attachment.Billboard
		t.equal(billboard.Enabled, true)
		t.equal(billboard.Text.Text, "-48")
		t.truthy((attachment.WorldPosition - Vector3.new(0, 5, 0)).Magnitude < 2)
		mocks.step(1 / 60, 30)
		t.truthy(billboard.StudsOffsetWorldSpace.Y > 1, "it rises")
		mocks.advance(1)
		t.equal(FloatingText.activeCount(), 0)
		t.equal(billboard.Enabled, false)

		-- bursts are capped and reuse the pool
		for index = 1, 80 do
			FloatingText.show(Vector3.new(index, 5, 0), "CRIT -" .. index, Color3.new(1, 1, 0), index % 2 == 0)
		end
		t.equal(FloatingText.activeCount(), 30)
		t.equal(attachments(), 30)
		mocks.advance(2)
		t.equal(FloatingText.activeCount(), 0)
		for index = 1, 80 do
			FloatingText.show(Vector3.new(index, 5, 0), "+" .. index, Color3.new(0, 1, 0))
		end
		t.equal(attachments(), 30, "no new instances for the second burst")
		mocks.advance(2)

		-- fewer in low-detail mode; bad arguments are ignored
		server.delta(player, { { path = { "settings", "lowDetail" }, value = true } })
		mocks.flush()
		for index = 1, 40 do
			FloatingText.show(Vector3.new(index, 5, 0), "x", Color3.new(1, 1, 1))
		end
		t.equal(FloatingText.activeCount(), 12)
		server.delta(player, { { path = { "settings", "lowDetail" }, value = false } })
		mocks.advance(2)
		FloatingText.show(nil, "x", Color3.new(1, 1, 1))
		FloatingText.show(Vector3.zero, "", Color3.new(1, 1, 1))
		FloatingText.show(Vector3.zero, 5, nil)
		t.equal(FloatingText.activeCount(), 0)
		noErrors()
	end)

	------------------------------------------------------------------------------------------------------------
	t.test("ZoneTracker: island under the character, nearest island, change signals", function()
		t.equal(ZoneTracker.getZoneId(), nil)
		t.equal(ZoneTracker.getNearestZoneId(), "")
		t.equal(ZoneTracker.getZoneCenter("meadow"), nil)

		local function marker(zoneId: string, x: number, radius: number?): Part
			local part = Instance.new("Part")
			part.Name = "Marker_" .. zoneId
			part.Anchored = true
			part.Position = Vector3.new(x, 0, 0)
			part:SetAttribute("ZoneId", zoneId)
			if radius then
				part:SetAttribute("Radius", radius)
			end
			part.Parent = workspace
			CollectionService:AddTag(part, "ZoneMarker")
			return part
		end
		marker("meadow", 0, 95)
		local dunes = marker("dunes", 280) -- no Radius attribute: Config.Game.islandRadius
		mocks.flush()

		local changes, nearestChanges = {}, {}
		ZoneTracker.Changed:Connect(function(zoneId)
			table.insert(changes, zoneId or "nil")
		end)
		ZoneTracker.NearestChanged:Connect(function(zoneId)
			table.insert(nearestChanges, zoneId)
		end)

		local character = mocks.waitFor(function()
			return player.Character
		end, 5)
		t.truthy(character, "the mock player has a character")
		local function standAt(x: number, y: number?)
			character:PivotTo(CFrame.new(x, y or 3, 10))
			mocks.advance(0.5)
		end

		standAt(20)
		t.equal(ZoneTracker.getZoneId(), "meadow")
		t.equal(ZoneTracker.getNearestZoneId(), "meadow")
		t.equal(ZoneTracker.getZoneCenter("meadow"), Vector3.new(0, 0, 0))
		t.equal(ZoneTracker.getZoneCenter("dunes"), Vector3.new(280, 0, 0))

		standAt(125) -- on the bridge, still closer to the meadow
		t.equal(ZoneTracker.getZoneId(), nil)
		t.equal(ZoneTracker.getNearestZoneId(), "meadow")
		standAt(160) -- on the bridge, closer to the dunes
		t.equal(ZoneTracker.getZoneId(), nil)
		t.equal(ZoneTracker.getNearestZoneId(), "dunes")
		standAt(280 - Config.Game.islandRadius + 5, -40) -- height does not matter, like on the server
		t.equal(ZoneTracker.getZoneId(), "dunes")
		t.equal(changes, { "meadow", "nil", "dunes" })
		t.equal(nearestChanges, { "meadow", "dunes" })

		-- refresh() re-evaluates immediately; markers can change and disappear
		character:PivotTo(CFrame.new(0, 3, 0))
		ZoneTracker.refresh()
		t.equal(ZoneTracker.getZoneId(), "meadow")
		dunes:SetAttribute("ZoneId", "peaks")
		mocks.flush()
		t.equal(ZoneTracker.getZoneCenter("dunes"), nil)
		t.equal(ZoneTracker.getZoneCenter("peaks"), Vector3.new(280, 0, 0))
		dunes:Destroy()
		mocks.flush()
		t.equal(ZoneTracker.getZoneCenter("peaks"), nil)
		mocks.advance(1)
		t.equal(ZoneTracker.getZoneId(), "meadow")
		noErrors()
	end)

	------------------------------------------------------------------------------------------------------------
	t.test("ClientMain: the bootstrap script boots with missing and broken feature modules and sets ClientReady", function()
		-- Replace the real feature folders (other owners' work, possibly absent or unfinished) with a controlled
		-- set: one good controller, one good window, three kinds of broken modules; everything else is missing.
		for _, name in { "Controllers", "Windows" } do
			local real = Client:FindFirstChild(name)
			if real then
				real.Name = name .. "_Real"
			end
			local folder = Instance.new("Folder")
			folder.Name = name
			folder.Parent = Client
		end
		local controllers = Client:FindFirstChild("Controllers")
		local windows = Client:FindFirstChild("Windows")
		mocks.newScript(
			"ModuleScript",
			"HudController",
			[[
			local Players = game:GetService("Players")
			local order = {}
			return {
				Init = function()
					table.insert(order, "init")
					Players.LocalPlayer:SetAttribute("TestHudInit", true)
				end,
				Start = function()
					table.insert(order, "start")
					Players.LocalPlayer:SetAttribute("TestHudOrder", table.concat(order, ","))
					task.wait(1000000) -- a Start that never returns must not block the boot
				end,
			}
		]],
			controllers
		)
		mocks.newScript("ModuleScript", "CombatController", [[error("combat module exploded while loading")]], controllers)
		mocks.newScript("ModuleScript", "ChatTags", [[return "not a table"]], controllers)
		mocks.newScript(
			"ModuleScript",
			"ShopWindow",
			[[
			local ReplicatedStorage = game:GetService("ReplicatedStorage")
			local Client = ReplicatedStorage:WaitForChild("Client")
			local WindowManager = require(Client:WaitForChild("Core"):WaitForChild("WindowManager"))
			local ClientState = require(Client:WaitForChild("Core"):WaitForChild("ClientState"))
			return {
				Init = function()
					assert(ClientState.isReady(), "features run after the state arrived")
					WindowManager.register({
						id = "Shop", title = "Shop", icon = "🛒", order = 0, showInMenu = true,
						build = function() end,
					})
				end,
			}
		]],
			windows
		)
		mocks.newScript(
			"ModuleScript",
			"PetsWindow",
			[[
			local Players = game:GetService("Players")
			return {
				Init = function()
					error("pets window Init exploded")
				end,
				Start = function()
					Players.LocalPlayer:SetAttribute("TestPetsStarted", true)
				end,
			}
		]],
			windows
		)
		mocks.newScript("ModuleScript", "StatsWindow", [[return {}]], windows) -- neither Init nor Start

		local ClientMain = clientRequire("ClientMain")
		t.equal(#ClientMain.Controllers, 12)
		t.equal(#ClientMain.Windows, 12)
		t.equal(ClientMain.Controllers[1], "HammerVisuals")
		t.equal(ClientMain.Controllers[12], "HudController")
		t.equal(ClientMain.Windows[1], "ShopWindow")
		t.equal(ClientMain.Windows[12], "StatsWindow")
		t.equal(ClientMain.isReady(), false)
		t.equal(player:GetAttribute("ClientReady"), nil)

		local warningsBefore = countWarnings("[ClientMain]")
		local bootstrap = player:FindFirstChildOfClass("PlayerScripts"):FindFirstChild("ClientBootstrap")
		t.truthy(bootstrap, "the bootstrap LocalScript is in StarterPlayerScripts")
		env:runScript(bootstrap, "client")
		mocks.waitFor(function()
			return player:GetAttribute("ClientReady")
		end, 5)

		t.equal(player:GetAttribute("ClientReady"), true)
		t.equal(ClientMain.isReady(), true)
		t.equal(ClientMain.getLoaded(), { "Controllers/HudController", "Windows/ShopWindow", "Windows/StatsWindow" })
		t.equal(player:GetAttribute("TestHudInit"), true)
		t.equal(player:GetAttribute("TestHudOrder"), "init,start", "Init runs before Start")
		t.equal(player:GetAttribute("TestPetsStarted"), nil, "Start is skipped after a failed Init")
		local shop
		for _, def in WindowManager.getRegistered() do
			if def.id == "Shop" then
				shop = def
			end
		end
		t.truthy(shop, "the window module registered its window")
		t.equal(WindowManager.getRegistered()[1].id, "Shop")

		-- one clear warning per missing or broken module: 24 listed, 3 fine
		t.equal(countWarnings("[ClientMain]") - warningsBefore, 21)
		t.equal(countWarnings("Controllers/HammerVisuals is missing"), 1)
		t.equal(countWarnings("Windows/SettingsWindow is missing"), 1)
		t.equal(countWarnings("combat module exploded while loading"), 1)
		t.equal(countWarnings("Controllers/ChatTags must return a table"), 1)
		t.equal(countWarnings("pets window Init exploded"), 1)

		ClientMain.start() -- a second start does nothing
		t.equal(countWarnings("[ClientMain]") - warningsBefore, 21)

		-- the registered window opens like any other
		WindowManager.open("Shop")
		t.equal(WindowManager.isOpen("Shop"), true)
		WindowManager.close()
		mocks.advance(1)

		for _, name in { "Controllers", "Windows" } do
			Client:FindFirstChild(name):Destroy()
			local real = Client:FindFirstChild(name .. "_Real")
			if real then
				real.Name = name
			end
		end
		noErrors()
	end)
end
