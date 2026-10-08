--!strict
-- De indeling van de wereld als gewone getallen. De mapbouwer (Lune) en de game
-- gebruiken allebei dit bestand, zodat platforms, rivier en labs altijd kloppen.
--
-- Assen: X loopt langs de rivier, Z dwars erop, Y is omhoog. De grond ligt op Y = 0.

export type Lab = { x: number, z: number, dir: number, color: { number }, name: string }
export type Point = { x: number, z: number }

local Layout = {}

Layout.ISLAND = { halfX = 340, halfZ = 205 }
Layout.LAB_HALF_X = 50 -- breedte 100
Layout.LAB_HALF_Z = 48 -- diepte 96
Layout.WALL_HEIGHT = 16
Layout.GATE_HALF = 15 -- halve breedte van de ingang
Layout.FLOOR_Y = 0.6
Layout.PAD_TOP = 1.1 -- bovenkant van een platform: hier staan de slijmpjes

-- Acht labs: vier ten noorden van de rivier (ingang naar +Z), vier ten zuiden (ingang naar -Z).
Layout.LABS = {
	{ x = -180, z = -112, dir = 1, color = { 255, 90, 120 }, name = "Strawberry Lab" },
	{ x = -60, z = -112, dir = 1, color = { 255, 170, 60 }, name = "Mango Lab" },
	{ x = 60, z = -112, dir = 1, color = { 255, 230, 80 }, name = "Lemon Lab" },
	{ x = 180, z = -112, dir = 1, color = { 120, 230, 110 }, name = "Lime Lab" },
	{ x = -180, z = 112, dir = -1, color = { 80, 210, 255 }, name = "Ocean Lab" },
	{ x = -60, z = 112, dir = -1, color = { 110, 130, 255 }, name = "Blueberry Lab" },
	{ x = 60, z = 112, dir = -1, color = { 190, 110, 255 }, name = "Grape Lab" },
	{ x = 180, z = 112, dir = -1, color = { 255, 120, 220 }, name = "Bubblegum Lab" },
} :: { Lab }

-- Platforms in lokale coördinaten (lx dwars, lz naar de ingang). Volgorde: voorste rij eerst,
-- van het midden naar buiten, zodat de eerste platforms het dichtst bij de ingang liggen.
Layout.PADS = {} :: { Point }
do
	local rows = { 10, -2, -14, -26, -38 }
	local cols = { 0, -14, 14, -28, 28 }
	for _, lz in rows do
		for _, lx in cols do
			table.insert(Layout.PADS, { x = lx, z = lz })
		end
	end
end

Layout.COLLECT = { x = -32, z = 33 }
Layout.LOCK = { x = 32, z = 33 }
Layout.FUSE = { x = -42, z = 20 }
Layout.SPAWN = { x = 0, z = 30 }
Layout.SIGN = { x = 0, z = 52 }

-- Lokaal -> wereld. Rechts = (-dir, 0, 0), vooruit = (0, 0, dir).
function Layout.toWorld(lab: Lab, lx: number, lz: number): (number, number)
	return lab.x - lx * lab.dir, lab.z + lz * lab.dir
end

-- Wereld -> lokaal (om te kijken of iemand in een lab staat).
function Layout.toLocal(lab: Lab, x: number, z: number): (number, number)
	return -(x - lab.x) * lab.dir, (z - lab.z) * lab.dir
end

function Layout.inLab(lab: Lab, x: number, z: number, margin: number?): boolean
	local lx, lz = Layout.toLocal(lab, x, z)
	local m = margin or 0
	return math.abs(lx) <= Layout.LAB_HALF_X + m and math.abs(lz) <= Layout.LAB_HALF_Z + m
end

-- De Goo-rivier: een golvende baan van de Slime Portal (west) naar de Recycler (oost).
Layout.RIVER_START = -282
Layout.RIVER_END = 282
Layout.RIVER_HALF_WIDTH = 12
Layout.RIVER_Y = 0.45

local function riverZ(x: number): number
	return 10 * math.sin(x / 55)
end

local POINTS: { Point } = {}
local LENGTHS: { number } = {}
do
	local total = 0
	local prev: Point? = nil
	local x = Layout.RIVER_START
	while x <= Layout.RIVER_END + 0.001 do
		local p = { x = x, z = riverZ(x) }
		if prev then
			total += math.sqrt((p.x - prev.x) ^ 2 + (p.z - prev.z) ^ 2)
		end
		table.insert(POINTS, p)
		table.insert(LENGTHS, total)
		prev = p
		x += 4
	end
end
Layout.RIVER_POINTS = POINTS
Layout.RIVER_LENGTH = LENGTHS[#LENGTHS]

-- Positie en looprichting (radialen om Y) op `dist` studs vanaf de portal.
function Layout.riverAt(dist: number): (number, number, number)
	dist = math.clamp(dist, 0, Layout.RIVER_LENGTH)
	local lo, hi = 1, #LENGTHS
	while hi - lo > 1 do
		local mid = (lo + hi) // 2
		if LENGTHS[mid] <= dist then
			lo = mid
		else
			hi = mid
		end
	end
	local a, b = POINTS[lo], POINTS[hi]
	local span = LENGTHS[hi] - LENGTHS[lo]
	local t = if span > 0 then (dist - LENGTHS[lo]) / span else 0
	local x = a.x + (b.x - a.x) * t
	local z = a.z + (b.z - a.z) * t
	return x, z, math.atan2(b.z - a.z, b.x - a.x)
end

Layout.RIVER_Z = riverZ

-- Plein-onderdelen aan de uiteinden van de rivier.
Layout.SHOP = { x = -300, z = -48 }
Layout.CODES = { x = -300, z = 48 }
Layout.REBIRTH = { x = 300, z = -48 }
Layout.DEX = { x = 300, z = 48 }
Layout.BOARD_GOO = { x = -262, z = -150 }
Layout.BOARD_STEALS = { x = 262, z = -150 }
Layout.BRIDGES = { -120, 0, 120 }

return Layout
