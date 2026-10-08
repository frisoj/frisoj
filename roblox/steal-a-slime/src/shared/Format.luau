--!strict
-- Getallen, tijden en kansen leesbaar maken.

local Format = {}

local SUFFIXES = { "", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc" }

-- 1234 -> "1.23K", 15000000 -> "15M"
function Format.number(n: number): string
	if n ~= n then
		return "0"
	end
	local sign = if n < 0 then "-" else ""
	n = math.abs(n)
	if n < 1000 then
		return sign .. tostring(math.floor(n))
	end
	local i = 1
	while n >= 1000 and i < #SUFFIXES do
		n /= 1000
		i += 1
	end
	local text
	if n >= 100 then
		text = string.format("%d", math.floor(n))
	elseif n >= 10 then
		text = string.format("%.1f", math.floor(n * 10) / 10)
	else
		text = string.format("%.2f", math.floor(n * 100) / 100)
	end
	if text:find("%.") then
		text = text:gsub("0+$", ""):gsub("%.$", "")
	end
	return sign .. text .. SUFFIXES[i]
end

-- 75 -> "1:15", 3725 -> "1:02:05"
function Format.time(seconds: number): string
	seconds = math.max(0, math.floor(seconds))
	local h = seconds // 3600
	local m = (seconds % 3600) // 60
	local s = seconds % 60
	if h > 0 then
		return string.format("%d:%02d:%02d", h, m, s)
	end
	return string.format("%d:%02d", m, s)
end

-- Kans als percentage met genoeg decimalen (Roblox: minstens 4 bij lange getallen).
function Format.chance(p: number): string
	local pct = p * 100
	if pct >= 10 then
		return string.format("%.2f%%", pct)
	elseif pct >= 0.01 then
		return string.format("%.4f%%", pct)
	end
	return string.format("%.6f%%", pct)
end

return Format
