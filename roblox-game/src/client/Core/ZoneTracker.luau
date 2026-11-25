--!strict
--[[
	ZoneTracker — which island the local player is on (spec §13.1). Reads the `ZoneMarker` parts the world
	builder places at every island centre (attributes ZoneId, Radius) and polls the character's position.

	    ZoneTracker.getZoneId()             -- island under the character; nil on bridges / in the void
	    ZoneTracker.getNearestZoneId()      -- nearest island centre; "" until the markers exist
	    ZoneTracker.getZoneCenter(zoneId)   -- Vector3? of that island's marker
	    ZoneTracker.Changed                 -- Signal (zoneId: string?) when getZoneId() changes
	    ZoneTracker.NearestChanged          -- Signal (zoneId: string) when getNearestZoneId() changes

	Like the server (WorldService.getZoneAt) only the horizontal position counts. While the character is missing
	(respawning) the last known values are kept.
]]

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Signal = require(Shared:WaitForChild("Util"):WaitForChild("Signal"))

local ZoneTracker = {}

local Changed: Signal.Signal<string?> = Signal.new()
local NearestChanged: Signal.Signal<string> = Signal.new()
ZoneTracker.Changed = Changed -- (zoneId: string?)
ZoneTracker.NearestChanged = NearestChanged -- (zoneId: string)

local MARKER_TAG = "ZoneMarker"
local POLL_INTERVAL = 0.25

type Marker = { part: BasePart, zoneId: string, radius: number }

local markers: { [Instance]: Marker } = {}
local byZone: { [string]: Marker } = {}
local currentZoneId: string? = nil
local nearestZoneId = ""

local function rebuildIndex()
	table.clear(byZone)
	for _, marker in markers do
		byZone[marker.zoneId] = marker
	end
end

local function readMarker(instance: Instance)
	markers[instance] = nil
	if instance:IsA("BasePart") and CollectionService:HasTag(instance, MARKER_TAG) then
		local zoneId = instance:GetAttribute("ZoneId")
		if type(zoneId) == "string" and zoneId ~= "" then
			local radius = instance:GetAttribute("Radius")
			markers[instance] = {
				part = instance,
				zoneId = zoneId,
				radius = if type(radius) == "number" and radius > 0 then radius else Config.Game.islandRadius,
			}
		end
	end
	rebuildIndex()
end

local function characterPosition(): Vector3?
	local character = Players.LocalPlayer.Character
	if not character then
		return nil
	end
	local root = character.PrimaryPart or character:FindFirstChild("HumanoidRootPart")
	if root and root:IsA("BasePart") then
		return root.Position
	end
	return nil
end

local function update()
	local position = characterPosition()
	if not position then
		return
	end
	local inside: string? = nil
	local nearest = ""
	local nearestDistance = math.huge
	for _, marker in markers do
		local center = marker.part.Position
		local dx = position.X - center.X
		local dz = position.Z - center.Z
		local distance = math.sqrt(dx * dx + dz * dz)
		if distance < nearestDistance then
			nearestDistance = distance
			nearest = marker.zoneId
		end
		if distance <= marker.radius then
			inside = marker.zoneId
		end
	end
	if nearest ~= "" and nearest ~= nearestZoneId then
		nearestZoneId = nearest
		NearestChanged:Fire(nearest)
	end
	if inside ~= currentZoneId then
		currentZoneId = inside
		Changed:Fire(inside)
	end
end

-- Id of the island under the local character, or nil on bridges and in the void.
function ZoneTracker.getZoneId(): string?
	return currentZoneId
end

-- Id of the island whose centre is nearest to the local character. "" until the world's markers exist.
function ZoneTracker.getNearestZoneId(): string
	return nearestZoneId
end

-- Centre of an island (the position of its ZoneMarker), or nil for an unknown zone.
function ZoneTracker.getZoneCenter(zoneId: string): Vector3?
	local marker = byZone[zoneId]
	return if marker then marker.part.Position else nil
end

-- Re-evaluates the position right now instead of waiting for the next poll (after a teleport, in tests).
function ZoneTracker.refresh()
	update()
end

local function onMarkerAdded(instance: Instance)
	readMarker(instance)
	-- Attributes may arrive (or be set) after the tag.
	instance:GetAttributeChangedSignal("ZoneId"):Connect(function()
		readMarker(instance)
	end)
	instance:GetAttributeChangedSignal("Radius"):Connect(function()
		readMarker(instance)
	end)
end

CollectionService:GetInstanceAddedSignal(MARKER_TAG):Connect(onMarkerAdded)
CollectionService:GetInstanceRemovedSignal(MARKER_TAG):Connect(function(instance: Instance)
	markers[instance] = nil
	rebuildIndex()
end)
for _, instance in CollectionService:GetTagged(MARKER_TAG) do
	onMarkerAdded(instance)
end

task.spawn(function()
	while true do
		local ok, message = pcall(update :: (...any) -> ...any)
		if not ok then
			warn(`[ZoneTracker] update failed: {tostring(message)}`)
		end
		task.wait(POLL_INTERVAL)
	end
end)

return ZoneTracker
