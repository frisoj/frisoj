--!strict
-- De acht labs in de wereld: wie welk lab heeft, wat er op de platforms staat (als attributen,
-- de client tekent de slijmpjes), het slot met de laserpoort, het schild, innen bij de
-- Collect Pad en het naambord.

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Layout = require(Shared:WaitForChild("Layout"))
local Format = require(Shared:WaitForChild("Format"))

local Server = script.Parent
local PlayerData = require(Server:WaitForChild("PlayerData"))
local Passes = require(Server:WaitForChild("Passes"))
local Economy = require(Server:WaitForChild("Economy"))
local Remotes = require(Server:WaitForChild("Remotes"))

local Labs = {}

export type LabInfo = {
	index: number,
	model: Model,
	layout: Layout.Lab,
	pads: { BasePart },
	gate: BasePart,
	collect: BasePart,
	lockButton: BasePart,
	owner: Player?,
	sign: TextLabel?,
	signIncome: TextLabel?,
}

local labs: { LabInfo } = {}
-- De Lock-knop werkt pas weer als de eigenaar er eerst vanaf is gestapt (geen eindeloos AFK-slot).
local lockArmed: { [LabInfo]: boolean } = {}
local byPlayer: { [Player]: LabInfo } = {}

local function now(): number
	return Workspace:GetServerTimeNow()
end

function Labs.get(player: Player): LabInfo?
	return byPlayer[player]
end

function Labs.all(): { LabInfo }
	return labs
end

function Labs.isLocked(lab: LabInfo): boolean
	return (tonumber(lab.model:GetAttribute("LockedUntil")) or 0) > now()
end

function Labs.isShielded(lab: LabInfo): boolean
	return (tonumber(lab.model:GetAttribute("ShieldUntil")) or 0) > now()
end

-- Welk lab staat er op deze plek (of nil)?
function Labs.at(position: Vector3, margin: number?): LabInfo?
	for _, lab in labs do
		if Layout.inLab(lab.layout, position.X, position.Z, margin) then
			return lab
		end
	end
	return nil
end

function Labs.padPosition(lab: LabInfo, pad: number): Vector3
	return lab.pads[pad].Position
end

------------------------------------------------------------------ platforms tonen

function Labs.refresh(player: Player)
	local lab = byPlayer[player]
	local data = PlayerData.get(player)
	if not lab or not data then
		return
	end
	local count = Economy.padCount(player)
	lab.model:SetAttribute("Pads", count)
	for i, pad in lab.pads do
		local slime = data.lab[tostring(i)]
		pad:SetAttribute("Unlocked", i <= count)
		pad:SetAttribute("Slime", if slime then slime.s else "")
		pad:SetAttribute("Mut", if slime and slime.m then slime.m else "")
		pad:SetAttribute("Fuse", if slime then slime.f else 0)
		pad:SetAttribute("Stolen", Economy.isInTransit(player, i))
	end
end

local function clearLab(lab: LabInfo)
	lab.model:SetAttribute("Owner", 0)
	lab.model:SetAttribute("OwnerName", "")
	lab.model:SetAttribute("Pads", 0)
	lab.model:SetAttribute("LockedUntil", 0)
	lab.model:SetAttribute("ShieldUntil", 0)
	lab.model:SetAttribute("Tank", 0)
	for _, pad in lab.pads do
		pad:SetAttribute("Unlocked", false)
		pad:SetAttribute("Slime", "")
		pad:SetAttribute("Mut", "")
		pad:SetAttribute("Fuse", 0)
		pad:SetAttribute("Stolen", false)
	end
	if lab.sign then
		lab.sign.Text = "EMPTY LAB"
	end
	if lab.signIncome then
		lab.signIncome.Text = ""
	end
end

------------------------------------------------------------------ slot en schild

function Labs.lockSeconds(player: Player): number
	local data = PlayerData.get(player)
	local seconds = Config.LOCK_SECONDS + Config.LOCK_PER_REBIRTH * (if data then data.rebirths else 0)
	if Passes.has(player, "VIP") then
		seconds += Config.VIP_LOCK_BONUS
	end
	if Passes.has(player, "LaserLockPlus") then
		seconds *= 2
	end
	return seconds
end

function Labs.lock(player: Player, seconds: number?)
	local lab = byPlayer[player]
	if not lab or Labs.isLocked(lab) then
		return
	end
	lab.model:SetAttribute("LockedUntil", now() + (seconds or Labs.lockSeconds(player)))
	Remotes.Effect:FireAllClients("lock", lab.gate.Position, { lab = lab.index })
	local data = PlayerData.get(player)
	if data and data.tutorial == 2 then
		data.tutorial = 3
	end
end

function Labs.shield(player: Player, seconds: number)
	local lab = byPlayer[player]
	if not lab then
		return
	end
	local current = math.max(now(), tonumber(lab.model:GetAttribute("ShieldUntil")) or 0)
	lab.model:SetAttribute("ShieldUntil", current + seconds)
end

------------------------------------------------------------------ toewijzen

local function spawnCFrame(lab: LabInfo): CFrame
	local x, z = Layout.toWorld(lab.layout, Layout.SPAWN.x, Layout.SPAWN.z)
	local pos = Vector3.new(x, Layout.FLOOR_Y + 4, z)
	return CFrame.lookAt(pos, pos + Vector3.new(0, 0, lab.layout.dir))
end

function Labs.spawnAt(player: Player)
	local lab = byPlayer[player]
	local character = player.Character
	if lab and character then
		character:PivotTo(spawnCFrame(lab))
	end
end

function Labs.assign(player: Player): LabInfo?
	for _, lab in labs do
		if lab.owner == nil then
			lab.owner = player
			byPlayer[player] = lab
			lab.model:SetAttribute("Owner", player.UserId)
			lab.model:SetAttribute("OwnerName", player.DisplayName)
			lab.model:SetAttribute("LockedUntil", now() + Config.JOIN_LOCK_SECONDS)
			player:SetAttribute("Lab", lab.index)
			if lab.sign then
				lab.sign.Text = string.upper(player.DisplayName) .. "'S LAB"
			end
			Labs.refresh(player)
			return lab
		end
	end
	return nil
end

function Labs.release(player: Player)
	local lab = byPlayer[player]
	if not lab then
		return
	end
	byPlayer[player] = nil
	lab.owner = nil
	lockArmed[lab] = nil
	clearLab(lab)
end

------------------------------------------------------------------ bord boven de ingang

local function makeSign(lab: LabInfo)
	local part = lab.model:FindFirstChild("Sign")
	if not part or not part:IsA("BasePart") then
		return
	end
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.CanvasSize = Vector2.new(800, 200)
	gui.LightInfluence = 0
	gui.Brightness = 1.4
	gui.Parent = part
	local title = Instance.new("TextLabel")
	title.BackgroundTransparency = 1
	title.Size = UDim2.new(1, 0, 0.62, 0)
	title.Font = Enum.Font.FredokaOne
	title.TextScaled = true
	title.TextColor3 = Color3.new(1, 1, 1)
	title.Text = "EMPTY LAB"
	title.Parent = gui
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 4
	stroke.Color = Color3.fromRGB(30, 20, 50)
	stroke.Parent = title
	local income = Instance.new("TextLabel")
	income.BackgroundTransparency = 1
	income.Position = UDim2.new(0, 0, 0.62, 0)
	income.Size = UDim2.new(1, 0, 0.38, 0)
	income.Font = Enum.Font.FredokaOne
	income.TextScaled = true
	income.TextColor3 = Color3.fromRGB(150, 255, 170)
	income.Text = ""
	income.Parent = gui
	local stroke2 = stroke:Clone()
	stroke2.Parent = income
	lab.sign = title
	lab.signIncome = income
end

------------------------------------------------------------------ start

local function findPart(model: Model, name: string): BasePart
	local part = model:FindFirstChild(name, true)
	assert(part and part:IsA("BasePart"), "Onderdeel ontbreekt in lab: " .. name)
	return part
end

function Labs.start()
	local folder = Workspace:WaitForChild("Labs")
	for i, info in Layout.LABS do
		local model = folder:WaitForChild("Lab" .. i) :: Model
		local padFolder = model:WaitForChild("Pads")
		local pads: { BasePart } = {}
		for p = 1, #Layout.PADS do
			pads[p] = padFolder:WaitForChild("Pad" .. p) :: BasePart
		end
		local lab: LabInfo = {
			index = i,
			model = model,
			layout = info,
			pads = pads,
			gate = findPart(model, "Gate"),
			collect = findPart(model, "CollectPad"),
			lockButton = findPart(model, "LockButton"),
			owner = nil,
			sign = nil,
			signIncome = nil,
		}
		makeSign(lab)
		clearLab(lab)
		table.insert(labs, lab)
	end

	Economy.labChanged:Connect(Labs.refresh)
	Passes.changed:Connect(function(player: Player)
		Labs.refresh(player)
		Economy.placeStorage(player)
	end)

	-- Eigenaars innen en vergrendelen door op hun knoppen te stappen.
	task.spawn(function()
		while true do
			task.wait(0.2)
			for _, lab in labs do
				local owner = lab.owner
				if owner then
					local character = owner.Character
					local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
					if root then
						local pos = root.Position
						local function near(part: BasePart, radius: number): boolean
							local d = part.Position - pos
							return Vector2.new(d.X, d.Z).Magnitude < radius and math.abs(d.Y) < 8
						end
						if near(lab.collect, 6) then
							local amount = Economy.collect(owner)
							if amount > 0 then
								Remotes.Effect:FireClient(owner, "collect", lab.collect.Position, { amount = amount })
							end
						end
						if near(lab.lockButton, 5) then
							if lockArmed[lab] ~= false and not Labs.isLocked(lab) then
								Labs.lock(owner)
								lockArmed[lab] = false
							end
						else
							lockArmed[lab] = true
						end
					end
					local data = PlayerData.get(owner)
					if data then
						lab.model:SetAttribute("Tank", math.floor(data.tank))
						if lab.signIncome then
							lab.signIncome.Text = Format.number(tonumber(owner:GetAttribute("Income")) or 0) .. " Goo/s"
						end
					end
				end
			end
		end
	end)

end

return Labs
