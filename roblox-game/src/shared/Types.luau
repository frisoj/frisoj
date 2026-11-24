--!strict
--[[
	Types — every data shape shared between server and client (config definitions, saved player data, derived
	stats, replicated state, remote payloads). Types only: the module returns an empty table.

	Usage: local Types = require(Shared:WaitForChild("Types"))  ...  local data: Types.PlayerData = ...
	Field names are a contract with saved data and with every other module — never rename them casually.
]]

---------------------------------------------------------------------------------------------------
-- Config definitions

export type Rarity = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary" | "Mythic" | "Exclusive"

export type ZoneTheme = {
	decor: string, -- "meadow"|"desert"|"snow"|"mushroom"|"lava"|"cavern"|"sky"|"void"
	ground: Color3,
	groundMaterial: Enum.Material,
	cliff: Color3,
	accent: Color3,
	accent2: Color3,
	crystalColors: { Color3 }, -- 3+ colours used for this zone's crystals
	fogColor: Color3,
	ambient: Color3,
	outdoorAmbient: Color3,
	brightness: number,
	clockTime: number,
	fogDensity: number, -- Atmosphere.Density 0..1
}

export type ZoneDef = {
	id: string,
	order: number,
	name: string,
	description: string,
	icon: string, -- emoji
	levelReq: number,
	cost: number, -- coins to unlock (0 for the first zone)
	nodeHealth: number, -- nodeHealth/nodeCoins/nodeXP: stats of a "small" crystal fully smashed
	nodeCoins: number,
	nodeXP: number,
	nodeCount: number,
	eggId: string?,
	theme: ZoneTheme,
}

export type NodeTypeDef = {
	id: string,
	name: string,
	weight: number, -- spawn weight
	healthMult: number,
	coinMult: number,
	xpMult: number,
	gemChance: number, -- chance 0..1 rolled when broken
	gemMin: number,
	gemMax: number,
	scale: number,
	respawnTime: number,
}

export type HammerVisual = {
	headColor: Color3,
	handleColor: Color3,
	material: Enum.Material,
	shape: "block" | "cylinder" | "spike" | "crystal",
	scale: number,
	glow: boolean,
}

export type HammerDef = {
	id: string,
	order: number,
	name: string,
	zoneOrder: number, -- needs that zone unlocked
	cost: number,
	damage: number,
	visual: HammerVisual,
}

export type PetVisual = {
	-- "blob","cat","dog","bunny","bear","fox","bird","dragon","golem","ghost","unicorn","robot"
	archetype: string,
	primary: Color3,
	secondary: Color3,
	flying: boolean,
	scale: number,
}

export type PetDef = { id: string, name: string, rarity: Rarity, power: number, visual: PetVisual }

export type PetTierDef = { tier: number, name: string, powerMult: number } -- 1 Normal, 2 Golden, 3 Rainbow

export type EggEntry = { petId: string, weight: number }

export type EggDef = {
	id: string,
	name: string,
	zoneId: string,
	cost: number, -- always coins
	pets: { EggEntry },
	color: Color3,
	spotColor: Color3,
}

export type UpgradeDef = {
	id: string,
	order: number,
	name: string,
	icon: string,
	description: string,
	maxLevel: number,
	baseCost: number, -- gems: floor(baseCost * costGrowth^level)
	costGrowth: number,
	effectPerLevel: number,
	effectKind: "percent" | "flat", -- how to print the effect
}

-- Boost ids: "coins", "xp", "luck", "damage".
export type BoostDef = { id: string, name: string, icon: string, multiplier: number, color: Color3 }

export type BoostGrant = { id: string, seconds: number }

export type PetGrant = { petId: string, tier: number }

-- Every field optional; a reward can combine several.
export type Reward = {
	coins: number?,
	coinsScaled: number?, -- coinsScaled * Formulas.coinScale(data) coins
	gems: number?,
	xp: number?,
	xpScaled: number?,
	boost: BoostGrant?,
	boosts: { BoostGrant }?,
	pet: PetGrant?,
}

export type GamePassDef = {
	key: string,
	id: number,
	order: number,
	name: string,
	description: string,
	icon: string,
	price: number,
	randomItemRelated: boolean,
}

export type ProductDef = {
	key: string,
	id: number,
	order: number,
	name: string,
	description: string,
	icon: string,
	price: number,
	category: "coins" | "gems" | "boosts" | "special",
	reward: Reward,
	oneTime: boolean,
	grantsCurrency: boolean,
	randomItemRelated: boolean,
	bestValue: boolean?,
}

export type QuestKind = "smash" | "smashBig" | "coins" | "hatch" | "playtime" | "boss" | "upgrade"

export type QuestDef = {
	id: string,
	kind: QuestKind,
	text: string, -- has one %s for the goal
	goal: number,
	goalScaled: boolean, -- goal * coinScale (for "coins")
	reward: Reward,
	weight: number,
}

export type AchievementTier = { goal: number, reward: Reward }

export type AchievementDef = {
	id: string,
	name: string,
	icon: string,
	text: string, -- one %s for the goal
	stat: string, -- key of data.stats, or "level" / "rebirths"
	tiers: { AchievementTier },
}

export type PlaytimeRewardDef = { seconds: number, reward: Reward }

export type CodeDef = { reward: Reward, expires: number? } -- expires = os.time() timestamp (UTC) or nil

-- goalKind: "smash","coins","buyHammer","hatch","unlockZone","upgrade"
-- hint: "crystal","window:Hammers","egg","gate","window:Upgrades"
export type TutorialStep = { id: string, text: string, goalKind: string, goalAmount: number, hint: string }

-- Entry of Config.Sounds; an empty id means "no sound".
export type SoundDef = { id: string, volume: number, pitch: number? }

---------------------------------------------------------------------------------------------------
-- Saved player data (all dictionary keys are strings, arrays are dense, numbers are finite)

export type PetInstance = {
	id: string,
	petId: string,
	tier: number,
	equipped: boolean,
	locked: boolean,
	obtainedAt: number,
}

export type QuestState = { id: string, progress: number, goal: number, claimed: boolean }

export type PlayerSettings = {
	music: number,
	sfx: number,
	showOtherPets: boolean,
	lowDetail: boolean,
	autoSmash: boolean,
	damageNumbers: boolean,
}

export type PlayerData = {
	version: number,
	coins: number,
	gems: number,
	xp: number,
	level: number,
	rebirths: number,
	-- totalCoins, crystalsSmashed, bigCrystals, eggsHatched, playSeconds, bossesDefeated, bossDamage,
	-- upgradesBought, petsDiscovered, robuxSpent, questsClaimed, fuses, hammersBought
	stats: { [string]: number },
	hammers: { owned: { [string]: boolean }, equipped: string },
	zones: { unlocked: { [string]: boolean } },
	pets: { list: { [string]: PetInstance }, nextId: number },
	petIndex: { [string]: boolean },
	upgrades: { [string]: number },
	boosts: { [string]: number }, -- remaining seconds per boost id (only counts down while online)
	quests: { day: number, list: { QuestState } },
	achievements: { [string]: number }, -- claimed tier count per achievement id
	daily: { lastClaimDay: number, streak: number },
	playtime: { day: number, seconds: number, claimed: { [string]: boolean } }, -- key = tostring(index)
	codes: { [string]: boolean },
	purchases: { history: { string }, oneTime: { [string]: boolean } }, -- history = last 100 PurchaseIds
	grantedPasses: { [string]: boolean }, -- passes granted by code/admin (not Robux); usually empty
	settings: PlayerSettings,
	tutorial: { step: number, done: boolean },
	groupRewardClaimed: boolean,
	firstJoin: number,
	lastJoin: number,
	joins: number,
}

---------------------------------------------------------------------------------------------------
-- Derived and replicated state

-- Everything derived; computed by Formulas.computeStats(data, session).
export type Stats = {
	damage: number, -- final damage per normal hit (hammer * multipliers)
	coinMult: number,
	xpMult: number,
	damageMult: number,
	luckMult: number,
	swingCooldown: number,
	range: number,
	critChance: number,
	critMult: number,
	walkSpeed: number,
	gemChanceBonus: number,
	petSlots: number,
	petStorage: number,
	maxHatch: number, -- 1 or 3
	petPower: number, -- sum of equipped pet power (already included in coinMult)
}

-- Replicated, NOT saved.
export type SessionState = {
	passes: { [string]: boolean }, -- owned game passes by key (Robux-owned or granted)
	boostEnds: { [string]: number }, -- workspace:GetServerTimeNow() timestamp when each active boost ends
	stats: Stats,
	friendCount: number,
	premium: boolean,
	inGroup: boolean,
	randomItemsRestricted: boolean, -- PolicyService.ArePaidRandomItemsRestricted
	serverLuck: number, -- reserved, 1
}

-- What the client sees: the saved data plus the session table. Fields of both parts read and write normally and
-- the value converts to PlayerData; to loop over the top-level keys use pairs(state) (the checker cannot iterate
-- an intersection with a bare `for ... in state do`).
export type ReplicatedState = PlayerData & { session: SessionState }

-- One entry of a StateDelta: value == nil deletes the key at path. path[1] == "session" addresses SessionState.
export type StateChange = { path: { string }, value: any }

---------------------------------------------------------------------------------------------------
-- Remote payloads (see Shared/Net)

export type NotifyKind = "success" | "error" | "info" | "reward"

export type NotifyPayload = { kind: NotifyKind, text: string }

export type RewardPopupPayload = { title: string, lines: { string } }

-- HatchEgg response payload: { results = { HatchResult } }
export type HatchResult = { petId: string, tier: number, id: string, isNew: boolean }

export type HatchResponse = { results: { HatchResult } }

-- GetLeaderboard response payload: { entries = { LeaderboardEntry } }
export type LeaderboardEntry = { rank: number, userId: number, name: string, value: number }

export type LeaderboardResponse = { entries: { LeaderboardEntry } }

export type BossDamageEntry = { name: string, damage: number }

export type BossStatePayload = {
	phase: "spawn" | "update" | "end",
	endsAt: number, -- server time (workspace:GetServerTimeNow())
	maxHealth: number,
	health: number,
	defeated: boolean?,
	top: { BossDamageEntry }?,
	yourDamage: number?,
	rewardLines: { string }?,
}

return {}
