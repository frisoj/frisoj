-- Self-tests of the headless Roblox mock environment (tests/harness/Mocks.luau and tests/harness/mocks/*).
-- They use tiny inline scripts instead of game code, so they keep passing whatever the game looks like, and
-- double as usage examples for the env.mocks API documented in tests/harness/README.md.
local CollectionService = game:GetService("CollectionService")
local DataStoreService = game:GetService("DataStoreService")
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

return function(t)
	local env = t.env
	local mocks = env.mocks

	-- Runs fn and returns the error message it raised (fails the test when it does not raise).
	local function errorOf(fn: () -> ()): string
		local ok, err = pcall(fn)
		if ok then
			t.fail("expected an error")
		end
		return tostring(err)
	end

	local function contains(text: string, part: string)
		if not string.find(text, part, 1, true) then
			t.fail(`expected "{text}" to contain "{part}"`)
		end
	end

	local function newFolder(name: string, parent: Instance): Folder
		local folder = Instance.new("Folder")
		folder.Name = name
		folder.Parent = parent
		return folder
	end

	------------------------------------------------------------------------------------------------------------
	-- instances
	------------------------------------------------------------------------------------------------------------
	t.test("instances: properties are stored, defaulted and type-checked", function()
		local part = Instance.new("Part")
		t.equal(typeof(part), "Instance")
		t.equal(type(part), "userdata")
		t.equal(part.ClassName, "Part")
		t.equal(part.Name, "Part")
		t.truthy(part:IsA("BasePart") and part:IsA("Instance") and not part:IsA("Model"))
		t.equal(part.Anchored, false)
		t.equal(part.Material, Enum.Material.Plastic)
		part.Anchored = true
		part.Size = Vector3.new(1, 2, 3)
		part.Material = Enum.Material.Neon
		part.CFrame = CFrame.new(10, 20, 30)
		t.equal(part.Anchored, true)
		t.equal(part.Size, Vector3.new(1, 2, 3))
		t.equal(part.Material, Enum.Material.Neon)
		t.equal(part.Position, Vector3.new(10, 20, 30))
		part.Position = Vector3.new(1, 1, 1)
		t.equal(part.CFrame, CFrame.new(1, 1, 1))
		part.Transparency = 0.1
		t.near(part.Transparency, 0.1, 1e-6)
		t.truthy(part.Transparency ~= 0.1, "float properties are stored as 32-bit floats like in Roblox")
		contains(errorOf(function()
			part.Size = 5 :: any
		end), "Unable to assign property Size. Vector3 expected, got number")
		contains(errorOf(function()
			part.Material = Enum.KeyCode.E :: any
		end), "Enum.Material expected")
		contains(errorOf(function()
			(part :: any).ClassName = "Model"
		end), "read only")
	end)

	t.test("instances: tree, names and lookups", function()
		local root = newFolder("TreeTest", workspace)
		local model = Instance.new("Model")
		model.Name = "Rig"
		model.Parent = root
		local part = Instance.new("Part")
		part.Name = "Handle"
		part.Parent = model
		t.equal(part:GetFullName(), "Workspace.TreeTest.Rig.Handle")
		t.equal(tostring(part), "Handle")
		t.truthy((root :: any).Rig.Handle == part)
		t.truthy(root:FindFirstChild("Handle") == nil)
		t.truthy(root:FindFirstChild("Handle", true) == part)
		t.truthy(model:FindFirstChildOfClass("Part") == part)
		t.truthy(model:FindFirstChildWhichIsA("BasePart") == part)
		t.truthy(part:FindFirstAncestorOfClass("Model") == model)
		t.truthy(part:FindFirstAncestor("TreeTest") == root)
		t.truthy(part:IsDescendantOf(workspace) and workspace:IsAncestorOf(part))
		t.equal(#root:GetDescendants(), 2)
		t.truthy(game.Workspace == workspace and game:GetService("Workspace") == workspace)
		contains(errorOf(function()
			model.Parent = part
		end), "circular reference")
		contains(errorOf(function()
			return game:GetService("NoSuchService")
		end), "not a valid Service name")
		contains(errorOf(function()
			return Instance.new("Players")
		end), "Unable to create an Instance")
		root:Destroy()
		t.equal(part.Parent, nil)
		t.equal(part.Name, "Handle", "destroyed instances stay readable")
		contains(errorOf(function()
			part.Parent = workspace
		end), "locked")
	end)

	t.test("instances: Clone copies properties, attributes, tags and remaps references", function()
		local model = Instance.new("Model")
		local part = Instance.new("Part")
		part.Name = "A"
		part.Color = Color3.new(1, 0, 0)
		part.Parent = model
		local weld = Instance.new("WeldConstraint")
		weld.Part0 = part
		weld.Parent = part
		model.PrimaryPart = part
		part:SetAttribute("Health", 123456789)
		part:AddTag("Cloned")
		local skipped = Instance.new("Part")
		skipped.Name = "NotArchivable"
		skipped.Archivable = false
		skipped.Parent = model
		local copy = model:Clone() :: any
		t.truthy(copy ~= model and copy.Parent == nil)
		t.truthy(copy.PrimaryPart == copy.A and copy.A ~= part)
		t.truthy(copy.A.WeldConstraint.Part0 == copy.A)
		t.equal(copy.A.Color, Color3.new(1, 0, 0))
		t.equal(copy.A:GetAttribute("Health"), 123456789)
		t.truthy(copy.A:HasTag("Cloned"))
		t.equal(copy:FindFirstChild("NotArchivable"), nil)
	end)

	t.test("instances: unknown, unmocked and restricted members fail loudly", function()
		local part = Instance.new("Part")
		part.Parent = workspace
		contains(errorOf(function()
			(part :: any).Sizee = Vector3.one
		end), 'Sizee is not a valid member of Part "Workspace.Part"')
		contains(errorOf(function()
			return (part :: any):GetNoSuchMethod()
		end), "GetNoSuchMethod is not a valid member of Part")
		-- exists in Roblox, but nobody wrote a mock for it yet
		contains(errorOf(function()
			return part:SubtractAsync({})
		end), "HARNESS: Part.SubtractAsync is not mocked (add it in tests/harness/Mocks.luau)")
		-- deprecated members are flagged instead of silently working
		contains(errorOf(function()
			return (part :: any):children()
		end), "deprecated")
		contains(errorOf(function()
			return (part :: any).RobloxLocked
		end), "cannot be used by game scripts")
		part:Destroy()
	end)

	t.test("UI: creation works and a wrong property name errors", function()
		local gui = Instance.new("ScreenGui")
		gui.ResetOnSpawn = false
		gui.IgnoreGuiInset = true
		gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
		local frame = Instance.new("Frame")
		frame.Size = UDim2.new(0.5, 0, 0, 100)
		frame.Position = UDim2.fromScale(0.5, 0.5)
		frame.AnchorPoint = Vector2.new(0.5, 0.5)
		frame.BackgroundColor3 = Color3.fromRGB(30, 30, 40)
		frame.Parent = gui
		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, 12)
		corner.Parent = frame
		local label = Instance.new("TextLabel")
		label.Text = "Hello"
		label.Font = Enum.Font.FredokaOne
		label.TextSize = 20
		label.TextScaled = false
		label.Size = UDim2.fromScale(1, 1)
		label.Parent = frame
		t.equal(gui.AbsoluteSize, Vector2.new(1280, 720))
		t.equal(frame.AbsoluteSize, Vector2.new(640, 100))
		t.equal(frame.AbsolutePosition, Vector2.new(320, 310))
		t.equal(label.AbsoluteSize, Vector2.new(640, 100))
		t.truthy(label.TextBounds.X > 0)
		contains(errorOf(function()
			(label :: any).TextColour3 = Color3.new(1, 1, 1)
		end), "TextColour3 is not a valid member of TextLabel")
		contains(errorOf(function()
			label.TextColor3 = "red" :: any
		end), "Unable to assign property TextColor3. Color3 expected, got string")
		contains(errorOf(function()
			(frame :: any).AbsoluteSize = Vector2.new(1, 1)
		end), "read only")
	end)

	t.test("UI: click, typeText and hidden buttons", function()
		local gui = Instance.new("ScreenGui")
		local button = Instance.new("TextButton")
		button.Parent = gui
		local box = Instance.new("TextBox")
		box.Parent = gui
		local clicks, activated, submitted = 0, 0, nil
		button.MouseButton1Click:Connect(function()
			clicks += 1
		end)
		button.Activated:Connect(function(input)
			t.equal(input.UserInputType, Enum.UserInputType.MouseButton1)
			activated += 1
		end)
		box.FocusLost:Connect(function(enterPressed)
			submitted = { box.Text, enterPressed }
		end)
		mocks.click(button)
		t.equal({ clicks, activated }, { 1, 1 })
		mocks.typeText(box, "RELEASE")
		t.equal(submitted, { "RELEASE", true })
		button.Visible = false
		contains(errorOf(function()
			mocks.click(button)
		end), "cannot be clicked")
		mocks.click(button, { force = true })
		t.equal(clicks, 2)
	end)

	------------------------------------------------------------------------------------------------------------
	-- signals
	------------------------------------------------------------------------------------------------------------
	t.test("signals: tree and property events fire (deferred), connections disconnect", function()
		local folder = newFolder("SignalTest", workspace)
		local log = {}
		local connection = folder.ChildAdded:Connect(function(child)
			table.insert(log, "added " .. child.Name)
		end)
		t.equal(typeof(folder.ChildAdded), "RBXScriptSignal")
		t.equal(typeof(connection), "RBXScriptConnection")
		folder.ChildRemoved:Connect(function(child)
			table.insert(log, "removed " .. child.Name)
		end)
		workspace.DescendantAdded:Once(function(descendant)
			table.insert(log, "descendant " .. descendant.Name)
		end)
		local part = Instance.new("Part")
		part.Name = "P"
		part.AncestryChanged:Connect(function(child, parent)
			table.insert(log, "ancestry " .. child.Name .. " -> " .. tostring(parent))
		end)
		part.Changed:Connect(function(property)
			table.insert(log, "changed " .. property)
		end)
		part:GetPropertyChangedSignal("Anchored"):Connect(function()
			table.insert(log, "anchored " .. tostring(part.Anchored))
		end)
		part.Destroying:Connect(function()
			table.insert(log, "destroying")
		end)
		part.Parent = folder
		t.equal(log, {}, "handlers are deferred until the running code yields or env.mocks.flush() is called")
		mocks.flush()
		t.equal(log, { "added P", "descendant P", "ancestry P -> SignalTest", "changed Parent" })
		table.clear(log)
		part.Anchored = true
		part.Anchored = true -- no change, no event
		task.wait()
		t.equal(log, { "changed Anchored", "anchored true" })
		table.clear(log)
		connection:Disconnect()
		t.equal(connection.Connected, false)
		part:Destroy()
		mocks.flush()
		t.equal(log, { "destroying", "removed P" })
		contains(errorOf(function()
			return part:GetPropertyChangedSignal("NotAProperty")
		end), "not a valid property name")
		folder:Destroy()
	end)

	t.test("signals: Wait, attributes and env.mocks.fire", function()
		local part = Instance.new("Part")
		local touched
		task.spawn(function()
			touched = part.Touched:Wait()
		end)
		mocks.fire(part, "Touched", workspace)
		t.truthy(touched == workspace)

		local seen = {}
		part.AttributeChanged:Connect(function(name)
			table.insert(seen, name)
		end)
		part:GetAttributeChangedSignal("Health"):Connect(function()
			table.insert(seen, part:GetAttribute("Health"))
		end)
		part:SetAttribute("Health", 50)
		part:SetAttribute("Health", 50)
		part:SetAttribute("Other", "x")
		mocks.flush()
		t.equal(seen, { "Health", 50, "Other" })
		t.equal(part:GetAttributes(), { Health = 50, Other = "x" })
		contains(errorOf(function()
			part:SetAttribute("Bad", {} :: any)
		end), "not a supported attribute type")
		contains(errorOf(function()
			part:SetAttribute("bad name", 1)
		end), "invalid")
	end)

	t.test("signals: Immediate mode runs handlers synchronously", function()
		mocks.config.signalBehavior = "Immediate"
		local value = Instance.new("IntValue")
		local seen
		value.Changed:Connect(function(newValue)
			seen = newValue
		end)
		value.Value = 7
		mocks.config.signalBehavior = "Deferred"
		t.equal(seen, 7, "ValueBase.Changed passes the new value")
	end)

	t.test("CollectionService: tags and instance added/removed signals", function()
		local log = {}
		CollectionService:GetInstanceAddedSignal("Crystal"):Connect(function(instance)
			table.insert(log, "+" .. instance.Name)
		end)
		CollectionService:GetInstanceRemovedSignal("Crystal"):Connect(function(instance)
			table.insert(log, "-" .. instance.Name)
		end)
		local a = Instance.new("Part")
		a.Name = "A"
		a:AddTag("Crystal") -- not in the DataModel yet: no signal, not in GetTagged
		mocks.flush()
		t.equal(#CollectionService:GetTagged("Crystal"), 0)
		a.Parent = workspace
		local b = Instance.new("Part")
		b.Name = "B"
		b.Parent = workspace
		CollectionService:AddTag(b, "Crystal")
		mocks.flush()
		t.equal(log, { "+A", "+B" })
		t.equal(#CollectionService:GetTagged("Crystal"), 2)
		t.truthy(CollectionService:HasTag(a, "Crystal") and b:HasTag("Crystal"))
		t.equal(a:GetTags(), { "Crystal" })
		b:RemoveTag("Crystal")
		a:Destroy()
		mocks.flush()
		t.equal(log, { "+A", "+B", "-B", "-A" })
		t.equal(#CollectionService:GetTagged("Crystal"), 0)
		b:Destroy()
	end)

	------------------------------------------------------------------------------------------------------------
	-- scheduler
	------------------------------------------------------------------------------------------------------------
	t.test("scheduler: virtual time, task library, frame events", function()
		local startClock, startUnix = os.clock(), os.time()
		local order = {}
		task.delay(5, function()
			table.insert(order, "delay5")
		end)
		task.spawn(function()
			table.insert(order, "spawn")
			local waited = task.wait(2)
			table.insert(order, "wait2")
			t.truthy(waited >= 2 and waited < 2.1)
		end)
		task.defer(function()
			table.insert(order, "defer")
		end)
		local cancelled = task.delay(1, function()
			table.insert(order, "cancelled")
		end)
		task.cancel(cancelled)
		t.equal(order, { "spawn" })
		local beats = 0
		local connection = RunService.Heartbeat:Connect(function(dt)
			beats += 1
			t.near(dt, 0.1, 1e-9)
		end)
		mocks.advance(10, 0.1) -- ten virtual seconds in 0.1 s frames, instantly
		connection:Disconnect()
		t.equal(order, { "spawn", "defer", "wait2", "delay5" })
		t.equal(beats, 100)
		t.near(os.clock() - startClock, 10, 0.5)
		t.truthy(os.time() - startUnix >= 10)
		t.near(workspace:GetServerTimeNow(), tick(), 0.5)
		t.truthy(DateTime.now().UnixTimestamp >= startUnix + 10)
		t.equal(typeof(DateTime.now()), "DateTime")
	end)

	t.test("scheduler: env.mocks.step and waitFor", function()
		local frames = 0
		local connection = RunService.Stepped:Connect(function()
			frames += 1
		end)
		mocks.step(1 / 60, 3)
		t.equal(frames, 3)
		connection:Disconnect()
		local done = false
		task.delay(30, function()
			done = true
		end)
		t.truthy(mocks.waitFor(function()
			return done
		end, 60))
		t.equal(mocks.waitFor(function()
			return false
		end, 1), nil)
	end)

	t.test("errors in threads and handlers are collected in env.errors", function()
		mocks.config.printErrors = false
		local before = #env.errors
		task.spawn(function()
			error("spawned thread failed")
		end)
		task.delay(0.5, function()
			error("delayed thread failed")
		end)
		local event = Instance.new("BindableEvent")
		event.Event:Connect(function()
			error("handler failed")
		end)
		local ran = false
		event.Event:Connect(function()
			ran = true
		end)
		event:Fire()
		mocks.advance(1)
		mocks.config.printErrors = true
		t.equal(#env.errors, before + 3)
		contains(env.errors[before + 1], "spawned thread failed")
		contains(env.errors[before + 1], "Harness.spec") -- message carries the source position / traceback
		contains(env.errors[before + 2], "handler failed")
		contains(env.errors[before + 3], "delayed thread failed")
		t.truthy(ran, "one failing handler does not stop the others")
		for _ = 1, 3 do
			table.remove(env.errors)
		end
	end)

	t.test("warn is collected in env.warnings", function()
		local before = #env.warnings
		warn("careful", 42)
		t.equal(env.warnings[before + 1], "careful 42")
	end)

	t.test("WaitForChild: returns, waits, times out and reports infinite yields", function()
		local folder = newFolder("WaitTest", workspace)
		newFolder("Present", folder)
		t.equal(folder:WaitForChild("Present").Name, "Present")
		task.delay(0.5, function()
			newFolder("Late", folder)
		end)
		local late
		task.spawn(function()
			late = folder:WaitForChild("Late")
		end)
		t.equal(late, nil)
		mocks.advance(1)
		t.truthy(late ~= nil and late.Name == "Late")
		local missing, failure = "unset", nil
		task.spawn(function()
			missing = folder:WaitForChild("Never", 0.5)
		end)
		task.spawn(function()
			failure = errorOf(function()
				folder:WaitForChild("Typo")
			end)
		end)
		mocks.advance(3)
		t.equal(missing, nil, "an explicit timeout returns nil")
		contains(failure, 'infinite yield: Workspace.WaitTest:WaitForChild("Typo")')
		folder:Destroy()
	end)

	------------------------------------------------------------------------------------------------------------
	-- globals and datatypes
	------------------------------------------------------------------------------------------------------------
	t.test("globals: Random, TweenInfo, typeof, math.random are deterministic and typed", function()
		local a, b = Random.new(42), Random.new(42)
		t.equal(typeof(a), "Random")
		for _ = 1, 20 do
			local value = a:NextInteger(1, 6)
			t.equal(value, b:NextInteger(1, 6))
			t.truthy(value >= 1 and value <= 6 and value % 1 == 0)
		end
		local unit = a:NextNumber()
		t.truthy(unit >= 0 and unit < 1)
		t.near(a:NextUnitVector().Magnitude, 1, 1e-4)
		local list = { 1, 2, 3, 4, 5 }
		a:Shuffle(list)
		table.sort(list)
		t.equal(list, { 1, 2, 3, 4, 5 })
		t.equal(a:Clone():NextNumber(), a:NextNumber())
		local info = TweenInfo.new(0.5, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
		t.equal(typeof(info), "TweenInfo")
		t.equal({ info.Time, info.EasingStyle, info.RepeatCount }, { 0.5, Enum.EasingStyle.Back, 0 } :: { any })
		t.throws(function()
			TweenInfo.new("fast" :: any)
		end)
		t.equal(typeof(Vector3.new()), "Vector3")
		t.equal(typeof(Enum.Material.Neon), "EnumItem")
		t.equal(typeof(RaycastParams.new()), "RaycastParams")
		local roll = math.random(1, 10)
		t.truthy(roll >= 1 and roll <= 10)
		t.throws(function()
			(RaycastParams.new() :: any).FilterDescendantInstances = {}
		end, "typo in a RaycastParams field must error")
		t.equal(workspace:Raycast(Vector3.zero, Vector3.new(0, -10, 0)), nil)
		local target = Instance.new("Part")
		target.Position = Vector3.new(0, -5, 0)
		target.Parent = workspace
		mocks.setRaycastTarget(target)
		local hit = workspace:Raycast(Vector3.zero, Vector3.new(0, -10, 0))
		t.truthy(hit and hit.Instance == target and hit.Distance == 5)
		mocks.setRaycastTarget(nil)
		target:Destroy()
		contains(errorOf(function()
			(wait :: any)(1)
		end), "task.wait")
	end)

	------------------------------------------------------------------------------------------------------------
	-- sides
	------------------------------------------------------------------------------------------------------------
	t.test("sides: separate globals and module caches, shared DataModel", function()
		local module = mocks.newScript(
			"ModuleScript",
			"SideProbe",
			[[
				local RunService = game:GetService("RunService")
				_G.loads = (_G.loads or 0) + 1
				return {
					isServer = RunService:IsServer(),
					isClient = RunService:IsClient(),
					localPlayer = game:GetService("Players").LocalPlayer,
					loads = _G.loads,
					scriptName = script.Name,
				}
			]],
			ReplicatedStorage
		)
		local player = mocks.addPlayer({ name = "SideTester", character = false })
		mocks.setLocalPlayer(player)
		local onServer = env:require(module)
		local onClient = env:requireAs("client", module)
		t.truthy(onServer ~= onClient, "each side runs the module once and gets its own value")
		t.truthy(env:requireAs("server", module) == onServer and env:requireAs("client", module) == onClient)
		t.equal({ onServer.isServer, onServer.isClient, onServer.localPlayer }, { true, false, nil } :: { any })
		t.equal({ onClient.isServer, onClient.isClient }, { false, true })
		t.truthy(onClient.localPlayer == player)
		t.equal({ onServer.loads, onClient.loads, onServer.scriptName }, { 1, 1, "SideProbe" } :: { any })
		-- the same instances are visible from both sides
		local probe = env:loadStringAs("client", [[return game:GetService("ReplicatedStorage"):FindFirstChild("SideProbe"), game, workspace]], "probe")
		local found, clientGame, clientWorkspace = probe()
		t.truthy(found == module and clientGame == game and clientWorkspace == workspace)
		-- client-only API refuses the server side
		contains(errorOf(function()
			return RunService.RenderStepped
		end), "can only be used from local scripts")
		local renders = env:loadStringAs("client", [[
			local count = 0
			game:GetService("RunService").RenderStepped:Connect(function() count += 1 end)
			return function() return count end
		]], "render")()
		mocks.step(1 / 60, 2)
		t.equal(renders(), 2)
		mocks.removePlayer(player)
	end)

	t.test("sides: cyclic requires and broken modules are reported", function()
		local a = mocks.newScript("ModuleScript", "CycleA", [[return require(script.Parent.CycleB)]], ReplicatedStorage)
		mocks.newScript("ModuleScript", "CycleB", [[return require(script.Parent.CycleA)]], ReplicatedStorage)
		contains(errorOf(function()
			env:require(a)
		end), "required recursively")
		local broken = mocks.newScript("ModuleScript", "Broken", [[error("module body failed")]], ReplicatedStorage)
		contains(errorOf(function()
			env:require(broken)
		end), "module body failed")
		local twoValues = mocks.newScript("ModuleScript", "TwoValues", [[return 1, 2]], ReplicatedStorage)
		contains(errorOf(function()
			env:require(twoValues)
		end), "did not return exactly one value")
	end)

	t.test("sides: Scripts and LocalScripts run on the side they belong to", function()
		local serverScript = mocks.newScript("Script", "ServerProbe", [[
			workspace:SetAttribute("ServerRan", game:GetService("RunService"):IsServer())
		]], game:GetService("ServerScriptService"))
		local clientScript = mocks.newScript("LocalScript", "ClientProbe", [[
			workspace:SetAttribute("ClientRan", game:GetService("RunService"):IsClient())
		]], game:GetService("ReplicatedFirst"))
		env:runScript(serverScript)
		env:runScript(clientScript)
		t.equal({ workspace:GetAttribute("ServerRan"), workspace:GetAttribute("ClientRan") }, { true, true })
		serverScript:Destroy()
		clientScript:Destroy()
	end)

	------------------------------------------------------------------------------------------------------------
	-- players and characters
	------------------------------------------------------------------------------------------------------------
	t.test("players: PlayerAdded, CharacterAdded, death, respawn and leaving", function()
		local log = {}
		local added = Players.PlayerAdded:Connect(function(player)
			table.insert(log, "joined " .. player.Name)
			player.CharacterAdded:Connect(function(character)
				table.insert(log, "character " .. character.Name)
			end)
		end)
		local removing = Players.PlayerRemoving:Connect(function(player)
			table.insert(log, "left " .. player.Name)
		end)
		local player = mocks.addPlayer({ userId = 77, name = "Ada", displayName = "Ada L.", membership = Enum.MembershipType.Premium })
		t.equal(log, { "joined Ada", "character Ada" })
		t.equal({ player.UserId, player.Name, player.DisplayName, player.MembershipType }, { 77, "Ada", "Ada L.", Enum.MembershipType.Premium } :: { any })
		t.truthy(Players:GetPlayerByUserId(77) == player and #Players:GetPlayers() == 1)
		t.truthy(player:FindFirstChildOfClass("PlayerGui") and player:FindFirstChildOfClass("Backpack") and player:FindFirstChild("PlayerScripts"))

		local character = player.Character :: any
		t.truthy(character and character.Parent == workspace and Players:GetPlayerFromCharacter(character) == player)
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		t.truthy(character.PrimaryPart == character.HumanoidRootPart and humanoid:FindFirstChildOfClass("Animator"))
		t.truthy(character.RightHand and character.Head and character.RightUpperArm.RightShoulder:IsA("Motor6D"))
		t.equal({ humanoid.Health, humanoid.MaxHealth, humanoid.RigType }, { 100, 100, Enum.HumanoidRigType.R15 } :: { any })
		character:PivotTo(CFrame.new(100, 10, 0))
		t.equal(character.HumanoidRootPart.Position, Vector3.new(100, 10, 0))
		t.near(character.Head.Position.X, 100, 1e-3, "PivotTo moves the whole rig")

		local died = 0
		humanoid.Died:Connect(function()
			died += 1
		end)
		humanoid:TakeDamage(30)
		t.equal(humanoid.Health, 70)
		humanoid.Health = 0
		humanoid.Health = 0
		mocks.flush()
		t.equal(died, 1)
		mocks.advance(Players.RespawnTime + 1)
		t.truthy(player.Character ~= character and player.Character ~= nil, "CharacterAutoLoads respawns")
		t.equal(character.Parent, nil)

		mocks.removePlayer(player)
		t.equal(log, { "joined Ada", "character Ada", "character Ada", "left Ada" })
		t.equal(#Players:GetPlayers(), 0)
		t.equal(player.Parent, nil)
		added:Disconnect()
		removing:Disconnect()
	end)

	t.test("players: Kick, friends, groups, names, R6 rigs", function()
		local alice = mocks.addPlayer({ userId = 1, name = "Alice", rigType = "R6" })
		local bob = mocks.addPlayer({ userId = 2, name = "Bob", character = false })
		t.truthy((alice.Character :: any)["Right Arm"] and (alice.Character :: any).Torso["Right Shoulder"])
		t.equal(bob.Character, nil)
		mocks.setFriends(alice, bob)
		mocks.setGroupRank(alice, 555, 200, "Admin")
		t.equal({ alice:IsFriendsWithAsync(2), bob:IsFriendsWithAsync(1), alice:IsFriendsWithAsync(3) }, { true, true, false })
		t.equal({ alice:IsInGroupAsync(555), alice:GetRankInGroupAsync(555), bob:IsInGroupAsync(555), bob:GetRankInGroupAsync(555) }, { true, 200, false, 0 } :: { any })
		t.equal(Players:GetNameFromUserIdAsync(2), "Bob")
		mocks.config.userNames[999] = "Offline"
		t.equal(Players:GetNameFromUserIdAsync(999), "Offline")
		local url, ready = Players:GetUserThumbnailAsync(1, Enum.ThumbnailType.HeadShot, Enum.ThumbnailSize.Size150x150)
		t.truthy(type(url) == "string" and ready == true)
		bob:Kick("Data could not be loaded")
		mocks.flush()
		t.equal(bob.Parent, nil)
		t.equal(mocks.kicks[#mocks.kicks].message, "Data could not be loaded")
		t.truthy(mocks.kicks[#mocks.kicks].player == bob)
		mocks.removePlayer(alice)
	end)

	------------------------------------------------------------------------------------------------------------
	-- remotes: a server snippet and a client snippet talking to each other
	------------------------------------------------------------------------------------------------------------
	t.test("remotes: RemoteEvent and RemoteFunction between server and client code", function()
		local remotes = newFolder("TestRemotes", ReplicatedStorage)
		local ping = Instance.new("RemoteEvent")
		ping.Name = "Ping"
		ping.Parent = remotes
		local ask = Instance.new("RemoteFunction")
		ask.Name = "Ask"
		ask.Parent = remotes
		local burst = Instance.new("UnreliableRemoteEvent")
		burst.Name = "Burst"
		burst.Parent = remotes

		local server = env:loadStringAs("server", [[
			local remotes = game:GetService("ReplicatedStorage"):WaitForChild("TestRemotes")
			local received = {}
			remotes.Ping.OnServerEvent:Connect(function(player, payload)
				table.insert(received, { player = player, payload = payload })
				remotes.Ping:FireClient(player, "pong", payload.count + 1)
			end)
			remotes.Ask.OnServerInvoke = function(player, question)
				task.wait(0.2) -- handlers may yield
				if question == "explode" then
					error("server handler failed")
				end
				return true, { answer = question .. "!", from = player.Name }
			end
			return received
		]], "server snippet")
		local client = env:loadStringAs("client", [[
			local remotes = game:GetService("ReplicatedStorage"):WaitForChild("TestRemotes")
			local state = { pongs = {}, bursts = 0 }
			remotes.Ping.OnClientEvent:Connect(function(word, count)
				table.insert(state.pongs, { word, count })
			end)
			remotes.Burst.OnClientEvent:Connect(function()
				state.bursts += 1
			end)
			function state.send(payload)
				remotes.Ping:FireServer(payload)
			end
			function state.ask(question)
				return remotes.Ask:InvokeServer(question)
			end
			return state
		]], "client snippet")

		local received = server()
		local player = mocks.addPlayer({ name = "Remo", isLocal = true, character = false })
		local clientState = client()

		local payload = { count = 1, nested = { 1, 2, 3 }, instance = workspace, fn = function() end }
		clientState.send(payload)
		t.equal(#received, 0, "delivery is deferred like real networking")
		mocks.flush()
		t.equal(#received, 1)
		t.truthy(received[1].player == player)
		t.truthy(received[1].payload ~= payload and received[1].payload.nested ~= payload.nested, "tables are copied")
		t.equal(received[1].payload.nested, { 1, 2, 3 })
		t.truthy(received[1].payload.instance == workspace, "instances pass by reference")
		t.equal(received[1].payload.fn, nil, "functions do not cross the network")
		t.equal(clientState.pongs, { { "pong", 2 } })

		local ok, answer
		task.spawn(function()
			ok, answer = clientState.ask("why")
		end)
		t.equal(ok, nil)
		mocks.advance(0.5)
		t.equal({ ok, answer }, { true, { answer = "why!", from = "Remo" } } :: { any })
		local failure
		task.spawn(function()
			failure = errorOf(function()
				clientState.ask("explode")
			end)
		end)
		mocks.advance(0.5)
		contains(failure, "server handler failed")

		-- server-only style: act as the client without client code, and inspect what the server sent
		mocks.clearSent()
		mocks.fireServer(player, "Ping", { count = 10 })
		t.equal(mocks.sentTo(player, "Ping"), { { "pong", 11, n = 2 } } :: { any })
		t.equal({ mocks.invokeServer(player, ask, "how") }, { true, { answer = "how!", from = "Remo" } } :: { any })
		burst:FireAllClients()
		burst:FireClient(player)
		mocks.flush()
		t.equal(clientState.bursts, 2)

		mocks.removePlayer(player)
		remotes:Destroy()
	end)

	t.test("remotes: events fired before anyone listens are queued for the first listener", function()
		local remote = Instance.new("RemoteEvent")
		remote.Parent = ReplicatedStorage
		local player = mocks.addPlayer({ name = "Early", isLocal = true, character = false })
		remote:FireClient(player, "StateInit", 1)
		remote:FireClient(player, "StateDelta", 2)
		mocks.flush()
		local got = {}
		remote.OnClientEvent:Connect(function(name, value)
			table.insert(got, { name, value })
		end)
		mocks.flush()
		t.equal(got, { { "StateInit", 1 }, { "StateDelta", 2 } } :: { any })
		mocks.removePlayer(player)
		remote:Destroy()
	end)

	------------------------------------------------------------------------------------------------------------
	-- data stores
	------------------------------------------------------------------------------------------------------------
	t.test("DataStore: UpdateAsync, copies, raw contents", function()
		local store = DataStoreService:GetDataStore("HarnessTest")
		t.equal(store:GetAsync("u_1"), nil)
		local written = { coins = 5, pets = { list = { a = { id = "a" } } } }
		store:SetAsync("u_1", written)
		written.coins = 999 -- must not affect what was stored
		local first = store:GetAsync("u_1")
		t.equal(first.coins, 5)
		first.coins = 1000 -- nor does mutating what was read
		local result = store:UpdateAsync("u_1", function(old)
			t.equal(old.coins, 5)
			old.coins += 10
			return old
		end)
		t.equal(result.coins, 15)
		t.equal(mocks.dataStores.HarnessTest.u_1.coins, 15, "tests can inspect raw contents")
		t.equal(store:UpdateAsync("u_1", function()
			return nil
		end), nil, "returning nil cancels the update")
		t.equal(store:GetAsync("u_1").coins, 15)
		mocks.dataStores.HarnessTest.u_2 = { coins = 1 } -- ... and seed them
		t.equal(store:GetAsync("u_2"), { coins = 1 })
		t.equal(store:IncrementAsync("counter", 5), 5)
		t.equal(store:RemoveAsync("u_2"), { coins = 1 })
		t.equal(store:GetAsync("u_2"), nil)
		t.truthy(DataStoreService:GetRequestBudgetForRequestType(Enum.DataStoreRequestType.UpdateAsync) > 0)
		t.equal(mocks.dataStoreCalls[1].method, "GetAsync")
	end)

	t.test("DataStore: values that cannot be stored raise errors", function()
		local store = DataStoreService:GetDataStore("HarnessValidation")
		contains(errorOf(function()
			store:SetAsync("k", { part = workspace })
		end), "value.part is a Instance")
		contains(errorOf(function()
			store:SetAsync("k", { n = 0 / 0 })
		end), "NaN")
		contains(errorOf(function()
			store:SetAsync("k", { [1] = "a", name = "mixed" })
		end), "mixes array indices and string keys")
		contains(errorOf(function()
			store:SetAsync("k", { [1] = "a", [3] = "c" })
		end), "sparse")
		contains(errorOf(function()
			store:SetAsync("k", { [10] = true })
		end), "sparse")
		contains(errorOf(function()
			store:UpdateAsync("k", function()
				return { callback = function() end }
			end)
		end), "function")
		contains(errorOf(function()
			store:UpdateAsync("k", function()
				task.wait()
				return {}
			end)
		end), "cannot yield")
		t.equal(store:GetAsync("k"), nil, "nothing was written")
	end)

	t.test("DataStore: failure injection", function()
		local store = DataStoreService:GetDataStore("HarnessFailures")
		store:SetAsync("k", { v = 1 })
		mocks.failDataStore(2)
		contains(errorOf(function()
			store:GetAsync("k")
		end), "API Services")
		t.throws(function()
			store:UpdateAsync("k", function(old)
				return old
			end)
		end)
		t.equal(store:GetAsync("k"), { v = 1 }, "the third call works again")
		mocks.failDataStore(true, mocks.dataStoreErrors.studioApiAccess, function(method)
			return method == "SetAsync"
		end)
		t.equal(store:GetAsync("k"), { v = 1 })
		contains(errorOf(function()
			store:SetAsync("k", { v = 2 })
		end), "403")
		mocks.failDataStore(0)
		store:SetAsync("k", { v = 3 })
		t.equal(mocks.dataStores.HarnessFailures.k, { v = 3 })
	end)

	t.test("DataStore: OrderedDataStore pages", function()
		local board = DataStoreService:GetOrderedDataStore("HarnessBoard")
		for index = 1, 7 do
			board:SetAsync("u_" .. index, index * 10)
		end
		t.throws(function()
			board:SetAsync("bad", 1.5)
		end)
		local pages = board:GetSortedAsync(false, 3)
		local page = pages:GetCurrentPage()
		t.equal({ #page, page[1].key, page[1].value, pages.IsFinished }, { 3, "u_7", 70, false } :: { any })
		pages:AdvanceToNextPageAsync()
		pages:AdvanceToNextPageAsync()
		t.equal({ #pages:GetCurrentPage(), pages:GetCurrentPage()[1].value, pages.IsFinished }, { 1, 10, true } :: { any })
		local ascending = board:GetSortedAsync(true, 100, 25, 55)
		t.equal(#ascending:GetCurrentPage(), 3)
		t.equal(ascending:GetCurrentPage()[1].value, 30)
	end)

	------------------------------------------------------------------------------------------------------------
	-- marketplace
	------------------------------------------------------------------------------------------------------------
	t.test("Marketplace: product purchase through ProcessReceipt, idempotent redelivery", function()
		local player = mocks.addPlayer({ userId = 500, name = "Buyer", character = false })
		local granted, seen = {}, {}
		MarketplaceService.ProcessReceipt = function(receipt)
			local buyer = Players:GetPlayerByUserId(receipt.PlayerId)
			if not buyer then
				return Enum.ProductPurchaseDecision.NotProcessedYet
			end
			if seen[receipt.PurchaseId] then
				return Enum.ProductPurchaseDecision.PurchaseGranted
			end
			task.wait(0.5) -- e.g. saving the profile
			seen[receipt.PurchaseId] = true
			table.insert(granted, receipt.ProductId)
			return Enum.ProductPurchaseDecision.PurchaseGranted
		end
		mocks.setProductInfo(9001, { Name = "100 Gems", PriceInRobux = 79 })
		t.equal(MarketplaceService:GetProductInfo(9001, Enum.InfoType.Product).PriceInRobux, 79)
		t.throws(function()
			MarketplaceService:GetProductInfo(1234, Enum.InfoType.Product)
		end, "unconfigured ids fail like unknown products do")

		MarketplaceService:PromptProductPurchase(player, 9001)
		t.equal({ mocks.prompts[#mocks.prompts].kind, mocks.prompts[#mocks.prompts].id }, { "product", 9001 } :: { any })
		local decision, receipt = mocks.buyProduct(player, 9001)
		t.equal(decision, Enum.ProductPurchaseDecision.PurchaseGranted)
		t.equal({ receipt.PlayerId, receipt.ProductId, receipt.CurrencySpent }, { 500, 9001, 79 })
		t.equal(granted, { 9001 })
		t.equal(mocks.deliverReceipt(receipt), Enum.ProductPurchaseDecision.PurchaseGranted)
		t.equal(granted, { 9001 }, "the same receipt is not granted twice")
		local _, second = mocks.buyProduct(player, 9001)
		t.truthy(second.PurchaseId ~= receipt.PurchaseId)
		t.equal(granted, { 9001, 9001 })

		-- a purchase the game could not process is delivered again when the player rejoins
		mocks.removePlayer(player)
		local pendingDecision, pending = mocks.buyProduct(500, 9001)
		t.equal(pendingDecision, Enum.ProductPurchaseDecision.NotProcessedYet)
		t.truthy(mocks.pendingReceipts[pending.PurchaseId] ~= nil)
		local again = mocks.addPlayer({ userId = 500, name = "Buyer", character = false })
		mocks.advance(5)
		t.equal(#granted, 3)
		t.equal(mocks.pendingReceipts[pending.PurchaseId], nil)
		mocks.removePlayer(again)
		MarketplaceService.ProcessReceipt = nil :: any
	end)

	t.test("Marketplace: game passes and prompts", function()
		local player = mocks.addPlayer({ userId = 600, name = "PassOwner", character = false })
		t.equal(MarketplaceService:UserOwnsGamePassAsync(600, 42), false)
		mocks.setGamePassOwned(player, 42)
		t.equal(MarketplaceService:UserOwnsGamePassAsync(600, 42), true)
		local finished
		local connection = MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(who, passId, purchased)
			finished = { who, passId, purchased }
		end)
		MarketplaceService:PromptGamePassPurchase(player, 43)
		t.equal(mocks.prompts[#mocks.prompts].kind, "gamePass")
		mocks.completeGamePassPurchase(player, 43, true)
		t.truthy(finished[1] == player and finished[2] == 43 and finished[3] == true)
		t.equal(MarketplaceService:UserOwnsGamePassAsync(600, 43), true)
		contains(errorOf(function()
			MarketplaceService:PromptGamePassPurchase(nil :: any, 43)
		end), "player must be a Player")
		connection:Disconnect()
		mocks.removePlayer(player)
	end)

	------------------------------------------------------------------------------------------------------------
	-- tweens, input, misc services
	------------------------------------------------------------------------------------------------------------
	t.test("TweenService: interpolates on the virtual clock and fires Completed", function()
		local part = Instance.new("Part")
		part.Transparency = 0
		part.Position = Vector3.zero
		local tween = TweenService:Create(part, TweenInfo.new(1, Enum.EasingStyle.Linear), { Transparency = 1, Position = Vector3.new(10, 0, 0) })
		t.equal(tween.PlaybackState, Enum.PlaybackState.Begin)
		local completed
		tween.Completed:Connect(function(state)
			completed = state
		end)
		tween:Play()
		mocks.advance(0.5, 0.1)
		t.near(part.Transparency, 0.5, 0.01)
		t.near(part.Position.X, 5, 0.1)
		t.equal(tween.PlaybackState, Enum.PlaybackState.Playing)
		t.equal(completed, nil)
		mocks.advance(1)
		t.equal({ part.Transparency, part.Position, completed }, { 1, Vector3.new(10, 0, 0), Enum.PlaybackState.Completed } :: { any })
		local cancelled = TweenService:Create(part, TweenInfo.new(5), { Transparency = 0 })
		local cancelState
		cancelled.Completed:Connect(function(state)
			cancelState = state
		end)
		cancelled:Play()
		mocks.advance(0.1)
		cancelled:Cancel()
		mocks.flush()
		t.equal(cancelState, Enum.PlaybackState.Cancelled)
		contains(errorOf(function()
			TweenService:Create(part, TweenInfo.new(1), { Transparancy = 1 })
		end), "no property named 'Transparancy'")
		contains(errorOf(function()
			TweenService:Create(part, TweenInfo.new(1), { Transparency = Vector3.one })
		end), "type mismatch")
		local debris = Instance.new("Part")
		debris.Parent = workspace
		game:GetService("Debris"):AddItem(debris, 2)
		mocks.advance(3)
		t.equal(debris.Parent, nil)
	end)

	t.test("input: UserInputService, ContextActionService, ProximityPrompt", function()
		local UserInputService = game:GetService("UserInputService")
		local ContextActionService = game:GetService("ContextActionService")
		t.equal({ UserInputService.TouchEnabled, UserInputService.KeyboardEnabled }, { false, true })
		mocks.config.input.touch = true
		t.equal(UserInputService.TouchEnabled, true)
		mocks.config.input.touch = false
		local keys = {}
		local connection = UserInputService.InputBegan:Connect(function(input, gameProcessed)
			table.insert(keys, { input.KeyCode, input.UserInputType, gameProcessed })
		end)
		mocks.input(Enum.KeyCode.E)
		mocks.input(Enum.KeyCode.F, { gameProcessed = true })
		mocks.input(Enum.UserInputType.MouseButton1)
		t.equal(keys, {
			{ Enum.KeyCode.E, Enum.UserInputType.Keyboard, false },
			{ Enum.KeyCode.F, Enum.UserInputType.Keyboard, true },
			{ Enum.KeyCode.None, Enum.UserInputType.MouseButton1, false },
		} :: { any })
		local actions = {}
		ContextActionService:BindAction("Smash", function(name, state)
			table.insert(actions, { name, state })
			return Enum.ContextActionResult.Sink
		end, false, Enum.KeyCode.E, Enum.KeyCode.ButtonX)
		mocks.inputBegan(Enum.KeyCode.E)
		t.equal(actions, { { "Smash", Enum.UserInputState.Begin } } :: { any })
		t.equal(keys[#keys][3], true, "a sunk input is reported as processed")
		mocks.triggerAction("Smash")
		t.equal(#actions, 2)
		ContextActionService:UnbindAction("Smash")
		connection:Disconnect()

		local player = mocks.addPlayer({ name = "Prompter", character = false })
		local part = Instance.new("Part")
		part.Parent = workspace
		local prompt = Instance.new("ProximityPrompt")
		prompt.ActionText = "Open"
		prompt.Parent = part
		local triggeredBy
		prompt.Triggered:Connect(function(who)
			triggeredBy = who
		end)
		mocks.triggerPrompt(prompt, player)
		t.truthy(triggeredBy == player)
		prompt.Enabled = false
		t.throws(function()
			mocks.triggerPrompt(prompt, player)
		end)
		part:Destroy()
		mocks.removePlayer(player)
	end)

	t.test("services: Policy, Badge, Social, Analytics, Http, TextChat, StarterGui, Sound", function()
		local player = mocks.addPlayer({ userId = 800, name = "Svc", character = false })
		local PolicyService = game:GetService("PolicyService")
		t.equal(PolicyService:GetPolicyInfoForPlayerAsync(player).ArePaidRandomItemsRestricted, false)
		mocks.config.policyByUserId[800] = { ArePaidRandomItemsRestricted = true }
		t.equal(PolicyService:GetPolicyInfoForPlayerAsync(player).ArePaidRandomItemsRestricted, true)
		mocks.config.policyError = "PolicyService is unavailable"
		t.throws(function()
			PolicyService:GetPolicyInfoForPlayerAsync(player)
		end)
		mocks.config.policyError = nil

		t.equal(game:GetService("BadgeService"):AwardBadge(800, 12), true)
		t.equal(mocks.badgesAwarded[#mocks.badgesAwarded], { userId = 800, badgeId = 12 })
		t.equal(game:GetService("BadgeService"):UserHasBadgeAsync(800, 12), true)

		local SocialService = game:GetService("SocialService")
		t.equal(SocialService:CanSendGameInviteAsync(player), true)
		SocialService:PromptGameInvite(player)
		t.truthy(mocks.invites[#mocks.invites].player == player)

		local AnalyticsService = game:GetService("AnalyticsService")
		AnalyticsService:LogEconomyEvent(player, Enum.AnalyticsEconomyFlowType.Source, "Coins", 10, 110, "Gameplay")
		AnalyticsService:LogOnboardingFunnelStepEvent(player, 1, "Joined")
		t.equal(mocks.analytics[#mocks.analytics - 1].method, "LogEconomyEvent")
		t.equal(mocks.analytics[#mocks.analytics].args[3], "Joined")

		local HttpService = game:GetService("HttpService")
		local json = HttpService:JSONEncode({ list = { 1, 2 }, name = "x", flag = true })
		t.equal(json, '{"flag":true,"list":[1,2],"name":"x"}')
		t.equal(HttpService:JSONDecode(json), { list = { 1, 2 }, name = "x", flag = true })
		t.truthy(HttpService:GenerateGUID(false) ~= HttpService:GenerateGUID(false))
		t.equal(#HttpService:GenerateGUID(false), 36)

		local TextChatService = game:GetService("TextChatService")
		TextChatService.OnIncomingMessage = function(message)
			local properties = Instance.new("TextChatMessageProperties")
			properties.PrefixText = "[VIP] " .. message.PrefixText
			return properties
		end
		t.equal(mocks.chat(player, "hello").PrefixText, "[VIP] Svc:")
		TextChatService.OnIncomingMessage = nil :: any
		t.truthy(TextChatService:WaitForChild("TextChannels"):FindFirstChild("RBXGeneral"))

		local StarterGui = game:GetService("StarterGui")
		StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false)
		t.equal(StarterGui:GetCoreGuiEnabled(Enum.CoreGuiType.Backpack), false)
		mocks.config.setCoreFailures = 1
		t.throws(function()
			StarterGui:SetCore("ResetButtonCallback", false)
		end)
		StarterGui:SetCore("ResetButtonCallback", false)
		t.equal(mocks.coreCalls[#mocks.coreCalls].name, "ResetButtonCallback")
		local inset = game:GetService("GuiService"):GetGuiInset()
		t.equal(typeof(inset), "Vector2")

		local sound = Instance.new("Sound")
		sound.SoundId = "rbxasset://sounds/button.wav"
		sound:Play()
		t.equal(sound.IsPlaying, true)
		t.equal(mocks.soundsPlayed[#mocks.soundsPlayed].soundId, "rbxasset://sounds/button.wav")
		sound:Stop()
		t.equal(sound.IsPlaying, false)

		local camera = workspace.CurrentCamera :: Camera
		t.equal(camera.ViewportSize, Vector2.new(1280, 720))
		local screenPoint, onScreen = camera:WorldToViewportPoint(camera.CFrame.Position + camera.CFrame.LookVector * 10)
		t.truthy(onScreen)
		t.near(screenPoint.X, 640, 0.01)
		t.near(camera:ViewportPointToRay(640, 360).Direction:Dot(camera.CFrame.LookVector), 1, 1e-4)
		mocks.removePlayer(player)
	end)

	t.test("game: ids, IsStudio, BindToClose and env.mocks.shutdown", function()
		t.truthy(game.PlaceId ~= 0 and game.JobId ~= "" and game.GameId ~= 0)
		mocks.config.placeId = 0
		t.equal(game.PlaceId, 0)
		mocks.config.placeId = 1001
		t.equal(RunService:IsStudio(), true)
		mocks.config.isStudio = false
		t.equal(RunService:IsStudio(), false)
		mocks.config.isStudio = true
		t.equal(game:IsLoaded(), true)
		local saved = {}
		game:BindToClose(function()
			task.wait(2) -- e.g. saving every profile
			table.insert(saved, "a")
		end)
		game:BindToClose(function()
			table.insert(saved, "b")
		end)
		t.equal(mocks.shutdown(), true)
		t.equal(saved, { "b", "a" })
	end)

	t.test("the project tree from default.project.json is present", function()
		t.truthy(ReplicatedStorage:FindFirstChild("Shared") and ReplicatedStorage:FindFirstChild("Client"))
		t.truthy(game:GetService("ServerScriptService"):FindFirstChild("Server"))
		t.truthy(game:GetService("StarterPlayer"):FindFirstChild("StarterPlayerScripts"))
		t.equal(workspace.StreamingEnabled, false)
		t.equal(game:GetService("StarterGui").ScreenOrientation, Enum.ScreenOrientation.LandscapeSensor)
		t.equal(env.errors, {}, "no unexpected errors were collected while these tests ran")
	end)
end
