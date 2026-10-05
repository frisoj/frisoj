--!strict
-- Elke server en elke client berekent zelf welke lucht er nu is, puur uit de
-- UTC-klok (workspace:GetServerTimeNow()). Zo zit iedereen wereldwijd tegelijk
-- in dezelfde eclips, zonder dat servers met elkaar hoeven te praten.

local SkyForecast = {}

SkyForecast.SLOT_SECONDS = 10 * 60 -- elke lucht duurt 10 minuten
SkyForecast.ECLIPSE_EVERY = 18 -- elk 18e slot = elke 3 uur, op het hele uur (UTC)
SkyForecast.ROTATION = {
	"CloudSea",
	"Thunderfront",
	"GoldenHour",
	"CloudSea",
	"Blizzard",
	"Aurora",
	"CloudSea",
	"Ashfall",
	"Thunderfront",
	"Starfall",
}

export type Slot = { id: string, startsAt: number }

function SkyForecast.biomeForSlot(slot: number): string
	if slot % SkyForecast.ECLIPSE_EVERY == 0 then
		return "Eclipse"
	end
	return SkyForecast.ROTATION[slot % #SkyForecast.ROTATION + 1]
end

function SkyForecast.slotAt(now: number): number
	return now // SkyForecast.SLOT_SECONDS
end

-- Huidige lucht + seconden tot de volgende wissel.
function SkyForecast.current(now: number): (string, number)
	local slot = SkyForecast.slotAt(now)
	return SkyForecast.biomeForSlot(slot), (slot + 1) * SkyForecast.SLOT_SECONDS - now
end

-- De komende `count` luchten met hun starttijd, voor het Forecast-bord.
function SkyForecast.upcoming(now: number, count: number): { Slot }
	local slot = SkyForecast.slotAt(now)
	local list = {}
	for i = 1, count do
		list[i] = {
			id = SkyForecast.biomeForSlot(slot + i),
			startsAt = (slot + i) * SkyForecast.SLOT_SECONDS,
		}
	end
	return list
end

-- Starttijd van de eerstvolgende eclips (of de huidige, als die nu bezig is).
function SkyForecast.nextEclipse(now: number): number
	local slot = SkyForecast.slotAt(now)
	while slot % SkyForecast.ECLIPSE_EVERY ~= 0 do
		slot += 1
	end
	return slot * SkyForecast.SLOT_SECONDS
end

return SkyForecast
