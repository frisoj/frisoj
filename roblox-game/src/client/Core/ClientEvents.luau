--!strict
--[[
	ClientEvents — client-side event bus (spec §13.1). Controllers fire and listen here instead of requiring each
	other, which keeps the require graph free of cycles. Every field is a Shared/Util/Signal.

	    ClientEvents.MenuHighlight:Fire("Hammers", true)          -- Tutorial → HUD: pulse that menu button
	    ClientEvents.LocalSwing:Connect(function() ... end)       -- CombatController fires on every local swing
	    ClientEvents.TargetChanged:Connect(function(model) end)   -- CombatController fires when the target changes
	    ClientEvents.HatchOverlay:Fire(true)                      -- EggController; HUD/popups hide while true
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Signal = require(Shared:WaitForChild("Util"):WaitForChild("Signal"))

local MenuHighlight: Signal.Signal<string, boolean> = Signal.new()
local LocalSwing: Signal.Signal<> = Signal.new()
local TargetChanged: Signal.Signal<Model?> = Signal.new()
local HatchOverlay: Signal.Signal<boolean> = Signal.new()

local ClientEvents = {
	MenuHighlight = MenuHighlight, -- (windowId: string, on: boolean)
	LocalSwing = LocalSwing, -- ()
	TargetChanged = TargetChanged, -- (model: Model?)
	HatchOverlay = HatchOverlay, -- (active: boolean)
}

return ClientEvents
