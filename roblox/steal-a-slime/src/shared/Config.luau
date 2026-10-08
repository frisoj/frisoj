--!strict
-- Alle instellingen van Steal a Slime op één plek.
--
-- PRODUCTS en PASSES worden automatisch ingevuld door tools/deploy.py.
-- Een ID van 0 betekent "nog niet ingesteld": de winkel toont het dan als niet beschikbaar.

local Config = {}

-- Creator Hub > jouw game > Monetization > Developer Products
Config.PRODUCTS = {
	GooPackS = 0,
	GooPackM = 0,
	GooPackL = 0,
	GooPackXL = 0,
	LuckyEgg = 0,
	MegaEgg = 0,
	ServerLuck2 = 0,
	ServerLuck5 = 0,
	GoldRush = 0,
	RainbowSurge = 0,
	LabShield = 0,
	SkipFusion = 0,
} :: { [string]: number }

-- Creator Hub > jouw game > Monetization > Passes
Config.PASSES = {
	VIP = 0,
	DoubleGoo = 0,
	AutoCollect = 0,
	MegaLab = 0,
	SpeedBoots = 0,
	ThiefGloves = 0,
	LaserLockPlus = 0,
	LuckyCharm = 0,
} :: { [string]: number }

-- Wat de winkel laat zien (Roblox toont bij het kopen altijd de echte prijs).
-- (Met ["..."] geschreven zodat deploy.py alleen de ID's hierboven aanpast.)
Config.PRICES = {
	["VIP"] = 299, ["DoubleGoo"] = 449, ["AutoCollect"] = 199, ["MegaLab"] = 349, ["SpeedBoots"] = 179,
	["ThiefGloves"] = 249, ["LaserLockPlus"] = 199, ["LuckyCharm"] = 399,
	["GooPackS"] = 29, ["GooPackM"] = 99, ["GooPackL"] = 299, ["GooPackXL"] = 799, ["LuckyEgg"] = 79, ["MegaEgg"] = 249,
	["ServerLuck2"] = 99, ["ServerLuck5"] = 349, ["GoldRush"] = 99, ["RainbowSurge"] = 349, ["LabShield"] = 59, ["SkipFusion"] = 19,
} :: { [string]: number }

-- Goo-pakketten: zoveel seconden van je huidige inkomen, met een minimum.
Config.GOO_PACKS = {
	GooPackS = { seconds = 15 * 60, min = 500 },
	GooPackM = { seconds = 60 * 60, min = 5000 },
	GooPackL = { seconds = 4 * 60 * 60, min = 50000 },
	GooPackXL = { seconds = 12 * 60 * 60, min = 500000 },
} :: { [string]: { seconds: number, min: number } }

-- Codes (hoofdletters). `egg` = gratis Lucky Egg.
Config.CODES = {
	SLIME = { goo = 1000 },
	GOOEY = { goo = 5000 },
	HEIST = { egg = "LuckyEgg" },
} :: { [string]: { goo: number?, egg: string? } }

Config.DATASTORE_NAME = "StealASlime_v1"
Config.LEADERBOARD_GOO = "TopGoo_v1"
Config.LEADERBOARD_STEALS = "TopThieves_v1"
Config.AUTOSAVE_SECONDS = 90

-- Lab
Config.BASE_PADS = 8
Config.MAX_PADS = 25
Config.MEGA_LAB_PADS = 6
Config.VIP_PADS = 1
Config.JOIN_LOCK_SECONDS = 30
Config.LOCK_SECONDS = 60
Config.LOCK_PER_REBIRTH = 5
Config.VIP_LOCK_BONUS = 15
Config.SHIELD_SECONDS = 5 * 60
Config.SELL_FRACTION = 0.5 -- verkopen levert de helft van de prijs op

-- Stelen
Config.STEAL_HOLD = 2
Config.STEAL_HOLD_GLOVES = 0.6
Config.CARRY_SPEED = 0.6
Config.CARRY_SPEED_GLOVES = 0.85
Config.CARRY_TIMEOUT = 45
Config.BONK_COOLDOWN = 0.9
Config.BONK_RANGE = 9

-- Beweging
Config.WALK_SPEED = 24
Config.SPEED_BOOTS = 1.35
Config.JUMP_POWER = 50
Config.JUMP_BOOTS = 1.2

-- Rivier
Config.STREAM_INTERVAL = 2.4
Config.STREAM_SPEED = 8 -- studs per seconde
Config.LEGENDARY_EVERY = 4 * 60
Config.MYTHIC_EVERY = 12 * 60
Config.CALM_GOLD_CHANCE = 0.02 -- buiten stormen is zoveel van de rivier Gold
Config.BUY_RANGE = 22

-- Goo-stormen
Config.STORM_EVERY = 6 * 60
Config.STORM_SECONDS = 100
Config.STORM_STREAM_CHANCE = 0.3
Config.STORM_STRIKE_EVERY = 10
Config.STORM_STRIKE_CHANCE = 0.03
Config.SERVER_LUCK_SECONDS = 15 * 60

-- Fuseren
Config.FUSE_SECONDS = { 45, 120 } -- naar Giant, naar Titan

-- Economie
Config.REBIRTH_BONUS = 0.5
Config.DEX_SPECIES_BONUS = 0.01
Config.DEX_MUTATION_BONUS = 0.005
Config.FRIEND_BONUS = 0.1
Config.FRIEND_BONUS_MAX = 0.4
Config.VIP_BONUS = 0.5
Config.OFFLINE_RATE = 0.5
Config.OFFLINE_CAP_SECONDS = 8 * 60 * 60

-- Dagelijkse beloning (minuten van je inkomen, met minimum) en speeltijd-cadeaus
Config.DAILY = {
	{ minutes = 5, min = 100 },
	{ minutes = 8, min = 250 },
	{ minutes = 12, min = 500 },
	{ minutes = 16, min = 1000 },
	{ minutes = 20, min = 2500 },
	{ minutes = 25, min = 5000 },
	{ minutes = 0, min = 0, egg = "LuckyEgg" },
} :: { { minutes: number, min: number, egg: string? } }

Config.GIFTS = {
	{ at = 1, minutes = 2, min = 50 },
	{ at = 3, minutes = 3, min = 100 },
	{ at = 5, minutes = 4, min = 200 },
	{ at = 8, minutes = 5, min = 400 },
	{ at = 12, minutes = 6, min = 800 },
	{ at = 16, minutes = 8, min = 1500 },
	{ at = 20, minutes = 10, min = 3000 },
	{ at = 30, minutes = 15, min = 6000 },
	{ at = 45, minutes = 20, min = 12000 },
	{ at = 60, minutes = 0, min = 0, egg = "LuckyEgg" },
} :: { { at: number, minutes: number, min: number, egg: string? } }

return Config
