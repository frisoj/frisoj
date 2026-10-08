-- Simuleert meerdere servers die dezelfde DataStore delen en test het sessie-slot.
-- Gebruik: lune run tools/tests/playerdata-lock.test.luau <projectmap>
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local serde = require("@lune/serde")
local process = require("@lune/process")
local root = process.args[1]

local clock = 1000000
local onWait = nil
local storeData = {}
local function deepcopy(v) return if v == nil then nil else serde.decode("json", serde.encode("json", v)) end
local DataStore = {}
function DataStore:UpdateAsync(key, fn)
  local new = fn(deepcopy(storeData[key]))
  if new ~= nil then storeData[key] = deepcopy(new) end
  return new
end
local Config = { DATASTORE_NAME = "test" }

local function makeServer(jobId)
  local services = {
    DataStoreService = { GetDataStore = function() return DataStore end },
    RunService = { IsStudio = function() return false end },
    HttpService = { GenerateGUID = function() return "guid" end },
    ReplicatedStorage = { WaitForChild = function() return { WaitForChild = function() return "CONFIG" end } end },
  }
  local game = { JobId = jobId, GetService = function(_, name) return services[name] end }
  local env = setmetatable({
    game = game,
    require = function(x) assert(x == "CONFIG"); return Config end,
    os = { time = function() return clock end },
    task = { wait = function(s) clock += s or 0; if onWait then onWait() end end },
    warn = function(...) print("  warn:", ...) end,
  }, { __index = _G })
  return luau.load(fs.readFile(root .. "/src/server/PlayerData.luau"), { environment = env, debugName = "PlayerData-" .. jobId })()
end

local fails = 0
local function check(c, m) if not c then fails += 1; print("FAIL: " .. m) else end end
local player = { UserId = 42, Name = "Friso", Parent = true }

-- 1. Server A laadt, speelt, en slaat op.
local A = makeServer("A")
local dA = A.load(player)
check(dA ~= nil and storeData.u_42.lock.id == "A", "A neemt het slot")
dA.goo = 500; dA.totalGoo = 500
check(A.save(player), "A slaat op")

-- 2. Server B laadt terwijl A het slot nog heeft; A geeft het slot vrij tijdens het wachten.
local B = makeServer("B")
local waits = 0
onWait = function()
  waits += 1
  if waits == 2 then dA.goo = 900; A.release(player) end
end
local dB = B.load(player)
onWait = nil
check(dB ~= nil and dB.goo == 900, "B wacht en krijgt de nieuwste save (900), kreeg " .. tostring(dB and dB.goo))
check(storeData.u_42.lock.id == "B", "B heeft nu het slot")

-- 3. Server C neemt het over als B nooit vrijgeeft (bijv. hangt), daarna mag B niet meer overschrijven.
local C = makeServer("C")
local dC = C.load(player)
check(dC ~= nil and storeData.u_42.lock.id == "C", "C neemt het slot over na wachten")
dB.goo = 1
check(B.save(player) == false, "B mag de save van C niet overschrijven")
check(storeData.u_42.goo == 900, "save is niet teruggezet door B")

-- 4. Verlopen slot (gecrashte server) wordt direct overgenomen.
C.save(player)
clock += 400
local D = makeServer("D")
local before = clock
local dD = D.load(player)
check(dD ~= nil and clock == before, "verlopen slot: D laadt meteen")

-- 5. Offline-tijd wordt bij het laden gemeten.
check(D.awaySeconds(player) == 400, "afwezigheid gemeten: " .. D.awaySeconds(player))

-- 6. Oude save zonder nieuwe velden wordt aangevuld; een fusie blijft bewaard.
storeData.u_7 = { goo = 12, lab = { ["1"] = { s = "Gloop", f = 0 } }, fusing = { s = "Gloop", f = 1, readyAt = 5 } }
local E = makeServer("E")
local dE = E.load({ UserId = 7, Name = "Oud", Parent = true })
check(dE ~= nil and dE.goo == 12 and dE.rebirths == 0 and type(dE.dex) == "table", "oude save aangevuld")
check(dE ~= nil and dE.fusing ~= nil and dE.fusing.s == "Gloop", "fusie overgenomen")
check(dE ~= nil and dE.lab["1"].s == "Gloop", "slijmpjes in het lab overgenomen")
print(fails == 0 and "ALLE SLOT-TESTS GESLAAGD" or (fails .. " MISLUKT"))
if fails > 0 then process.exit(1) end
