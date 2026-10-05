-- Test de gedeelde logica (luchten, kansen, opmaak, upgrades, live-events) in Lune.
-- Gebruik: lune run tools/tests/shared.test.luau <projectmap>
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local roblox = require("@lune/roblox")
local process = require("@lune/process")
local root = process.args[1]

local RandomShim = {}
RandomShim.__index = RandomShim
function RandomShim.new(seed) math.randomseed(seed or os.time()); return setmetatable({}, RandomShim) end
function RandomShim:NextNumber(a, b) a = a or 0; b = b or 1; return a + math.random() * (b - a) end

local env = setmetatable({ Color3 = roblox.Color3, Enum = roblox.Enum, Random = RandomShim }, { __index = _G })
local cache = {}
local function load(name)
  if cache[name] then return cache[name] end
  local src = fs.readFile(root .. "/src/shared/" .. name .. ".luau")
  local fn = luau.load(src, { debugName = name, environment = env })
  cache[name] = fn()
  return cache[name]
end

local SkyForecast, Biomes, Driftlings, Format, Upgrades = load("SkyForecast"), load("Biomes"), load("Driftlings"), load("Format"), load("Upgrades")
local LiveEvents = load("LiveEvents")
local failures = 0
local function check(cond, msg) if not cond then failures += 1; print("FAIL: " .. msg) end end

-- SkyForecast
check(SkyForecast.current(1790996400) == "Eclipse", "eclipse op 03:00 UTC")
local b, left = SkyForecast.current(1790996400 + 599.5); check(b == "Eclipse" and math.abs(left - 0.5) < 1e-6, "eclipse duurt 10 min")
check(SkyForecast.nextEclipse(1790996400 + 601) == 1790996400 + 10800, "volgende eclips 3 uur later")
for _, id in SkyForecast.ROTATION do check(Biomes.LIST[id] ~= nil, "biome bestaat: " .. id) end
for _, id in Biomes.ORDER do local bb = Biomes.LIST[id]; check(bb.mutation == nil or Biomes.MUTATIONS[bb.mutation] ~= nil, "mutatie bestaat voor " .. id) end

-- Driftlings: elke soort heeft een bekende zeldzaamheid, rolls geven geldige soorten
for _, id in Driftlings.ORDER do local s = Driftlings.SPECIES[id]; check(s and Driftlings.RARITY_BY_ID[s.rarity], "soort " .. id) end
local rng = RandomShim.new(1)
for _, biome in Biomes.ORDER do
  local counts, total = {}, 200000
  for _ = 1, total do local id = Driftlings.roll(rng, "sky", biome); counts[id] = (counts[id] or 0) + 1 end
  for id, n in counts do
    local s = Driftlings.SPECIES[id]
    check(s.zone == "sky", biome .. ": eilandsoort in de lucht: " .. id)
    check(s.biome == nil or s.biome == biome, biome .. ": " .. id .. " hoort niet in deze lucht")
  end
  local line = {}
  for _, id in Driftlings.ORDER do if counts[id] then table.insert(line, string.format("%s %.2f%%", id, counts[id] / total * 100)) end end
  print(biome .. ": " .. table.concat(line, ", "))
end
local isl = {}
for _ = 1, 50000 do local id = Driftlings.roll(rng, "island", "GoldenHour"); isl[id] = (isl[id] or 0) + 1 end
check(isl.PuffinPilot and isl.Owlbatross, "eilandsoorten verschijnen op eiland in Golden Hour")

-- Format
check(Format.number(950) == "950", "950")
check(Format.number(12345) == "12,345", "12,345 -> " .. Format.number(12345))
check(Format.number(1250000) == "1.25M", "1.25M -> " .. Format.number(1250000))
check(Format.number(250000) == "250K", "250K -> " .. Format.number(250000))
check(Format.number(1000000000) == "1B", "1B -> " .. Format.number(1000000000))
check(Format.clock(125) == "02:05", "clock")

-- Upgrades
check(Upgrades.value("Net", 1) == 12 and Upgrades.nextCost("Net", 1) == 150, "net lvl1")
check(Upgrades.nextCost("Glider", 5) == nil, "glider max")
check(Upgrades.value("Nest", 99) == 18, "nest clamp")

-- LiveEvents: zaterdag 3 oktober 2026 17:00 UTC = 1791046800
local sat = 1791046800
local active, left = LiveEvents.captainsCall(sat + 60)
check(active and left == 20 * 60 - 60, "Captain's Call actief op zaterdag 17:01 UTC")
active, left = LiveEvents.captainsCall(sat - 3600)
check(not active and left == 3600, "Captain's Call start over 1 uur")
active, left = LiveEvents.captainsCall(sat + 20 * 60)
check(not active and left == 7 * 86400 - 20 * 60, "na afloop: volgende over een week")
check(LiveEvents.pearlMultiplier(sat + 5) == 2 and LiveEvents.pearlMultiplier(sat + 3600) == 1, "event-multiplier")
check(LiveEvents.formatCountdown(2 * 86400 + 3 * 3600 + 12 * 60 + 44) == "2d 03:12:44", "aftellen met dagen")
check(LiveEvents.formatCountdown(75) == "01:15", "aftellen kort")

print(failures == 0 and "ALLE TESTS GESLAAGD" or (failures .. " TESTS MISLUKT"))
if failures > 0 then process.exit(1) end
