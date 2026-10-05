--!strict
-- De acht luchten: hoe ze eruitzien en welke mutatie ze geven.

export type Biome = {
	id: string,
	name: string,
	blurb: string,
	mutation: string?,
	chance: number, -- kans dat een vangst in deze lucht de mutatie krijgt
	clockTime: number,
	brightness: number,
	ambient: Color3,
	outdoor: Color3,
	atmoColor: Color3,
	atmoDecay: Color3,
	atmoDensity: number,
	haze: number,
	glare: number,
	cloudCover: number,
	cloudDensity: number,
	cloudColor: Color3,
	puffColor: Color3,
	tint: Color3,
	saturation: number,
	contrast: number,
	weather: string?, -- "rain" | "snow" | "ash" | "stars" | "aurora" | "void"
	lightning: boolean,
	uiColor: Color3,
}

export type Mutation = {
	id: string,
	mult: number,
	color: Color3,
	tint: number, -- hoeveel de lichaamskleur naar `color` verschuift (0-1)
	material: Enum.Material?,
	light: Color3?,
	particles: Color3?,
}

local rgb = Color3.fromRGB

local Biomes = {}

Biomes.ORDER = { "CloudSea", "Thunderfront", "Blizzard", "Ashfall", "GoldenHour", "Aurora", "Starfall", "Eclipse" }

Biomes.MUTATIONS = {
	Charged = { id = "Charged", mult = 2, color = rgb(255, 230, 90), tint = 0.35, light = rgb(255, 230, 90), particles = rgb(255, 240, 120) },
	Frozen = { id = "Frozen", mult = 3, color = rgb(185, 230, 255), tint = 0.55, material = Enum.Material.Ice },
	Molten = { id = "Molten", mult = 4, color = rgb(255, 110, 40), tint = 0.6, material = Enum.Material.Neon, light = rgb(255, 120, 50), particles = rgb(255, 150, 60) },
	Gilded = { id = "Gilded", mult = 5, color = rgb(255, 200, 60), tint = 0.75, material = Enum.Material.Foil, light = rgb(255, 210, 120) },
	Prismatic = { id = "Prismatic", mult = 6, color = rgb(150, 255, 230), tint = 0.4, material = Enum.Material.ForceField, light = rgb(140, 255, 220) },
	Stardust = { id = "Stardust", mult = 8, color = rgb(210, 215, 255), tint = 0.3, light = rgb(200, 210, 255), particles = rgb(255, 255, 255) },
	Void = { id = "Void", mult = 25, color = rgb(45, 15, 70), tint = 0.85, material = Enum.Material.Neon, light = rgb(170, 80, 255), particles = rgb(170, 90, 255) },
} :: { [string]: Mutation }

Biomes.LIST = {
	CloudSea = {
		id = "CloudSea", name = "Cloud Sea", blurb = "Calm skies. Perfect for catching.",
		mutation = nil, chance = 0,
		clockTime = 13, brightness = 2.2, ambient = rgb(95, 105, 125), outdoor = rgb(140, 150, 170),
		atmoColor = rgb(199, 220, 240), atmoDecay = rgb(106, 140, 170), atmoDensity = 0.28, haze = 1, glare = 0.2,
		cloudCover = 0.55, cloudDensity = 0.35, cloudColor = rgb(255, 255, 255), puffColor = rgb(255, 255, 255),
		tint = rgb(255, 255, 255), saturation = 0.05, contrast = 0.05,
		weather = nil, lightning = false, uiColor = rgb(120, 180, 230),
	},
	Thunderfront = {
		id = "Thunderfront", name = "Thunderfront", blurb = "Lightning charges every Driftling.",
		mutation = "Charged", chance = 0.25,
		clockTime = 14, brightness = 1, ambient = rgb(60, 65, 85), outdoor = rgb(80, 85, 105),
		atmoColor = rgb(110, 120, 140), atmoDecay = rgb(60, 65, 80), atmoDensity = 0.42, haze = 2.5, glare = 0,
		cloudCover = 0.85, cloudDensity = 0.7, cloudColor = rgb(120, 125, 140), puffColor = rgb(150, 155, 170),
		tint = rgb(205, 215, 240), saturation = -0.25, contrast = 0.15,
		weather = "rain", lightning = true, uiColor = rgb(255, 225, 90),
	},
	GoldenHour = {
		id = "GoldenHour", name = "Golden Hour", blurb = "Everything the sun touches turns gold.",
		mutation = "Gilded", chance = 0.25,
		clockTime = 17.7, brightness = 2.4, ambient = rgb(130, 95, 70), outdoor = rgb(170, 120, 90),
		atmoColor = rgb(255, 190, 130), atmoDecay = rgb(200, 110, 70), atmoDensity = 0.32, haze = 1.6, glare = 0.6,
		cloudCover = 0.5, cloudDensity = 0.4, cloudColor = rgb(255, 210, 170), puffColor = rgb(255, 214, 180),
		tint = rgb(255, 236, 210), saturation = 0.15, contrast = 0.08,
		weather = nil, lightning = false, uiColor = rgb(255, 190, 90),
	},
	Blizzard = {
		id = "Blizzard", name = "Blizzard", blurb = "Snowstorm! Driftlings freeze solid.",
		mutation = "Frozen", chance = 0.25,
		clockTime = 12, brightness = 1.6, ambient = rgb(150, 160, 180), outdoor = rgb(190, 200, 215),
		atmoColor = rgb(225, 235, 245), atmoDecay = rgb(180, 195, 215), atmoDensity = 0.55, haze = 3, glare = 0,
		cloudCover = 0.9, cloudDensity = 0.8, cloudColor = rgb(235, 240, 250), puffColor = rgb(240, 246, 255),
		tint = rgb(225, 235, 255), saturation = -0.3, contrast = 0,
		weather = "snow", lightning = false, uiColor = rgb(190, 230, 255),
	},
	Ashfall = {
		id = "Ashfall", name = "Ashfall", blurb = "A volcano island erupts in the distance.",
		mutation = "Molten", chance = 0.25,
		clockTime = 15.5, brightness = 1.4, ambient = rgb(110, 80, 70), outdoor = rgb(140, 95, 80),
		atmoColor = rgb(190, 120, 90), atmoDecay = rgb(120, 60, 45), atmoDensity = 0.45, haze = 2.4, glare = 0.3,
		cloudCover = 0.7, cloudDensity = 0.6, cloudColor = rgb(150, 110, 95), puffColor = rgb(175, 140, 125),
		tint = rgb(255, 215, 190), saturation = -0.1, contrast = 0.12,
		weather = "ash", lightning = false, uiColor = rgb(255, 130, 70),
	},
	Aurora = {
		id = "Aurora", name = "Aurora", blurb = "Northern lights. The whale glows along.",
		mutation = "Prismatic", chance = 0.25,
		clockTime = 0.5, brightness = 1.2, ambient = rgb(40, 70, 80), outdoor = rgb(60, 110, 110),
		atmoColor = rgb(60, 140, 130), atmoDecay = rgb(40, 90, 120), atmoDensity = 0.3, haze = 1.2, glare = 0,
		cloudCover = 0.4, cloudDensity = 0.3, cloudColor = rgb(90, 200, 170), puffColor = rgb(110, 170, 175),
		tint = rgb(190, 255, 235), saturation = 0.25, contrast = 0.1,
		weather = "aurora", lightning = false, uiColor = rgb(110, 255, 200),
	},
	Starfall = {
		id = "Starfall", name = "Starfall", blurb = "Shooting stars rain down. Make a wish.",
		mutation = "Stardust", chance = 0.25,
		clockTime = 23, brightness = 1, ambient = rgb(50, 55, 90), outdoor = rgb(70, 75, 120),
		atmoColor = rgb(60, 70, 130), atmoDecay = rgb(40, 40, 90), atmoDensity = 0.25, haze = 0.8, glare = 0,
		cloudCover = 0.3, cloudDensity = 0.25, cloudColor = rgb(90, 95, 150), puffColor = rgb(110, 115, 165),
		tint = rgb(210, 215, 255), saturation = 0.1, contrast = 0.1,
		weather = "stars", lightning = false, uiColor = rgb(170, 180, 255),
	},
	Eclipse = {
		id = "Eclipse", name = "ECLIPSE", blurb = "The sun is gone. Void Driftlings appear.",
		mutation = "Void", chance = 0.15,
		clockTime = 0, brightness = 0.3, ambient = rgb(35, 20, 50), outdoor = rgb(45, 25, 60),
		atmoColor = rgb(40, 20, 60), atmoDecay = rgb(20, 10, 30), atmoDensity = 0.4, haze = 1.5, glare = 0,
		cloudCover = 0.6, cloudDensity = 0.5, cloudColor = rgb(40, 30, 60), puffColor = rgb(60, 45, 80),
		tint = rgb(220, 190, 255), saturation = -0.2, contrast = 0.2,
		weather = "void", lightning = false, uiColor = rgb(190, 110, 255),
	},
} :: { [string]: Biome }

function Biomes.get(id: string): Biome
	return Biomes.LIST[id] or Biomes.LIST.CloudSea
end

function Biomes.mutationMult(mutation: string?): number
	if mutation == nil then
		return 1
	end
	local m = Biomes.MUTATIONS[mutation]
	return if m then m.mult else 1
end

return Biomes
