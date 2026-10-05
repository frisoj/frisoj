--!strict
-- Alles wat de wereld levend laat voelen, alleen op de client:
-- wolken die langs drijven, de staart die beweegt, zwevende Driftlings,
-- het Forecast-bord en de "JUMP IN!"-hint boven het spuitgat.

local Workspace = game:GetService("Workspace")
local RunService = game:GetService("RunService")
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local SkyForecast = require(Shared:WaitForChild("SkyForecast"))
local Biomes = require(Shared:WaitForChild("Biomes"))
local Format = require(Shared:WaitForChild("Format"))

local Client = script.Parent
local Movement = require(Client:WaitForChild("Movement"))

local WorldFx = {}

local CLOUD_SPEED = 7 -- studs per seconde: de walvis "zwemt" langs de wolken
local WRAP = 1000

type Bobber = { base: CFrame, phase: number }
local bobbers: { [Model]: Bobber } = {}

local function trackDriftling(inst: Instance)
	if inst:IsA("Model") and bobbers[inst] == nil then
		bobbers[inst] = { base = inst:GetPivot(), phase = math.random() * math.pi * 2 }
	end
end

local function setupClouds(): () -> ()
	local puffs = Workspace:WaitForChild("CloudSea"):WaitForChild("Puffs")
	local parts: { BasePart } = {}
	local bases: { CFrame } = {}
	for _, p in puffs:GetChildren() do
		if p:IsA("BasePart") then
			table.insert(parts, p)
			table.insert(bases, p.CFrame)
		end
	end
	local offset = 0
	local cframes: { CFrame } = table.create(#parts)
	return function()
		offset += CLOUD_SPEED / 30
		for i, base in bases do
			local x = (base.X + offset + WRAP) % (2 * WRAP) - WRAP
			cframes[i] = CFrame.new(x, base.Y, base.Z) * base.Rotation
		end
		Workspace:BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged)
	end
end

local function setupTail(): (number) -> ()
	local tail = Workspace:WaitForChild("SkyWhale"):WaitForChild("Tail")
	local root = tail:WaitForChild("Root") :: BasePart
	local parts: { BasePart } = {}
	local offsets: { CFrame } = {}
	for _, p in tail:GetChildren() do
		if p:IsA("BasePart") and p ~= root then
			table.insert(parts, p)
			table.insert(offsets, root.CFrame:ToObjectSpace(p.CFrame))
		end
	end
	local cframes: { CFrame } = table.create(#parts)
	return function(t: number)
		local swing = CFrame.Angles(0, 0, math.sin(t * 0.9) * math.rad(9))
		for i, offset in offsets do
			cframes[i] = root.CFrame * swing * offset
		end
		Workspace:BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged)
	end
end

local function setupBoard(): () -> ()
	local board = Workspace:WaitForChild("SkyWhale"):WaitForChild("ForecastBoard") :: BasePart
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.CanvasSize = Vector2.new(800, 480)
	gui.LightInfluence = 0
	gui.Parent = board

	local bg = Instance.new("Frame")
	bg.Size = UDim2.fromScale(1, 1)
	bg.BackgroundColor3 = Color3.fromRGB(16, 30, 52)
	bg.Parent = gui

	local function label(text: string, y: number, h: number, font: Enum.Font, color: Color3): TextLabel
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.Position = UDim2.new(0, 30, 0, y)
		l.Size = UDim2.new(1, -60, 0, h)
		l.Font = font
		l.TextScaled = true
		l.TextColor3 = color
		l.TextXAlignment = Enum.TextXAlignment.Left
		l.Text = text
		l.Parent = bg
		return l
	end

	label("SKY FORECAST", 18, 44, Enum.Font.FredokaOne, Color3.fromRGB(150, 200, 255))
	local now = label("", 74, 86, Enum.Font.FredokaOne, Color3.new(1, 1, 1))
	local sub = label("", 162, 40, Enum.Font.GothamMedium, Color3.fromRGB(200, 215, 235))
	local rows: { TextLabel } = {}
	for i = 1, 4 do
		rows[i] = label("", 220 + (i - 1) * 56, 44, Enum.Font.GothamBold, Color3.fromRGB(230, 236, 245))
	end

	return function()
		local t = Workspace:GetServerTimeNow()
		local id, left = SkyForecast.current(t)
		local b = Biomes.get(id)
		now.Text = b.name
		now.TextColor3 = b.uiColor
		sub.Text = (if b.mutation then b.mutation .. " x" .. Biomes.MUTATIONS[b.mutation].mult .. "  ·  " else "") .. "next in " .. Format.clock(left)
		for i, slot in SkyForecast.upcoming(t, 4) do
			local nb = Biomes.get(slot.id)
			rows[i].Text = Format.clock(slot.startsAt - t) .. "   " .. nb.name
			rows[i].TextColor3 = nb.uiColor
		end
	end
end

local function setupHint()
	local blowhole = Workspace:WaitForChild("SkyWhale"):WaitForChild("Blowhole") :: BasePart
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromOffset(220, 70)
	gui.StudsOffset = Vector3.new(0, 9, 0)
	gui.AlwaysOnTop = true
	gui.MaxDistance = 120
	gui.LightInfluence = 0
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Size = UDim2.fromScale(1, 1)
	l.Font = Enum.Font.FredokaOne
	l.TextScaled = true
	l.Text = "JUMP IN!\nv"
	l.TextColor3 = Color3.fromRGB(255, 230, 120)
	l.TextStrokeTransparency = 0.2
	l.Parent = gui
	gui.Parent = blowhole
	Movement.Launched:Connect(function()
		gui.Enabled = false
	end)
end

function WorldFx.start()
	for _, inst in CollectionService:GetTagged("Driftling") do
		trackDriftling(inst)
	end
	CollectionService:GetInstanceAddedSignal("Driftling"):Connect(trackDriftling)
	CollectionService:GetInstanceRemovedSignal("Driftling"):Connect(function(inst)
		bobbers[inst :: any] = nil
	end)

	task.spawn(function()
		local moveClouds = setupClouds()
		local moveTail = setupTail()
		local updateBoard = setupBoard()
		setupHint()

		local acc = 0
		local boardAcc = 1
		RunService.RenderStepped:Connect(function(dt)
			local t = os.clock()
			acc += dt
			boardAcc += dt
			if acc >= 1 / 30 then
				acc = 0
				moveClouds()
				moveTail(t)
				for model, b in bobbers do
					if model.Parent then
						model:PivotTo(b.base * CFrame.new(0, math.sin(t * 2 + b.phase) * 1.2, 0) * CFrame.Angles(0, math.sin(t * 0.7 + b.phase) * 0.5, 0))
					end
				end
			end
			if boardAcc >= 0.5 then
				boardAcc = 0
				updateBoard()
			end
		end)
	end)
end

return WorldFx
