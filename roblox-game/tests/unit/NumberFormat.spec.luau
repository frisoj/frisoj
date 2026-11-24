-- Unit tests for Shared/Util/NumberFormat: exact output formats, rounding carries and degenerate inputs.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local NumberFormat = require(Shared:WaitForChild("Util"):WaitForChild("NumberFormat"))

local NAN = 0 / 0
local INF = math.huge

return function(t)
	-- cases = { { input, expected }, ... }
	local function check(fn: (number) -> string, name: string, cases)
		for _, case in cases do
			local input, expected = case[1], case[2]
			t.equal(fn(input), expected, `{name}({tostring(input)})`)
		end
	end

	t.test("abbreviate: whole numbers below 1000", function()
		check(NumberFormat.abbreviate, "abbreviate", {
			{ 0, "0" },
			{ 1, "1" },
			{ 7, "7" },
			{ 42, "42" },
			{ 100, "100" },
			{ 999, "999" },
		})
	end)

	t.test("abbreviate: fractions below 1000 round to a whole number", function()
		check(NumberFormat.abbreviate, "abbreviate", {
			{ 0.4, "0" },
			{ 0.5, "1" },
			{ 1e-9, "0" },
			{ 12.4, "12" },
			{ 12.6, "13" },
			{ 999.4, "999" },
			{ 999.5, "1K" },
			{ 999.99, "1K" },
		})
	end)

	t.test("abbreviate: three significant digits with trimmed zeros", function()
		check(NumberFormat.abbreviate, "abbreviate", {
			{ 1000, "1K" },
			{ 1e3, "1K" },
			{ 1200, "1.2K" },
			{ 1234, "1.23K" },
			{ 1050, "1.05K" },
			{ 10000, "10K" },
			{ 10500, "10.5K" },
			{ 12345, "12.3K" },
			{ 100000, "100K" },
			{ 123456, "123K" },
			{ 1000000, "1M" },
			{ 1234567, "1.23M" },
			{ 20300000, "20.3M" },
			{ 1.5e9, "1.5B" },
			{ 7.25e12, "7.25T" },
		})
	end)

	t.test("abbreviate: rounds to nearest, halves up, exactly", function()
		check(NumberFormat.abbreviate, "abbreviate", {
			{ 1004, "1K" },
			{ 1005, "1.01K" },
			{ 1234.9, "1.23K" },
			{ 1235, "1.24K" },
			{ 4350, "4.35K" },
			{ 12349, "12.3K" },
			{ 12350, "12.4K" },
			{ 123499, "123K" },
			{ 123500, "124K" },
			{ 1005000, "1.01M" },
		})
	end)

	t.test("abbreviate: rounding carries into the next digit count and the next suffix", function()
		check(NumberFormat.abbreviate, "abbreviate", {
			{ 9994, "9.99K" },
			{ 9995, "10K" },
			{ 9999, "10K" },
			{ 99949, "99.9K" },
			{ 99950, "100K" },
			{ 99999, "100K" },
			{ 999499, "999K" },
			{ 999500, "1M" },
			{ 999950, "1M" },
			{ 999999, "1M" },
			{ 999499999, "999M" },
			{ 999500000, "1B" },
			{ 999999999999, "1T" },
			{ 9.995e35, "1e36" },
		})
	end)

	t.test("abbreviate: every suffix, then scientific notation", function()
		check(NumberFormat.abbreviate, "abbreviate", {
			{ 1e3, "1K" },
			{ 1e6, "1M" },
			{ 1e9, "1B" },
			{ 1e12, "1T" },
			{ 1e15, "1Qa" },
			{ 1e18, "1Qi" },
			{ 1e21, "1Sx" },
			{ 1e24, "1Sp" },
			{ 1e27, "1Oc" },
			{ 1e30, "1No" },
			{ 1e33, "1Dc" },
			{ 2.5e16, "25Qa" },
			{ 4.56e20, "456Qi" },
			{ 1.23e34, "12.3Dc" },
			{ 9.99e35, "999Dc" },
			{ 1e36, "1e36" },
			{ 1.5e40, "1.5e40" },
			{ 1.234e45, "1.23e45" },
			{ 9.999e99, "1e100" },
			{ 1e100, "1e100" },
			{ 1.7976931348623157e308, "1.8e308" },
		})
	end)

	t.test("abbreviate: negative numbers mirror the positive format", function()
		check(NumberFormat.abbreviate, "abbreviate", {
			{ -1, "-1" },
			{ -999, "-999" },
			{ -999.5, "-1K" },
			{ -1500, "-1.5K" },
			{ -999950, "-1M" },
			{ -1.234e45, "-1.23e45" },
			{ -0.4, "0" },
			{ -0, "0" },
		})
	end)

	t.test("abbreviate: NaN, infinity and non-numbers", function()
		t.equal(NumberFormat.abbreviate(NAN), "0")
		t.equal(NumberFormat.abbreviate(INF), "∞")
		t.equal(NumberFormat.abbreviate(-INF), "-∞")
		t.equal(NumberFormat.abbreviate(nil :: any), "0")
		t.equal(NumberFormat.abbreviate("12" :: any), "0")
	end)

	t.test("abbreviate: never prints four digits before a suffix (sweep around every power of ten)", function()
		local function assertShape(value: number)
			local text = NumberFormat.abbreviate(value)
			local mantissa, suffix = string.match(text, "^(%d+%.?%d*)(.*)$")
			t.truthy(mantissa, `unexpected shape "{text}" for {value}`)
			local number = tonumber(mantissa) :: number
			if value >= 999.5 then
				t.truthy(suffix ~= "", `missing suffix in "{text}" for {value}`)
				local limit = if string.sub(suffix, 1, 1) == "e" then 10 else 1000
				t.truthy(number >= 1 and number < limit, `mantissa out of range in "{text}" for {value}`)
			end
			-- at most three significant digits
			local digits = string.gsub(mantissa, "%.", "")
			t.truthy(#digits <= 3, `too many digits in "{text}" for {value}`)
		end
		local factors = { 0.99, 0.9994, 0.99949, 0.9995, 0.99951, 0.99995, 0.999999999, 1, 1.000000001 }
		local carries = { 1.004, 1.005, 9.994, 9.995, 9.9951, 99.94, 99.95, 99.951 }
		for exponent = 3, 60 do
			local power = 10 ^ exponent
			for _, factor in factors do
				assertShape(power * factor)
			end
			for _, factor in carries do
				assertShape(power * factor)
			end
		end
		local value = 1
		while value < 1e70 do
			assertShape(value)
			value *= 1.0371
		end
	end)

	t.test("abbreviate / abbreviateFloor: every exact power of ten prints as 1, 10 or 100 + suffix", function()
		local suffixes = { "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc" }
		for exponent = 3, 35 do
			local power = tonumber("1e" .. exponent) :: number
			local expected = ({ "1", "10", "100" })[exponent % 3 + 1] .. suffixes[exponent // 3]
			t.equal(NumberFormat.abbreviate(power), expected, `abbreviate(1e{exponent})`)
			t.equal(NumberFormat.abbreviateFloor(power), expected, `abbreviateFloor(1e{exponent})`)
		end
		for exponent = 36, 300, 7 do
			local power = tonumber("1e" .. exponent) :: number
			t.equal(NumberFormat.abbreviate(power), "1e" .. exponent)
			t.equal(NumberFormat.abbreviateFloor(power), "1e" .. exponent)
		end
	end)

	t.test("abbreviateFloor: rounds toward zero", function()
		check(NumberFormat.abbreviateFloor, "abbreviateFloor", {
			{ 0, "0" },
			{ 0.9, "0" },
			{ 999, "999" },
			{ 999.9, "999" },
			{ 1000, "1K" },
			{ 1009, "1K" },
			{ 1010, "1.01K" },
			{ 1995, "1.99K" },
			{ 1999, "1.99K" },
			{ 2000, "2K" },
			{ 4350, "4.35K" },
			{ 9999, "9.99K" },
			{ 12349, "12.3K" },
			{ 12399, "12.3K" },
			{ 99999, "99.9K" },
			{ 999999, "999K" },
			{ 1000000, "1M" },
			{ 1234567, "1.23M" },
			{ 999999999999999, "999T" },
			{ 1e15, "1Qa" },
			{ 1.23e30, "1.23No" },
			{ 4.56e22, "45.6Sx" },
			{ 9.99e35, "999Dc" },
			{ 1.999e45, "1.99e45" },
			{ -1999, "-1.99K" },
			{ -0.5, "0" },
			{ NAN, "0" },
			{ INF, "∞" },
			{ -INF, "-∞" },
		})
		t.equal(NumberFormat.abbreviateFloor(nil :: any), "0")
	end)

	t.test("abbreviateFloor: the printed amount is never above the value and at most 1% below it", function()
		local tiers = { K = 1e3, M = 1e6, B = 1e9, T = 1e12, Qa = 1e15, Qi = 1e18, Sx = 1e21, Sp = 1e24 }
		local function printedValue(text: string): number
			local mantissa, suffix = string.match(text, "^(%d+%.?%d*)(%a*)$")
			assert(mantissa, `unexpected shape "{text}"`)
			return (tonumber(mantissa) :: number) * (if suffix == "" then 1 else tiers[suffix])
		end
		local value = 1
		while value < 1e26 do
			-- whole amounts, like real balances
			local amount = math.floor(value)
			local printed = printedValue(NumberFormat.abbreviateFloor(amount))
			t.truthy(printed <= amount * (1 + 1e-12), `{amount} printed as more: {printed}`)
			t.truthy(printed >= amount * 0.99, `{amount} printed more than 1% low: {printed}`)
			local rounded = printedValue(NumberFormat.abbreviate(amount))
			t.truthy(math.abs(rounded - amount) <= amount * 0.005 + 0.5, `{amount} rounded too far: {rounded}`)
			value *= 1.0137
		end
	end)

	t.test("commas", function()
		check(NumberFormat.commas, "commas", {
			{ 0, "0" },
			{ 7, "7" },
			{ 999, "999" },
			{ 1000, "1,000" },
			{ 12345, "12,345" },
			{ 123456, "123,456" },
			{ 1234567, "1,234,567" },
			{ 1000000, "1,000,000" },
			{ 999999999999999, "999,999,999,999,999" },
			{ -1234567, "-1,234,567" },
			{ -999, "-999" },
			{ 1234.4, "1,234" },
			{ 1234.5, "1,235" },
			{ 999.6, "1,000" },
			{ -1234.4, "-1,234" },
			{ -0.2, "0" },
			{ 1e15, "1Qa" },
			{ 2.5e18, "2.5Qi" },
			{ NAN, "0" },
			{ INF, "∞" },
			{ -INF, "-∞" },
		})
		t.equal(NumberFormat.commas(nil :: any), "0")
	end)

	t.test("decimal", function()
		t.equal(NumberFormat.decimal(1.5), "1.5")
		t.equal(NumberFormat.decimal(2), "2")
		t.equal(NumberFormat.decimal(0.333), "0.33")
		t.equal(NumberFormat.decimal(0.666), "0.67")
		t.equal(NumberFormat.decimal(100), "100")
		t.equal(NumberFormat.decimal(1200), "1200")
		t.equal(NumberFormat.decimal(10.5), "10.5")
		t.equal(NumberFormat.decimal(-2.25), "-2.25")
		t.equal(NumberFormat.decimal(-0.001), "0")
		t.equal(NumberFormat.decimal(1.23456, 4), "1.2346")
		t.equal(NumberFormat.decimal(3.14159, 0), "3")
		t.equal(NumberFormat.decimal(250, 0), "250")
		t.equal(NumberFormat.decimal(0.5, 1), "0.5")
		t.equal(NumberFormat.decimal(NAN), "0")
		t.equal(NumberFormat.decimal(INF), "∞")
		t.equal(NumberFormat.decimal(-INF), "-∞")
		t.equal(NumberFormat.decimal(1e20), "100Qi")
		t.equal(NumberFormat.decimal(nil :: any), "0")
	end)

	t.test("percent: default precision", function()
		check(NumberFormat.percent, "percent", {
			{ 0, "0%" },
			{ 1, "100%" },
			{ 2.5, "250%" },
			{ 0.25, "25%" },
			{ 0.5, "50%" },
			{ 0.3, "30%" },
			{ 0.07, "7%" },
			{ 0.045, "4.5%" },
			{ 0.4995, "49.95%" },
			{ 0.15, "15%" },
			{ 1 / 3, "33.33%" },
			{ 0.01, "1%" },
			{ -0.03, "-3%" },
		})
	end)

	t.test("percent: small chances keep three significant digits", function()
		check(NumberFormat.percent, "percent", {
			{ 0.005, "0.5%" },
			{ 0.0005, "0.05%" },
			{ 0.000734, "0.0734%" },
			{ 0.00999, "0.999%" },
			{ 0.009999, "1%" },
			{ 0.0000012, "0.00012%" },
			{ 1e-12, "<0.000001%" },
			{ -1e-12, "0%" },
		})
	end)

	t.test("percent: explicit decimals", function()
		t.equal(NumberFormat.percent(0.12345, 1), "12.3%")
		t.equal(NumberFormat.percent(0.12345, 3), "12.345%")
		t.equal(NumberFormat.percent(0.5, 0), "50%")
		t.equal(NumberFormat.percent(0.0005, 1), "0.1%")
		t.equal(NumberFormat.percent(0.999, 0), "100%")
	end)

	t.test("percent: NaN, infinity and non-numbers", function()
		t.equal(NumberFormat.percent(NAN), "0%")
		t.equal(NumberFormat.percent(INF), "∞%")
		t.equal(NumberFormat.percent(-INF), "-∞%")
		t.equal(NumberFormat.percent(nil :: any), "0%")
	end)

	t.test("multiplier", function()
		check(NumberFormat.multiplier, "multiplier", {
			{ 1, "x1" },
			{ 1.5, "x1.5" },
			{ 2, "x2" },
			{ 1.25, "x1.25" },
			{ 1.234, "x1.23" },
			{ 0.5, "x0.5" },
			{ 10, "x10" },
			{ 100, "x100" },
			{ 12.5, "x12.5" },
			{ 999.99, "x999.99" },
			{ 999.999, "x1K" },
			{ 1500, "x1.5K" },
			{ 2.5e6, "x2.5M" },
			{ 0, "x0" },
			{ NAN, "x0" },
			{ INF, "x∞" },
		})
		t.equal(NumberFormat.multiplier(nil :: any), "x0")
	end)

	t.test("duration", function()
		check(NumberFormat.duration, "duration", {
			{ 0, "0s" },
			{ 1, "1s" },
			{ 12, "12s" },
			{ 59, "59s" },
			{ 59.9, "59s" },
			{ 60, "1m 00s" },
			{ 249, "4m 09s" },
			{ 3599, "59m 59s" },
			{ 3600, "1h 00m" },
			{ 3900, "1h 05m" },
			{ 86399, "23h 59m" },
			{ 86400, "1d 00h" },
			{ 93600, "1d 02h" },
			{ 30 * 86400 + 5 * 3600, "30d 05h" },
			{ -5, "0s" },
			{ NAN, "0s" },
			{ INF, "∞" },
			{ 1e300, "∞" },
		})
		t.equal(NumberFormat.duration(nil :: any), "0s")
	end)

	t.test("clock", function()
		check(NumberFormat.clock, "clock", {
			{ 0, "0:00" },
			{ 5, "0:05" },
			{ 59, "0:59" },
			{ 60, "1:00" },
			{ 65, "1:05" },
			{ 754, "12:34" },
			{ 754.9, "12:34" },
			{ 3599, "59:59" },
			{ 3600, "1:00:00" },
			{ 3723, "1:02:03" },
			{ 360000, "100:00:00" },
			{ -1, "0:00" },
			{ NAN, "0:00" },
			{ INF, "∞" },
		})
		t.equal(NumberFormat.clock(nil :: any), "0:00")
	end)
end
