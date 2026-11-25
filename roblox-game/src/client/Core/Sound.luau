--!strict
--[[
	Sound — plays the sound effects of Config.Sounds by name (spec §8).

	    Sound.play("Click")            -- no-op for unknown names and empty ids; never errors
	    Sound.play("Coin", 1.2)        -- optional pitch multiplier (on top of the configured pitch)
	    Sound.sfxVolume()              -- 0..1 from state.settings.sfx (1 until the state has arrived)
	    Sound.musicVolume()            -- 0..1 from state.settings.music (for the music player)

	Sound instances are pooled per name under SoundService.SFX (a few voices each, so fast repeats overlap
	instead of cutting each other off) and identical sounds are rate limited so a burst cannot stack up.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local SoundService = game:GetService("SoundService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local Client = ReplicatedStorage:WaitForChild("Client")
local ClientState = require(Client:WaitForChild("Core"):WaitForChild("ClientState"))

local Sound = {}

-- Simultaneous voices per sound name; when all are busy the oldest one restarts.
local VOICES_PER_SOUND = 4
-- Minimum time between two plays of the same sound.
local MIN_INTERVAL = 0.03
local MIN_PITCH = 0.1
local MAX_PITCH = 4

type Pool = { voices: { Sound }, nextVoice: number, lastPlayed: number }

local pools: { [string]: Pool } = {}
local folder: Folder? = nil

local function getFolder(): Folder
	local existing = folder
	if existing and existing.Parent then
		return existing
	end
	local created = Instance.new("Folder")
	created.Name = "SFX"
	created.Parent = SoundService
	folder = created
	return created
end

local function readSetting(key: string): number
	if not ClientState.isReady() then
		return 1
	end
	local settings = ClientState.get().settings
	local value = if type(settings) == "table" then (settings :: any)[key] else nil
	if type(value) ~= "number" or value ~= value then
		return 1
	end
	return math.clamp(value, 0, 1)
end

-- Volume of sound effects, 0..1 (the player's "sfx" setting).
function Sound.sfxVolume(): number
	return readSetting("sfx")
end

-- Volume of music, 0..1 (the player's "music" setting).
function Sound.musicVolume(): number
	return readSetting("music")
end

local function acquireVoice(name: string, soundId: string): Sound?
	local pool = pools[name]
	if not pool then
		pool = { voices = {}, nextVoice = 1, lastPlayed = -math.huge }
		pools[name] = pool
	end
	local now = os.clock()
	if now - pool.lastPlayed < MIN_INTERVAL then
		return nil
	end
	pool.lastPlayed = now

	for _, voice in pool.voices do
		if not voice.IsPlaying then
			return voice
		end
	end
	if #pool.voices < VOICES_PER_SOUND then
		local voice = Instance.new("Sound")
		voice.Name = name
		voice.SoundId = soundId
		voice.Parent = getFolder()
		table.insert(pool.voices, voice)
		return voice
	end
	-- Everything is busy: restart the voice that has been playing the longest.
	local voice = pool.voices[pool.nextVoice]
	pool.nextVoice = pool.nextVoice % #pool.voices + 1
	return voice
end

local function playNow(name: string, pitch: number?)
	local def = Config.Sounds.byId[name]
	if def == nil or type(def.id) ~= "string" or def.id == "" then
		return
	end
	local volume = (def.volume or 1) * Sound.sfxVolume()
	if volume <= 0 then
		return
	end
	local voice = acquireVoice(name, def.id)
	if not voice then
		return
	end
	local speed = (def.pitch or 1) * (if type(pitch) == "number" and pitch == pitch then pitch else 1)
	voice.Volume = math.clamp(volume, 0, 10)
	voice.PlaybackSpeed = math.clamp(speed, MIN_PITCH, MAX_PITCH)
	voice.TimePosition = 0
	voice:Play()
end

-- Plays the Config.Sounds entry called `name` at the player's sfx volume. `pitch` multiplies the configured
-- pitch (1 = unchanged). Unknown names, empty ids and a muted sfx setting are silent no-ops; never errors.
function Sound.play(name: string, pitch: number?)
	if type(name) ~= "string" then
		return
	end
	local ok, message = pcall(playNow :: (...any) -> ...any, name, pitch)
	if not ok then
		warn(`[Sound] could not play "{name}": {tostring(message)}`)
	end
end

return Sound
