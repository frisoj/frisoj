--!strict
-- Wereld-dingen op de server: wolken, terug naar de walvis als je valt,
-- glider-vleugels op je personage en de voerbak.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local Server = script.Parent
local Economy = require(Server:WaitForChild("Economy"))
local Remotes = require(Server:WaitForChild("Remotes"))

local WorldService = {}

local whale = Workspace:WaitForChild("SkyWhale")
local spawnLocation = whale:WaitForChild("Spawn") :: BasePart
local trough = whale:WaitForChild("FeedingTrough") :: BasePart

local function setupClouds()
	local terrain = Workspace:FindFirstChildOfClass("Terrain")
	if terrain and terrain:FindFirstChildOfClass("Clouds") == nil then
		local clouds = Instance.new("Clouds")
		clouds.Cover = 0.55
		clouds.Density = 0.35
		clouds.Parent = terrain
	end
end

local function rescueLoop()
	while true do
		task.wait(0.5)
		for _, player in Players:GetPlayers() do
			local character = player.Character
			local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
			if character and root and root.Position.Y < Config.FALL_RESCUE_Y then
				root.AssemblyLinearVelocity = Vector3.zero
				character:PivotTo(spawnLocation.CFrame + Vector3.new(0, 5, 0))
			end
		end
	end
end

-- Twee vleugels op de rug. Onzichtbaar tot de client meldt dat je zweeft.
local function addGlider(character: Model)
	local torso = (character:WaitForChild("UpperTorso", 5) or character:FindFirstChild("Torso")) :: BasePart?
	if torso == nil then
		return
	end
	local folder = Instance.new("Folder")
	folder.Name = "Glider"
	for _, side in { -1, 1 } do
		local wing = Instance.new("Part")
		wing.Name = "Wing"
		wing.Size = Vector3.new(7, 0.3, 3)
		wing.Color = Color3.fromRGB(235, 245, 255)
		wing.Material = Enum.Material.SmoothPlastic
		wing.CanCollide = false
		wing.CanQuery = false
		wing.CanTouch = false
		wing.Massless = true
		wing.CastShadow = false
		wing.Transparency = 1
		wing.CFrame = torso.CFrame * CFrame.new(side * 3.8, 0.6, 0.8) * CFrame.Angles(0, 0, side * math.rad(12))
		local weld = Instance.new("WeldConstraint")
		weld.Part0 = torso
		weld.Part1 = wing
		weld.Parent = wing
		wing.Parent = folder
	end
	folder.Parent = character
end

local function onSetGliding(player: Player, gliding: unknown)
	if type(gliding) ~= "boolean" then
		return
	end
	local folder = player.Character and player.Character:FindFirstChild("Glider")
	if folder == nil then
		return
	end
	for _, wing in folder:GetChildren() do
		if wing:IsA("BasePart") then
			wing.Transparency = if gliding then 0 else 1
		end
	end
end

local function setupTrough()
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Feed the whale"
	prompt.ObjectText = "Whale Trough"
	prompt.HoldDuration = 0.4
	prompt.MaxActivationDistance = 14
	prompt.RequiresLineOfSight = false
	prompt.Parent = trough
	prompt.Triggered:Connect(function(player)
		Economy.feed(player)
	end)

	local gui = Instance.new("BillboardGui")
	gui.Name = "Hunger"
	gui.Size = UDim2.fromOffset(260, 70)
	gui.StudsOffset = Vector3.new(0, 9, 0)
	gui.MaxDistance = 140
	gui.LightInfluence = 0
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextStrokeTransparency = 0.4
	label.Parent = gui
	gui.Parent = trough

	local function update()
		local count = (tonumber(Workspace:GetAttribute("FeedCount")) or 0)
		label.Text = string.format("WHALE HUNGER\n%d / %d", count, Config.FEED_GOAL)
	end
	Workspace:GetAttributeChangedSignal("FeedCount"):Connect(update)
	update()
end

function WorldService.start()
	Workspace:SetAttribute("FeedCount", 0)
	Workspace:SetAttribute("FeedGoal", Config.FEED_GOAL)
	setupClouds()
	setupTrough()
	Remotes.SetGliding.OnServerEvent:Connect(onSetGliding)
	Players.PlayerAdded:Connect(function(player)
		player.CharacterAdded:Connect(addGlider)
	end)
	for _, player in Players:GetPlayers() do
		player.CharacterAdded:Connect(addGlider)
		if player.Character then
			task.spawn(addGlider, player.Character)
		end
	end
	task.spawn(rescueLoop)
end

return WorldService
