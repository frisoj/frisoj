--!strict
-- Tekent de labs: slijmpjes op de platforms (uit de attributen van de server), gesloten
-- platforms, de laserpoort met aftelling, het schild, de Goo-tank bij de Collect Pad,
-- en slijmpjes die boven het hoofd van een dief zweven.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Slimes = require(Shared:WaitForChild("Slimes"))
local Format = require(Shared:WaitForChild("Format"))
local Layout = require(Shared:WaitForChild("Layout"))

local Client = script.Parent
local SlimeModel = require(Client:WaitForChild("SlimeModel"))
local Ui = require(Client:WaitForChild("Ui"))

local LabView = {}

local player = Players.LocalPlayer
type PadView = { part: BasePart, visual: SlimeModel.Visual?, key: string, label: BillboardGui, rows: { TextLabel }, lockIcon: BillboardGui }
type LabView = { model: Model, floor: BasePart, pads: { PadView }, gate: BasePart, gateGui: BillboardGui, gateText: TextLabel, tankText: TextLabel, shield: BasePart?, color: Color3 }

local views: { LabView } = {}
local carried: { [Player]: SlimeModel.Visual } = {}
local thiefTags: { [Player]: BillboardGui } = {}
local folder = Instance.new("Folder")
folder.Name = "LabSlimes"
folder.Parent = Workspace

local function myLab(view: LabView): boolean
	return view.model:GetAttribute("Owner") == player.UserId
end

local function slimeOfPad(part: BasePart): Slimes.Slime?
	local s = part:GetAttribute("Slime")
	if typeof(s) ~= "string" or s == "" then
		return nil
	end
	local m = part:GetAttribute("Mut")
	return { s = s, m = if typeof(m) == "string" and m ~= "" then m else nil, f = tonumber(part:GetAttribute("Fuse")) or 0 }
end

local function refreshPad(view: LabView, pv: PadView)
	local part = pv.part
	local slime = slimeOfPad(part)
	local stolen = part:GetAttribute("Stolen") == true
	local unlocked = part:GetAttribute("Unlocked") == true
	local owned = (tonumber(view.model:GetAttribute("Owner")) or 0) ~= 0

	-- Platform zelf: open in de kleur van het lab, dicht in grijs met een slotje.
	part.Color = if unlocked then view.color else Color3.fromRGB(90, 90, 105)
	part.Material = if unlocked then Enum.Material.Neon else Enum.Material.SmoothPlastic
	part.Transparency = if unlocked then 0.15 else 0.3
	pv.lockIcon.Enabled = owned and not unlocked

	local key = if slime then slime.s .. "|" .. (slime.m or "") .. "|" .. slime.f else ""
	if key ~= pv.key then
		pv.key = key
		if pv.visual then
			SlimeModel.destroy(pv.visual :: SlimeModel.Visual)
			pv.visual = nil
		end
		if slime then
			local visual = SlimeModel.build(slime.s, slime.m, slime.f)
			visual.model.Parent = folder
			pv.visual = visual
		end
	end
	local visual = pv.visual
	if visual then
		visual.model.Parent = if stolen then nil else folder
	end
	if slime and not stolen then
		pv.label.Enabled = true
		pv.label.StudsOffsetWorldSpace = Vector3.new(0, (if visual then visual.size * 1.1 else 4) + 1.5, 0)
		pv.rows[1].Text = Slimes.displayName(slime)
		local info = Slimes.BY_ID[slime.s]
		pv.rows[1].TextColor3 = if info then Ui.rgb(Slimes.RARITIES[info.rarity].color) else Ui.WHITE
		pv.rows[2].Text = "+" .. Format.number(Slimes.income(slime)) .. "/s"
	elseif stolen then
		pv.label.Enabled = true
		pv.rows[1].Text = "STOLEN!"
		pv.rows[1].TextColor3 = Ui.RED
		pv.rows[2].Text = "Bonk the thief!"
	else
		pv.label.Enabled = false
	end
end

-- Steal-knop alleen bij andermans lab, Sell-knop alleen bij je eigen lab.
local function applyPromptVisibility(view: LabView, pv: PadView)
	local mine = myLab(view)
	local steal = pv.part:FindFirstChild("StealPrompt")
	local sell = pv.part:FindFirstChild("SellPrompt")
	if steal and steal:IsA("ProximityPrompt") then
		if mine and steal.Enabled then
			steal.Enabled = false
		end
		if player:GetAttribute("Pass_ThiefGloves") then
			steal.HoldDuration = 0.6
		end
	end
	if sell and sell:IsA("ProximityPrompt") and not mine and sell.Enabled then
		sell.Enabled = false
	end
end

local function watchPrompts(view: LabView, pv: PadView)
	local function hook(name: string)
		local prompt = pv.part:WaitForChild(name, 30)
		if prompt and prompt:IsA("ProximityPrompt") then
			prompt:GetPropertyChangedSignal("Enabled"):Connect(function()
				applyPromptVisibility(view, pv)
			end)
		end
	end
	task.spawn(hook, "StealPrompt")
	task.spawn(hook, "SellPrompt")
	task.defer(applyPromptVisibility, view, pv)
end

local function setupLab(model: Model)
	local color = model:GetAttribute("Color")
	local view: LabView = {
		model = model,
		floor = model:WaitForChild("Floor") :: BasePart,
		pads = {},
		gate = model:WaitForChild("Gate") :: BasePart,
		gateGui = nil :: any,
		gateText = nil :: any,
		tankText = nil :: any,
		shield = nil,
		color = if typeof(color) == "Color3" then color else Color3.fromRGB(120, 230, 160),
	}
	local gateGui, gateRows = Ui.billboard(view.gate, 9, 9, 1, 120)
	gateGui.Parent = view.gate
	view.gateGui = gateGui
	view.gateText = gateRows[1]

	local collect = model:WaitForChild("CollectPad") :: BasePart
	local tankGui, tankRows = Ui.billboard(collect, 5, 7, 2, 60)
	tankGui.Parent = collect
	tankRows[1].Text = "COLLECT"
	tankRows[1].TextColor3 = Color3.fromRGB(150, 255, 170)
	view.tankText = tankRows[2]

	local padFolder = model:WaitForChild("Pads")
	local i = 1
	while true do
		local part = padFolder:FindFirstChild("Pad" .. i)
		if not part or not part:IsA("BasePart") then
			break
		end
		local label, rows = Ui.billboard(part, 5, 6, 2, 45)
		label.Parent = part
		local lockIcon, lockRows = Ui.billboard(part, 2.5, 2.5, 1, 50)
		lockRows[1].Text = "🔒"
		lockIcon.Parent = part
		local pv: PadView = { part = part, visual = nil, key = "", label = label, rows = rows, lockIcon = lockIcon }
		table.insert(view.pads, pv)
		for _, attr in { "Slime", "Mut", "Fuse", "Stolen", "Unlocked" } do
			part:GetAttributeChangedSignal(attr):Connect(function()
				refreshPad(view, pv)
			end)
		end
		refreshPad(view, pv)
		watchPrompts(view, pv)
		i += 1
	end
	model:GetAttributeChangedSignal("Owner"):Connect(function()
		for _, pv in view.pads do
			refreshPad(view, pv)
			applyPromptVisibility(view, pv)
		end
	end)
	table.insert(views, view)
end

local function updateShield(view: LabView, on: boolean)
	if on and not view.shield then
		local center = view.floor.Position
		local dome = Instance.new("Part")
		dome.Name = "Shield"
		dome.Shape = Enum.PartType.Ball
		dome.Size = Vector3.new(150, 150, 150)
		dome.Position = Vector3.new(center.X, 0, center.Z)
		dome.Anchored = true
		dome.CanCollide = false
		dome.CanQuery = false
		dome.CanTouch = false
		dome.Material = Enum.Material.ForceField
		dome.Color = Color3.fromRGB(120, 220, 255)
		dome.Transparency = 0.2
		dome.Parent = folder
		view.shield = dome
	elseif not on and view.shield then
		(view.shield :: BasePart):Destroy()
		view.shield = nil
	end
end

local function carryVisual(other: Player): SlimeModel.Visual?
	local species = other:GetAttribute("CarrySpecies")
	local existing = carried[other]
	if typeof(species) ~= "string" then
		if existing then
			SlimeModel.destroy(existing)
			carried[other] = nil
		end
		local tag = thiefTags[other]
		if tag then
			tag:Destroy()
			thiefTags[other] = nil
		end
		return nil
	end
	local mut = other:GetAttribute("CarryMut")
	local fuse = tonumber(other:GetAttribute("CarryFuse")) or 0
	if existing and existing.species == species and existing.mut == (if typeof(mut) == "string" then mut else nil) and existing.fuse == fuse then
		return existing
	end
	if existing then
		SlimeModel.destroy(existing)
	end
	local visual = SlimeModel.build(species, if typeof(mut) == "string" then mut else nil, fuse)
	visual.model.Parent = folder
	carried[other] = visual
	local head = other.Character and other.Character:FindFirstChild("Head")
	if head and head:IsA("BasePart") and not thiefTags[other] then
		local tag, rows = Ui.billboard(head, 3 + visual.size * 1.6, 7, 1, 200)
		tag.AlwaysOnTop = true
		rows[1].Text = "THIEF!"
		rows[1].TextColor3 = Ui.RED
		tag.Parent = head
		thiefTags[other] = tag
	end
	return visual
end

function LabView.start()
	local labs = Workspace:WaitForChild("Labs")
	for _, model in labs:GetChildren() do
		if model:IsA("Model") then
			task.spawn(setupLab, model)
		end
	end
	player:GetAttributeChangedSignal("Pass_ThiefGloves"):Connect(function()
		for _, view in views do
			for _, pv in view.pads do
				applyPromptVisibility(view, pv)
			end
		end
	end)

	local acc = 0
	RunService.RenderStepped:Connect(function(dt)
		local t = Workspace:GetServerTimeNow()
		local camera = Workspace.CurrentCamera
		local camPos = if camera then camera.CFrame.Position else Vector3.zero
		acc += dt
		local slowTick = acc > 0.2
		if slowTick then
			acc = 0
		end
		for _, view in views do
			local owner = tonumber(view.model:GetAttribute("Owner")) or 0
			local near = (view.floor.Position - camPos).Magnitude < 260
			for _, pv in view.pads do
				local visual = pv.visual
				if visual and visual.model.Parent then
					local top = Vector3.new(pv.part.Position.X, Layout.PAD_TOP, pv.part.Position.Z)
					local face = view.gate.Position - pv.part.Position
					local cf = CFrame.lookAt(top, top + Vector3.new(face.X, 0, face.Z))
					SlimeModel.place(visual, cf, t, if near then 0.3 else 0)
				end
			end
			if slowTick then
				local locked = (tonumber(view.model:GetAttribute("LockedUntil")) or 0) - t
				local shielded = (tonumber(view.model:GetAttribute("ShieldUntil")) or 0) - t
				local mine = owner == player.UserId
				-- Laserpoort: dicht voor anderen als het lab op slot is; de eigenaar kan erdoor.
				view.gate.CanCollide = locked > 0 and not mine and owner ~= 0
				view.gate.Transparency = if locked > 0 then 0.35 else 0.95
				view.gate.Color = if locked > 0 then Color3.fromRGB(255, 60, 90) else Color3.fromRGB(120, 255, 170)
				if owner == 0 then
					view.gateText.Text = ""
				elseif shielded > 0 then
					view.gateText.Text = "SHIELD " .. Format.time(shielded)
					view.gateText.TextColor3 = Color3.fromRGB(120, 220, 255)
				elseif locked > 0 then
					view.gateText.Text = "LOCKED " .. Format.time(locked)
					view.gateText.TextColor3 = Ui.RED
				else
					view.gateText.Text = if mine then "OPEN - step on the LOCK button!" else "OPEN"
					view.gateText.TextColor3 = Color3.fromRGB(150, 255, 170)
				end
				updateShield(view, shielded > 0)
				view.tankText.Text = if mine then Format.number(tonumber(view.model:GetAttribute("Tank")) or 0) .. " Goo" else ""
			end
		end
		-- Slijmpjes boven dieven
		for _, other in Players:GetPlayers() do
			local visual = if slowTick or carried[other] then carryVisual(other) else nil
			local head = other.Character and other.Character:FindFirstChild("Head")
			if visual and head and head:IsA("BasePart") then
				local pos = head.Position + Vector3.new(0, 1.2 + visual.size * 0.2, 0)
				SlimeModel.place(visual, CFrame.new(pos) * CFrame.Angles(0, t * 2, 0), t, 0.6)
			end
		end
	end)
	Players.PlayerRemoving:Connect(function(other)
		local visual = carried[other]
		if visual then
			SlimeModel.destroy(visual)
			carried[other] = nil
		end
		thiefTags[other] = nil
	end)
end

return LabView
