--!strict
-- Bouwt en animeert één slijmpje aan de kant van de client.
--
-- Opbouw: `root` staat op de grond (schaduw, naambord), `bodyRoot` draagt het lijf en alle
-- accessoires via welds en springt op en neer. Het lijf is een bol (SpecialMesh) die bij het
-- landen platgedrukt wordt en in de lucht uitrekt (squash en stretch).

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Slimes = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Slimes"))

export type Visual = {
	model: Model,
	root: BasePart,
	bodyRoot: BasePart,
	body: BasePart,
	mesh: SpecialMesh,
	size: number,
	height: number,
	species: string,
	mut: string?,
	fuse: number,
	rainbow: boolean,
	phase: number,
}

local SlimeModel = {}

local SPARKLE = "rbxasset://textures/particles/sparkles_main.dds"
local FIRE = "rbxasset://textures/particles/fire_main.dds"
local DARK = Color3.fromRGB(25, 20, 35)

local function c3(rgb: { number }): Color3
	return Color3.fromRGB(rgb[1], rgb[2], rgb[3])
end

local function part(model: Model, anchor: BasePart, name: string, size: Vector3, color: Color3, cf: CFrame, shape: string?, material: Enum.Material?): BasePart
	local p: BasePart
	if shape == "wedge" then
		p = Instance.new("WedgePart")
	else
		local block = Instance.new("Part")
		if shape == "ball" then
			block.Shape = Enum.PartType.Ball
		elseif shape == "cylinder" then
			block.Shape = Enum.PartType.Cylinder
		end
		p = block
	end
	p.Name = name
	p.Size = size
	p.Color = color
	p.Material = material or Enum.Material.SmoothPlastic
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Anchored = false
	p.Massless = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.CFrame = anchor.CFrame * cf
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = anchor
	weld.Part1 = p
	weld.Parent = p
	p.Parent = model
	return p
end

-- Ellipsoïde: een blok met een bol-mesh (kan in elke richting geschaald worden).
local function blob(model: Model, anchor: BasePart, name: string, size: Vector3, color: Color3, cf: CFrame, material: Enum.Material?, transparency: number?): BasePart
	local p = part(model, anchor, name, size, color, cf, nil, material)
	local mesh = Instance.new("SpecialMesh")
	mesh.MeshType = Enum.MeshType.Sphere
	mesh.Parent = p
	p.Transparency = transparency or 0
	return p
end

local function sparkles(parent: BasePart, color: Color3, rate: number, size: number)
	local e = Instance.new("ParticleEmitter")
	e.Texture = SPARKLE
	e.Color = ColorSequence.new(color)
	e.LightEmission = 0.8
	e.Rate = rate
	e.Lifetime = NumberRange.new(0.8, 1.4)
	e.Speed = NumberRange.new(0.5, 2)
	e.SpreadAngle = Vector2.new(180, 180)
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, size), NumberSequenceKeypoint.new(1, 0) })
	e.Transparency = NumberSequence.new(0.2)
	e.Parent = parent
end

local function fire(parent: BasePart, color: Color3, size: number)
	local e = Instance.new("ParticleEmitter")
	e.Texture = FIRE
	e.Color = ColorSequence.new(color, Color3.fromRGB(255, 230, 120))
	e.LightEmission = 1
	e.Rate = 18
	e.Lifetime = NumberRange.new(0.5, 0.9)
	e.Speed = NumberRange.new(2, 4)
	e.SpreadAngle = Vector2.new(15, 15)
	e.Acceleration = Vector3.new(0, 4, 0)
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, size), NumberSequenceKeypoint.new(1, 0) })
	e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.3), NumberSequenceKeypoint.new(1, 1) })
	e.Parent = parent
end

local function light(parent: BasePart, color: Color3, range: number, brightness: number)
	local l = Instance.new("PointLight")
	l.Color = color
	l.Range = range
	l.Brightness = brightness
	l.Shadows = false
	l.Parent = parent
end

------------------------------------------------------------------ accessoires per soort

type Ctx = { model: Model, anchor: BasePart, S: number, h: number, color: Color3, accent: Color3 }

local function top(ctx: Ctx, dy: number): CFrame
	return CFrame.new(0, ctx.h + dy, 0)
end

local STYLES: { [string]: (Ctx) -> () } = {}

STYLES.plain = function(ctx)
	blob(ctx.model, ctx.anchor, "Drop", Vector3.new(ctx.S * 0.16, ctx.S * 0.22, ctx.S * 0.16), ctx.color, top(ctx, ctx.S * 0.04), nil, 0.1)
end

STYLES.bubbles = function(ctx)
	for i, a in { 0.4, 2.3, 4.2 } do
		local r = ctx.S * (0.55 + i * 0.04)
		blob(ctx.model, ctx.anchor, "Bubble", Vector3.one * ctx.S * (0.14 + i * 0.03), Color3.fromRGB(220, 245, 255),
			CFrame.new(math.cos(a) * r, ctx.h * (0.6 + i * 0.15), math.sin(a) * r), Enum.Material.Glass, 0.45)
	end
end

STYLES.moss = function(ctx)
	for i = 1, 5 do
		local a = i * 1.25
		blob(ctx.model, ctx.anchor, "Moss", Vector3.new(ctx.S * 0.22, ctx.S * 0.12, ctx.S * 0.22), ctx.accent,
			CFrame.new(math.cos(a) * ctx.S * 0.18, ctx.h * 0.97, math.sin(a) * ctx.S * 0.18), Enum.Material.Grass)
	end
	part(ctx.model, ctx.anchor, "Flower", Vector3.one * ctx.S * 0.11, Color3.fromRGB(255, 130, 200), top(ctx, ctx.S * 0.06), "ball", Enum.Material.Neon)
end

STYLES.bean = function(ctx)
	local pink = Color3.fromRGB(255, 90, 160)
	blob(ctx.model, ctx.anchor, "BowL", Vector3.new(ctx.S * 0.2, ctx.S * 0.14, ctx.S * 0.1), pink, top(ctx, 0) * CFrame.new(-ctx.S * 0.11, 0, 0) * CFrame.Angles(0, 0, 0.4))
	blob(ctx.model, ctx.anchor, "BowR", Vector3.new(ctx.S * 0.2, ctx.S * 0.14, ctx.S * 0.1), pink, top(ctx, 0) * CFrame.new(ctx.S * 0.11, 0, 0) * CFrame.Angles(0, 0, -0.4))
	part(ctx.model, ctx.anchor, "Knot", Vector3.one * ctx.S * 0.08, pink, top(ctx, 0), "ball")
end

STYLES.pup = function(ctx)
	for _, side in { -1, 1 } do
		blob(ctx.model, ctx.anchor, "Ear", Vector3.new(ctx.S * 0.16, ctx.S * 0.36, ctx.S * 0.1), ctx.accent,
			CFrame.new(side * ctx.S * 0.36, ctx.h * 0.78, -ctx.S * 0.05) * CFrame.Angles(0, 0, side * 0.5))
	end
	part(ctx.model, ctx.anchor, "Nose", Vector3.one * ctx.S * 0.09, DARK, CFrame.new(0, ctx.h * 0.5, -ctx.S * 0.5), "ball")
end

STYLES.sprout = function(ctx)
	part(ctx.model, ctx.anchor, "Stem", Vector3.new(ctx.S * 0.24, ctx.S * 0.05, ctx.S * 0.05), ctx.accent, top(ctx, ctx.S * 0.1) * CFrame.Angles(0, 0, math.pi / 2), "cylinder")
	for _, side in { -1, 1 } do
		blob(ctx.model, ctx.anchor, "Leaf", Vector3.new(ctx.S * 0.28, ctx.S * 0.06, ctx.S * 0.14), Color3.fromRGB(90, 200, 80),
			top(ctx, ctx.S * 0.22) * CFrame.new(side * ctx.S * 0.13, 0, 0) * CFrame.Angles(0, 0, side * -0.4))
	end
end

STYLES.spring = function(ctx)
	for i = 0, 2 do
		part(ctx.model, ctx.anchor, "Coil", Vector3.new(ctx.S * 0.04, ctx.S * 0.2, ctx.S * 0.2), ctx.accent, top(ctx, ctx.S * (0.02 + i * 0.07)) * CFrame.Angles(0, 0, math.pi / 2), "cylinder")
	end
	part(ctx.model, ctx.anchor, "Ball", Vector3.one * ctx.S * 0.16, Color3.fromRGB(255, 80, 80), top(ctx, ctx.S * 0.28), "ball", Enum.Material.Neon)
end

STYLES.frost = function(ctx)
	for i, a in { -0.5, 0, 0.5 } do
		part(ctx.model, ctx.anchor, "Ice", Vector3.new(ctx.S * 0.08, ctx.S * (0.32 + (if i == 2 then 0.12 else 0)), ctx.S * 0.08), Color3.fromRGB(200, 245, 255),
			top(ctx, ctx.S * 0.1) * CFrame.Angles(0, 0, a) * CFrame.new(0, ctx.S * 0.1, 0), nil, Enum.Material.Neon).Transparency = 0.2
	end
	part(ctx.model, ctx.anchor, "Scarf", Vector3.new(ctx.S * 0.1, ctx.S * 0.96, ctx.S * 0.96), ctx.accent, CFrame.new(0, ctx.h * 0.18, 0) * CFrame.Angles(0, 0, math.pi / 2), "cylinder")
end

STYLES.spark = function(ctx)
	local y = Color3.fromRGB(255, 240, 90)
	part(ctx.model, ctx.anchor, "Bolt1", Vector3.new(ctx.S * 0.08, ctx.S * 0.24, ctx.S * 0.06), y, top(ctx, ctx.S * 0.1) * CFrame.Angles(0, 0, 0.5), nil, Enum.Material.Neon)
	part(ctx.model, ctx.anchor, "Bolt2", Vector3.new(ctx.S * 0.08, ctx.S * 0.24, ctx.S * 0.06), y, top(ctx, ctx.S * 0.28) * CFrame.new(ctx.S * 0.06, 0, 0) * CFrame.Angles(0, 0, -0.5), nil, Enum.Material.Neon)
	light(ctx.anchor, y, ctx.S * 2.5, 1.2)
end

STYLES.ninja = function(ctx)
	part(ctx.model, ctx.anchor, "Band", Vector3.new(ctx.S * 0.16, ctx.S * 0.98, ctx.S * 0.98), ctx.accent, CFrame.new(0, ctx.h * 0.74, 0) * CFrame.Angles(0, 0, math.pi / 2), "cylinder")
	for _, a in { -0.35, 0.35 } do
		part(ctx.model, ctx.anchor, "Tail", Vector3.new(ctx.S * 0.06, ctx.S * 0.12, ctx.S * 0.4), ctx.accent,
			CFrame.new(0, ctx.h * 0.72, ctx.S * 0.55) * CFrame.Angles(-0.4, a, 0))
	end
end

STYLES.pirate = function(ctx)
	local black = Color3.fromRGB(30, 28, 36)
	part(ctx.model, ctx.anchor, "Brim", Vector3.new(ctx.S * 0.04, ctx.S * 0.9, ctx.S * 0.7), black, top(ctx, -ctx.S * 0.03) * CFrame.Angles(0, 0, math.pi / 2), "cylinder")
	blob(ctx.model, ctx.anchor, "Crown", Vector3.new(ctx.S * 0.62, ctx.S * 0.3, ctx.S * 0.46), black, top(ctx, ctx.S * 0.08))
	part(ctx.model, ctx.anchor, "Skull", Vector3.one * ctx.S * 0.09, Color3.new(1, 1, 1), top(ctx, ctx.S * 0.1) * CFrame.new(0, 0, -ctx.S * 0.22), "ball")
	part(ctx.model, ctx.anchor, "Patch", Vector3.new(ctx.S * 0.03, ctx.S * 0.17, ctx.S * 0.17), black, CFrame.new(ctx.S * 0.17, ctx.h * 0.62, -ctx.S * 0.455) * CFrame.Angles(0, math.pi / 2, 0), "cylinder")
end

STYLES.lava = function(ctx)
	for i = 1, 4 do
		local a = i * 1.6
		part(ctx.model, ctx.anchor, "Rock", Vector3.one * ctx.S * (0.16 + (i % 2) * 0.05), Color3.fromRGB(60, 40, 40),
			CFrame.new(math.cos(a) * ctx.S * 0.22, ctx.h * 0.92, math.sin(a) * ctx.S * 0.22), "ball", Enum.Material.Slate)
	end
	light(ctx.anchor, ctx.accent, ctx.S * 3, 1.5)
end

STYLES.king = function(ctx)
	local gold = Color3.fromRGB(255, 205, 60)
	part(ctx.model, ctx.anchor, "Band", Vector3.new(ctx.S * 0.14, ctx.S * 0.5, ctx.S * 0.5), gold, top(ctx, ctx.S * 0.02) * CFrame.Angles(0, 0, math.pi / 2), "cylinder", Enum.Material.Foil)
	for i = 0, 4 do
		local a = i / 5 * math.pi * 2
		part(ctx.model, ctx.anchor, "Spike", Vector3.one * ctx.S * 0.1, gold, top(ctx, ctx.S * 0.13) * CFrame.new(math.cos(a) * ctx.S * 0.22, 0, math.sin(a) * ctx.S * 0.22), "ball", Enum.Material.Foil)
	end
	part(ctx.model, ctx.anchor, "Gem", Vector3.one * ctx.S * 0.09, Color3.fromRGB(255, 60, 90), top(ctx, ctx.S * 0.03) * CFrame.new(0, 0, -ctx.S * 0.25), "ball", Enum.Material.Neon)
end

STYLES.unicorn = function(ctx)
	local gold = Color3.fromRGB(255, 215, 120)
	for i = 0, 3 do
		local w = ctx.S * (0.16 - i * 0.035)
		part(ctx.model, ctx.anchor, "Horn", Vector3.new(ctx.S * 0.1, w, w), gold, CFrame.new(0, ctx.h * 0.92 + i * ctx.S * 0.09, -ctx.S * 0.18 - i * ctx.S * 0.03) * CFrame.Angles(0, 0, math.pi / 2), "cylinder", Enum.Material.Neon)
	end
	for i, col in { Color3.fromRGB(255, 140, 220), Color3.fromRGB(170, 140, 255), Color3.fromRGB(120, 220, 255) } do
		part(ctx.model, ctx.anchor, "Mane", Vector3.one * ctx.S * 0.2, col, CFrame.new(0, ctx.h * (0.95 - i * 0.18), ctx.S * (0.32 + i * 0.05)), "ball")
	end
end

STYLES.dragon = function(ctx)
	for _, side in { -1, 1 } do
		part(ctx.model, ctx.anchor, "Horn", Vector3.new(ctx.S * 0.28, ctx.S * 0.09, ctx.S * 0.09), ctx.accent,
			CFrame.new(side * ctx.S * 0.18, ctx.h * 0.98, 0) * CFrame.Angles(0, 0, side * -1.1 + math.pi / 2), "cylinder")
		part(ctx.model, ctx.anchor, "Wing", Vector3.new(ctx.S * 0.06, ctx.S * 0.5, ctx.S * 0.42), ctx.color:Lerp(Color3.new(0, 0, 0), 0.2),
			CFrame.new(side * ctx.S * 0.55, ctx.h * 0.7, ctx.S * 0.1) * CFrame.Angles(0, 0, side * -0.5), "wedge")
	end
end

STYLES.galaxy = function(ctx)
	for i = 1, 7 do
		local a, b = i * 2.4, (i % 3) * 0.35 + 0.1
		part(ctx.model, ctx.anchor, "Star", Vector3.one * ctx.S * 0.05, Color3.new(1, 1, 1),
			CFrame.new(math.cos(a) * math.cos(b) * ctx.S * 0.49, ctx.h * 0.5 + math.sin(b) * ctx.h * 0.49, math.sin(a) * math.cos(b) * ctx.S * 0.49), "ball", Enum.Material.Neon)
	end
	sparkles(ctx.anchor, ctx.accent, 6, ctx.S * 0.12)
	light(ctx.anchor, Color3.fromRGB(150, 110, 255), ctx.S * 3, 1.4)
end

STYLES.cyber = function(ctx)
	part(ctx.model, ctx.anchor, "Visor", Vector3.new(ctx.S * 0.62, ctx.S * 0.12, ctx.S * 0.1), ctx.accent, CFrame.new(0, ctx.h * 0.64, -ctx.S * 0.43), nil, Enum.Material.Neon)
	part(ctx.model, ctx.anchor, "Antenna", Vector3.new(ctx.S * 0.32, ctx.S * 0.03, ctx.S * 0.03), Color3.fromRGB(180, 180, 200), top(ctx, ctx.S * 0.14) * CFrame.Angles(0, 0, math.pi / 2), "cylinder")
	part(ctx.model, ctx.anchor, "Tip", Vector3.one * ctx.S * 0.1, ctx.accent, top(ctx, ctx.S * 0.32), "ball", Enum.Material.Neon)
	light(ctx.anchor, ctx.accent, ctx.S * 2.5, 1.2)
end

STYLES.phoenix = function(ctx)
	for i, a in { -0.45, 0, 0.45 } do
		part(ctx.model, ctx.anchor, "Crest", Vector3.new(ctx.S * 0.06, ctx.S * (0.3 + (if i == 2 then 0.12 else 0)), ctx.S * 0.18), if i == 2 then ctx.accent else ctx.color,
			top(ctx, ctx.S * 0.05) * CFrame.Angles(0, 0, a) * CFrame.new(0, ctx.S * 0.12, 0), "wedge", Enum.Material.Neon)
	end
	fire(ctx.anchor, ctx.color, ctx.S * 0.3)
	light(ctx.anchor, Color3.fromRGB(255, 150, 60), ctx.S * 3, 1.6)
end

STYLES.god = function(ctx)
	local gold = Color3.fromRGB(255, 225, 120)
	for i = 0, 11 do
		local a = i / 12 * math.pi * 2
		part(ctx.model, ctx.anchor, "Halo", Vector3.one * ctx.S * 0.07, gold, top(ctx, ctx.S * 0.3) * CFrame.new(math.cos(a) * ctx.S * 0.26, 0, math.sin(a) * ctx.S * 0.26), "ball", Enum.Material.Neon)
	end
	for _, side in { -1, 1 } do
		part(ctx.model, ctx.anchor, "Wing", Vector3.new(ctx.S * 0.06, ctx.S * 0.6, ctx.S * 0.5), Color3.new(1, 1, 1),
			CFrame.new(side * ctx.S * 0.6, ctx.h * 0.75, ctx.S * 0.1) * CFrame.Angles(0, 0, side * -0.6), "wedge", Enum.Material.Neon).Transparency = 0.15
	end
	sparkles(ctx.anchor, gold, 10, ctx.S * 0.15)
	light(ctx.anchor, gold, ctx.S * 4, 2)
end

STYLES.kraken = function(ctx)
	STYLES.king(ctx)
	for i = 0, 3 do
		local a = i / 4 * math.pi * 2 + 0.4
		for j = 0, 2 do
			local r = ctx.S * (0.48 + j * 0.16)
			part(ctx.model, ctx.anchor, "Tentacle", Vector3.one * ctx.S * (0.2 - j * 0.04), ctx.accent,
				CFrame.new(math.cos(a) * r, ctx.S * (0.08 + j * 0.02), math.sin(a) * r), "ball")
		end
	end
	sparkles(ctx.anchor, ctx.accent, 8, ctx.S * 0.12)
	light(ctx.anchor, ctx.accent, ctx.S * 3.5, 1.6)
end

STYLES.void = function(ctx)
	sparkles(ctx.anchor, Color3.fromRGB(180, 80, 255), 14, ctx.S * 0.18)
	light(ctx.anchor, Color3.fromRGB(170, 70, 255), ctx.S * 4, 2.2)
end

STYLES.rainbow = function(ctx)
	STYLES.king(ctx)
	sparkles(ctx.anchor, Color3.new(1, 1, 1), 12, ctx.S * 0.15)
	light(ctx.anchor, Color3.new(1, 1, 1), ctx.S * 4, 1.8)
end

------------------------------------------------------------------ mutaties

local MUTATION_LOOK: { [string]: (BasePart, Ctx) -> () } = {
	Gold = function(body, ctx)
		body.Color = Color3.fromRGB(255, 200, 50)
		body.Reflectance = 0.35
		sparkles(ctx.anchor, Color3.fromRGB(255, 220, 90), 5, ctx.S * 0.12)
	end,
	Diamond = function(body, ctx)
		body.Color = Color3.fromRGB(170, 240, 255)
		body.Transparency = 0.3
		body.Reflectance = 0.5
		sparkles(ctx.anchor, Color3.new(1, 1, 1), 7, ctx.S * 0.12)
	end,
	Candy = function(body, ctx)
		body.Color = Color3.fromRGB(255, 140, 210)
		local colors = { Color3.fromRGB(255, 255, 255), Color3.fromRGB(120, 220, 255), Color3.fromRGB(255, 240, 100), Color3.fromRGB(140, 255, 150) }
		for i = 1, 8 do
			local a, b = i * 2.1, 0.3 + (i % 3) * 0.2
			part(ctx.model, ctx.anchor, "Sprinkle", Vector3.new(ctx.S * 0.12, ctx.S * 0.035, ctx.S * 0.035), colors[i % 4 + 1],
				CFrame.new(math.cos(a) * math.cos(b) * ctx.S * 0.47, ctx.h * 0.5 + math.sin(b) * ctx.h * 0.47, math.sin(a) * math.cos(b) * ctx.S * 0.47) * CFrame.Angles(0, a, 0.6))
		end
	end,
	Lava = function(body, ctx)
		body.Color = Color3.fromRGB(110, 30, 20)
		blob(ctx.model, ctx.anchor, "Core", Vector3.new(ctx.S * 0.7, ctx.h * 0.7, ctx.S * 0.7), Color3.fromRGB(255, 110, 30), CFrame.new(0, ctx.h * 0.5, 0), Enum.Material.Neon, 0.2)
		body.Transparency = 0.35
		fire(ctx.anchor, Color3.fromRGB(255, 100, 30), ctx.S * 0.25)
		light(ctx.anchor, Color3.fromRGB(255, 110, 40), ctx.S * 3, 1.5)
	end,
	Galaxy = function(body, ctx)
		body.Color = Color3.fromRGB(50, 25, 110)
		STYLES.galaxy(ctx)
	end,
	Rainbow = function(_, ctx)
		sparkles(ctx.anchor, Color3.new(1, 1, 1), 10, ctx.S * 0.14)
	end,
}

------------------------------------------------------------------ bouwen

function SlimeModel.build(species: string, mut: string?, fuse: number): Visual
	local info = Slimes.BY_ID[species] or Slimes.LIST[1]
	local rarity = Slimes.RARITIES[info.rarity]
	local S = rarity.size * (Slimes.FUSE_SIZE[fuse] or 1)
	local h = S * 0.82
	local color, accent = c3(info.color), c3(info.accent)
	local order = rarity.order

	local model = Instance.new("Model")
	model.Name = species

	local root = Instance.new("Part")
	root.Name = "Root"
	root.Size = Vector3.new(S, 0.2, S)
	root.Transparency = 1
	root.Anchored = true
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	root.Parent = model
	model.PrimaryPart = root

	local shadow = Instance.new("Part")
	shadow.Name = "Shadow"
	shadow.Shape = Enum.PartType.Cylinder
	shadow.Size = Vector3.new(0.05, S * 0.95, S * 0.95)
	shadow.Color = Color3.new(0, 0, 0)
	shadow.Transparency = 0.65
	shadow.Material = Enum.Material.SmoothPlastic
	shadow.CanCollide = false
	shadow.CanQuery = false
	shadow.CanTouch = false
	shadow.CastShadow = false
	shadow.Massless = true
	shadow.CFrame = root.CFrame * CFrame.new(0, 0.05, 0) * CFrame.Angles(0, 0, math.pi / 2)
	local sw = Instance.new("WeldConstraint")
	sw.Part0 = root
	sw.Part1 = shadow
	sw.Parent = shadow
	shadow.Parent = model

	local bodyRoot = Instance.new("Part")
	bodyRoot.Name = "BodyRoot"
	bodyRoot.Size = Vector3.new(0.2, 0.2, 0.2)
	bodyRoot.Transparency = 1
	bodyRoot.Anchored = true
	bodyRoot.CanCollide = false
	bodyRoot.CanQuery = false
	bodyRoot.CanTouch = false
	bodyRoot.Parent = model

	local ctx: Ctx = { model = model, anchor = bodyRoot, S = S, h = h, color = color, accent = accent }

	-- Lijf: doorschijnend voor de zeldzamere soorten, met een gloeiende kern vanaf Epic.
	local jelly = order >= 4
	local body = part(model, bodyRoot, "Body", Vector3.new(S, S, S), color, CFrame.new(0, h / 2, 0), nil, Enum.Material.SmoothPlastic)
	local mesh = Instance.new("SpecialMesh")
	mesh.MeshType = Enum.MeshType.Sphere
	mesh.Scale = Vector3.new(1, 0.82, 1)
	mesh.Parent = body
	body.Transparency = if jelly then 0.14 else 0.03
	body.Reflectance = 0.08
	if jelly then
		blob(model, bodyRoot, "Core", Vector3.new(S * 0.55, h * 0.5, S * 0.55), accent, CFrame.new(0, h * 0.45, 0), Enum.Material.Neon, 0.35)
	end
	if species == "VoidBlob" then
		body.Material = Enum.Material.ForceField
		body.Transparency = 0
	end

	-- Gezicht en glans
	local eyeColor = if species == "VoidBlob" then Color3.fromRGB(200, 90, 255) else DARK
	for _, side in { -1, 1 } do
		-- Grote glanzende ogen, wat lager en verder uit elkaar: schattiger.
		blob(model, bodyRoot, "Eye", Vector3.new(S * 0.2, S * 0.24, S * 0.12), eyeColor, CFrame.new(side * S * 0.19, h * 0.58, -S * 0.43),
			if species == "VoidBlob" then Enum.Material.Neon else nil)
		part(model, bodyRoot, "EyeShine", Vector3.one * S * 0.08, Color3.new(1, 1, 1), CFrame.new(side * S * 0.19 + S * 0.035, h * 0.64, -S * 0.495), "ball", Enum.Material.Neon)
		part(model, bodyRoot, "EyeShine2", Vector3.one * S * 0.035, Color3.new(1, 1, 1), CFrame.new(side * S * 0.19 - S * 0.03, h * 0.52, -S * 0.495), "ball", Enum.Material.Neon)
		blob(model, bodyRoot, "Cheek", Vector3.new(S * 0.14, S * 0.08, S * 0.05), Color3.fromRGB(255, 120, 165), CFrame.new(side * S * 0.31, h * 0.44, -S * 0.39) * CFrame.Angles(0, side * 0.6, 0), nil, 0.2)
	end
	blob(model, bodyRoot, "Mouth", Vector3.new(S * 0.12, S * 0.08, S * 0.05), DARK, CFrame.new(0, h * 0.4, -S * 0.475))
	blob(model, bodyRoot, "Tongue", Vector3.new(S * 0.07, S * 0.04, S * 0.03), Color3.fromRGB(255, 110, 140), CFrame.new(0, h * 0.375, -S * 0.49))
	blob(model, bodyRoot, "Shine", Vector3.new(S * 0.22, S * 0.11, S * 0.14), Color3.new(1, 1, 1), CFrame.new(-S * 0.17, h * 0.86, -S * 0.22) * CFrame.Angles(0.3, 0.4, 0.2), nil, 0.25)

	local style = STYLES[info.style]
	if style then
		style(ctx)
	end
	if mut then
		local look = MUTATION_LOOK[mut]
		if look then
			look(body, ctx)
		end
	end
	if order >= 5 and not mut then
		light(bodyRoot, c3(rarity.color), S * 2.5, 1)
	end
	if fuse >= 2 then
		sparkles(bodyRoot, Color3.fromRGB(255, 240, 160), 6, S * 0.1)
	end

	return {
		model = model,
		root = root,
		bodyRoot = bodyRoot,
		body = body,
		mesh = mesh,
		size = S,
		height = h,
		species = species,
		mut = mut,
		fuse = fuse,
		rainbow = mut == "Rainbow" or species == "RainbowRoyale",
		phase = math.random() * 10,
	}
end

-- Zet het slijmpje neer en laat het springen. `hop` = hoe hoog (0 = stil, 1 = vol).
function SlimeModel.place(v: Visual, cf: CFrame, t: number, hop: number)
	v.root.CFrame = cf
	local period = 0.85
	local p = ((t + v.phase) % period) / period
	local air = math.sin(p * math.pi)
	local c = math.cos(p * math.pi * 2)
	local squash = math.max(0, c) ^ 4 * 0.12 * hop
	local stretch = math.max(0, -c) * 0.07 * hop
	local breathe = math.sin(t * 2.2 + v.phase) * 0.025
	local sy = 1 - squash + stretch + breathe
	local sxz = 1 + squash * 0.8 - stretch * 0.5 - breathe * 0.5
	v.bodyRoot.CFrame = cf * CFrame.new(0, air * v.size * 0.45 * hop, 0)
	v.mesh.Scale = Vector3.new(sxz, 0.82 * sy, sxz)
	v.mesh.Offset = Vector3.new(0, -v.height * (1 - sy) / 2, 0)
	if v.rainbow then
		v.body.Color = Color3.fromHSV((t * 0.25 + v.phase) % 1, 0.55, 1)
	end
end

function SlimeModel.destroy(v: Visual)
	v.model:Destroy()
end

return SlimeModel
