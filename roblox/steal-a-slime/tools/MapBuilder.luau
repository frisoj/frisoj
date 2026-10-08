-- Bouwt de wereld van Steal a Slime in een placebestand: het zwevende eiland, de Goo-rivier,
-- de acht labs, het plein met kiosken, ranglijsten, decor en de belichting.
-- Draait met Lune tijdens het bouwen, niet in de game zelf. Alle maten komen uit Layout.

local roblox = require("@lune/roblox")
local Instance = roblox.Instance
local Vector3 = roblox.Vector3
local CFrame = roblox.CFrame
local Color3 = roblox.Color3
local Enum = roblox.Enum
local ColorSequence = roblox.ColorSequence
local NumberSequence = roblox.NumberSequence
local NumberSequenceKeypoint = roblox.NumberSequenceKeypoint
local NumberRange = roblox.NumberRange
local Vector2 = roblox.Vector2

local Layout = require("../src/shared/Layout")

local MapBuilder = {}

local rgb = Color3.fromRGB
local VERTICAL = CFrame.Angles(0, 0, math.rad(90)) -- cilinder rechtop
local WHITE = rgb(242, 240, 250)
local CREAM = rgb(255, 244, 228)
local ROCK = { rgb(118, 86, 140), rgb(92, 70, 122), rgb(140, 100, 160) }
local CANDY = { rgb(255, 90, 170), rgb(70, 200, 255), rgb(160, 100, 255), rgb(255, 195, 50), rgb(70, 225, 140) }

-- Eigen lookAt: CFrame.lookAt in Lune 0.10 draait de kijkrichting om (in Roblox klopt hij wel).
-- Kolommen van een CFrame: RightVector, UpVector en -LookVector.
local function lookAt(pos: any, target: any, upHint: any?): any
	local f = (target - pos).Unit
	local up = upHint or (if math.abs(f.Y) > 0.99 then Vector3.new(1, 0, 0) else Vector3.new(0, 1, 0))
	local r = f:Cross(up).Unit
	local u = r:Cross(f)
	return CFrame.new(pos.X, pos.Y, pos.Z, r.X, u.X, -f.X, r.Y, u.Y, -f.Y, r.Z, u.Z, -f.Z)
end

local seed = 1234
local function rnd(): number
	seed = (seed * 1103515245 + 12345) % 2147483648
	return seed / 2147483648
end
local function range(a: number, b: number): number
	return a + (b - a) * rnd()
end

local count = 0
local function part(props: { [string]: any }): any
	local p = Instance.new(props.ClassName or "Part")
	p.Anchored = true
	p.Material = Enum.Material.SmoothPlastic
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in props do
		if k ~= "ClassName" and k ~= "Parent" then
			p[k] = v
		end
	end
	p.Parent = props.Parent
	count += 1
	return p
end

local function block(name: string, size: any, cf: any, color: any, material: any, parent: any): any
	return part({ Name = name, Size = size, CFrame = cf, Color = color, Material = material or Enum.Material.SmoothPlastic, Parent = parent })
end

local function ball(name: string, pos: any, d: number, color: any, material: any, parent: any): any
	return part({ Name = name, Shape = Enum.PartType.Ball, Size = Vector3.new(d, d, d), CFrame = CFrame.new(pos), Color = color, Material = material or Enum.Material.SmoothPlastic, Parent = parent })
end

-- Rechtopstaande cilinder met de onderkant op `bottom`.
local function cyl(name: string, bottom: any, height: number, d: number, color: any, material: any, parent: any): any
	return part({
		Name = name, Shape = Enum.PartType.Cylinder, Size = Vector3.new(height, d, d),
		CFrame = CFrame.new(bottom + Vector3.new(0, height / 2, 0)) * VERTICAL,
		Color = color, Material = material or Enum.Material.SmoothPlastic, Parent = parent,
	})
end

-- Liggende cilinder van a naar b.
local function rod(name: string, a: any, b: any, d: number, color: any, material: any, parent: any): any
	local mid = (a + b) / 2
	local dir = (b - a).Unit
	local up = if math.abs(dir.Y) > 0.99 then Vector3.new(1, 0, 0) else Vector3.new(0, 1, 0)
	return part({
		Name = name, Shape = Enum.PartType.Cylinder, Size = Vector3.new((b - a).Magnitude, d, d),
		CFrame = lookAt(mid, b, up) * CFrame.Angles(0, math.rad(90), 0),
		Color = color, Material = material or Enum.Material.SmoothPlastic, Parent = parent,
	})
end

local function light(parent: any, color: any, range_: number, brightness: number)
	local l = Instance.new("PointLight")
	l.Color = color
	l.Range = range_
	l.Brightness = brightness
	l.Shadows = false
	l.Parent = parent
end

local function sparkles(parent: any, color: any, rate: number, size: number, speed: number)
	local e = Instance.new("ParticleEmitter")
	e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	e.Color = ColorSequence.new(color)
	e.LightEmission = 0.9
	e.Rate = rate
	e.Lifetime = NumberRange.new(1, 2)
	e.Speed = NumberRange.new(speed * 0.5, speed)
	e.SpreadAngle = Vector2.new(180, 180)
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, size), NumberSequenceKeypoint.new(1, 0) })
	e.Parent = parent
end

local function folder(name: string, parent: any): any
	local f = Instance.new("Folder")
	f.Name = name
	f.Parent = parent
	return f
end

------------------------------------------------------------------ eiland

local function buildIsland(world: any)
	local island = folder("Island", world)
	local hx, hz = Layout.ISLAND.halfX, Layout.ISLAND.halfZ
	local R = 70
	local grass = rgb(92, 200, 110)
	-- Bovenkant met afgeronde hoeken: twee blokken en vier cilinders.
	local function slab(y: number, thick: number, grow: number, color: any, material: any)
		block("Top", Vector3.new(2 * (hx - R), thick, 2 * (hz + grow)), CFrame.new(0, y, 0), color, material, island)
		block("Top", Vector3.new(2 * (hx + grow), thick, 2 * (hz - R)), CFrame.new(0, y, 0), color, material, island)
		for _, sx in { -1, 1 } do
			for _, sz in { -1, 1 } do
				cyl("Corner", Vector3.new(sx * (hx - R), y - thick / 2, sz * (hz - R)), thick, 2 * (R + grow), color, material, island)
			end
		end
	end
	slab(-2, 4, 0, grass, Enum.Material.Grass)
	slab(-7, 6, 4, rgb(160, 112, 140), Enum.Material.Ground)
	slab(-13, 6, 0, rgb(124, 96, 138), Enum.Material.Slate)

	-- Rotsige onderkant met hangende punten en gloeiende kristallen.
	for _ = 1, 70 do
		local x, z = range(-hx * 0.92, hx * 0.92), range(-hz * 0.9, hz * 0.9)
		local r = range(26, 60)
		-- Helemaal onder de bodemplaat (die loopt tot Y = -16), zodat niets door het gras steekt.
		ball("Rock", Vector3.new(x, -14 - r * 1.02, z), r * 2, ROCK[math.floor(range(1, 3.99))], Enum.Material.Rock, island)
	end
	for i = 1, 14 do
		local x, z = range(-hx * 0.75, hx * 0.75), range(-hz * 0.7, hz * 0.7)
		local d = range(34, 50)
		local y = -60 - d * 0.5
		while d > 6 do
			ball("Spike", Vector3.new(x + range(-3, 3), y, z + range(-3, 3)), d, ROCK[(i % 3) + 1], Enum.Material.Rock, island)
			y -= d * 0.55
			d *= 0.74
		end
		if i % 3 == 0 then
			local c = ball("Glow", Vector3.new(x, y - 4, z), 8, CANDY[(i % 5) + 1], Enum.Material.Neon, island)
			light(c, c.Color, 40, 2)
		end
	end

	-- Onzichtbare wanden langs de rand (met de bocht van de hoeken), zodat niemand eraf valt.
	local wall = folder("EdgeWalls", world)
	local function edgeWall(a: any, b: any)
		local mid = (a + b) / 2
		local len = (b - a).Magnitude
		part({ Name = "Wall", Size = Vector3.new(len + 2, 60, 2), CFrame = lookAt(mid, mid + (b - a).Unit:Cross(Vector3.new(0, 1, 0))) , Transparency = 1, CanCollide = true, Parent = wall })
	end
	local pts = {}
	local function corner(cx: number, cz: number, a0: number)
		for k = 0, 6 do
			local a = a0 + k * (math.pi / 2) / 6
			table.insert(pts, Vector3.new(cx + math.cos(a) * (R - 2), 30, cz + math.sin(a) * (R - 2)))
		end
	end
	corner(hx - R, hz - R, 0)
	corner(-(hx - R), hz - R, math.pi / 2)
	corner(-(hx - R), -(hz - R), math.pi)
	corner(hx - R, -(hz - R), math.pi * 1.5)
	for i = 1, #pts do
		edgeWall(pts[i], pts[(i % #pts) + 1])
	end

	-- Hekje van snoepstokken langs de rand.
	for i = 1, #pts do
		local a, b = pts[i], pts[(i % #pts) + 1]
		local steps = math.max(1, math.floor((b - a).Magnitude / 14))
		for s = 0, steps - 1 do
			local p = a:Lerp(b, s / steps)
			cyl("Post", Vector3.new(p.X, 0, p.Z), 4, 1.2, if s % 2 == 0 then rgb(255, 120, 170) else WHITE, nil, island)
		end
		rod("Rail", Vector3.new(a.X, 3.4, a.Z), Vector3.new(b.X, 3.4, b.Z), 0.7, WHITE, nil, island)
	end

	-- Goo-watervallen van de rand naar beneden.
	for i, spot in { { -150, 1 }, { 140, 1 }, { -60, -1 }, { 230, -1 } } do
		local x, side = spot[1], spot[2]
		local z = side * (hz + 3)
		local fall = block("GooFall", Vector3.new(10, 140, 1.5), CFrame.new(x, -68, z), rgb(110, 255, 170), Enum.Material.Neon, island)
		fall.Transparency = 0.25
		fall.CanCollide = false
		local lip = block("Lip", Vector3.new(14, 1.5, 6), CFrame.new(x, -0.2, z - side * 2), rgb(110, 255, 170), Enum.Material.Neon, island)
		lip.CanCollide = false
		sparkles(lip, rgb(170, 255, 210), 12, 1.2, 4)
		local _ = i
	end

	-- Wolken ver onder het eiland
	local clouds = folder("Clouds", world)
	for _ = 1, 22 do
		local c = ball("Cloud", Vector3.new(range(-750, 750), range(-320, -240), range(-550, 550)), range(60, 130), rgb(255, 240, 250), Enum.Material.SmoothPlastic, clouds)
		c.CanCollide = false
		c.Transparency = 0.1
		c.CastShadow = false
	end
end

------------------------------------------------------------------ rivier

local function buildRiver(world: any)
	local river = folder("River", world)
	local pts = Layout.RIVER_POINTS
	local W = Layout.RIVER_HALF_WIDTH * 2
	for i = 1, #pts - 1 do
		local a, b = pts[i], pts[i + 1]
		local pa, pb = Vector3.new(a.x, 0, a.z), Vector3.new(b.x, 0, b.z)
		local mid = (pa + pb) / 2
		local len = (pb - pa).Magnitude + 0.6
		local base = lookAt(Vector3.new(0, 0, 0), (pb - pa).Unit)
		block("Bed", Vector3.new(W + 2, 1.2, len), CFrame.new(mid.X, -0.5, mid.Z) * base, rgb(40, 120, 100), Enum.Material.SmoothPlastic, river)
		local goo = block("Goo", Vector3.new(W, 0.5, len), CFrame.new(mid.X, Layout.RIVER_Y - 0.25, mid.Z) * base, rgb(100, 240, 175), Enum.Material.Glass, river)
		goo.Transparency = 0.12
		goo.Reflectance = 0.15
		local glow = block("Current", Vector3.new(3, 0.1, len), CFrame.new(mid.X, Layout.RIVER_Y + 0.02, mid.Z) * base, rgb(200, 255, 225), Enum.Material.Neon, river)
		glow.Transparency = 0.45
		glow.CanCollide = false
		-- Snoepstok-randjes en een stenen looppad aan beide kanten.
		for _, side in { -1, 1 } do
			local off = base.RightVector * side * (Layout.RIVER_HALF_WIDTH + 0.6)
			rod("Curb", Vector3.new(pa.X, 0.6, pa.Z) + off, Vector3.new(pb.X, 0.6, pb.Z) + off, 1.6, if i % 2 == 0 then rgb(255, 110, 170) else WHITE, nil, river)
			local walk = base.RightVector * side * (Layout.RIVER_HALF_WIDTH + 9)
			block("Walk", Vector3.new(15, 0.4, len), CFrame.new(mid.X + walk.X, 0.1, mid.Z + walk.Z) * base, rgb(238, 228, 214), Enum.Material.Pavement, river)
		end
		-- Lantaarns langs het water
		if i % 8 == 4 then
			for _, side in { -1, 1 } do
				local off = base.RightVector * side * (Layout.RIVER_HALF_WIDTH + 16.5)
				local p = Vector3.new(mid.X, 0, mid.Z) + off
				cyl("LampPost", p, 8, 0.7, WHITE, nil, river)
				local bulb = ball("Lamp", p + Vector3.new(0, 8.6, 0), 1.9, CANDY[(i // 8) % 5 + 1], Enum.Material.Neon, river)
				light(bulb, bulb.Color, 16, 1.2)
			end
		end
	end

	-- Bruggetjes in een boog over de rivier
	for _, bx in Layout.BRIDGES do
		local bz = Layout.RIVER_Z(bx)
		local steps = 9
		for s = 0, steps - 1 do
			local z0 = bz - 22 + s * (44 / steps)
			local z1 = z0 + 44 / steps
			local y0 = 0.6 + 5 * math.sin(math.pi * (z0 - bz + 22) / 44)
			local y1 = 0.6 + 5 * math.sin(math.pi * (z1 - bz + 22) / 44)
			local a, b = Vector3.new(bx, y0, z0), Vector3.new(bx, y1, z1)
			local mid = (a + b) / 2
			block("Deck", Vector3.new(12, 0.8, (b - a).Magnitude + 0.3), lookAt(mid, b), rgb(250, 210, 150), Enum.Material.WoodPlanks, river)
			for _, side in { -1, 1 } do
				rod("Rail", a + Vector3.new(side * 6, 2.4, 0), b + Vector3.new(side * 6, 2.4, 0), 0.6, rgb(255, 120, 190), Enum.Material.Neon, river)
			end
		end
	end

	-- Slime Portal (begin) en Recycler (einde)
	local portalX = Layout.RIVER_START - 4
	local center = Vector3.new(portalX, 12, Layout.RIVER_Z(Layout.RIVER_START))
	for k = 0, 23 do
		local a = k / 24 * math.pi * 2
		local p = center + Vector3.new(0, math.sin(a) * 12, math.cos(a) * 12)
		ball("PortalRing", p, 3.4, rgb(200, 110, 255), Enum.Material.Neon, river)
	end
	local disc = part({ Name = "PortalSwirl", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.6, 22, 22), CFrame = CFrame.new(center), Color = rgb(150, 80, 255), Material = Enum.Material.ForceField, Parent = river })
	disc.CanCollide = false
	sparkles(disc, rgb(220, 170, 255), 30, 1.4, 6)
	light(disc, rgb(190, 120, 255), 40, 3)
	cyl("PortalBase", Vector3.new(portalX, 0, center.Z), 1.5, 30, rgb(90, 70, 120), Enum.Material.DiamondPlate, river)

	local rx = Layout.RIVER_END + 6
	local rz = Layout.RIVER_Z(Layout.RIVER_END)
	for i, d in { 30, 25, 20, 15 } do
		cyl("Recycler", Vector3.new(rx, (i - 1) * 2.5, rz), 2.5, d, if i % 2 == 0 then rgb(120, 130, 150) else rgb(90, 100, 120), Enum.Material.DiamondPlate, river)
	end
	local ring = cyl("RecyclerGlow", Vector3.new(rx, 10, rz), 0.8, 16, rgb(110, 255, 170), Enum.Material.Neon, river)
	light(ring, rgb(110, 255, 170), 30, 2)
	local sign = block("RecyclerSign", Vector3.new(24, 5, 0.6), lookAt(Vector3.new(rx, 18, rz), Vector3.new(rx - 1, 18, rz)), rgb(40, 30, 60), nil, river)
	sign:SetAttribute("SignText", "RECYCLER")
end

------------------------------------------------------------------ labs

local function buildLab(labs: any, index: number, info: any)
	local model = Instance.new("Model")
	model.Name = "Lab" .. index
	model:SetAttribute("Color", rgb(info.color[1], info.color[2], info.color[3]))
	model:SetAttribute("Index", index)
	model.Parent = labs
	local color = rgb(info.color[1], info.color[2], info.color[3])
	local rot = lookAt(Vector3.new(0, 0, 0), Vector3.new(0, 0, info.dir))
	local function at(lx: number, y: number, lz: number): any
		local x, z = Layout.toWorld(info, lx, lz)
		return CFrame.new(x, y, z) * rot
	end
	local F = Layout.FLOOR_Y
	local HX, HZ, WH = Layout.LAB_HALF_X, Layout.LAB_HALF_Z, Layout.WALL_HEIGHT

	block("Floor", Vector3.new(HX * 2, 1.2, HZ * 2), at(0, F - 0.6, 0), color:Lerp(WHITE, 0.55), Enum.Material.SmoothPlastic, model)
	-- Lichter middenvlak met tegelnaden in de kleur van het lab
	block("FloorTrim", Vector3.new(HX * 2 - 6, 0.12, HZ * 2 - 6), at(0, F + 0.02, 0), color:Lerp(WHITE, 0.8), Enum.Material.SmoothPlastic, model)
	for k = -3, 3 do
		block("Seam", Vector3.new(0.3, 0.14, HZ * 2 - 6), at(k * 14 + 7, F + 0.03, 0), color:Lerp(WHITE, 0.45), Enum.Material.SmoothPlastic, model)
	end

	-- Muren: onder dicht, boven glas, met neon langs de bovenrand.
	local function wall(lx: number, lz: number, sx: number, sz: number)
		block("Wall", Vector3.new(sx, 9, sz), at(lx, F + 4.5, lz), WHITE, Enum.Material.SmoothPlastic, model)
		local glass = block("Glass", Vector3.new(sx, WH - 9, sz), at(lx, F + 9 + (WH - 9) / 2, lz), color:Lerp(WHITE, 0.6), Enum.Material.Glass, model)
		glass.Transparency = 0.55
		block("Trim", Vector3.new(sx + 0.2, 0.6, sz + 0.2), at(lx, F + 9, lz), color, Enum.Material.Neon, model)
		block("Trim", Vector3.new(sx + 0.2, 0.8, sz + 0.2), at(lx, F + WH, lz), color, Enum.Material.Neon, model)
	end
	wall(0, -HZ + 1, HX * 2, 2)
	wall(-HX + 1, 0, 2, HZ * 2)
	wall(HX - 1, 0, 2, HZ * 2)
	local G = Layout.GATE_HALF
	local frontW = HX - G
	wall(-(G + frontW / 2), HZ - 1, frontW, 2)
	wall(G + frontW / 2, HZ - 1, frontW, 2)

	-- Hoekpilaren met lampen
	for _, c in { { -HX, -HZ }, { HX, -HZ }, { -HX, HZ }, { HX, HZ }, { -G - 1, HZ }, { G + 1, HZ } } do
		local cf = at(c[1], F, c[2])
		cyl("Pillar", cf.Position, WH + 2, 4, WHITE, nil, model)
		local cap = ball("PillarLight", cf.Position + Vector3.new(0, WH + 3, 0), 3.4, color, Enum.Material.Neon, model)
		light(cap, color, 22, 1.4)
	end
	-- Balk boven de ingang en de laserpoort
	block("GateBeam", Vector3.new(G * 2 + 4, 2, 2.4), at(0, F + WH + 1, HZ - 1), color, Enum.Material.Neon, model)
	local gate = block("Gate", Vector3.new(G * 2, WH - 1, 0.8), at(0, F + (WH - 1) / 2, HZ - 1), rgb(120, 255, 170), Enum.Material.ForceField, model)
	gate.Transparency = 0.95
	gate.CanCollide = false

	-- Platforms
	local pads = folder("Pads", model)
	for i, p in Layout.PADS do
		local cf = at(p.x, F, p.z)
		cyl("PadRing", cf.Position, 0.3, 10.6, rgb(70, 60, 90), nil, model)
		local pad = cyl("Pad" .. i, cf.Position, 0.5, 9.4, color, Enum.Material.Neon, pads)
		pad.Transparency = 0.15
	end

	-- Collect Pad met Goo-tank
	local collect = cyl("CollectPad", at(Layout.COLLECT.x, F, Layout.COLLECT.z).Position, 0.6, 8, rgb(100, 255, 150), Enum.Material.Neon, model)
	light(collect, rgb(100, 255, 150), 14, 1.2)
	local tankPos = at(Layout.COLLECT.x - 11, F, Layout.COLLECT.z + 6).Position
	cyl("TankBase", tankPos, 1.2, 7, rgb(90, 100, 120), Enum.Material.DiamondPlate, model)
	local tankGlass = cyl("TankGlass", tankPos + Vector3.new(0, 1.2, 0), 9, 5.6, rgb(220, 255, 235), Enum.Material.Glass, model)
	tankGlass.Transparency = 0.6
	cyl("TankGoo", tankPos + Vector3.new(0, 1.3, 0), 6, 4.6, rgb(110, 255, 170), Enum.Material.Neon, model)
	cyl("TankCap", tankPos + Vector3.new(0, 10.2, 0), 1, 6.4, rgb(90, 100, 120), Enum.Material.DiamondPlate, model)

	-- Lock-knop
	local lockPos = at(Layout.LOCK.x, F, Layout.LOCK.z).Position
	cyl("LockRim", lockPos, 0.4, 8.2, rgb(60, 50, 70), nil, model)
	local button = cyl("LockButton", lockPos, 0.8, 6.6, rgb(255, 70, 100), Enum.Material.Neon, model)
	light(button, rgb(255, 80, 110), 12, 1)

	-- Fuse Machine
	local fusePos = at(Layout.FUSE.x, F, Layout.FUSE.z).Position
	local fuseBase = cyl("FuseMachine", fusePos, 2, 9, rgb(80, 70, 110), Enum.Material.DiamondPlate, model)
	fuseBase:SetAttribute("Opens", "Fuse")
	local tube = cyl("FuseTube", fusePos + Vector3.new(0, 2, 0), 10, 6.5, rgb(230, 210, 255), Enum.Material.Glass, model)
	tube.Transparency = 0.55
	local core = ball("FuseCore", fusePos + Vector3.new(0, 7, 0), 3.6, rgb(200, 110, 255), Enum.Material.Neon, model)
	sparkles(core, rgb(220, 170, 255), 8, 0.8, 2)
	light(core, rgb(200, 110, 255), 16, 1.5)
	cyl("FuseCap", fusePos + Vector3.new(0, 12, 0), 1.6, 8, rgb(80, 70, 110), Enum.Material.DiamondPlate, model)
	for k = 0, 2 do
		cyl("FuseRing", fusePos + Vector3.new(0, 4 + k * 3, 0), 0.4, 7.2, color, Enum.Material.Neon, model)
	end

	-- Naambord boven de ingang (tekst komt in de game)
	block("SignBack", Vector3.new(38, 10, 0.8), at(0, F + WH + 7, HZ + 0.6), color, Enum.Material.Neon, model)
	block("Sign", Vector3.new(36, 8, 0.6), at(0, F + WH + 7, HZ + 1.2), rgb(40, 26, 70), Enum.Material.SmoothPlastic, model)

	-- Plantjes in de achterhoeken
	for _, c in { { -HX + 6, -HZ + 6 }, { HX - 6, -HZ + 6 } } do
		local p = at(c[1], F, c[2]).Position
		cyl("Pot", p, 3, 5, color:Lerp(WHITE, 0.3), nil, model)
		ball("Bush", p + Vector3.new(0, 5.5, 0), 7, rgb(110, 200, 120), Enum.Material.Grass, model)
	end
end

------------------------------------------------------------------ plein en kiosken

local function kioskShop(world: any, x: number, z: number, faceX: number)
	local m = folder("ShopKiosk", world)
	local look = Vector3.new(faceX, 0, 0)
	local base = lookAt(Vector3.new(x, 0, z), Vector3.new(x, 0, z) + look)
	local counter = block("ShopCounter", Vector3.new(18, 4.5, 6), base * CFrame.new(0, 2.25, 0), rgb(255, 140, 200), nil, m)
	counter:SetAttribute("Opens", "Shop")
	for i = -2, 2 do
		block("Awning", Vector3.new(4, 0.6, 9), base * CFrame.new(i * 4, 12, -1.5) * CFrame.Angles(math.rad(15), 0, 0), if i % 2 == 0 then rgb(255, 110, 180) else WHITE, nil, m)
	end
	for _, s in { -1, 1 } do
		cyl("ShopPost", (base * CFrame.new(s * 8.5, 0, 3)).Position, 12, 1, WHITE, nil, m)
	end
	local sign = block("ShopSign", Vector3.new(16, 4, 0.5), base * CFrame.new(0, 15.5, -1), rgb(40, 26, 70), nil, m)
	sign:SetAttribute("SignText", "SLIME SHOP")
	-- Uitgestalde eieren
	for i, c in { rgb(255, 230, 120), rgb(170, 140, 255), rgb(120, 230, 255) } do
		local egg = ball("ShopEgg", (base * CFrame.new(-6 + i * 3, 5.6, -1)).Position, 2.4, c, Enum.Material.SmoothPlastic, m)
		egg.Reflectance = 0.2
	end
end

local function kioskCodes(world: any, x: number, z: number, faceX: number)
	local m = folder("CodeTerminal", world)
	local base = lookAt(Vector3.new(x, 0, z), Vector3.new(x + faceX, 0, z))
	local body = block("CodeTerminal", Vector3.new(7, 9, 4), base * CFrame.new(0, 4.5, 0), rgb(70, 60, 100), Enum.Material.DiamondPlate, m)
	body:SetAttribute("Opens", "Codes")
	local screen = block("CodeScreen", Vector3.new(5.6, 4, 0.3), base * CFrame.new(0, 6, -2.05), rgb(120, 220, 200), Enum.Material.Neon, m)
	light(screen, rgb(120, 230, 210), 12, 1.2)
	local sign = block("CodeSign", Vector3.new(12, 3.4, 0.5), base * CFrame.new(0, 12, 0), rgb(40, 26, 70), nil, m)
	sign:SetAttribute("SignText", "CODES")
end

local function kioskRebirth(world: any, x: number, z: number)
	local m = folder("RebirthAltar", world)
	local altar = cyl("RebirthAltar", Vector3.new(x, 0, z), 1.6, 20, rgb(90, 220, 150), Enum.Material.Marble, m)
	altar:SetAttribute("Opens", "Rebirth")
	cyl("AltarGlow", Vector3.new(x, 1.6, z), 0.3, 16, rgb(140, 255, 190), Enum.Material.Neon, m)
	for k = 0, 7 do
		local a = k / 8 * math.pi * 2
		local p = Vector3.new(x + math.cos(a) * 9, 1.6, z + math.sin(a) * 9)
		cyl("AltarPillar", p, 7, 1.2, WHITE, Enum.Material.Marble, m)
		ball("AltarFlame", p + Vector3.new(0, 7.8, 0), 1.6, rgb(140, 255, 190), Enum.Material.Neon, m)
	end
	local orb = ball("RebirthOrb", Vector3.new(x, 11, z), 5, rgb(160, 255, 200), Enum.Material.Neon, m)
	sparkles(orb, rgb(200, 255, 220), 20, 1.2, 4)
	light(orb, rgb(150, 255, 200), 30, 2)
	local sign = block("RebirthSign", Vector3.new(16, 4, 0.5), lookAt(Vector3.new(x, 17, z), Vector3.new(x - 1, 17, z)), rgb(40, 26, 70), nil, m)
	sign:SetAttribute("SignText", "REBIRTH")
end

local function kioskDex(world: any, x: number, z: number)
	local m = folder("DexBoard", world)
	local base = lookAt(Vector3.new(x, 0, z), Vector3.new(x - 1, 0, z))
	local board = block("DexBoard", Vector3.new(22, 13, 1), base * CFrame.new(0, 9.5, 0), rgb(50, 34, 90), nil, m)
	board:SetAttribute("Opens", "Dex")
	board:SetAttribute("SignText", "SLIMEDEX")
	block("DexFrame", Vector3.new(24, 15, 0.6), base * CFrame.new(0, 9.5, 0.6), rgb(90, 180, 255), Enum.Material.Neon, m)
	for _, s in { -1, 1 } do
		cyl("DexPost", (base * CFrame.new(s * 10, 0, 0.8)).Position, 4, 1.2, WHITE, nil, m)
	end
end

local function buildBoards(world: any)
	local boards = folder("Boards", world)
	for _, spec in { { "TopGoo", Layout.BOARD_GOO, rgb(120, 255, 160) }, { "TopThieves", Layout.BOARD_STEALS, rgb(255, 140, 90) } } do
		local pos = Vector3.new(spec[2].x, 18, spec[2].z)
		local cf = lookAt(pos, pos + Vector3.new(0, 0, 1))
		block(spec[1], Vector3.new(24, 30, 1), cf, rgb(28, 18, 52), nil, boards)
		block("BoardFrame", Vector3.new(26, 32, 0.6), cf * CFrame.new(0, 0, 0.7), spec[3], Enum.Material.Neon, boards)
		for _, s in { -1, 1 } do
			cyl("BoardPost", Vector3.new(pos.X + s * 11, 0, pos.Z + 1), 3, 1.6, WHITE, nil, boards)
		end
	end
end

local function buildPlazas(world: any)
	local plaza = folder("Plaza", world)
	for _, side in { -1, 1 } do
		local x = side * 300
		cyl("PlazaFloor", Vector3.new(x, 0, 0), 0.4, 96, rgb(240, 228, 214), Enum.Material.Pavement, plaza)
		cyl("PlazaRing", Vector3.new(x, 0.05, 0), 0.4, 100, CANDY[if side < 0 then 1 else 5], Enum.Material.Neon, plaza)
	end
	kioskShop(world, Layout.SHOP.x, Layout.SHOP.z, 1)
	kioskCodes(world, Layout.CODES.x, Layout.CODES.z, 1)
	kioskRebirth(world, Layout.REBIRTH.x, Layout.REBIRTH.z)
	kioskDex(world, Layout.DEX.x, Layout.DEX.z)

	local spawn = part({ ClassName = "SpawnLocation", Name = "Spawn", Size = Vector3.new(14, 1, 14), CFrame = CFrame.new(-312, 0.5, 0), Color = rgb(150, 255, 190), Material = Enum.Material.Neon, Parent = world })
	spawn.Neutral = true
	spawn.Duration = 0
	spawn.Transparency = 0.3
end

------------------------------------------------------------------ decor

local function mushroom(parent: any, x: number, z: number, h: number, d: number, color: any)
	cyl("Stem", Vector3.new(x, 0, z), h, d * 0.25, CREAM, nil, parent)
	cyl("Gills", Vector3.new(x, h - 0.4, z), 0.8, d, rgb(255, 225, 225), nil, parent)
	ball("Cap", Vector3.new(x, h, z), d, color, Enum.Material.SmoothPlastic, parent)
	for k = 1, 6 do
		local a = k * 1.05
		local r = d * (0.22 + (k % 2) * 0.12)
		local y = h + math.sqrt(math.max(0, (d / 2) ^ 2 - r * r)) - 0.3
		ball("Dot", Vector3.new(x + math.cos(a) * r, y, z + math.sin(a) * r), d * 0.14, WHITE, nil, parent)
	end
end

local function crystal(parent: any, x: number, z: number, color: any)
	for k = 1, 4 do
		local h = range(6, 15)
		local cf = CFrame.new(x + range(-2.5, 2.5), h / 2 - 1, z + range(-2.5, 2.5)) * CFrame.Angles(range(-0.35, 0.35), range(0, 3), range(-0.35, 0.35))
		local c = block("Crystal", Vector3.new(range(1.8, 3.2), h, range(1.8, 3.2)), cf, color, Enum.Material.Neon, parent)
		c.Transparency = 0.15
		if k == 1 then
			light(c, color, 18, 1.2)
		end
	end
end

local function candyTree(parent: any, x: number, z: number)
	cyl("Trunk", Vector3.new(x, 0, z), 11, 2, rgb(170, 120, 90), Enum.Material.Wood, parent)
	for k = 1, 3 do
		ball("Leaves", Vector3.new(x + range(-2.5, 2.5), 11 + k * 2.2, z + range(-2.5, 2.5)), range(8, 11), CANDY[math.floor(range(1, 5.99))], Enum.Material.SmoothPlastic, parent)
	end
end

local function free(x: number, z: number, margin: number): boolean
	if math.abs(z) < 36 then
		return false
	end
	for _, lab in Layout.LABS do
		if Layout.inLab(lab, x, z, margin) then
			return false
		end
	end
	for _, spot in { Layout.SHOP, Layout.CODES, Layout.REBIRTH, Layout.DEX, Layout.BOARD_GOO, Layout.BOARD_STEALS } do
		if math.abs(x - spot.x) < 22 and math.abs(z - spot.z) < 22 then
			return false
		end
	end
	if math.abs(math.abs(x) - 300) < 52 and math.abs(z) < 52 then
		return false
	end
	return math.abs(x) < Layout.ISLAND.halfX - 14 and math.abs(z) < Layout.ISLAND.halfZ - 14
end

local function buildDecor(world: any)
	local decor = folder("Decor", world)
	local placed = 0
	local tries = 0
	while placed < 46 and tries < 3000 do
		tries += 1
		local x = range(-Layout.ISLAND.halfX, Layout.ISLAND.halfX)
		local z = range(-Layout.ISLAND.halfZ, Layout.ISLAND.halfZ)
		if free(x, z, 10) then
			placed += 1
			local kind = placed % 3
			if kind == 0 then
				mushroom(decor, x, z, range(12, 22), range(14, 24), CANDY[math.floor(range(1, 5.99))])
			elseif kind == 1 then
				crystal(decor, x, z, CANDY[math.floor(range(1, 5.99))])
			else
				candyTree(decor, x, z)
			end
		end
	end
	-- Kleine boompjes in de smalle stroken tussen de labs
	for _, gx in { -120, 0, 120 } do
		for _, gz in { -150, -90, 90, 150 } do
			candyTree(decor, gx, gz)
		end
	end
end

------------------------------------------------------------------ belichting

local function buildLighting(game: any)
	local lighting = game:GetService("Lighting")
	local atmo = Instance.new("Atmosphere")
	atmo.Density = 0.3
	atmo.Offset = 0.2
	atmo.Color = rgb(255, 214, 236)
	atmo.Decay = rgb(130, 96, 190)
	atmo.Glare = 0.35
	atmo.Haze = 1.4
	atmo.Parent = lighting
	local bloom = Instance.new("BloomEffect")
	bloom.Intensity = 0.55
	bloom.Size = 30
	bloom.Threshold = 1.4
	bloom.Parent = lighting
	local grade = Instance.new("ColorCorrectionEffect")
	grade.Name = "Grade"
	grade.Brightness = 0.02
	grade.Contrast = 0.1
	grade.Saturation = 0.16
	grade.TintColor = rgb(255, 250, 252)
	grade.Parent = lighting
	local rays = Instance.new("SunRaysEffect")
	rays.Intensity = 0.07
	rays.Spread = 0.55
	rays.Parent = lighting
end

------------------------------------------------------------------ alles

function MapBuilder.build(game: any): { [string]: number }
	local world = game:GetService("Workspace")
	buildIsland(world)
	buildRiver(world)
	local labs = folder("Labs", world)
	for i, info in Layout.LABS do
		buildLab(labs, i, info)
	end
	buildPlazas(world)
	buildBoards(world)
	buildDecor(world)
	buildLighting(game)
	return { parts = count, labs = #Layout.LABS, pads = #Layout.PADS, river = math.floor(Layout.RIVER_LENGTH) }
end

return MapBuilder
