--!strict
-- Spuitgat/lanceerplatforms en zweven met de glider.
-- Zweven gaat vanzelf als je valt; met G (of de GLIDE-knop) klap je hem dicht.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local CollectionService = game:GetService("CollectionService")
local TweenService = game:GetService("TweenService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Remotes = ReplicatedStorage:WaitForChild("Remotes")
local SetGliding = Remotes:WaitForChild("SetGliding") :: RemoteEvent

local player = Players.LocalPlayer

local Movement = {}

local launchedEvent = Instance.new("BindableEvent")
Movement.Launched = launchedEvent.Event
local glideEvent = Instance.new("BindableEvent")
Movement.GlideChanged = glideEvent.Event -- (gliding: boolean, closedByPlayer: boolean)

local gliding = false
local gliderClosed = false
local launched = false
local airborneSince: number? = nil
local lastLaunch = 0
local launchers: { BasePart } = {}

local function addLauncher(inst: Instance)
	if inst:IsA("BasePart") and not table.find(launchers, inst) then
		table.insert(launchers, inst)
	end
end

local function removeLauncher(inst: Instance)
	local i = table.find(launchers, inst :: any)
	if i then
		table.remove(launchers, i)
	end
end

local function setGliding(on: boolean)
	if on == gliding then
		return
	end
	gliding = on
	SetGliding:FireServer(on)
	glideEvent:Fire(on, gliderClosed)
	local camera = Workspace.CurrentCamera
	if camera then
		TweenService:Create(camera, TweenInfo.new(0.4), { FieldOfView = if on then 80 else 70 }):Play()
	end
end

function Movement.isGliding(): boolean
	return gliding
end

function Movement.isClosed(): boolean
	return gliderClosed
end

function Movement.toggle()
	gliderClosed = not gliderClosed
	glideEvent:Fire(gliding and not gliderClosed, gliderClosed)
end

local function playWhoosh(root: BasePart)
	local sound = Instance.new("Sound")
	sound.SoundId = "rbxasset://sounds/swordlunge.wav"
	sound.Volume = 0.6
	sound.PlaybackSpeed = 0.7
	sound.Parent = root
	sound:Play()
	task.delay(2, function()
		sound:Destroy()
	end)
end

local function tryLaunch(humanoid: Humanoid, root: BasePart)
	if os.clock() - lastLaunch < 1 then
		return
	end
	local pos = root.Position
	for _, pad in launchers do
		if pad.Parent then
			local offset = pos - pad.Position
			local radius = ((tonumber(pad:GetAttribute("Radius")) or 6)) + 1
			local flat = Vector3.new(offset.X, 0, offset.Z).Magnitude
			if flat <= radius and offset.Y > -1 and offset.Y < 8 then
				lastLaunch = os.clock()
				launched = true
				airborneSince = os.clock()
				gliderClosed = false
				local v = root.AssemblyLinearVelocity
				humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
				root.AssemblyLinearVelocity = Vector3.new(v.X * 0.2, (tonumber(pad:GetAttribute("LaunchVelocity")) or Config.LAUNCH_VELOCITY), v.Z * 0.2)
				playWhoosh(root)
				launchedEvent:Fire()
				return
			end
		end
	end
end

local function step()
	local character = player.Character
	if character == nil then
		return
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	local root = character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if humanoid == nil or root == nil or humanoid.Health <= 0 then
		setGliding(false)
		return
	end

	tryLaunch(humanoid, root)

	local state = humanoid:GetState()
	local inAir = state == Enum.HumanoidStateType.Freefall or state == Enum.HumanoidStateType.Jumping
	if not inAir then
		airborneSince = nil
		launched = false
		gliderClosed = false
		setGliding(false)
		return
	end
	if airborneSince == nil then
		airborneSince = os.clock()
	end

	local velocity = root.AssemblyLinearVelocity
	local longFall = os.clock() - (airborneSince :: number) > 0.9
	setGliding(not gliderClosed and (launched or longFall) and velocity.Y < 0)

	if gliding then
		local move = humanoid.MoveDirection
		local look = root.CFrame.LookVector
		local dir = if move.Magnitude > 0.1 then move.Unit else Vector3.new(look.X, 0, look.Z).Unit
		local speed = ((tonumber(player:GetAttribute("GliderSpeed")) or 45)) * (if move.Magnitude > 0.1 then 1 else 0.55)
		root.AssemblyLinearVelocity = Vector3.new(dir.X * speed, math.max(velocity.Y, -Config.GLIDE_FALL_SPEED), dir.Z * speed)
	end
end

function Movement.start()
	for _, inst in CollectionService:GetTagged("Launcher") do
		addLauncher(inst)
	end
	CollectionService:GetInstanceAddedSignal("Launcher"):Connect(addLauncher)
	CollectionService:GetInstanceRemovedSignal("Launcher"):Connect(removeLauncher)

	-- Het spuitgat staat altijd in de map; zoek het ook op naam, voor de zekerheid.
	task.spawn(function()
		local whale = Workspace:WaitForChild("SkyWhale")
		addLauncher(whale:WaitForChild("Blowhole"))
	end)

	UserInputService.InputBegan:Connect(function(input, processed)
		if not processed and input.KeyCode == Enum.KeyCode.G then
			Movement.toggle()
		end
	end)

	RunService.Heartbeat:Connect(step)
end

return Movement
