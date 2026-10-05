-- Gebruik: lune run tools/build-place <scripts.rbxl> <uitvoer.rbxl>
-- Neemt het door Rojo gebouwde bestand (alleen scripts) en voegt de map toe.

local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local MapBuilder = require("./MapBuilder")

local input, output = process.args[1], process.args[2]
assert(input and output, "Gebruik: lune run tools/build-place <scripts.rbxl> <uitvoer.rbxl>")

local game = roblox.deserializePlace(fs.readFile(input))
local stats = MapBuilder.build(game)
fs.writeFile(output, roblox.serializePlace(game))

print(string.format("Map gebouwd: %d onderdelen, %d lijf-bollen, spuitgat op Y=%.1f, rug op Y=%.1f",
	stats.parts, stats.spheres, stats.blowholeTop, stats.backTop))
print("Geschreven naar " .. output)
