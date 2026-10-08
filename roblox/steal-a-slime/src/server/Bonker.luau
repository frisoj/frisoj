--!strict
-- De Bonker: een zachte hamer die iedereen krijgt. Wie een dief raakt, stuurt het
-- gestolen slijmpje terug naar huis. Anderen worden alleen een stukje weggeduwd.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local Server = script.Parent
local Steal = require(Server:WaitForChild("Steal"))
local Remotes = require(Server:WaitForChild("Remotes"))

local Bonker = {}

local lastBonk: { [Player]: number } = {}
local GRIP = CFrame.new(0, -1.2, 0) * CFrame.Angles(0, 0, 0)
local SWING = CFrame.new(0, -1.2, 0) * CFrame.Angles(math.rad(-80), 0, 0)

local function build(): Tool
	local tool = Instance.new("Tool")
	tool.Name = "Bonker"
	tool.ToolTip = "Bonk thieves to send slimes home!"
	tool.CanBeDropped = false
	tool.RequiresHandle = true
	tool.Grip = GRIP

	local handle = Instance.new("Part")
	handle.Name = "Handle"
	handle.Size = Vector3.new(0.5, 3.6, 0.5)
	handle.Color = Color3.fromRGB(170, 110, 255)
	handle.Material = Enum.Material.SmoothPlastic
	handle.CanCollide = false
	handle.Massless = true
	handle.Parent = tool

	local head = Instance.new("Part")
	head.Name = "Head"
	head.Shape = Enum.PartType.Ball
	head.Size = Vector3.new(2.4, 2.4, 2.4)
	head.Color = Color3.fromRGB(110, 255, 160)
	head.Material = Enum.Material.SmoothPlastic
	head.Transparency = 0.15
	head.CanCollide = false
	head.Massless = true
	head.CFrame = handle.CFrame * CFrame.new(0, 2.6, 0)
	head.Parent = tool
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = handle
	weld.Part1 = head
	weld.Parent = head

	local shine = Instance.new("Part")
	shine.Name = "Shine"
	shine.Shape = Enum.PartType.Ball
	shine.Size = Vector3.new(0.7, 0.7, 0.7)
	shine.Color = Color3.new(1, 1, 1)
	shine.Material = Enum.Material.Neon
	shine.CanCollide = false
	shine.Massless = true
	shine.CFrame = head.CFrame * CFrame.new(-0.55, 0.6, -0.55)
	shine.Parent = tool
	local weld2 = Instance.new("WeldConstraint")
	weld2.Part0 = head
	weld2.Part1 = shine
	weld2.Parent = shine
	return tool
end

local function swing(player: Player, tool: Tool)
	local t = os.clock()
	if (lastBonk[player] or 0) > t - Config.BONK_COOLDOWN then
		return
	end
	lastBonk[player] = t
	tool.Grip = SWING
	task.delay(0.18, function()
		if tool.Parent then
			tool.Grip = GRIP
		end
	end)

	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then
		return
	end
	local look = root.CFrame.LookVector
	local best: Player? = nil
	local bestDist = Config.BONK_RANGE
	for _, other in Players:GetPlayers() do
		if other ~= player then
			local oc = other.Character
			local oroot = oc and oc:FindFirstChild("HumanoidRootPart") :: BasePart?
			local hum = oc and oc:FindFirstChildOfClass("Humanoid")
			if oroot and hum and hum.Health > 0 then
				local offset = oroot.Position - root.Position
				local dist = offset.Magnitude
				if dist < bestDist and (dist < 3 or offset.Unit:Dot(look) > 0.2) then
					best = other
					bestDist = dist
				end
			end
		end
	end
	if best then
		local target = best :: Player
		Remotes.Effect:FireAllClients("bonk", root.Position + look * 3, { by = player.UserId, target = target.UserId })
		local troot = target.Character and target.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
		if troot then
			local dir = (troot.Position - root.Position) * Vector3.new(1, 0, 1)
			Remotes.Knockback:FireClient(target, if dir.Magnitude > 0.1 then dir.Unit else look)
		end
		Steal.onBonk(target, player)
	end
end

function Bonker.give(player: Player)
	local backpack = player:FindFirstChildOfClass("Backpack")
	if not backpack or backpack:FindFirstChild("Bonker") then
		return
	end
	local tool = build()
	tool.Activated:Connect(function()
		swing(player, tool)
	end)
	tool.Parent = backpack
end

function Bonker.start()
	Players.PlayerRemoving:Connect(function(player)
		lastBonk[player] = nil
	end)
end

return Bonker
