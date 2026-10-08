--!strict
-- Tekent de slijmpjes op de Goo-rivier. Hun positie volgt uit de spawntijd en de snelheid,
-- dus iedereen ziet hetzelfde zonder dat de server elke frame posities hoeft te sturen.
-- Gekochte slijmpjes springen in een boog naar hun platform.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Slimes = require(Shared:WaitForChild("Slimes"))
local Layout = require(Shared:WaitForChild("Layout"))
local Format = require(Shared:WaitForChild("Format"))

local Client = script.Parent
local SlimeModel = require(Client:WaitForChild("SlimeModel"))
local Ui = require(Client:WaitForChild("Ui"))
local Sound = require(Client:WaitForChild("Sound"))

local StreamView = {}

type Item = { cfg: Configuration, visual: SlimeModel.Visual, spawn: number, prompt: ProximityPrompt, soldFrom: CFrame? }

local items: { [Configuration]: Item } = {}
local player = Players.LocalPlayer
local folder = Instance.new("Folder")
folder.Name = "RiverSlimes"
folder.Parent = Workspace

local function slimeOf(cfg: Configuration): Slimes.Slime
	local mut = cfg:GetAttribute("Mut")
	return {
		s = tostring(cfg:GetAttribute("Species")),
		m = if typeof(mut) == "string" and mut ~= "" then mut else nil,
		f = 0,
	}
end

local function riverCFrame(spawn: number, t: number): CFrame
	local dist = (t - spawn) * Config.STREAM_SPEED
	local x, z, angle = Layout.riverAt(dist)
	local pos = Vector3.new(x, Layout.RIVER_Y, z)
	return CFrame.lookAt(pos, pos + Vector3.new(math.cos(angle), 0, math.sin(angle)))
end

local function padCFrame(userId: number, pad: number): CFrame?
	for _, lab in (Workspace:WaitForChild("Labs")):GetChildren() do
		if lab:GetAttribute("Owner") == userId then
			local part = lab:FindFirstChild("Pads") and (lab :: any).Pads:FindFirstChild("Pad" .. pad)
			if part and part:IsA("BasePart") then
				return CFrame.new(part.Position.X, Layout.PAD_TOP, part.Position.Z)
			end
		end
	end
	return nil
end

local function add(cfg: Configuration)
	if items[cfg] then
		return
	end
	local slime = slimeOf(cfg)
	local info = Slimes.BY_ID[slime.s]
	if not info then
		return
	end
	local visual = SlimeModel.build(slime.s, slime.m, 0)
	local rarity = Slimes.RARITIES[info.rarity]

	local gui, rows = Ui.billboard(visual.root, visual.size * 1.15 + 2.2, 6, 3, 75)
	rows[1].Text = Slimes.displayName(slime)
	rows[1].TextColor3 = if slime.m then Ui.rgb(Slimes.MUTATIONS[slime.m].color) else Ui.WHITE
	rows[2].Text = string.upper(info.rarity)
	rows[2].TextColor3 = Ui.rgb(rarity.color)
	rows[3].Text = Format.number(Slimes.price(slime)) .. " Goo  |  +" .. Format.number(Slimes.income(slime)) .. "/s"
	rows[3].TextColor3 = Color3.fromRGB(150, 255, 170)
	gui.Parent = visual.root

	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Buy " .. Format.number(Slimes.price(slime))
	prompt.ObjectText = Slimes.displayName(slime)
	prompt.HoldDuration = 0.15
	prompt.MaxActivationDistance = 13
	prompt.RequiresLineOfSight = false
	prompt.KeyboardKeyCode = Enum.KeyCode.E
	prompt.Parent = visual.root
	prompt.Triggered:Connect(function()
		Sound.play("buy")
		local remote = ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("Buy") :: RemoteEvent
		remote:FireServer(cfg.Name)
	end)

	visual.model.Parent = folder
	items[cfg] = { cfg = cfg, visual = visual, spawn = tonumber(cfg:GetAttribute("Spawn")) or 0, prompt = prompt, soldFrom = nil }
end

local function remove(cfg: Configuration)
	local item = items[cfg]
	if item then
		items[cfg] = nil
		SlimeModel.destroy(item.visual)
	end
end

function StreamView.start()
	local stream = ReplicatedStorage:WaitForChild("Stream")
	for _, child in stream:GetChildren() do
		if child:IsA("Configuration") then
			add(child)
		end
	end
	stream.ChildAdded:Connect(function(child)
		if child:IsA("Configuration") then
			add(child)
		end
	end)
	stream.ChildRemoved:Connect(function(child)
		if child:IsA("Configuration") then
			remove(child)
		end
	end)

	RunService.RenderStepped:Connect(function()
		local t = Workspace:GetServerTimeNow()
		local camera = Workspace.CurrentCamera
		local camPos = if camera then camera.CFrame.Position else Vector3.zero
		for cfg, item in items do
			local buyer = tonumber(cfg:GetAttribute("Buyer"))
			if buyer then
				-- Gekocht: in een boog naar het platform van de koper.
				item.prompt.Enabled = false
				local soldAt = tonumber(cfg:GetAttribute("SoldAt")) or t
				local from = item.soldFrom or riverCFrame(item.spawn, soldAt)
				item.soldFrom = from
				local target = padCFrame(buyer, tonumber(cfg:GetAttribute("BuyPad")) or 0)
				local p = math.clamp((t - soldAt) / 0.9, 0, 1)
				if target and p < 1 then
					local a, b = from.Position, target.Position
					local pos = a:Lerp(b, p) + Vector3.new(0, math.sin(p * math.pi) * 30, 0)
					SlimeModel.place(item.visual, CFrame.new(pos) * from.Rotation, t, 0.3)
				else
					item.visual.model.Parent = nil
				end
				if buyer == player.UserId and p >= 1 and item.visual.model.Parent == nil then
					remove(cfg)
				end
			else
				local cf = riverCFrame(item.spawn, t)
				local near = (cf.Position - camPos).Magnitude < 220
				SlimeModel.place(item.visual, cf, t, if near then 1 else 0)
			end
		end
	end)
end

return StreamView
