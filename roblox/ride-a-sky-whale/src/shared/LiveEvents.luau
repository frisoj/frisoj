--!strict
-- Automatische live-events. Net als de luchten volgt dit de wereldklok, dus
-- elke server start het event tegelijk zonder dat jij online hoeft te zijn.
--
-- Captain's Call: elke zaterdag om 17:00 UTC (19:00 Nederlandse zomertijd,
-- 18:00 wintertijd), 20 minuten lang 2x Pearls en 2x Driftlings.

local LiveEvents = {}

local WEEK = 7 * 24 * 60 * 60
-- 1 januari 1970 was een donderdag. Zaterdag 17:00 UTC = 2 dagen en 17 uur later.
local OFFSET = (2 * 24 + 17) * 60 * 60

LiveEvents.CAPTAINS_CALL = {
	name = "CAPTAIN'S CALL",
	duration = 20 * 60,
	pearlMult = 2,
	spawnMult = 2,
}

-- Starttijd van het event van deze week (kan in de toekomst of het verleden liggen).
local function weekStart(now: number): number
	return ((now - OFFSET) // WEEK) * WEEK + OFFSET
end

-- Geeft (actief, seconden tot het einde als actief / tot de start als niet actief).
function LiveEvents.captainsCall(now: number): (boolean, number)
	local start = weekStart(now)
	local ends = start + LiveEvents.CAPTAINS_CALL.duration
	if now >= start and now < ends then
		return true, ends - now
	end
	local nextStart = if now < start then start else start + WEEK
	return false, nextStart - now
end

function LiveEvents.pearlMultiplier(now: number): number
	local active = LiveEvents.captainsCall(now)
	return if active then LiveEvents.CAPTAINS_CALL.pearlMult else 1
end

function LiveEvents.spawnMultiplier(now: number): number
	local active = LiveEvents.captainsCall(now)
	return if active then LiveEvents.CAPTAINS_CALL.spawnMult else 1
end

-- "2d 03:12:44" of "12:44"
function LiveEvents.formatCountdown(seconds: number): string
	seconds = math.max(0, math.floor(seconds))
	local d = seconds // 86400
	local h = (seconds % 86400) // 3600
	local m = (seconds % 3600) // 60
	local s = seconds % 60
	if d > 0 then
		return string.format("%dd %02d:%02d:%02d", d, h, m, s)
	elseif h > 0 then
		return string.format("%02d:%02d:%02d", h, m, s)
	end
	return string.format("%02d:%02d", m, s)
end

return LiveEvents
