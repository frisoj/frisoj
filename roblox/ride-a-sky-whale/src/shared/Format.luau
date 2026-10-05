--!strict
-- Getallen en tijden netjes weergeven.

local Format = {}

local SUFFIXES = { "K", "M", "B", "T", "Qa", "Qi" }

local function commas(n: number): string
	local s = tostring(math.floor(n))
	local out = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	if out:sub(1, 1) == "," then
		out = out:sub(2)
	end
	return out
end

-- 950 -> "950", 12 345 -> "12,345", 1 250 000 -> "1.25M"
function Format.number(n: number): string
	n = math.floor(n)
	if n < 100000 then
		return commas(n)
	end
	local i = 0
	local v = n
	while v >= 1000 and i < #SUFFIXES do
		v /= 1000
		i += 1
	end
	local text = if v >= 100 then string.format("%d", math.floor(v)) else string.format("%.2f", v):gsub("%.?0+$", "")
	return text .. SUFFIXES[i]
end

-- 125 -> "02:05"
function Format.clock(seconds: number): string
	seconds = math.max(0, math.floor(seconds))
	return string.format("%02d:%02d", seconds // 60, seconds % 60)
end

return Format
