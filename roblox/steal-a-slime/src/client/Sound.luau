--!strict
-- Korte geluidjes uit de ingebouwde Roblox-geluiden (geen uploads nodig).

local SoundService = game:GetService("SoundService")

local Sound = {}

local SOUNDS: { [string]: { id: string, volume: number, pitch: number } } = {
	click = { id = "rbxasset://sounds/clickfast.wav", volume = 0.5, pitch = 1.1 },
	buy = { id = "rbxasset://sounds/electronicpingshort.wav", volume = 0.6, pitch = 1.2 },
	coin = { id = "rbxasset://sounds/electronicpingshort.wav", volume = 0.45, pitch = 1.6 },
	rare = { id = "rbxasset://sounds/victory.wav", volume = 0.5, pitch = 1 },
	alarm = { id = "rbxasset://sounds/electronicpingshort.wav", volume = 0.9, pitch = 0.6 },
	bonk = { id = "rbxasset://sounds/swordslash.wav", volume = 0.6, pitch = 1.4 },
	splat = { id = "rbxasset://sounds/splat.wav", volume = 0.6, pitch = 1 },
	swoosh = { id = "rbxasset://sounds/swoosh.wav", volume = 0.5, pitch = 1 },
	lock = { id = "rbxasset://sounds/switch.wav", volume = 0.6, pitch = 0.9 },
	error = { id = "rbxasset://sounds/clickfast.wav", volume = 0.5, pitch = 0.6 },
}

local cache: { [string]: Sound } = {}

function Sound.play(name: string, pitch: number?)
	local info = SOUNDS[name]
	if not info then
		return
	end
	local s = cache[name]
	if not s then
		local snd = Instance.new("Sound")
		snd.SoundId = info.id
		snd.Volume = info.volume
		snd.Parent = SoundService
		cache[name] = snd
		s = snd
	end
	local sound = s :: Sound
	sound.PlaybackSpeed = info.pitch * (pitch or 1)
	SoundService:PlayLocalSound(sound)
end

return Sound
