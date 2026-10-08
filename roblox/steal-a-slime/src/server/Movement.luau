--!strict
-- Loopsnelheid en sprongkracht: basis, Speed Boots en trager lopen met een gestolen slijmpje.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Passes = require(script.Parent:WaitForChild("Passes"))

local Movement = {}

local carrying: { [Player]: boolean } = {}

function Movement.setCarrying(player: Player, value: boolean)
	if value then
		carrying[player] = true
	else
		carrying[player] = nil
	end
	Movement.refresh(player)
end

function Movement.refresh(player: Player)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not humanoid then
		return
	end
	local speed = Config.WALK_SPEED
	local jump = Config.JUMP_POWER
	if Passes.has(player, "SpeedBoots") then
		speed *= Config.SPEED_BOOTS
		jump *= Config.JUMP_BOOTS
	end
	if carrying[player] then
		speed *= if Passes.has(player, "ThiefGloves") then Config.CARRY_SPEED_GLOVES else Config.CARRY_SPEED
	end
	humanoid.UseJumpPower = true
	humanoid.WalkSpeed = speed
	humanoid.JumpPower = jump
end

function Movement.start()
	Passes.changed:Connect(function(player: Player)
		Movement.refresh(player)
	end)
	Players.PlayerRemoving:Connect(function(player)
		carrying[player] = nil
	end)
end

return Movement
