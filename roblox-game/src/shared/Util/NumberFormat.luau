--!strict
--[[
	NumberFormat — every number-to-text conversion used by the UI. Pure (runs under Lune tests).
	All functions are total: nil / NaN print as zero, infinity prints "∞", nothing ever errors.

	Exact output formats (UI code relies on these):

	abbreviate(n)    whole-number quantities (coins, gems, damage, health), 3 significant digits, rounded to
	                 nearest, trailing zeros trimmed:
	                     0 → "0"   999 → "999"   1000 → "1K"   1234 → "1.23K"   12345 → "12.3K"
	                     123456 → "123K"   999499 → "999K"   999500 → "1M" (never "1000K")   -1500 → "-1.5K"
	                 Below 1000 the value is rounded to a whole number (0.4 → "0", 12.6 → "13").
	                 Suffixes: K M B T Qa Qi Sx Sp Oc No Dc (1e3 … 1e33), then scientific: 1e36 → "1e36",
	                 1.234e45 → "1.23e45".
	abbreviateFloor(n)  same format, but rounded toward zero so it never shows more than there is:
	                     1995 → "1.99K"   999999 → "999K"   999.9 → "999". Use it for a balance that the player
	                 compares with a price (1995 coins must not read "2K" next to a 2K price tag).
	commas(n)        whole number with thousands separators: 1234567 → "1,234,567", -1234.4 → "-1,234".
	                 From 1e15 on (beyond exact integers) it falls back to abbreviate(n).
	decimal(x, d?)   at most d decimals (default 2), trailing zeros trimmed: 1.5 → "1.5", 2 → "2", 0.333 → "0.33".
	percent(f, d?)   f is a fraction: 0.25 → "25%", 0.4995 → "49.95%", 1 → "100%", -0.03 → "-3%".
	                 Default precision: 2 decimals from 1% up, 3 significant digits below 1% so rare odds stay
	                 readable (0.0005 → "0.05%", 0.000734 → "0.0734%"); a positive chance never prints as "0%"
	                 (worst case "<0.000001%"). With d: exactly "at most d decimals" (percent(0.12345, 1) → "12.3%").
	multiplier(x)    "x" + decimal(x, 2): 1.5 → "x1.5", 2 → "x2", 1.234 → "x1.23"; from 1000 on "x1.2K".
	duration(s)      compact length of time, whole seconds, fractions dropped (pass math.ceil(s) for countdowns):
	                     12 → "12s"   249 → "4m 09s"   3900 → "1h 05m"   93600 → "1d 02h"
	clock(s)         timer face: 5 → "0:05"   754 → "12:34"   3723 → "1:02:03"
]]

local NumberFormat = {}

local INFINITY = "∞"

-- SUFFIXES[i] belongs to 1000^i.
local SUFFIXES = { "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc" }
-- First decimal exponent that has no suffix (1e36): scientific notation from here on.
local SCIENTIFIC_EXPONENT = (#SUFFIXES + 1) * 3
-- Largest decimal exponent of a finite double.
local MAX_EXPONENT = 308
-- commas() prints exact integers only below this; durations beyond it print as "∞".
local EXACT_LIMIT = 1e15
-- From 2^53 on doubles no longer hold every integer, so values are approximations of what was meant.
local APPROXIMATE_FROM = 2 ^ 53
-- percent() never prints more decimals than this.
local MAX_PERCENT_DECIMALS = 6

-- POW10[e] = 10^e, parsed from text so every entry is the correctly rounded double (10 ^ e can be off by an ulp).
local POW10: { [number]: number } = {}
for exponent = 0, MAX_EXPONENT do
	POW10[exponent] = tonumber("1e" .. exponent) :: number
end

local function isNumber(value: any): boolean
	return type(value) == "number" and value == value
end

-- floor(log10(value)) for a finite value >= 1, corrected with exact comparisons because log10 may round.
local function decimalExponent(value: number): number
	local exponent = math.clamp(math.floor(math.log10(value)), 0, MAX_EXPONENT)
	while exponent < MAX_EXPONENT and value >= POW10[exponent + 1] do
		exponent += 1
	end
	while exponent > 0 and value < POW10[exponent] do
		exponent -= 1
	end
	return exponent
end

-- Reduces a finite value >= 100 to three significant digits (rounded to nearest, or toward zero when roundDown).
-- Returns the digits as an integer 100..999 and the decimal exponent of the first digit. A carry (999.5 → 1000)
-- moves to the next exponent instead of overflowing.
local function threeDigits(value: number, roundDown: boolean): (number, number)
	local exponent = decimalExponent(value)
	local scaled = value / POW10[exponent - 2]
	local digits
	if not roundDown then
		digits = math.floor(scaled + 0.5)
	elseif value < APPROXIMATE_FROM then
		digits = math.floor(scaled) -- exact: integer divided by an exact power of ten
	else
		-- The division is off by an ulp or two here; without the nudge 1.23e30 would print as "1.22No".
		digits = math.floor(scaled + 1e-9)
	end
	if digits >= 1000 then
		digits = 100
		exponent += 1
	end
	return digits, exponent
end

-- Places the decimal point after `wholeDigits` digits of a 3-digit integer and trims trailing zeros.
local function pointAfter(digits: number, wholeDigits: number): string
	local text = string.format("%d", digits)
	local whole = string.sub(text, 1, wholeDigits)
	local fraction = string.gsub(string.sub(text, wholeDigits + 1), "0+$", "")
	if fraction == "" then
		return whole
	end
	return whole .. "." .. fraction
end

-- Fixed-point text with at most `decimals` decimals; trailing zeros (and a dangling point) are removed.
local function fixed(value: number, decimals: number): string
	local text = string.format("%." .. decimals .. "f", value)
	if decimals > 0 then
		text = string.gsub(text, "0+$", "")
		text = string.gsub(text, "%.$", "")
	end
	if text == "-0" then
		return "0"
	end
	return text
end

local function sanitizeDecimals(decimals: number?, default: number): number
	if not isNumber(decimals) then
		return default
	end
	return math.clamp(math.floor(decimals :: number), 0, 12)
end

-- Whole non-negative seconds; math.huge when the amount is too large to print digit by digit.
local function wholeSeconds(seconds: number): number
	if not isNumber(seconds) or seconds <= 0 then
		return 0
	end
	if seconds >= EXACT_LIMIT then
		return math.huge
	end
	return math.floor(seconds)
end

local function abbreviateWith(n: number, roundDown: boolean): string
	if not isNumber(n) then
		return "0"
	end
	if n < 0 then
		local text = abbreviateWith(-n, roundDown)
		return if text == "0" then text else "-" .. text
	end
	if n == math.huge then
		return INFINITY
	end
	local whole = if roundDown then math.floor(n) else math.floor(n + 0.5)
	if whole < 1000 then
		return string.format("%d", whole)
	end
	local digits, exponent = threeDigits(n, roundDown)
	if exponent >= SCIENTIFIC_EXPONENT then
		return pointAfter(digits, 1) .. "e" .. exponent
	end
	return pointAfter(digits, exponent % 3 + 1) .. SUFFIXES[exponent // 3]
end

function NumberFormat.abbreviate(n: number): string
	return abbreviateWith(n, false)
end

function NumberFormat.abbreviateFloor(n: number): string
	return abbreviateWith(n, true)
end

function NumberFormat.commas(n: number): string
	if not isNumber(n) then
		return "0"
	end
	if n < 0 then
		local text = NumberFormat.commas(-n)
		return if text == "0" then text else "-" .. text
	end
	if n >= EXACT_LIMIT then
		return NumberFormat.abbreviate(n)
	end
	-- Group from the right: reverse, put a comma after every 3 digits, reverse back.
	local reversed = string.reverse(string.format("%d", math.floor(n + 0.5)))
	local grouped = string.reverse((string.gsub(reversed, "(%d%d%d)", "%1,")))
	if string.sub(grouped, 1, 1) == "," then
		grouped = string.sub(grouped, 2)
	end
	return grouped
end

function NumberFormat.decimal(x: number, decimals: number?): string
	if not isNumber(x) then
		return "0"
	end
	if math.abs(x) == math.huge then
		return if x < 0 then "-" .. INFINITY else INFINITY
	end
	if math.abs(x) >= EXACT_LIMIT then
		return NumberFormat.abbreviate(x)
	end
	return fixed(x, sanitizeDecimals(decimals, 2))
end

function NumberFormat.percent(fraction: number, decimals: number?): string
	if not isNumber(fraction) then
		return "0%"
	end
	local value = fraction * 100
	local magnitude = math.abs(value)
	if magnitude >= EXACT_LIMIT then
		return NumberFormat.decimal(value) .. "%"
	end
	if decimals ~= nil then
		return fixed(value, sanitizeDecimals(decimals, 2)) .. "%"
	end
	if magnitude >= 1 or magnitude == 0 then
		return fixed(value, 2) .. "%"
	end
	-- Below 1 %: three significant digits, so 0.05 % (a Mythic pet) is not flattened to "0.1%" or "0%".
	local places = math.min(2 - math.floor(math.log10(magnitude)), MAX_PERCENT_DECIMALS)
	local text = fixed(value, places)
	if text == "0" then
		return if value > 0 then "<0.000001%" else "0%"
	end
	return text .. "%"
end

function NumberFormat.multiplier(x: number): string
	if not isNumber(x) then
		return "x0"
	end
	-- 999.995 would print as "1000" with two decimals; hand it to abbreviate so it becomes "x1K".
	if math.abs(x) >= 999.995 then
		return "x" .. NumberFormat.abbreviate(x)
	end
	return "x" .. fixed(x, 2)
end

function NumberFormat.duration(seconds: number): string
	local total = wholeSeconds(seconds)
	if total == math.huge then
		return INFINITY
	end
	local days = total // 86400
	local hours = total // 3600 % 24
	local minutes = total // 60 % 60
	if days > 0 then
		return string.format("%dd %02dh", days, hours)
	elseif hours > 0 then
		return string.format("%dh %02dm", hours, minutes)
	elseif minutes > 0 then
		return string.format("%dm %02ds", minutes, total % 60)
	end
	return string.format("%ds", total)
end

function NumberFormat.clock(seconds: number): string
	local total = wholeSeconds(seconds)
	if total == math.huge then
		return INFINITY
	end
	local hours = total // 3600
	local minutes = total // 60 % 60
	if hours > 0 then
		return string.format("%d:%02d:%02d", hours, minutes, total % 60)
	end
	return string.format("%d:%02d", minutes, total % 60)
end

return NumberFormat
