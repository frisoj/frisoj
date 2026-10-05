--!strict
-- Verdeelt de acht nesten op de rug van de walvis en zet de Driftlings van
-- elke speler zichtbaar in zijn nest.

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Driftlings = require(Shared:WaitForChild("Driftlings"))
local Format = require(Shared:WaitForChild("Format"))
local DriftlingModel = require(script.Parent:WaitForChild("DriftlingModel"))
local PlayerData = require(script.Parent:WaitForChild("PlayerData"))

local NestService = {}

local whale = Workspace:WaitForChild("SkyWhale")
local nestsFolder = whale:WaitForChild("Nests")

local owners: { [number]: Player } = {}
local nestOf: { [Player]: number } = {}

-- Plekken op het nest: midden, ring van 7, ring van 12 (maximaal 20).
local SLOTS: { Vector3 } = { Vector3.zero }
for i = 0, 6 do
	local a = i / 7 * math.pi * 2
	table.insert(SLOTS, Vector3.new(math.cos(a) * 6, 0, math.sin(a) * 6))
end
for i = 0, 11 do
	local a = (i + 0.5) / 12 * math.pi * 2
	table.insert(SLOTS, Vector3.new(math.cos(a) * 11, 0, math.sin(a) * 11))
end

local function nestModel(index: number): Model?
	return nestsFolder:FindFirstChild("Nest" .. index) :: Model?
end

local function padOf(model: Model): BasePart
	return model:WaitForChild("Pad") :: BasePart
end

-- Bovenkant van het nest (de Pad is een liggende cilinder: Size.X is de dikte).
local function padTop(pad: BasePart): Vector3
	return pad.Position + Vector3.new(0, pad.Size.X / 2, 0)
end

local function sign(model: Model): (BillboardGui, TextLabel, TextLabel)
	local pad = padOf(model)
	local gui = pad:FindFirstChild("OwnerSign") :: BillboardGui?
	if gui == nil then
		local g = Instance.new("BillboardGui")
		g.Name = "OwnerSign"
		g.Size = UDim2.fromOffset(240, 64)
		g.StudsOffset = Vector3.new(0, 14, 0)
		g.MaxDistance = 160
		g.LightInfluence = 0
		g.Parent = pad

		local title = Instance.new("TextLabel")
		title.Name = "Title"
		title.BackgroundTransparency = 1
		title.Size = UDim2.new(1, 0, 0.6, 0)
		title.Font = Enum.Font.FredokaOne
		title.TextScaled = true
		title.TextColor3 = Color3.new(1, 1, 1)
		title.TextStrokeTransparency = 0.4
		title.Parent = g

		local sub = Instance.new("TextLabel")
		sub.Name = "Sub"
		sub.BackgroundTransparency = 1
		sub.Position = UDim2.fromScale(0, 0.6)
		sub.Size = UDim2.new(1, 0, 0.4, 0)
		sub.Font = Enum.Font.GothamBold
		sub.TextScaled = true
		sub.TextColor3 = Color3.fromRGB(255, 225, 140)
		sub.TextStrokeTransparency = 0.5
		sub.Parent = g
		gui = g
	end
	local g = gui :: BillboardGui
	return g, g:WaitForChild("Title") :: TextLabel, g:WaitForChild("Sub") :: TextLabel
end

local function driftlingFolder(model: Model): Folder
	local folder = model:FindFirstChild("Driftlings") :: Folder?
	if folder == nil then
		local f = Instance.new("Folder")
		f.Name = "Driftlings"
		f.Parent = model
		folder = f
	end
	return folder :: Folder
end

function NestService.assign(player: Player): number?
	for i = 1, 8 do
		if not owners[i] and nestModel(i) ~= nil then
			owners[i] = player
			nestOf[player] = i
			player:SetAttribute("NestIndex", i)
			local _, title, sub = sign(nestModel(i) :: Model)
			title.Text = player.DisplayName .. "'s Nest"
			sub.Text = ""
			return i
		end
	end
	return nil
end

function NestService.release(player: Player)
	local index = nestOf[player]
	if index == nil then
		return
	end
	nestOf[player] = nil
	owners[index] = nil
	local model = nestModel(index)
	if model then
		driftlingFolder(model):ClearAllChildren()
		local _, title, sub = sign(model)
		title.Text = "Free Nest"
		sub.Text = "Join with a friend!"
	end
end

-- Zet de Driftlings uit de save in het nest.
function NestService.render(player: Player)
	local index = nestOf[player]
	local data = PlayerData.get(player)
	if index == nil or data == nil then
		return
	end
	local model = nestModel(index) :: Model
	local folder = driftlingFolder(model)
	folder:ClearAllChildren()

	local top = padTop(padOf(model))
	local facing = Vector3.new(0, 0, if top.Z > 0 then -1 else 1) -- kijk naar het middenpad
	for i, entry in data.nest do
		local offset = SLOTS[i]
		if not offset then
			break
		end
		local species = Driftlings.SPECIES[entry.s]
		local size = if species then Driftlings.RARITY_BY_ID[species.rarity].size * 0.9 else 3
		local pos = top + offset + Vector3.new(0, size / 2 + 0.8, 0)
		local m = DriftlingModel.build(entry.s, entry.m, CFrame.lookAt(pos, pos + facing), 0.9)
		m.Parent = folder
	end
end

-- Werkt het bordje boven het nest bij (inkomen per minuut).
function NestService.updateSign(player: Player, ratePerMinute: number)
	local index = nestOf[player]
	if index == nil then
		return
	end
	local _, _, sub = sign(nestModel(index) :: Model)
	sub.Text = "+" .. Format.number(ratePerMinute) .. " Pearls/min"
end

function NestService.init()
	for i = 1, 8 do
		local model = nestModel(i)
		if model then
			local _, title, sub = sign(model)
			title.Text = "Free Nest"
			sub.Text = "Join with a friend!"
		end
	end
end

return NestService
