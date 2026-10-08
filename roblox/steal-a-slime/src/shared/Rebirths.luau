--!strict
-- De tien rebirths: wat je nodig hebt en wat je krijgt. Gedeeld zodat het scherm
-- precies hetzelfde laat zien als wat de server controleert.

local Slimes = require(script.Parent:WaitForChild("Slimes"))

export type Requirement = { goo: number, rarity: string, fuse: number }
type Slime = Slimes.Slime

local Rebirths = {}

Rebirths.LIST = {
	{ goo = 250e3, rarity = "Epic", fuse = 0 },
	{ goo = 1.5e6, rarity = "Legendary", fuse = 0 },
	{ goo = 8e6, rarity = "Legendary", fuse = 0 },
	{ goo = 40e6, rarity = "Mythic", fuse = 0 },
	{ goo = 200e6, rarity = "Mythic", fuse = 0 },
	{ goo = 1e9, rarity = "Mythic", fuse = 1 },
	{ goo = 5e9, rarity = "Godly", fuse = 0 },
	{ goo = 25e9, rarity = "Godly", fuse = 0 },
	{ goo = 120e9, rarity = "Secret", fuse = 0 },
	{ goo = 600e9, rarity = "Secret", fuse = 0 },
} :: { Requirement }

Rebirths.MAX = #Rebirths.LIST

-- De eis voor de volgende rebirth, of nil als je alles gehad hebt.
function Rebirths.next(rebirths: number): Requirement?
	return Rebirths.LIST[rebirths + 1]
end

-- Voldoet dit slijmpje aan de eis (minstens die zeldzaamheid en dat fusieniveau)?
function Rebirths.meets(slime: Slime, req: Requirement): boolean
	local species = Slimes.BY_ID[slime.s]
	if not species then
		return false
	end
	return Slimes.rarityOrder(species.rarity) >= Slimes.rarityOrder(req.rarity) and slime.f >= req.fuse
end

function Rebirths.describe(req: Requirement): string
	local fuse = Slimes.FUSE_NAMES[req.fuse] or ""
	local article = if req.rarity == "Epic" then "an" else "a"
	if fuse ~= "" then
		return string.format("%s %s %s", article, req.rarity, fuse)
	end
	return string.format("%s %s slime", article, req.rarity)
end

return Rebirths
