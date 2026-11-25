--!strict
--[[
	Config.Monetization — game passes and developer products. The owner creates them on the Creator Dashboard
	and pastes the asset ids into the `id` fields below; an id of 0 means "not configured yet": the shop still
	shows the card, the button says "Not available yet" and nothing can be bought.

	Shape: Monetization.Passes.list / .byId[passKey] and Monetization.Products.list / .byId[productKey]
	(both keyed by `def.key`; `def.id` is the Roblox asset id), plus the flags below.

	`price` is only the suggested Robux price and the fallback the shop shows when the real price cannot be
	fetched. What a pass actually does is implemented with the constants in Config.Game (vipCoinBonus, ...).

	Paid-random-items policy: when PolicyService reports ArePaidRandomItemsRestricted, every product with
	`grantsCurrency` or `randomItemRelated` and every pass with `randomItemRelated` is hidden and refused.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type GamePassDef = Types.GamePassDef
type ProductDef = Types.ProductDef

local HALF_HOUR = 30 * 60
local HOUR = 60 * 60

---------------------------------------------------------------------------------------------------
-- Game passes (permanent)

local passList: { GamePassDef } = {
	{
		key = "vip",
		id = 0,
		order = 1,
		name = "VIP",
		description = "+20% coins and XP, a VIP chat tag and crown, the exclusive Crown Unicorn pet and double gems from daily rewards.",
		icon = "👑",
		price = 399,
		randomItemRelated = false,
	},
	{
		key = "doubleCoins",
		id = 0,
		order = 2,
		name = "2x Coins",
		description = "Earn double coins from every crystal, forever.",
		icon = "💰",
		price = 299,
		randomItemRelated = false,
	},
	{
		key = "doubleXP",
		id = 0,
		order = 3,
		name = "2x XP",
		description = "Earn double XP from every crystal, forever.",
		icon = "⭐",
		price = 199,
		randomItemRelated = false,
	},
	{
		key = "doubleDamage",
		id = 0,
		order = 4,
		name = "2x Damage",
		description = "Every hammer hits twice as hard, forever.",
		icon = "💥",
		price = 349,
		randomItemRelated = false,
	},
	{
		key = "autoSmash",
		id = 0,
		order = 5,
		name = "Auto Smash",
		description = "Automatically targets and smashes the nearest crystal.",
		icon = "🤖",
		price = 249,
		randomItemRelated = false,
	},
	{
		key = "luckyEggs",
		id = 0,
		order = 6,
		name = "Lucky Eggs",
		description = "2x luck on every egg you hatch. Each egg always shows your exact odds.",
		icon = "🍀",
		price = 299,
		randomItemRelated = true,
	},
	{
		key = "tripleHatch",
		id = 0,
		order = 7,
		name = "Triple Hatch",
		description = "Hatch 3 eggs at once (each egg still costs its normal coin price).",
		icon = "🥚",
		price = 199,
		randomItemRelated = true,
	},
	{
		key = "extraPets",
		id = 0,
		order = 8,
		name = "+2 Pet Slots",
		description = "Equip 2 more pets at the same time.",
		icon = "🐾",
		price = 349,
		randomItemRelated = false,
	},
	{
		key = "petStorage",
		id = 0,
		order = 9,
		name = "+100 Pet Storage",
		description = "Keep 100 more pets in your inventory.",
		icon = "🎒",
		price = 149,
		randomItemRelated = false,
	},
	{
		key = "speed",
		id = 0,
		order = 10,
		name = "Speedy Boots",
		description = "+6 walk speed, forever.",
		icon = "👟",
		price = 99,
		randomItemRelated = false,
	},
}

---------------------------------------------------------------------------------------------------
-- Developer products (can be bought again, except `oneTime` ones)

local COIN_PACK_TEXT = "Coins right away. The amount grows with your best zone and rebirths."
local BOOST_TEXT = " Time stacks and only counts down while you play."

local productList: { ProductDef } = {
	-- Coins (scaled: coinsScaled * Formulas.coinScale(data); the shop shows the exact amount)
	{
		key = "coinsSmall",
		id = 0,
		order = 1,
		name = "Pouch of Coins",
		description = COIN_PACK_TEXT,
		icon = "🪙",
		price = 49,
		category = "coins",
		reward = { coinsScaled = 400 },
		oneTime = false,
		grantsCurrency = true,
		randomItemRelated = false,
	},
	{
		key = "coinsMedium",
		id = 0,
		order = 2,
		name = "Sack of Coins",
		description = COIN_PACK_TEXT,
		icon = "💰",
		price = 149,
		category = "coins",
		reward = { coinsScaled = 1600 },
		oneTime = false,
		grantsCurrency = true,
		randomItemRelated = false,
	},
	{
		key = "coinsLarge",
		id = 0,
		order = 3,
		name = "Chest of Coins",
		description = COIN_PACK_TEXT,
		icon = "🧰",
		price = 399,
		category = "coins",
		reward = { coinsScaled = 6000 },
		oneTime = false,
		grantsCurrency = true,
		randomItemRelated = false,
	},
	{
		key = "coinsMega",
		id = 0,
		order = 4,
		name = "Vault of Coins",
		description = COIN_PACK_TEXT,
		icon = "🏦",
		price = 999,
		category = "coins",
		reward = { coinsScaled = 20000 },
		oneTime = false,
		grantsCurrency = true,
		randomItemRelated = false,
		bestValue = true,
	},
	-- Gems
	{
		key = "gemsSmall",
		id = 0,
		order = 5,
		name = "Handful of Gems",
		description = "100 gems for permanent upgrades.",
		icon = "💎",
		price = 79,
		category = "gems",
		reward = { gems = 100 },
		oneTime = false,
		grantsCurrency = true,
		randomItemRelated = false,
	},
	{
		key = "gemsMedium",
		id = 0,
		order = 6,
		name = "Bag of Gems",
		description = "550 gems for permanent upgrades.",
		icon = "💎",
		price = 349,
		category = "gems",
		reward = { gems = 550 },
		oneTime = false,
		grantsCurrency = true,
		randomItemRelated = false,
	},
	{
		key = "gemsLarge",
		id = 0,
		order = 7,
		name = "Crate of Gems",
		description = "1,500 gems for permanent upgrades.",
		icon = "💎",
		price = 799,
		category = "gems",
		reward = { gems = 1500 },
		oneTime = false,
		grantsCurrency = true,
		randomItemRelated = false,
	},
	{
		key = "gemsMega",
		id = 0,
		order = 8,
		name = "Mountain of Gems",
		description = "5,000 gems for permanent upgrades.",
		icon = "💎",
		price = 1999,
		category = "gems",
		reward = { gems = 5000 },
		oneTime = false,
		grantsCurrency = true,
		randomItemRelated = false,
		bestValue = true,
	},
	-- Boosts
	{
		key = "boostCoins",
		id = 0,
		order = 9,
		name = "Coin Boost",
		description = "2x coins for 30 minutes." .. BOOST_TEXT,
		icon = "💰",
		price = 49,
		category = "boosts",
		reward = { boost = { id = "coins", seconds = HALF_HOUR } },
		oneTime = false,
		grantsCurrency = false,
		randomItemRelated = false,
	},
	{
		key = "boostXP",
		id = 0,
		order = 10,
		name = "XP Boost",
		description = "2x XP for 30 minutes." .. BOOST_TEXT,
		icon = "⭐",
		price = 39,
		category = "boosts",
		reward = { boost = { id = "xp", seconds = HALF_HOUR } },
		oneTime = false,
		grantsCurrency = false,
		randomItemRelated = false,
	},
	{
		key = "boostDamage",
		id = 0,
		order = 11,
		name = "Damage Boost",
		description = "2x damage for 30 minutes." .. BOOST_TEXT,
		icon = "💥",
		price = 49,
		category = "boosts",
		reward = { boost = { id = "damage", seconds = HALF_HOUR } },
		oneTime = false,
		grantsCurrency = false,
		randomItemRelated = false,
	},
	{
		key = "boostLuck",
		id = 0,
		order = 12,
		name = "Luck Boost",
		description = "2x egg luck for 30 minutes. Each egg always shows your exact odds." .. BOOST_TEXT,
		icon = "🍀",
		price = 59,
		category = "boosts",
		reward = { boost = { id = "luck", seconds = HALF_HOUR } },
		oneTime = false,
		grantsCurrency = false,
		randomItemRelated = true,
	},
	{
		key = "boostAll",
		id = 0,
		order = 13,
		name = "Mega Boost",
		description = "2x coins, XP, damage and egg luck for 60 minutes." .. BOOST_TEXT,
		icon = "🚀",
		price = 149,
		category = "boosts",
		reward = {
			boosts = {
				{ id = "coins", seconds = HOUR },
				{ id = "xp", seconds = HOUR },
				{ id = "damage", seconds = HOUR },
				{ id = "luck", seconds = HOUR },
			},
		},
		oneTime = false,
		grantsCurrency = false,
		randomItemRelated = true,
	},
	-- Special (one purchase per player)
	{
		key = "starterPack",
		id = 0,
		order = 14,
		name = "Starter Pack",
		description = "The exclusive Sparkle Fox pet, 250 gems, a pile of coins and 2x coins for 30 minutes. One per player.",
		icon = "🎁",
		price = 99,
		category = "special",
		reward = {
			pet = { petId = "starter_fox", tier = 1 },
			gems = 250,
			coinsScaled = 500,
			boost = { id = "coins", seconds = HALF_HOUR },
		},
		oneTime = true,
		grantsCurrency = true,
		randomItemRelated = false,
	},
	{
		key = "royalDragon",
		id = 0,
		order = 15,
		name = "Royal Dragon",
		description = "Get the exclusive Royal Dragon pet - guaranteed, no luck involved. One per player.",
		icon = "🐉",
		price = 499,
		category = "special",
		reward = { pet = { petId = "royal_dragon", tier = 1 } },
		oneTime = true,
		grantsCurrency = false,
		randomItemRelated = false,
	},
}

---------------------------------------------------------------------------------------------------

local passById: { [string]: GamePassDef } = {}
for _, def in passList do
	passById[def.key] = def
end

local productById: { [string]: ProductDef } = {}
for _, def in productList do
	productById[def.key] = def
end

return {
	-- When true AND RunService:IsStudio(), shop purchases are granted instantly without Robux (owner testing).
	studioTestMode = false,
	-- If a receipt arrives for a `oneTime` product the player already owns, they get price * this in gems instead.
	oneTimeFallbackGemsPerRobux = 1.5,
	-- purchases.oneTime key that remembers the one-time vip_unicorn grant for VIP owners.
	vipPetKey = "vipPet",
	vipPetId = "vip_unicorn",

	Passes = { list = passList, byId = passById },
	Products = { list = productList, byId = productById },
}
