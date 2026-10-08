--!strict
-- Goo-stormen: elke 6 minuten een storm die slijmpjes muteert (Gold ×2 tot Rainbow ×15).
-- Nieuwe rivier-slijmpjes krijgen de mutatie (Stream kijkt naar het attribuut "Weather"),
-- en slijmpjes in de labs kunnen geraakt worden.

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Slimes = require(Shared:WaitForChild("Slimes"))

local Server = script.Parent
local PlayerData = require(Server:WaitForChild("PlayerData"))
local Passes = require(Server:WaitForChild("Passes"))
local Economy = require(Server:WaitForChild("Economy"))
local Labs = require(Server:WaitForChild("Labs"))
local Remotes = require(Server:WaitForChild("Remotes"))

local Weather = {}

local rng = Random.new()
local nextStorm = 0
local nextStrike = 0

local function now(): number
	return Workspace:GetServerTimeNow()
end

function Weather.current(): string?
	local w = Workspace:GetAttribute("Weather")
	if typeof(w) == "string" and w ~= "" and (tonumber(Workspace:GetAttribute("WeatherEnds")) or 0) > now() then
		return w
	end
	return nil
end

function Weather.begin(mutation: string, buyer: Player?)
	local info = Slimes.MUTATIONS[mutation]
	if not info then
		return
	end
	local t = now()
	Workspace:SetAttribute("Weather", mutation)
	Workspace:SetAttribute("WeatherEnds", t + Config.STORM_SECONDS)
	nextStorm = t + Config.STORM_SECONDS + Config.STORM_EVERY
	Workspace:SetAttribute("NextStorm", nextStorm)
	nextStrike = t + Config.STORM_STRIKE_EVERY
	local text = if buyer
		then string.format("%s started a %s! (%s x%d)", buyer.DisplayName, string.upper(info.storm), info.name, info.mult)
		else string.format("A %s is coming! %s slimes x%d", string.upper(info.storm), info.name, info.mult)
	Economy.announce(text, string.format("#%02X%02X%02X", info.color[1], info.color[2], info.color[3]))
end

local function strike(mutation: string)
	local mult = Slimes.mutationMult(mutation)
	for player, data in PlayerData.all() do
		local lab = Labs.get(player)
		if lab then
			local chance = Config.STORM_STRIKE_CHANCE * (if Passes.has(player, "LuckyCharm") then 2 else 1)
			local changed = false
			for key, slime in data.lab do
				local pad = tonumber(key)
				if pad and not Economy.isInTransit(player, pad) and Slimes.mutationMult(slime.m) < mult and rng:NextNumber() < chance then
					slime.m = mutation
					changed = true
					local isNew = Economy.discover(player, slime)
					Remotes.Effect:FireAllClients("strike", Labs.padPosition(lab, pad), { mut = mutation })
					Economy.notify(player, string.format("The storm turned your %s into %s!", Slimes.BY_ID[slime.s].name, Slimes.displayName(slime)), if isNew then "rare" else "good")
				end
			end
			if changed then
				Economy.labChanged:Fire(player)
			end
		end
	end
end

function Weather.start()
	nextStorm = now() + Config.STORM_EVERY * 0.5
	Workspace:SetAttribute("Weather", "")
	Workspace:SetAttribute("WeatherEnds", 0)
	Workspace:SetAttribute("NextStorm", nextStorm)
	task.spawn(function()
		while true do
			task.wait(1)
			local ok, err = pcall(function()
				local t = now()
				local active = Weather.current()
				if active then
					if t >= nextStrike then
						nextStrike = t + Config.STORM_STRIKE_EVERY
						strike(active)
					end
				else
					if Workspace:GetAttribute("Weather") ~= "" then
						Workspace:SetAttribute("Weather", "")
					end
					if t >= nextStorm then
						Weather.begin(Slimes.rollStorm(function()
							return rng:NextNumber()
						end))
					end
				end
			end)
			if not ok then
				warn("[Weather]", err)
			end
		end
	end)
end

return Weather
