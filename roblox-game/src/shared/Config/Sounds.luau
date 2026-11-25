--!strict
--[[
	Config.Sounds — sound effects by name, using only sound files built into every Roblox client
	(rbxasset://sounds/...), so the game needs no uploaded audio. An empty `id` means "no sound".

	Shape: Sounds.byId[name] where name is "Click", "Hit", "LevelUp" ... (the SoundDef's own `id` field is the
	asset id); Sounds.Music is a list of music asset ids ("rbxassetid://123") that is empty by default - the
	owner may add licensed tracks, and all code must work with the empty list.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))

type SoundDef = Types.SoundDef

local PREFIX = "rbxasset://sounds/"

local function sound(file: string, volume: number, pitch: number?): SoundDef
	return { id = PREFIX .. file, volume = volume, pitch = pitch }
end

local byId: { [string]: SoundDef } = {
	-- Interface
	Click = sound("clickfast.wav", 0.6),
	Hover = sound("switch.wav", 0.15, 1.6),
	Open = sound("pageturn.wav", 0.5),
	Close = sound("pageturn.wav", 0.4, 0.85),
	Error = sound("bass.wav", 0.5, 0.7),
	Purchase = sound("button.wav", 0.6, 1.1),
	Reward = sound("electronicpingshort.wav", 0.5, 1.2),
	Equip = sound("unsheath.wav", 0.4, 1.3),
	-- Smashing
	Swing = sound("swordslash.wav", 0.3, 1.1),
	Hit = sound("hit.wav", 0.5),
	Crit = sound("swordlunge.wav", 0.55, 1.2),
	Break = sound("collide.wav", 0.7, 1.3),
	Coin = sound("electronicpingshort.wav", 0.25, 1.5),
	Gem = sound("electronicpingshort.wav", 0.4, 2),
	-- Progress
	LevelUp = sound("victory.wav", 0.6),
	Unlock = sound("victory.wav", 0.7, 1.15),
	Rebirth = sound("victory.wav", 0.8, 0.8),
	-- Eggs
	Hatch = sound("snap.mp3", 0.6),
	Reveal = sound("action_jump.mp3", 0.5, 1.2),
	RareReveal = sound("victory.wav", 0.7, 1.3),
	-- Boss
	BossSpawn = sound("bass.wav", 0.8, 0.5),
	BossDefeat = sound("victory.wav", 0.9, 0.9),
}

local Music: { string } = {}

return {
	byId = byId,
	Music = Music,
}
