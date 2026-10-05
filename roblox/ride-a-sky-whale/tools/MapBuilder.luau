-- Bouwt de map (de walvis, wolkenzee en verre eilanden) in een placebestand.
-- Draait met Lune tijdens het bouwen, niet in de game zelf.
--
-- Assen: de walvis ligt langs X. De kop zit bij +X, de staart bij -X.
-- Y is omhoog. De rug ligt rond Y = 70.

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

local MapBuilder = {}

local rgb = Color3.fromRGB
local BODY = rgb(64, 108, 150)
local BELLY = rgb(176, 198, 216)
local DARK = rgb(28, 44, 68)
local WOOD = rgb(150, 108, 70)
local STRAW = rgb(205, 168, 110)

local VERTICAL = CFrame.Angles(0, 0, math.rad(90)) -- cilinder rechtop zetten

-- Profiel van het lijf: { x, hoogte van de middellijn, straal }
local PROFILE = {
	{ 270, 0, 20 },
	{ 250, -2, 38 },
	{ 220, 0, 52 },
	{ 180, 2, 62 },
	{ 130, 4, 69 },
	{ 70, 5, 72 },
	{ 10, 4, 70 },
	{ -50, 3, 64 },
	{ -110, 4, 54 },
	{ -160, 6, 42 },
	{ -205, 8, 30 },
	{ -245, 10, 20 },
	{ -280, 12, 13 },
}

local function profileAt(x: number): (number, number)
	if x >= PROFILE[1][1] then
		return PROFILE[1][2], PROFILE[1][3]
	end
	for i = 1, #PROFILE - 1 do
		local a, b = PROFILE[i], PROFILE[i + 1]
		if x <= a[1] and x >= b[1] then
			local t = (a[1] - x) / (a[1] - b[1])
			return a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t
		end
	end
	local last = PROFILE[#PROFILE]
	return last[2], last[3]
end

type Sphere = { x: number, y: number, r: number }
local spheres: { Sphere } = {}

-- Hoogte van het walvisoppervlak boven punt (x, z). Nil als je naast de walvis staat.
local function surfaceY(x: number, z: number): number?
	local best: number? = nil
	for _, s in spheres do
		local d2 = s.r * s.r - (x - s.x) ^ 2 - z * z
		if d2 > 0 then
			local y = s.y + math.sqrt(d2)
			if best == nil or y > best then
				best = y
			end
		end
	end
	return best
end

local function part(props: { [string]: any }): any
	local className = props.ClassName or "Part"
	local p = Instance.new(className)
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
	return p
end

local function ball(name: string, pos: any, diameter: number, color: any, parent: any): any
	return part({ Name = name, Shape = Enum.PartType.Ball, Size = Vector3.new(diameter, diameter, diameter), CFrame = CFrame.new(pos), Color = color, Parent = parent })
end

local function disc(name: string, center: any, diameter: number, thickness: number, color: any, parent: any): any
	return part({ Name = name, Shape = Enum.PartType.Cylinder, Size = Vector3.new(thickness, diameter, diameter), CFrame = CFrame.new(center) * VERTICAL, Color = color, Parent = parent })
end

-- Cilinder van punt a naar punt b.
local function rod(name: string, a: any, b: any, diameter: number, color: any, parent: any): any
	local mid = (a + b) / 2
	local length = (b - a).Magnitude
	local dir = (b - a).Unit
	-- lookAt met de standaard up-vector faalt bij een (bijna) verticale staaf.
	local up = if math.abs(dir.Y) > 0.99 then Vector3.new(1, 0, 0) else Vector3.new(0, 1, 0)
	return part({
		Name = name,
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(length, diameter, diameter),
		CFrame = CFrame.lookAt(mid, b, up) * CFrame.Angles(0, math.rad(90), 0),
		Color = color,
		Parent = parent,
	})
end

local function buildBody(whale: any)
	local body = Instance.new("Model")
	body.Name = "Body"
	body.Parent = whale

	local x = 268
	while x >= -280 do
		local yc, r = profileAt(x)
		table.insert(spheres, { x = x, y = yc, r = r })
		ball("Body", Vector3.new(x, yc, 0), r * 2, BODY, body)
		if x <= 250 and x >= -210 then
			-- Lichtere buik: een iets kleinere bol die alleen onderaan uitsteekt.
			ball("Belly", Vector3.new(x, yc - 0.16 * r, 0), r * 1.8, BELLY, body)
		end
		x -= 12
	end

	-- Ogen
	for _, side in { -1, 1 } do
		local ex = 214
		local yc, r = profileAt(ex)
		local ey = yc - 4
		local ez = side * (math.sqrt(r * r - 16) - 1.5)
		ball("Eye", Vector3.new(ex, ey, ez), 9, DARK, body)
		local glint = ball("Glint", Vector3.new(ex + 1.5, ey + 2, ez + side * 3.4), 2.6, rgb(255, 255, 255), body)
		glint.Material = Enum.Material.Neon
	end

	-- Glimlach: een lijn van korte staafjes langs de kaak
	for _, side in { -1, 1 } do
		local points = {}
		for i = 0, 7 do
			local t = i / 7
			local mx = 266 - t * 62
			local yc, r = profileAt(mx)
			local my = yc - 12 - 7 * math.sin(t * math.pi)
			local dz = math.sqrt(math.max(r * r - (my - yc) ^ 2, 1)) - 0.4
			table.insert(points, Vector3.new(mx, my, side * dz))
		end
		for i = 1, #points - 1 do
			rod("Mouth", points[i], points[i + 1], 1.6, DARK, body)
		end
	end

	-- Zeepokken voor wat textuur (vaste seed, dus elke build hetzelfde)
	math.randomseed(7)
	for _ = 1, 40 do
		local bx = math.random(-200, 250)
		local bz = math.random(-45, 45)
		local inNestZone = bx > -30 and bx < 150 and math.abs(bz) > 8
		local y = surfaceY(bx, bz)
		if y and not inNestZone and math.abs(bz) > 6 then
			ball("Barnacle", Vector3.new(bx, y - 0.6, bz), math.random(20, 42) / 10, rgb(214, 220, 226), body)
		end
	end

	-- Borstvinnen
	for _, side in { -1, 1 } do
		local yc, r = profileAt(150)
		local root = Vector3.new(150, yc - 22, side * (math.sqrt(r * r - 22 * 22) - 6))
		local dir = Vector3.new(-0.55, -0.32, side * 0.77).Unit
		local center = root + dir * 30
		part({
			Name = "Fin",
			Size = Vector3.new(64, 3, 22),
			CFrame = CFrame.lookAt(center, center + dir) * CFrame.Angles(0, math.rad(90), 0),
			Color = BODY,
			Parent = body,
		})
	end

	-- Rugvin
	local finY = surfaceY(-100, 0) or 60
	part({
		ClassName = "WedgePart",
		Name = "DorsalFin",
		Size = Vector3.new(3, 12, 22),
		CFrame = CFrame.new(-100, finY + 4, 0) * CFrame.Angles(0, math.rad(-90), 0),
		Color = BODY,
		Parent = body,
	})
end

local function buildTail(whale: any)
	local tail = Instance.new("Model")
	tail.Name = "Tail"
	tail.Parent = whale
	local _, r = profileAt(-280)
	local rootPos = Vector3.new(-282, 12, 0)
	part({ Name = "Root", Size = Vector3.new(1, 1, 1), CFrame = CFrame.new(rootPos), Transparency = 1, CanCollide = false, CanQuery = false, CanTouch = false, Parent = tail })
	local joint = ball("Joint", Vector3.new(-290, 12, 0), r * 1.7, BODY, tail)
	joint.CanCollide = false
	for _, side in { -1, 1 } do
		local fluke = part({
			Name = "Fluke",
			Size = Vector3.new(44, 2.6, 26),
			CFrame = CFrame.new(-312, 12, side * 20) * CFrame.Angles(0, side * math.rad(-32), 0),
			Color = BODY,
			CanCollide = false,
			Parent = tail,
		})
		fluke.CastShadow = true
	end
end

local function buildBlowhole(whale: any)
	local x = 168
	local top = surfaceY(x, 0) or 66
	disc("BlowholeRim", Vector3.new(x, top - 0.6, 0), 15, 1.4, rgb(120, 155, 190), whale)
	disc("BlowholeHole", Vector3.new(x, top - 0.35, 0), 10, 1.4, DARK, whale)

	local zone = part({
		Name = "Blowhole",
		Size = Vector3.new(11, 6, 11),
		CFrame = CFrame.new(x, top + 2, 0),
		Transparency = 1,
		CanCollide = false,
		CanQuery = false,
		Parent = whale,
	})
	zone:SetAttribute("Radius", 6)
	zone:SetAttribute("LaunchVelocity", 210)
	zone:AddTag("Launcher")

	local spray = Instance.new("ParticleEmitter")
	spray.Name = "Spray"
	spray.Texture = "rbxasset://textures/particles/smoke_main.dds"
	spray.Color = ColorSequence.new(rgb(225, 240, 255))
	spray.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 2), NumberSequenceKeypoint.new(1, 7) })
	spray.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.3), NumberSequenceKeypoint.new(1, 1) })
	spray.Speed = NumberRange.new(35, 55)
	spray.Lifetime = NumberRange.new(1, 1.6)
	spray.SpreadAngle = Vector2.new(10, 10)
	spray.Acceleration = Vector3.new(0, -25, 0)
	spray.Rate = 18
	spray.EmissionDirection = Enum.NormalId.Top
	spray.Parent = zone
	return top
end

local function buildSpawnAndBoard(whale: any)
	local sx = 198
	local sy = surfaceY(sx, 0) or 60
	local spawnPos = Vector3.new(sx, sy + 0.6, 0)
	local spawn = part({
		ClassName = "SpawnLocation",
		Name = "Spawn",
		Size = Vector3.new(10, 1, 10),
		CFrame = CFrame.lookAt(spawnPos, spawnPos + Vector3.new(-1, 0, 0)),
		Transparency = 1,
		CanCollide = false,
		Parent = whale,
	})
	spawn.Neutral = true
	spawn.Duration = 0

	-- Forecast-bord rechts van het pad naar het spuitgat, gedraaid naar de spawn.
	local bx, bz = 182, -28
	local groundY = surfaceY(bx, bz) or (sy - 6)
	local boardPos = Vector3.new(bx, groundY + 11, bz)
	local lookTarget = Vector3.new(sx, boardPos.Y, 0)
	part({
		Name = "ForecastBoard",
		Size = Vector3.new(22, 13, 1),
		CFrame = CFrame.lookAt(boardPos, lookTarget),
		Color = rgb(30, 50, 80),
		Parent = whale,
	})
	local boardCf = CFrame.lookAt(boardPos, lookTarget)
	for _, side in { -1, 1 } do
		local postTop = (boardCf * CFrame.new(side * 9, -6, 0.8)).Position
		rod("BoardPost", postTop, Vector3.new(postTop.X, groundY - 3, postTop.Z), 1.4, WOOD, whale)
	end
end

local function buildNests(whale: any)
	local nests = Instance.new("Folder")
	nests.Name = "Nests"
	nests.Parent = whale
	local index = 0
	for _, nx in { 118, 78, 38, -2 } do
		for _, nz in { 24, -24 } do
			index += 1
			local model = Instance.new("Model")
			model.Name = "Nest" .. index
			model.Parent = nests

			local hi, lo = -math.huge, math.huge
			for dx = -14, 14, 7 do
				for dz = -14, 14, 7 do
					local y = surfaceY(nx + dx, nz + dz)
					if y then
						hi = math.max(hi, y)
						lo = math.min(lo, y)
					end
				end
			end
			local top = hi + 0.6
			local padCenter = Vector3.new(nx, top - 1, nz)
			local pad = disc("Pad", padCenter, 28, 2, STRAW, model)
			pad.Material = Enum.Material.Fabric
			model.PrimaryPart = pad

			local baseTop = top - 2
			local baseBottom = lo - 4
			local baseHeight = baseTop - baseBottom
			local base = disc("Base", Vector3.new(nx, (baseTop + baseBottom) / 2, nz), 24, baseHeight, WOOD, model)
			base.Material = Enum.Material.Wood

			for i = 0, 15 do
				local a = i / 16 * math.pi * 2
				ball("Twig", Vector3.new(nx + math.cos(a) * 13.4, top + 0.4, nz + math.sin(a) * 13.4), 3.2, rgb(130, 92, 58), model)
			end
		end
	end
end

local function buildTrough(whale: any)
	local tx = -72
	local ty = surfaceY(tx, 0) or 60
	local trough = part({
		Name = "FeedingTrough",
		Size = Vector3.new(12, 3.5, 6),
		CFrame = CFrame.new(tx, ty + 1.4, 0),
		Color = WOOD,
		Material = Enum.Material.Wood,
		Parent = whale,
	})
	part({
		Name = "Krill",
		Size = Vector3.new(10.5, 0.6, 4.5),
		CFrame = trough.CFrame * CFrame.new(0, 1.6, 0),
		Color = rgb(255, 140, 120),
		Material = Enum.Material.Neon,
		CanCollide = false,
		Parent = whale,
	})
end

local function buildCloudSea(workspace: any)
	local sea = Instance.new("Folder")
	sea.Name = "CloudSea"
	sea.Parent = workspace
	local puffs = Instance.new("Folder")
	puffs.Name = "Puffs"
	puffs.Parent = sea

	local function puff(pos: any, d: number)
		local p = ball("Puff", pos, d, rgb(255, 255, 255), puffs)
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.CastShadow = false
	end

	math.randomseed(11)
	for _ = 1, 70 do
		puff(Vector3.new(math.random(-1000, 1000), math.random(-155, -105), math.random(-1000, 1000)), math.random(70, 170))
	end
	-- Een paar wolken op ooghoogte, ver genoeg weg om niet in de weg te zitten.
	local placed = 0
	while placed < 24 do
		local px, pz = math.random(-1000, 1000), math.random(-1000, 1000)
		if math.sqrt(px * px + pz * pz) > 420 then
			puff(Vector3.new(px, math.random(-30, 140), pz), math.random(30, 80))
			placed += 1
		end
	end
end

local function buildScenery(workspace: any)
	local scenery = Instance.new("Folder")
	scenery.Name = "Scenery"
	scenery.Parent = workspace
	math.randomseed(23)
	for i = 1, 9 do
		local angle = (i / 9) * math.pi * 2 + math.random() * 0.4
		local dist = math.random(650, 950)
		local center = Vector3.new(math.cos(angle) * dist, math.random(-60, 170), math.sin(angle) * dist)
		local d = math.random(60, 130)
		local island = Instance.new("Model")
		island.Name = "Island" .. i
		island.Parent = scenery
		local grass = disc("Grass", center, d, 8, rgb(104, 165, 90), island)
		grass.Material = Enum.Material.Grass
		local rockColors = { rgb(132, 116, 100), rgb(116, 102, 90), rgb(100, 88, 78) }
		for tier = 1, 3 do
			local rock = disc("Rock", center + Vector3.new(0, -4 - tier * 9, 0), d * (1 - tier * 0.24), 12, rockColors[tier], island)
			rock.Material = Enum.Material.Slate
		end
		if i == 4 then
			-- Vulkaaneiland voor Ashfall
			for tier = 0, 4 do
				local cone = disc("Volcano", center + Vector3.new(0, 8 + tier * 10, 0), d * (0.7 - tier * 0.12), 10, rgb(95 - tier * 6, 80 - tier * 6, 72 - tier * 6), island)
				cone.Material = Enum.Material.Basalt
			end
			local lava = disc("Lava", center + Vector3.new(0, 56, 0), d * 0.16, 2, rgb(255, 110, 40), island)
			lava.Material = Enum.Material.Neon
		else
			for _ = 1, math.random(1, 3) do
				local tx = center.X + math.random(-d // 4, d // 4)
				local tz = center.Z + math.random(-d // 4, d // 4)
				local h = math.random(12, 22)
				local trunkBase = Vector3.new(tx, center.Y + 4, tz)
				local trunkTop = trunkBase + Vector3.new(0, h, 0)
				rod("Trunk", trunkBase, trunkTop, 2.4, rgb(110, 80, 55), island)
				local leaves = ball("Leaves", trunkTop + Vector3.new(0, 4, 0), math.random(12, 18), rgb(80, 150, 85), island)
				leaves.Material = Enum.Material.Grass
			end
		end
	end
end

local function buildLighting(game: any)
	local lighting = game:GetService("Lighting")
	local atmosphere = Instance.new("Atmosphere")
	atmosphere.Density = 0.28
	atmosphere.Offset = 0.25
	atmosphere.Color = rgb(199, 220, 240)
	atmosphere.Decay = rgb(106, 140, 170)
	atmosphere.Glare = 0.2
	atmosphere.Haze = 1
	atmosphere.Parent = lighting
end

-- Bouwt alles in `game` (een DataModel uit roblox.deserializePlace).
function MapBuilder.build(game: any): { [string]: number }
	local workspace = game:GetService("Workspace")
	local whale = Instance.new("Model")
	whale.Name = "SkyWhale"
	whale.Parent = workspace

	buildBody(whale)
	buildTail(whale)
	local blowholeTop = buildBlowhole(whale)
	buildSpawnAndBoard(whale)
	buildNests(whale)
	buildTrough(whale)
	buildCloudSea(workspace)
	buildScenery(workspace)
	buildLighting(game)

	local count = 0
	for _, d in workspace:GetDescendants() do
		if d:IsA("BasePart") then
			count += 1
		end
	end
	return { parts = count, spheres = #spheres, blowholeTop = blowholeTop, backTop = surfaceY(40, 0) or 0 }
end

return MapBuilder
