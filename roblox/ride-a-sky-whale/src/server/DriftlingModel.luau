--!strict
-- Bouwt het 3D-model van een Driftling uit simpele onderdelen.
-- Voorkant = -Z (LookVector), zoals bij elk Roblox-model.

local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Driftlings = require(Shared:WaitForChild("Driftlings"))
local Biomes = require(Shared:WaitForChild("Biomes"))

local DriftlingModel = {}

local function newPart(name: string, shape: Enum.PartType, size: Vector3, color: Color3, cf: CFrame, parent: Instance): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Shape = shape
	p.Size = size
	p.Color = color
	p.CFrame = cf
	p.Anchored = true
	p.CanCollide = false
	p.CanTouch = false
	p.CanQuery = false
	p.CastShadow = false
	p.Material = Enum.Material.SmoothPlastic
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

local BALL = Enum.PartType.Ball
local BLOCK = Enum.PartType.Block
local CYL = Enum.PartType.Cylinder
local DARK = Color3.fromRGB(25, 25, 35)
local WHITE = Color3.new(1, 1, 1)

local function addFeature(feature: string, model: Model, cf: CFrame, s: number, accent: Color3, neonAccent: boolean)
	local function accentPart(name: string, shape: Enum.PartType, size: Vector3, offset: CFrame): Part
		local p = newPart(name, shape, size, accent, cf * offset, model)
		if neonAccent then
			p.Material = Enum.Material.Neon
		end
		return p
	end

	if feature == "ears" then
		for _, side in { -1, 1 } do
			accentPart("Ear", BALL, Vector3.one * (s * 0.32), CFrame.new(side * s * 0.27, s * 0.42, s * 0.02))
		end
	elseif feature == "wings" then
		for _, side in { -1, 1 } do
			accentPart("Wing", BLOCK, Vector3.new(s * 0.9, s * 0.08, s * 0.5),
				CFrame.new(side * s * 0.75, s * 0.1, s * 0.05) * CFrame.Angles(0, 0, side * math.rad(20)))
		end
	elseif feature == "bigwings" then
		for _, side in { -1, 1 } do
			accentPart("Wing", BLOCK, Vector3.new(s * 1.4, s * 0.08, s * 0.85),
				CFrame.new(side * s * 1.0, s * 0.05, s * 0.05) * CFrame.Angles(0, side * math.rad(-12), side * math.rad(12)))
		end
	elseif feature == "tentacles" then
		for i = 0, 3 do
			local a = i / 4 * math.pi * 2
			accentPart("Tentacle", CYL, Vector3.new(s * 0.8, s * 0.12, s * 0.12),
				CFrame.new(math.cos(a) * s * 0.2, -s * 0.62, math.sin(a) * s * 0.2) * CFrame.Angles(0, 0, math.rad(90)))
		end
	elseif feature == "fins" then
		accentPart("TailFin", BLOCK, Vector3.new(s * 0.08, s * 0.55, s * 0.5), CFrame.new(0, s * 0.05, s * 0.62))
		accentPart("TopFin", BLOCK, Vector3.new(s * 0.06, s * 0.35, s * 0.4), CFrame.new(0, s * 0.48, s * 0.1))
	elseif feature == "beak" then
		local beak = newPart("Beak", BALL, Vector3.one * (s * 0.3), Color3.fromRGB(255, 150, 50), cf * CFrame.new(0, -s * 0.05, -s * 0.52), model)
		beak.Material = Enum.Material.SmoothPlastic
	elseif feature == "horn" then
		accentPart("Horn", CYL, Vector3.new(s * 1.3, s * 0.13, s * 0.13),
			CFrame.new(0, s * 0.15, -s * 1.05) * CFrame.Angles(0, math.rad(90), 0))
	elseif feature == "fluke" then
		for _, side in { -1, 1 } do
			accentPart("Fluke", BLOCK, Vector3.new(s * 0.5, s * 0.07, s * 0.28),
				CFrame.new(side * s * 0.26, 0, s * 0.68) * CFrame.Angles(0, side * math.rad(-25), 0))
		end
		local belly = newPart("Belly", BALL, Vector3.one * (s * 0.92), accent, cf * CFrame.new(0, -s * 0.1, 0), model)
		belly.Material = Enum.Material.SmoothPlastic
	end
end

local function addEffects(body: BasePart, mutation: Biomes.Mutation)
	if mutation.light then
		local light = Instance.new("PointLight")
		light.Color = mutation.light
		light.Range = 10
		light.Brightness = 1.6
		light.Shadows = false
		light.Parent = body
	end
	if mutation.particles then
		local emitter = Instance.new("ParticleEmitter")
		emitter.Color = ColorSequence.new(mutation.particles)
		emitter.LightEmission = 1
		emitter.Size = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 0.5),
			NumberSequenceKeypoint.new(1, 0),
		})
		emitter.Lifetime = NumberRange.new(0.5, 1)
		emitter.Speed = NumberRange.new(1, 3)
		emitter.SpreadAngle = Vector2.new(180, 180)
		emitter.Rate = 8
		emitter.Parent = body
	end
end

-- Bouwt een Driftling op positie `cf`. Het model krijgt de tag "Driftling",
-- zodat de client het kan laten zweven.
function DriftlingModel.build(speciesId: string, mutation: string?, cf: CFrame, scale: number?): Model
	local species = Driftlings.SPECIES[speciesId] or Driftlings.SPECIES.NimbusPup
	local rarity = Driftlings.RARITY_BY_ID[species.rarity]
	local s = rarity.size * (scale or 1)
	local mut = if mutation then Biomes.MUTATIONS[mutation] else nil

	local model = Instance.new("Model")
	model.Name = species.id

	local bodyColor = species.color
	if mut then
		bodyColor = bodyColor:Lerp(mut.color, mut.tint)
	end
	local body = newPart("Body", BALL, Vector3.one * s, bodyColor, cf, model)
	if mut and mut.material then
		body.Material = mut.material
	end
	model.PrimaryPart = body

	for _, side in { -1, 1 } do
		newPart("Eye", BALL, Vector3.one * (s * 0.26), DARK, cf * CFrame.new(side * s * 0.2, s * 0.12, -s * 0.42), model)
		local glint = newPart("Glint", BALL, Vector3.one * (s * 0.09), WHITE,
			cf * CFrame.new(side * s * 0.2 + s * 0.04, s * 0.18, -s * 0.53), model)
		glint.Material = Enum.Material.Neon
	end

	local legendary = species.rarity == "Legendary" or species.rarity == "Mythic"
	for _, feature in species.features do
		addFeature(feature, model, cf, s, species.accent, legendary)
	end

	if mut then
		addEffects(body, mut)
	end

	model:SetAttribute("Species", species.id)
	model:SetAttribute("Mutation", mutation)
	CollectionService:AddTag(model, "Driftling")
	return model
end

return DriftlingModel
