--!strict
-- Verandert licht, wolken en weer bij elke nieuwe lucht. Draait alleen op de
-- client: de server hoeft niets te sturen, want de lucht volgt de klok.

local Lighting = game:GetService("Lighting")
local Workspace = game:GetService("Workspace")
local TweenService = game:GetService("TweenService")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local SkyForecast = require(Shared:WaitForChild("SkyForecast"))
local Biomes = require(Shared:WaitForChild("Biomes"))

local SkyController = {}

local changedEvent = Instance.new("BindableEvent")
SkyController.Changed = changedEvent.Event -- (biomeId: string)

local current = ""
local atmosphere: Atmosphere
local tint: ColorCorrectionEffect
local clockValue = Instance.new("NumberValue")
local weatherPart: Part
local emitter: ParticleEmitter
local weatherHeight = 45
local nextFlash = 0

local SPARKLES = "rbxasset://textures/particles/sparkles_main.dds"
local SMOKE = "rbxasset://textures/particles/smoke_main.dds"

function SkyController.current(): string
	return current
end

local function setupEffects()
	local existing = Lighting:FindFirstChildOfClass("Atmosphere")
	if existing then
		atmosphere = existing
	else
		atmosphere = Instance.new("Atmosphere")
		atmosphere.Parent = Lighting
	end

	tint = Instance.new("ColorCorrectionEffect")
	tint.Name = "SkyTint"
	tint.Parent = Lighting

	clockValue.Value = Lighting.ClockTime
	clockValue.Changed:Connect(function(v)
		Lighting.ClockTime = v % 24
	end)

	weatherPart = Instance.new("Part")
	weatherPart.Name = "LocalWeather"
	weatherPart.Anchored = true
	weatherPart.CanCollide = false
	weatherPart.CanQuery = false
	weatherPart.CanTouch = false
	weatherPart.Transparency = 1
	weatherPart.Size = Vector3.new(260, 1, 260)
	weatherPart.Parent = Workspace

	emitter = Instance.new("ParticleEmitter")
	emitter.Shape = Enum.ParticleEmitterShape.Box
	emitter.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume
	emitter.Enabled = false
	emitter.Parent = weatherPart
end

local function seq(a: number, b: number?): NumberSequence
	return NumberSequence.new({
		NumberSequenceKeypoint.new(0, a),
		NumberSequenceKeypoint.new(1, b or a),
	})
end

local function setWeather(kind: string?)
	emitter:Clear()
	emitter.Enabled = kind ~= nil
	emitter.Texture = SPARKLES
	emitter.LightEmission = 0
	emitter.Squash = seq(0)
	emitter.Orientation = Enum.ParticleOrientation.FacingCamera
	emitter.Acceleration = Vector3.zero
	emitter.SpreadAngle = Vector2.new(5, 5)
	emitter.EmissionDirection = Enum.NormalId.Bottom
	emitter.Transparency = seq(0.2, 0.6)
	weatherHeight = 45
	weatherPart.Size = Vector3.new(260, 1, 260)

	if kind == "rain" then
		emitter.Color = ColorSequence.new(Color3.fromRGB(185, 200, 225))
		emitter.Size = seq(0.15)
		emitter.Squash = seq(2.5)
		emitter.Orientation = Enum.ParticleOrientation.VelocityParallel
		emitter.Speed = NumberRange.new(110, 130)
		emitter.Lifetime = NumberRange.new(0.8, 1)
		emitter.Rate = 500
	elseif kind == "snow" then
		emitter.Color = ColorSequence.new(Color3.new(1, 1, 1))
		emitter.Size = seq(0.45, 0.3)
		emitter.Speed = NumberRange.new(12, 18)
		emitter.Lifetime = NumberRange.new(5, 7)
		emitter.SpreadAngle = Vector2.new(20, 20)
		emitter.Acceleration = Vector3.new(3, 0, 2)
		emitter.Rate = 260
	elseif kind == "ash" then
		emitter.Color = ColorSequence.new(Color3.fromRGB(95, 85, 80), Color3.fromRGB(255, 140, 70))
		emitter.Size = seq(0.4, 0.2)
		emitter.Speed = NumberRange.new(6, 10)
		emitter.Lifetime = NumberRange.new(6, 8)
		emitter.SpreadAngle = Vector2.new(25, 25)
		emitter.Rate = 180
	elseif kind == "stars" then
		weatherHeight = 90
		weatherPart.Size = Vector3.new(500, 1, 500)
		emitter.Color = ColorSequence.new(Color3.fromRGB(255, 250, 225))
		emitter.LightEmission = 1
		emitter.Size = seq(0.9, 0)
		emitter.Squash = seq(2)
		emitter.Orientation = Enum.ParticleOrientation.VelocityParallel
		emitter.Speed = NumberRange.new(80, 100)
		emitter.SpreadAngle = Vector2.new(35, 35)
		emitter.Lifetime = NumberRange.new(1.4, 1.8)
		emitter.Rate = 14
		emitter.Transparency = seq(0, 1)
	elseif kind == "aurora" then
		weatherHeight = 170
		weatherPart.Size = Vector3.new(700, 1, 700)
		emitter.Texture = SMOKE
		emitter.Color = ColorSequence.new(Color3.fromRGB(90, 255, 180), Color3.fromRGB(170, 110, 255))
		emitter.LightEmission = 1
		emitter.Size = seq(70, 110)
		emitter.Speed = NumberRange.new(0.5, 2)
		emitter.Lifetime = NumberRange.new(10, 14)
		emitter.Rate = 1.5
		emitter.Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 1),
			NumberSequenceKeypoint.new(0.5, 0.7),
			NumberSequenceKeypoint.new(1, 1),
		})
	elseif kind == "void" then
		emitter.Color = ColorSequence.new(Color3.fromRGB(170, 90, 255))
		emitter.LightEmission = 1
		emitter.Size = seq(0.4, 0)
		emitter.Speed = NumberRange.new(3, 6)
		emitter.EmissionDirection = Enum.NormalId.Top
		emitter.SpreadAngle = Vector2.new(40, 40)
		emitter.Lifetime = NumberRange.new(4, 6)
		emitter.Rate = 120
		weatherHeight = -20
	end
end

local function apply(biomeId: string, instant: boolean)
	local b = Biomes.get(biomeId)
	local info = TweenInfo.new(if instant then 0 else 4, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut)

	-- Klok via een NumberValue, zodat 23:00 -> 00:30 niet de hele dag terugdraait.
	local from = Lighting.ClockTime
	local to = b.clockTime
	if to - from > 12 then
		to -= 24
	elseif from - to > 12 then
		to += 24
	end
	clockValue.Value = from
	TweenService:Create(clockValue, info, { Value = to }):Play()

	TweenService:Create(Lighting, info, {
		Brightness = b.brightness,
		Ambient = b.ambient,
		OutdoorAmbient = b.outdoor,
	}):Play()
	TweenService:Create(atmosphere, info, {
		Density = b.atmoDensity,
		Color = b.atmoColor,
		Decay = b.atmoDecay,
		Haze = b.haze,
		Glare = b.glare,
	}):Play()
	TweenService:Create(tint, info, {
		TintColor = b.tint,
		Saturation = b.saturation,
		Contrast = b.contrast,
	}):Play()

	local terrain = Workspace:FindFirstChildOfClass("Terrain")
	local clouds = terrain and terrain:FindFirstChildOfClass("Clouds")
	if clouds then
		TweenService:Create(clouds, info, { Cover = b.cloudCover, Density = b.cloudDensity, Color = b.cloudColor }):Play()
	end

	local cloudSea = Workspace:FindFirstChild("CloudSea")
	local puffs = cloudSea and cloudSea:FindFirstChild("Puffs")
	if puffs then
		for _, puff in puffs:GetChildren() do
			if puff:IsA("BasePart") then
				TweenService:Create(puff, info, { Color = b.puffColor }):Play()
			end
		end
	end

	setWeather(b.weather)
end

local function flash()
	tint.Brightness = 0.6
	TweenService:Create(tint, TweenInfo.new(0.35), { Brightness = 0 }):Play()
end

function SkyController.start()
	setupEffects()
	local camera = Workspace.CurrentCamera

	RunService.RenderStepped:Connect(function()
		local now = Workspace:GetServerTimeNow()
		local biomeId = SkyForecast.current(now)
		if biomeId ~= current then
			local first = current == ""
			current = biomeId
			apply(biomeId, first)
			changedEvent:Fire(biomeId)
		end

		if camera then
			weatherPart.CFrame = CFrame.new(camera.CFrame.Position + Vector3.new(0, weatherHeight, 0))
		end

		if Biomes.get(current).lightning and os.clock() > nextFlash then
			nextFlash = os.clock() + math.random(5, 12)
			flash()
		end
	end)
end

return SkyController
