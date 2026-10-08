--!strict
-- Vaste events die vanzelf lopen, berekend uit de UTC-tijd (server en client rekenen hetzelfde).
--
-- Slime Storm Saturday: elke zaterdag 18:00-18:30 UTC (20:00 Nederlandse zomertijd),
-- dubbel Goo en dubbel geluk op de rivier.

local Events = {}

local WEEK = 7 * 24 * 60 * 60
-- 1 januari 1970 was een donderdag: zaterdag 18:00 UTC ligt 2 dagen en 18 uur na het begin van de week.
local OFFSET = (2 * 24 + 18) * 60 * 60
Events.SATURDAY_SECONDS = 30 * 60

-- Geeft (bezig?, seconden tot begin of einde).
function Events.saturday(now: number): (boolean, number)
	local into = (now - OFFSET) % WEEK
	if into < Events.SATURDAY_SECONDS then
		return true, Events.SATURDAY_SECONDS - into
	end
	return false, WEEK - into
end

function Events.gooMultiplier(now: number): number
	return if (Events.saturday(now)) then 2 else 1
end

function Events.luckMultiplier(now: number): number
	return if (Events.saturday(now)) then 2 else 1
end

-- Dagnummer in UTC, voor de dagelijkse beloning en de speeltijd-cadeaus.
function Events.day(now: number): number
	return math.floor(now / 86400)
end

return Events
