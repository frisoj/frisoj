--!strict
--[[
	Config.Rarities — pet rarities from most to least common, with the colours of the UI style guide.

	Shape: Rarities.list (ordered by `order`), Rarities.byId[rarity].
	`luckAffected` marks the rarities whose egg weight is multiplied by the player's luck (Rare and better);
	`announce` marks the ones whose hatches are announced to the whole server.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

export type RarityDef = {
	id: Types.Rarity,
	order: number, -- 1 = most common
	name: string,
	color: Color3,
	luckAffected: boolean, -- egg luck shifts weight toward this rarity
	announce: boolean, -- hatching one is announced server-wide
	rainbow: boolean, -- drawn with an animated rainbow gradient (`color` is the fallback)
}

local function rarity(
	id: Types.Rarity,
	color: Color3,
	luckAffected: boolean,
	announce: boolean,
	rainbow: boolean
): RarityDef
	return {
		id = id,
		order = 0, -- filled in below from the position in the list
		name = id,
		color = color,
		luckAffected = luckAffected,
		announce = announce,
		rainbow = rainbow,
	}
end

local list: { RarityDef } = {
	rarity("Common", Color3.fromHex("#B8C1CC"), false, false, false),
	rarity("Uncommon", Color3.fromHex("#5BE37D"), false, false, false),
	rarity("Rare", Color3.fromHex("#4DA8FF"), true, false, false),
	rarity("Epic", Color3.fromHex("#B36BFF"), true, false, false),
	rarity("Legendary", Color3.fromHex("#FFB627"), true, true, false),
	rarity("Mythic", Color3.fromHex("#FF4D6D"), true, true, false),
	rarity("Exclusive", Color3.fromHex("#FF7AD9"), false, false, true), -- never in eggs
}

local byId: { [string]: RarityDef } = {}
for order, def in list do
	def.order = order
	byId[def.id] = def
end

return {
	list = list,
	byId = byId,
}
