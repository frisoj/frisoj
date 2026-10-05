--!strict
-- Alle instellingen van Ride a Sky Whale op één plek.
--
-- Na het publiceren: maak in de Creator Hub je Developer Products en Game Passes
-- aan en vul hieronder hun ID's in. Een ID van 0 betekent "staat uit": de knop
-- in de winkel laat dan zien dat het product nog niet is ingesteld.

local Config = {}

-- Creator Hub > jouw game > Monetization > Developer Products
Config.PRODUCTS = {
	GoldenFeast = 0, -- advies: 99 R$
	MegaFeast = 0, -- advies: 449 R$
	PearlPack = 0, -- advies: 49 R$
} :: { [string]: number }

-- Creator Hub > jouw game > Monetization > Passes
Config.PASSES = {
	DoublePearls = 0, -- advies: 399 R$
	VIPCaptain = 0, -- advies: 249 R$
	Weatherman = 0, -- advies: 99 R$
} :: { [string]: number }

-- Codes die spelers in het CODES-scherm kunnen invullen (altijd in hoofdletters).
Config.CODES = {
	WHALEHELLO = { pearls = 500 },
	SKYHIGH = { pearls = 1500 },
} :: { [string]: { pearls: number } }

-- Verander deze naam alleen als je alle opgeslagen voortgang wilt wissen.
Config.DATASTORE_NAME = "SkyWhale_v1"
Config.AUTOSAVE_SECONDS = 90

-- Economie
Config.OFFLINE_CAP_SECONDS = 8 * 60 * 60 -- nest verdient maximaal 8 uur door als je weg bent
Config.OFFLINE_RATE = 0.5 -- offline aan 50% van de normale snelheid
Config.SELL_MINUTES = 2 -- nest vol: zwakste Driftling wordt verkocht voor 2 minuten aan Parels
Config.MIGRATION_BONUS = 0.25 -- +25% Parels per Migratie
Config.MIGRATION_BASE_COST = 250000 -- kosten Migratie = dit x (aantal Migraties + 1)
Config.FRIEND_BONUS = 0.10 -- +10% Parels per vriend in je server
Config.FRIEND_BONUS_MAX = 0.40
Config.PEARL_PACK_MINUTES = 30 -- Parelzak = 30 minuten van je huidige inkomen
Config.PEARL_PACK_MIN = 1000

-- Feestmalen (server-boosts)
Config.FEASTS = {
	GoldenFeast = { minutes = 10, mult = 2, label = "Golden Feast" },
	MegaFeast = { minutes = 30, mult = 3, label = "MEGA Feast" },
} :: { [string]: { minutes: number, mult: number, label: string } }
Config.FEAST_SPAWN_MULT = 1.5

-- Voerbak en walvislied
Config.FEED_GOAL = 25 -- aantal voerbeurten tot de walvis zingt
Config.FEED_COOLDOWN = 20 -- seconden tussen voerbeurten per speler
Config.FEED_COST_FRACTION = 0.05 -- voeren kost 5% van je Parels
Config.FEED_MIN_COST = 25
Config.SONG_SECONDS = 5 * 60
Config.SONG_SPAWN_MULT = 2

-- Driftlings in de lucht
Config.SKY_BASE = 16
Config.SKY_PER_PLAYER = 4
Config.SKY_MAX = 48
Config.COLUMN_COUNT = 3 -- altijd zoveel Driftlings recht boven het spuitgat
Config.ISLAND_COUNT = 5
Config.CATCH_TOLERANCE = 10 -- extra studs speling voor lag

-- Beweging
Config.LAUNCH_VELOCITY = 210 -- spuitgat: ongeveer 180 studs omhoog bij Gravity 120
Config.GLIDE_FALL_SPEED = 12
Config.FALL_RESCUE_Y = -120 -- wie onder de wolken zakt, gaat terug naar de walvis

return Config
