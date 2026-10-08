--!strict
-- Alles wat er mooi uitziet maar niets beslist: stormen (licht en neerslag), blikseminslag op
-- een platform, Goo-popups bij innen, bonk-sterretjes, terugduwen, alarm, eier-onthulling,
-- rebirth-feest en de groene gidslijn van de tutorial.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Slimes = require(Shared:WaitForChild("Slimes"))
local Format = require(Shared:WaitForChild("Format"))

local Client = script.Parent
local Ui = require(Client:WaitForChild("Ui"))
local Sound = require(Client:WaitForChild("Sound"))
local SlimeIcon = require(Client:WaitForChild("SlimeIcon"))

local Effects = {}

local player = Players.LocalPlayer
local SPARKLE = "rbxasset://textures/particles/sparkles_main.dds"
local FIRE = "rbxasset://textures/particles/fire_main.dds"

local screen: ScreenGui = nil :: any
local flash: Frame = nil :: any
local stormPart: BasePart? = nil
local stormEmitter: ParticleEmitter? = nil
local defaults: { tint: Color3, saturation: number, atmo: Color3, clock: number }? = nil
local guideBeam: Beam? = nil
local guideTarget: Attachment? = nil

------------------------------------------------------------------ hulpjes

local function tween(inst: Instance, seconds: number, props: { [string]: any }, style: Enum.EasingStyle?)
	TweenService:Create(inst, TweenInfo.new(seconds, style or Enum.EasingStyle.Quad, Enum.EasingDirection.Out), props):Play()
end

local function anchorAt(position: Vector3): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Transparency = 1
	p.Size = Vector3.new(0.2, 0.2, 0.2)
	p.Position = position
	p.Parent = Workspace
	return p
end

local function burst(position: Vector3, color: Color3, count: number, speed: number)
	local p = anchorAt(position)
	local e = Instance.new("ParticleEmitter")
	e.Texture = SPARKLE
	e.Color = ColorSequence.new(color)
	e.LightEmission = 1
	e.Rate = 0
	e.Lifetime = NumberRange.new(0.6, 1.1)
	e.Speed = NumberRange.new(speed * 0.5, speed)
	e.SpreadAngle = Vector2.new(180, 180)
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1.2), NumberSequenceKeypoint.new(1, 0) })
	e.Acceleration = Vector3.new(0, -20, 0)
	e.Parent = p
	e:Emit(count)
	task.delay(2, function()
		p:Destroy()
	end)
end

local function floatText(position: Vector3, text: string, color: Color3)
	local p = anchorAt(position)
	local gui, rows = Ui.billboard(p, 0, 8, 1, 150)
	gui.AlwaysOnTop = true
	rows[1].Text = text
	rows[1].TextColor3 = color
	gui.Parent = p
	tween(gui, 1.2, { StudsOffsetWorldSpace = Vector3.new(0, 7, 0) })
	task.delay(0.6, function()
		tween(rows[1], 0.6, { TextTransparency = 1 })
	end)
	task.delay(1.3, function()
		p:Destroy()
	end)
end

------------------------------------------------------------------ stormen

local STORM_COLORS: { [string]: ColorSequence } = {
	Gold = ColorSequence.new(Color3.fromRGB(255, 215, 80), Color3.fromRGB(255, 170, 40)),
	Diamond = ColorSequence.new(Color3.fromRGB(190, 245, 255), Color3.fromRGB(110, 200, 255)),
	Candy = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 120, 200)),
		ColorSequenceKeypoint.new(0.5, Color3.fromRGB(120, 220, 255)),
		ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 240, 120)),
	}),
	Lava = ColorSequence.new(Color3.fromRGB(255, 120, 30), Color3.fromRGB(255, 60, 20)),
	Galaxy = ColorSequence.new(Color3.fromRGB(255, 255, 255), Color3.fromRGB(170, 140, 255)),
	Rainbow = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 90, 90)),
		ColorSequenceKeypoint.new(0.25, Color3.fromRGB(255, 220, 90)),
		ColorSequenceKeypoint.new(0.5, Color3.fromRGB(120, 255, 140)),
		ColorSequenceKeypoint.new(0.75, Color3.fromRGB(110, 180, 255)),
		ColorSequenceKeypoint.new(1, Color3.fromRGB(220, 120, 255)),
	}),
}

local function applyWeather()
	local grade = Lighting:FindFirstChildOfClass("ColorCorrectionEffect")
	local atmo = Lighting:FindFirstChildOfClass("Atmosphere")
	if not defaults then
		defaults = {
			tint = if grade then grade.TintColor else Color3.new(1, 1, 1),
			saturation = if grade then grade.Saturation else 0,
			atmo = if atmo then atmo.Color else Color3.new(1, 1, 1),
			clock = Lighting.ClockTime,
		}
	end
	local d = defaults :: { tint: Color3, saturation: number, atmo: Color3, clock: number }
	local w = Workspace:GetAttribute("Weather")
	local mut = if typeof(w) == "string" and w ~= "" then Slimes.MUTATIONS[w] else nil
	if mut then
		local color = Ui.rgb(mut.color)
		if grade then
			tween(grade, 2, { TintColor = d.tint:Lerp(color, 0.25), Saturation = d.saturation + 0.15 })
		end
		if atmo then
			tween(atmo, 2, { Color = d.atmo:Lerp(color, 0.5) })
		end
		tween(Lighting, 3, { ClockTime = if mut.id == "Galaxy" then 21.5 elseif mut.id == "Lava" then 17.6 else d.clock })
		local emitter = stormEmitter
		if emitter then
			emitter.Color = STORM_COLORS[mut.id] or ColorSequence.new(color)
			emitter.Texture = if mut.id == "Lava" then FIRE else SPARKLE
			emitter.Rate = if mut.id == "Rainbow" then 160 else 110
			emitter.Enabled = true
		end
		Sound.play("swoosh", 0.7)
	else
		if grade then
			tween(grade, 3, { TintColor = d.tint, Saturation = d.saturation })
		end
		if atmo then
			tween(atmo, 3, { Color = d.atmo })
		end
		tween(Lighting, 3, { ClockTime = d.clock })
		if stormEmitter then
			(stormEmitter :: ParticleEmitter).Enabled = false
		end
	end
end

local function makeStormPart()
	local p = Instance.new("Part")
	p.Name = "StormFx"
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Transparency = 1
	p.Size = Vector3.new(220, 1, 220)
	p.Parent = Workspace
	local e = Instance.new("ParticleEmitter")
	e.Texture = SPARKLE
	e.Shape = Enum.ParticleEmitterShape.Box
	e.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume
	e.EmissionDirection = Enum.NormalId.Bottom
	e.LightEmission = 0.9
	e.Rate = 110
	e.Lifetime = NumberRange.new(2.5, 3.5)
	e.Speed = NumberRange.new(22, 32)
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.9), NumberSequenceKeypoint.new(1, 0.4) })
	e.RotSpeed = NumberRange.new(-180, 180)
	e.Enabled = false
	e.Parent = p
	stormPart = p
	stormEmitter = e
end

------------------------------------------------------------------ losse effecten

local function strike(position: Vector3, mut: string)
	local info = Slimes.MUTATIONS[mut]
	local color = if info then Ui.rgb(info.color) else Color3.new(1, 1, 1)
	local beam = Instance.new("Part")
	beam.Anchored = true
	beam.CanCollide = false
	beam.CanQuery = false
	beam.CanTouch = false
	beam.Material = Enum.Material.Neon
	beam.Color = color
	beam.Shape = Enum.PartType.Cylinder
	beam.Size = Vector3.new(160, 2.4, 2.4)
	beam.CFrame = CFrame.new(position + Vector3.new(0, 80, 0)) * CFrame.Angles(0, 0, math.pi / 2)
	beam.Parent = Workspace
	tween(beam, 0.6, { Transparency = 1, Size = Vector3.new(160, 0.2, 0.2) })
	task.delay(0.7, function()
		beam:Destroy()
	end)
	burst(position + Vector3.new(0, 2, 0), color, 40, 30)
	Sound.play("rare", 1.2)
end

local function screenFlash(color: Color3, strength: number)
	flash.BackgroundColor3 = color
	flash.BackgroundTransparency = 1 - strength
	tween(flash, 0.5, { BackgroundTransparency = 1 })
end

local function eggReveal(species: string, egg: string?)
	local info = Slimes.BY_ID[species]
	if not info then
		return
	end
	local rarity = Slimes.RARITIES[info.rarity]
	local frame = Ui.make("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.48),
		Size = UDim2.fromOffset(340, 380),
		BackgroundColor3 = Ui.PANEL,
		Parent = screen,
	}, { Ui.corner(24), Ui.stroke(4, Ui.rgb(rarity.color)), Ui.gradient(Color3.fromRGB(80, 50, 140), Color3.fromRGB(30, 18, 60)) })
	Ui.label(if egg then (Slimes.EGGS[egg] and Slimes.EGGS[egg].name or "Egg") .. " opened!" else "New slime!", {
		Size = UDim2.new(1, -20, 0, 40), Position = UDim2.fromOffset(10, 10), Parent = frame,
	})
	local icon = SlimeIcon.new(species, nil, 0, true)
	icon.Size = UDim2.new(1, -40, 0, 220)
	icon.Position = UDim2.fromOffset(20, 55)
	icon.Parent = frame
	Ui.label(info.name, { Size = UDim2.new(1, -20, 0, 44), Position = UDim2.fromOffset(10, 280), Parent = frame })
	Ui.label(string.upper(info.rarity), { Size = UDim2.new(1, -20, 0, 34), Position = UDim2.fromOffset(10, 326), TextColor3 = Ui.rgb(rarity.color), Parent = frame })
	Ui.pop(frame)
	Sound.play(if rarity.order >= 5 then "rare" else "buy")
	screenFlash(Ui.rgb(rarity.color), 0.4)
	task.delay(3.2, function()
		frame:Destroy()
	end)
end

local function confetti()
	for i = 1, 60 do
		local piece = Ui.make("Frame", {
			Size = UDim2.fromOffset(10, 16),
			Position = UDim2.new(math.random(), 0, -0.05, 0),
			BackgroundColor3 = Color3.fromHSV(math.random(), 0.7, 1),
			Rotation = math.random(0, 360),
			Parent = screen,
		})
		local fall = 1.6 + math.random() * 1.2
		tween(piece, fall, { Position = UDim2.new(piece.Position.X.Scale + (math.random() - 0.5) * 0.2, 0, 1.05, 0), Rotation = piece.Rotation + 360 }, Enum.EasingStyle.Sine)
		task.delay(fall, function()
			piece:Destroy()
		end)
		if i % 12 == 0 then
			task.wait()
		end
	end
end

------------------------------------------------------------------ gidslijn (tutorial)

function Effects.setGuide(target: Vector3?)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if not target or not root then
		if guideBeam then
			(guideBeam :: Beam).Enabled = false
		end
		return
	end
	if not guideBeam or not guideTarget then
		local anchor = anchorAt(Vector3.zero)
		anchor.Name = "GuideTarget"
		local a1 = Instance.new("Attachment")
		a1.Parent = anchor
		local beam = Instance.new("Beam")
		beam.Color = ColorSequence.new(Color3.fromRGB(120, 255, 150))
		beam.LightEmission = 1
		beam.Width0 = 1.2
		beam.Width1 = 1.2
		beam.FaceCamera = true
		beam.Transparency = NumberSequence.new(0.25)
		beam.Segments = 20
		beam.CurveSize0 = 8
		beam.Attachment1 = a1
		beam.Parent = anchor
		guideBeam = beam
		guideTarget = a1
	end
	local beam = guideBeam :: Beam
	local a1 = guideTarget :: Attachment
	local a0 = root:FindFirstChild("GuideAttachment") :: Attachment?
	if not a0 then
		local att = Instance.new("Attachment")
		att.Name = "GuideAttachment"
		att.Parent = root
		a0 = att
	end
	beam.Attachment0 = a0
	;(a1.Parent :: BasePart).Position = target
	beam.Enabled = true
end

------------------------------------------------------------------ start

function Effects.start(gui: ScreenGui)
	screen = gui
	flash = Ui.make("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, BorderSizePixel = 0, ZIndex = 50, Parent = gui })
	makeStormPart()
	applyWeather()
	Workspace:GetAttributeChangedSignal("Weather"):Connect(applyWeather)

	RunService.RenderStepped:Connect(function()
		local camera = Workspace.CurrentCamera
		if camera and stormPart then
			local pos = camera.CFrame.Position
			;(stormPart :: BasePart).Position = Vector3.new(pos.X, pos.Y + 70, pos.Z)
		end
	end)

	local remotes = ReplicatedStorage:WaitForChild("Remotes")
	local effect = remotes:WaitForChild("Effect") :: RemoteEvent
	effect.OnClientEvent:Connect(function(kind: string, position: Vector3?, extra: any)
		if kind == "strike" and position then
			strike(position, extra and extra.mut or "Gold")
		elseif kind == "collect" and position then
			floatText(position + Vector3.new(0, 3, 0), "+" .. Format.number(extra and extra.amount or 0) .. " Goo", Color3.fromRGB(150, 255, 170))
			burst(position + Vector3.new(0, 1, 0), Color3.fromRGB(120, 255, 150), 18, 15)
			Sound.play("coin")
		elseif kind == "bonk" and position then
			burst(position, Color3.fromRGB(255, 240, 120), 14, 18)
			Sound.play("bonk")
		elseif kind == "lock" and position then
			burst(position, Color3.fromRGB(255, 80, 110), 20, 20)
			Sound.play("lock")
		elseif kind == "home" and position then
			burst(position + Vector3.new(0, 2, 0), Color3.fromRGB(120, 255, 170), 20, 14)
			Sound.play("splat")
		elseif kind == "sold" and position then
			burst(position + Vector3.new(0, 2, 0), Color3.fromRGB(255, 220, 90), 16, 14)
			Sound.play("coin", 0.8)
		elseif kind == "egg" then
			eggReveal(extra.species, extra.egg)
		elseif kind == "fused" then
			eggReveal(extra.species, nil)
		elseif kind == "rebirth" then
			Sound.play("rare")
			screenFlash(Color3.fromRGB(150, 255, 190), 0.6)
			task.spawn(confetti)
		elseif kind == "stolen" then
			if extra and extra.thief == player.UserId then
				Sound.play("rare")
				task.spawn(confetti)
			end
		end
	end)

	local knock = remotes:WaitForChild("Knockback") :: RemoteEvent
	knock.OnClientEvent:Connect(function(dir: Vector3)
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart")
		if root and root:IsA("BasePart") and typeof(dir) == "Vector3" then
			root.AssemblyLinearVelocity = dir * 70 + Vector3.new(0, 45, 0)
			screenFlash(Color3.new(1, 1, 1), 0.3)
		end
	end)

	local alarm = remotes:WaitForChild("Alarm") :: RemoteEvent
	alarm.OnClientEvent:Connect(function()
		for i = 0, 2 do
			task.delay(i * 0.45, function()
				screenFlash(Color3.fromRGB(255, 40, 60), 0.45)
				Sound.play("alarm")
			end)
		end
	end)
end

return Effects
